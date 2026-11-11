import hashlib
import asyncio
import json
import os
import secrets
from datetime import datetime,timezone,timedelta
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import select,text
from backend.database import Base,engine,Session,Place,Road,Report
from backend.schemas import RouteRequest,RoadUpdate,RoadCreate,AssistantRequest,PlaceCreate,TransitRequest,ReportCreate,ReportReview,Point
from backend.geo import distance
from backend import transit
from backend import catalog,bus_catalog
from backend.config import valhalla_url
from backend.region import CACHE_SCOPE,require_local_route,require_maceio,is_in_maceio
from backend.traffic import traffic
from backend.assistant import interpret
from backend.providers import search,calculate
ROOT=Path(__file__).resolve().parents[1]
clients=set()
redis_client=None
async def relay():
 async with redis_client.pubsub() as channel:
  await channel.subscribe("maceio:events")
  async for message in channel.listen():
   if message["type"]=="message": await broadcast(json.loads(message["data"]))
@asynccontextmanager
async def lifespan(app):
 (ROOT/'instance').mkdir(exist_ok=True)
 if engine.dialect.name=='sqlite': Base.metadata.create_all(engine)
 with Session.begin() as db:
  seed=json.loads((ROOT/'seed.json').read_text(encoding='utf8'))
  if db.scalar(select(Place.id).limit(1)) is None: db.add_all([Place(id=i+1,data=h,**({'location':f"SRID=4326;POINT({h['lon']} {h['lat']})"} if engine.dialect.name=='postgresql' else {})) for i,h in enumerate(seed['hospitals'])])
  if db.scalar(select(Road.id).limit(1)) is None: db.add_all([Road(id=r['id'],data=r) for r in seed['roads']])
  catalog.sync(db)
  if engine.dialect.name=='postgresql':
   db.execute(text("SELECT setval(pg_get_serial_sequence('places','id'), COALESCE((SELECT MAX(id) FROM places),1), EXISTS(SELECT 1 FROM places))"))
 global redis_client
 task=None
 if os.getenv("REDIS_URL"):
  from redis.asyncio import Redis
  redis_client=Redis.from_url(os.environ["REDIS_URL"],decode_responses=True)
  await redis_client.ping()
  task=asyncio.create_task(relay())
 try: yield
 finally:
  if task:
   task.cancel()
   try: await task
   except asyncio.CancelledError: pass
   await redis_client.aclose()
   redis_client=None
app=FastAPI(title='Maceió Inteligente',lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
@app.middleware('http')
async def asset_cache(request:Request,call_next):
 response=await call_next(request)
 if request.url.path.startswith('/assets/') and response.status_code==200:
  response.headers['Cache-Control']='public, max-age=31536000, immutable'
 elif request.url.path in ('/','/index.html','/sw.js','/manifest.webmanifest'):
  response.headers['Cache-Control']='no-cache'
 return response
@app.middleware('http')
async def protect_writes(request:Request,call_next):
 if (request.method in ('POST','PATCH','DELETE') and request.url.path.startswith(('/api/roads','/api/places','/api/admin'))) or (request.method=='PATCH' and request.url.path.startswith('/api/reports/')) or request.url.path=='/api/admin/indicators':
  token=os.getenv('ADMIN_TOKEN')
  provided=request.headers.get('Authorization','')
  if token and not secrets.compare_digest(provided.encode(),('Bearer '+token).encode()):
   from fastapi.responses import JSONResponse
   return JSONResponse({'detail':'Autenticação administrativa necessária'},status_code=401)
  if not token and request.client and request.client.host not in ('127.0.0.1','::1','testclient'):
   from fastapi.responses import JSONResponse
   return JSONResponse({'detail':'Configure ADMIN_TOKEN para administrar fora deste computador.'},status_code=503)
 return await call_next(request)
@app.get('/api/health')
def health():
 with Session() as db: db.execute(text('SELECT 1'))
 return {'status':'ok','database':engine.dialect.name}
@app.get('/api/capabilities')
def capabilities():
 valhalla=bool(valhalla_url())
 return {'modes':['car','walk','bike','wheelchair'] if valhalla else ['car'],'objectives':['fastest','shortest'],
         'transit':transit.status()['configured'],'bus_catalog':bus_catalog.status()['configured'],'accessibility':False,'accessibility_preferences':valhalla,
         'live_traffic':bool(os.getenv('TRAFFIC_FEED_URL') and os.getenv('TRAFFIC_FEED_SOURCE')),
         'closure_routing':valhalla,'admin_protected':bool(os.getenv('ADMIN_TOKEN')),
         'assistant':True,'assistant_provider':'ollama' if os.getenv('OLLAMA_URL') and os.getenv('OLLAMA_MODEL') else 'local'}

@app.get('/api/catalog/status')
def catalog_status(): return {'healthcare':catalog.status(),'transport':bus_catalog.status()}

@app.post('/api/admin/catalog/reload')
def reload_catalog():
 with Session.begin() as db: catalog.sync(db)
 return catalog_status()

@app.get('/api/transit/catalog/stops')
def catalog_stops(lat:float=Query(ge=-90,le=90),lon:float=Query(ge=-180,le=180),radius:int=Query(default=800,ge=100,le=3000)):
 require_maceio(Point(lat=lat,lon=lon))
 return bus_catalog.nearby_stops(lat,lon,radius)

@app.get('/api/transit/lines')
def bus_lines(q:str=Query(default='',max_length=150),lat:float|None=Query(default=None,ge=-90,le=90),lon:float|None=Query(default=None,ge=-180,le=180),radius:int=Query(default=800,ge=100,le=3000),nearby_only:bool=False):
 if (lat is None)!=(lon is None): raise HTTPException(422,'Informe latitude e longitude juntas.')
 if nearby_only and lat is None: raise HTTPException(422,'Informe uma referência para buscar linhas próximas.')
 if lat is not None: require_maceio(Point(lat=lat,lon=lon))
 return bus_catalog.lines(q,lat,lon,radius,nearby_only)

@app.get('/api/transit/lines/{line_id}')
def bus_geometry(line_id:str): return bus_catalog.route(line_id)

@app.post('/api/admin/session')
def admin_session(): return {'authenticated':True,'local_only':not bool(os.getenv('ADMIN_TOKEN'))}

@app.get('/api/admin/indicators')
def indicators():
 with Session() as db:
  places=list(db.scalars(select(Place)));reports=[r.data for r in db.scalars(select(Report))];roads=[r.data for r in db.scalars(select(Road))]
 return {'hospitals':sum(p.data.get('category','hospital')=='hospital' for p in places),
         'hospitals_with_source':sum(p.data.get('category','hospital')=='hospital' and bool(p.data.get('source')) for p in places),
         'places_with_accessibility_record':sum(bool(p.data.get('verified_at')) and p.data.get('wheelchair') in ('yes','no') for p in places),
         'reports_pending':sum(r['verification']=='unverified' for r in reports),
         'reports_verified':sum(r['verification']=='verified' for r in reports),
         'reports_resolved':sum(r['verification']=='resolved' for r in reports),
         'road_closures':sum(r.get('status')=='Bloqueada' and (not r.get('expires_at') or datetime.fromisoformat(r['expires_at'])>datetime.now(timezone.utc)) for r in roads),
         'generated_at':datetime.now(timezone.utc).isoformat(),'scope':'Somente registros deste sistema; não representa cobertura de toda a cidade.'}

@app.get('/api/reports')
def reports():
 now=datetime.now(timezone.utc)
 with Session() as db:
  return [r.data for r in db.scalars(select(Report)) if r.data['verification']!='rejected' and datetime.fromisoformat(r.data['expires_at'])>now]

@app.post('/api/reports',status_code=201)
async def create_report(body:ReportCreate):
 now=datetime.now(timezone.utc)
 result={'id':'REL_'+uuid4().hex[:16],**body.model_dump(exclude={'consent'}),'verification':'unverified','created_at':now.isoformat(),'expires_at':(now+timedelta(hours=24)).isoformat()}
 with Session.begin() as db: db.add(Report(id=result['id'],data=result))
 await notify({'type':'reports.changed'})
 return result

@app.patch('/api/reports/{report_id}')
async def review_report(report_id:str,body:ReportReview):
 with Session.begin() as db:
  report=db.get(Report,report_id)
  if not report: raise HTTPException(404,'Ocorrência não encontrada')
  report.data=dict(report.data,verification=body.verification,reviewed_at=datetime.now(timezone.utc).isoformat());result=report.data
 await notify({'type':'reports.changed'})
 return result

@app.get('/api/transit/status')
def transit_status(): return transit.status()

@app.get('/api/transit/stops')
def transit_stops(lat:float=Query(ge=-90,le=90),lon:float=Query(ge=-180,le=180),radius:int=Query(default=800,ge=100,le=2000)):
 return transit.stops(lat,lon,radius)

@app.post('/api/transit/journeys')
def transit_journeys(body:TransitRequest):
 require_maceio(body.origin,'Origem');require_maceio(body.destination,'Destino')
 return transit.journeys(body)

@app.get('/api/traffic')
async def traffic_feed(): return await traffic()
@app.get('/api/places/nearby')
def nearby(lat:float=Query(ge=-90,le=90),lon:float=Query(ge=-180,le=180),radius:int=Query(default=3000,ge=100,le=20000),category:str|None=Query(default=None,pattern='^(hospital|tourism|service)$'),wheelchair:bool=False):
 require_maceio(Point(lat=lat,lon=lon))
 with Session() as db:
  if engine.dialect.name=='postgresql':
   rows=db.execute(text('SELECT id,data FROM places WHERE ST_DWithin(location::geography,ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography,:radius)'),{'lat':lat,'lon':lon,'radius':radius})
   candidates=[dict(r.data,id=r.id) for r in rows]
  else:
   candidates=[dict(p.data,id=p.id) for p in db.scalars(select(Place))]
  result=[]
  for p in candidates:
   if p.get('active') is False or not p.get('routable',True) or not is_in_maceio(p.get('lat'),p.get('lon')): continue
   if category and p.get('category','hospital')!=category: continue
   if wheelchair and (p.get('wheelchair')!='yes' or not p.get('verified_at')): continue
   d=distance(lat,lon,p['lat'],p['lon'])
   if d<=radius: result.append(dict(public_place(p),distance_m=round(d)))
  return sorted(result,key=lambda p:p['distance_m'])[:100]

def public_place(data):
 result=dict(data)
 if not is_in_maceio(data.get('lat'),data.get('lon')): result['routable']=False
 if 'source' not in data:
  for key in ('distance','time','status'): result.pop(key,None)
  result.update(category='hospital',source='Demonstração do protótipo; confirme localização e atendimento',wheelchair='unknown',demo=True)
 return result

@app.post('/api/places',status_code=201)
def create_place(body:PlaceCreate):
 require_maceio(body,'Unidade de saúde')
 data=body.model_dump(mode='json');data['name']=data['name'].strip()
 with Session.begin() as db:
  place=Place(data=data,**({'location':f'SRID=4326;POINT({body.lon} {body.lat})'} if engine.dialect.name=='postgresql' else {}))
  db.add(place);db.flush();result=dict(data,id=place.id)
 return result

@app.delete('/api/places/{place_id}',status_code=204)
def delete_place(place_id:int):
 with Session.begin() as db:
  place=db.get(Place,place_id)
  if not place: raise HTTPException(404,'Local não encontrado')
  db.delete(place)
@app.get('/api/hospitals')
def hospitals():
 with Session() as db: return [public_place(dict(p.data,id=p.id)) for p in db.scalars(select(Place).order_by(Place.id)) if p.data.get('category','hospital')=='hospital' and p.data.get('active',True)]
@app.get('/api/roads')
def roads():
 with Session() as db: return [r.data for r in db.scalars(select(Road).order_by(Road.id))]
async def notify(event):
 if redis_client: await redis_client.publish("maceio:events",json.dumps(event))
 else: await broadcast(event)
async def broadcast(event):
 for ws in list(clients):
  try: await ws.send_json(event)
  except Exception: clients.discard(ws)
@app.patch('/api/roads/{road_id}')
async def update_road(road_id:str,body:RoadUpdate):
 with Session.begin() as db:
  road=db.get(Road,road_id)
  if not road: raise HTTPException(404,'Via não encontrada')
  road.data=dict(road.data,**body.model_dump(mode='json',exclude_unset=True));result=road.data
 await notify({'type':'roads.changed','road':result})
 return result
@app.post('/api/roads',status_code=201)
async def create_road(body:RoadCreate):
 road={'id':'RUA_'+uuid4().hex[:10],**body.model_dump(mode='json'),'name':body.name.strip(),'direction':'Dupla','cost':5,'source':'Cadastro administrativo'}
 with Session.begin() as db: db.add(Road(id=road['id'],data=road))
 await notify({'type':'roads.changed','road':road})
 return road
@app.get('/api/search')
async def geocode(q:str=Query(min_length=3,max_length=180)):
 if not redis_client: return await search(q)
 key='geocode:'+CACHE_SCOPE+':'+hashlib.sha256(q.strip().casefold().encode()).hexdigest()
 cached=await redis_client.get(key)
 if cached: return json.loads(cached)
 async with redis_client.lock('geocoder:rate',timeout=30,blocking_timeout=25):
  cached=await redis_client.get(key)
  if cached: return json.loads(cached)
  result=await search(q)
  await redis_client.setex(key,86400,json.dumps(result))
  await asyncio.sleep(1.1)
  return result
@app.post('/api/assistant')
async def assistant(body:AssistantRequest): return await interpret(body.message)
@app.post('/api/routes')
async def route(body:RouteRequest):
 require_local_route(body)
 return await calculate(body)
@app.get('/api/routes')
async def legacy_route(lat:float,lon:float,hospital_id:int):
 with Session() as db:
  h=db.get(Place,hospital_id)
  if not h: raise HTTPException(404,'Hospital não encontrado')
  body=RouteRequest(origin={'lat':lat,'lon':lon},destination={'lat':h.data['lat'],'lon':h.data['lon']})
 require_local_route(body)
 return dict(await calculate(body),code='Ok')
@app.websocket('/ws/events')
async def events(ws:WebSocket):
 if ws.headers.get('origin') and ws.headers['origin'].split('://')[-1]!=ws.headers.get('host'):
  await ws.close(code=1008);return
 await ws.accept();clients.add(ws)
 try:
  while True:
   await ws.receive_text();await ws.send_json({'type':'pong'})
 except WebSocketDisconnect: pass
 finally: clients.discard(ws)
@app.get('/legacy')
def legacy(): return FileResponse(ROOT/'index.html')
@app.get('/branding/logo.png')
def logo(): return FileResponse(ROOT/'frontend'/'public'/'logo-maceio.png',media_type='image/png')
DIST=ROOT/'frontend'/'dist'
if DIST.exists(): app.mount('/',StaticFiles(directory=DIST,html=True),name='frontend')
else:
 @app.get('/')
 def frontend_missing():
  from fastapi.responses import HTMLResponse
  return HTMLResponse('<html lang="pt-BR"><meta charset="utf-8"><title>Maceió Inteligente</title><h1>Frontend ainda não compilado</h1><p>Execute <code>npm.cmd install --prefix frontend</code> e <code>npm.cmd run build --prefix frontend</code>, depois reinicie o servidor.</p><a href="/docs">Documentação da API</a></html>',status_code=503)
