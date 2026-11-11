import hashlib
import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select,text
from backend.database import Base,engine,Session,Place,Road
from backend.schemas import RouteRequest,RoadUpdate,RoadCreate,AssistantRequest
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
app=FastAPI(title='Maceió Inteligente',lifespan=lifespan)
@app.middleware('http')
async def protect_writes(request:Request,call_next):
 if request.method in ('POST','PATCH','DELETE') and request.url.path.startswith('/api/roads'):
  token=os.getenv('ADMIN_TOKEN')
  if token and request.headers.get('Authorization')!='Bearer '+token:
   from fastapi.responses import JSONResponse
   return JSONResponse({'detail':'Autenticação administrativa necessária'},status_code=401)
 return await call_next(request)
@app.get('/api/health')
def health():
 with Session() as db: db.execute(text('SELECT 1'))
 return {'status':'ok','database':engine.dialect.name}
@app.get('/api/capabilities')
def capabilities(): return {'modes':['car','walk','bike'] if os.getenv('VALHALLA_URL') else ['car'],'objectives':['fastest','shortest'],'transit':False,'accessibility':False,'live_traffic':False}
@app.get('/api/places/nearby')
def nearby(lat:float=Query(ge=-90,le=90),lon:float=Query(ge=-180,le=180),radius:int=Query(default=3000,ge=100,le=20000)):
 if engine.dialect.name!='postgresql': raise HTTPException(503,'Consulta espacial requer PostgreSQL/PostGIS')
 with Session() as db:
  rows=db.execute(text('SELECT id,data FROM places WHERE ST_DWithin(location::geography,ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography,:radius)'),{'lat':lat,'lon':lon,'radius':radius})
  return [dict(r.data,id=r.id) for r in rows]
@app.get('/api/hospitals')
def hospitals():
 with Session() as db: return [dict(p.data,id=p.id) for p in db.scalars(select(Place).order_by(Place.id))]
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
  road.data=dict(road.data,status=body.status);result=road.data
 await notify({'type':'roads.changed','road':result})
 return result
@app.post('/api/roads',status_code=201)
async def create_road(body:RoadCreate):
 road={'id':'RUA_'+uuid4().hex[:10],'name':body.name.strip(),'direction':'Dupla','status':'Liberada','cost':5}
 with Session.begin() as db: db.add(Road(id=road['id'],data=road))
 await notify({'type':'roads.changed','road':road})
 return road
@app.get('/api/search')
async def geocode(q:str=Query(min_length=3,max_length=180)):
 if not redis_client: return await search(q)
 key='geocode:'+hashlib.sha256(q.strip().casefold().encode()).hexdigest()
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
async def route(body:RouteRequest): return await calculate(body)
@app.get('/api/routes')
async def legacy_route(lat:float,lon:float,hospital_id:int):
 with Session() as db:
  h=db.get(Place,hospital_id)
  if not h: raise HTTPException(404,'Hospital não encontrado')
  body=RouteRequest(origin={'lat':lat,'lon':lon},destination={'lat':h.data['lat'],'lon':h.data['lon']})
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
DIST=ROOT/'frontend'/'dist'
if DIST.exists(): app.mount('/',StaticFiles(directory=DIST,html=True),name='frontend')
