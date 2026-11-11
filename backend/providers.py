import asyncio
import os
import time
from datetime import datetime, timezone
import httpx
from fastapi import HTTPException
from backend.config import valhalla_url
from backend.geometry import coordinates as shape_coordinates
lock=asyncio.Lock()
last_search=0.0
cache={}
async def search(q):
 global last_search
 key=q.strip().casefold()
 if key in cache and time.monotonic()-cache[key][0]<86400: return cache[key][1]
 async with lock:
  if key in cache and time.monotonic()-cache[key][0]<86400: return cache[key][1]
  await asyncio.sleep(max(0,1.1-(time.monotonic()-last_search)))
  last_search=time.monotonic()
  try:
   async with httpx.AsyncClient(timeout=12) as client:
    r=await client.get(os.getenv("GEOCODER_URL","https://nominatim.openstreetmap.org/search"),params={"q":q,"format":"jsonv2","limit":5,"countrycodes":"br"},headers={"User-Agent":os.getenv("GEOCODER_USER_AGENT","MaceioInteligente/0.1 local-development")})
    r.raise_for_status()
    result=[{"name":p["display_name"],"lat":float(p["lat"]),"lon":float(p["lon"])} for p in r.json()]
  except (httpx.HTTPError,ValueError,KeyError): raise HTTPException(502,"Pesquisa indisponível")
  if len(cache)>500: cache.clear()
  cache[key]=(time.monotonic(),result)
  return result
async def calculate(body):
 url=valhalla_url()
 if not url and body.mode!="car": raise HTTPException(503,"Configure Valhalla para caminhada e bicicleta.")
 from backend.database import Session,Road,Report
 from sqlalchemy import select
 from backend.traffic import traffic
 excluded=[];unlocated=0
 with Session() as db:
  for road in db.scalars(select(Road)):
   data=road.data
   if data.get('status')!='Bloqueada': continue
   expiry=data.get('expires_at')
   if expiry and datetime.fromisoformat(expiry)<=datetime.now(timezone.utc): continue
   if data.get('location'): excluded.append(data['location'])
   else: unlocated+=1
  for report in db.scalars(select(Report)):
   data=report.data
   if data['verification']=='verified' and data['kind'] in ('blockage','flood') and datetime.fromisoformat(data['expires_at'])>datetime.now(timezone.utc):
    excluded.append(data['location'])
 warnings=['Tempos estimados; lentidão de trânsito não é incorporada ao cálculo.']
 if body.vehicle_profile!='standard': warnings.append('Perfil declarado de veículo: o cálculo mantém as permissões viárias normais e não concede prioridade ou autorização de circulação.')
 try:
  feed=await traffic()
  excluded.extend({'lat':f['geometry']['coordinates'][1],'lon':f['geometry']['coordinates'][0]} for f in feed['features'] if f['properties']['status']=='closed')
 except HTTPException: warnings.append('Fonte de trânsito indisponível; verifique as condições antes de sair.')
 if unlocated: warnings.append(f'{unlocated} bloqueio(s) sem coordenadas não podem alterar o percurso.')
 if excluded and not url: warnings.append('OSRM não considera os bloqueios cadastrados. Configure Valhalla para solicitar desvios.')
 if body.mode=='wheelchair' or body.avoid_steps or body.prefer_lit or body.avoid_hills:
  warnings.append('Preferências dependem do mapeamento OSM: não garantem acessibilidade, iluminação ou ausência de escadas e ladeiras.')
 try:
  async with httpx.AsyncClient(timeout=20,headers={'User-Agent':os.getenv('ROUTER_USER_AGENT','MaceioInteligente/0.2 hospital-route-planner')}) as client:
   routes=[]
   if url:
    costing={"car":"auto","walk":"pedestrian","bike":"bicycle","wheelchair":"pedestrian"}[body.mode]
    options={}
    if body.mode=='wheelchair': options['type']='wheelchair'
    if body.avoid_steps: options['step_penalty']=3600
    if body.prefer_lit: options['use_lit']=1
    if body.avoid_hills: options['use_hills']=0
    payload={"locations":[body.origin.model_dump()]+[p.model_dump() for p in body.waypoints]+[body.destination.model_dump()],"costing":costing,"alternates":2,"units":"kilometers","language":"pt-BR","shape_format":"geojson","costing_options":{costing:options}}
    if excluded: payload['exclude_locations']=excluded
    r=await client.post(url.rstrip('/')+'/route',json=payload)
    r.raise_for_status();data=r.json()
    if data.get('warnings'): warnings.append('O provedor retornou ressalvas: '+str(data['warnings'])[:500])
    if excluded: warnings.append(f'Desvio solicitado ao Valhalla para {len(excluded)} ponto(s) de bloqueio; confira o trajeto retornado.')
    for trip in [data['trip']]+[a['trip'] for a in data.get('alternates',[])]:
     coords=[];steps=[]
     for leg in trip['legs']:
      offset=len(coords);coords.extend(shape_coordinates(leg['shape']))
      for m in leg['maneuvers']: steps.append({'instruction':m['instruction'],'distance':m['length']*1000,'duration':m['time'],'coordinate':coords[offset+m['begin_shape_index']],'street':', '.join(m.get('street_names',[]))})
     routes.append({'distance':trip['summary']['length']*1000,'duration':trip['summary']['time'],'geometry':{'type':'LineString','coordinates':coords},'steps':steps})
   else:
    points=[body.origin]+body.waypoints+[body.destination]
    coordinates=';'.join(f'{p.lon},{p.lat}' for p in points)
    r=await client.get(f'{os.getenv("OSRM_URL","https://router.project-osrm.org").rstrip("/")}/route/v1/driving/{coordinates}',params={'alternatives':'true','steps':'true','overview':'full','geometries':'geojson'})
    r.raise_for_status();data=r.json()
    if data.get('code')!='Ok': raise ValueError()
    for route in data['routes']:
     steps=[]
     for leg in route['legs']:
      for s in leg['steps']:
       m=s['maneuver'];verb={'depart':'Siga','arrive':'Chegue ao destino','turn':'Vire','roundabout':'Entre na rotatória'}.get(m['type'],'Continue');direction={'left':'à esquerda','right':'à direita','straight':'em frente','slight left':'levemente à esquerda','slight right':'levemente à direita'}.get(m.get('modifier'),'')
       steps.append({'instruction':f"{verb} {direction} {s.get('name','')}".strip(),'coordinate':m['location'],'distance':s['distance'],'duration':s['duration'],'street':s.get('name','')})
     routes.append({'distance':route['distance'],'duration':route['duration'],'geometry':route['geometry'],'steps':steps})
 except (httpx.HTTPError,KeyError,ValueError,TypeError,IndexError): raise HTTPException(502,'Provedor de rotas indisponível')
 routes.sort(key=lambda r:r['distance' if body.objective=='shortest' else 'duration'])
 if not routes: raise HTTPException(404,'Nenhum trajeto encontrado entre esses pontos.')
 return {'routes':routes,'provider':'Valhalla' if url else 'OSRM','explanation':'Menor distância entre as alternativas retornadas.' if body.objective=='shortest' else 'Menor tempo entre as alternativas retornadas.','warnings':warnings,'vehicle_profile':body.vehicle_profile,'routing_policy':'normal-road-access'}
