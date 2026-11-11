import asyncio
import os
import time
import httpx
from fastapi import HTTPException
lock=asyncio.Lock()
last_search=0.0
cache={}
async def search(q):
 global last_search
 key=q.strip().casefold()
 if key in cache and time.monotonic()-cache[key][0]<86400: return cache[key][1]
 async with lock:
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
 url=os.getenv("VALHALLA_URL")
 if not url and body.mode!="car": raise HTTPException(503,"Configure Valhalla para caminhada e bicicleta.")
 try:
  async with httpx.AsyncClient(timeout=20) as client:
   routes=[]
   if url:
    r=await client.post(url.rstrip('/')+'/route',json={"locations":[body.origin.model_dump(),body.destination.model_dump()],"costing":{"car":"auto","walk":"pedestrian","bike":"bicycle"}[body.mode],"alternates":2,"units":"kilometers","language":"pt-BR","shape_format":"geojson"})
    r.raise_for_status();data=r.json()
    for trip in [data['trip']]+[a['trip'] for a in data.get('alternates',[])]:
     coords=[];steps=[]
     for leg in trip['legs']:
      offset=len(coords);coords.extend(leg['shape']['coordinates'])
      for m in leg['maneuvers']: steps.append({'instruction':m['instruction'],'distance':m['length']*1000,'duration':m['time'],'coordinate':coords[offset+m['begin_shape_index']],'street':', '.join(m.get('street_names',[]))})
     routes.append({'distance':trip['summary']['length']*1000,'duration':trip['summary']['time'],'geometry':{'type':'LineString','coordinates':coords},'steps':steps})
   else:
    a,b=body.origin,body.destination
    r=await client.get(f'https://router.project-osrm.org/route/v1/driving/{a.lon},{a.lat};{b.lon},{b.lat}',params={'alternatives':'true','steps':'true','overview':'full','geometries':'geojson'})
    r.raise_for_status();data=r.json()
    if data.get('code')!='Ok': raise ValueError()
    for route in data['routes']:
     steps=[]
     for leg in route['legs']:
      for s in leg['steps']:
       m=s['maneuver'];verb={'depart':'Siga','arrive':'Chegue ao destino','turn':'Vire','roundabout':'Entre na rotatória'}.get(m['type'],'Continue');direction={'left':'à esquerda','right':'à direita','straight':'em frente','slight left':'levemente à esquerda','slight right':'levemente à direita'}.get(m.get('modifier'),'')
       steps.append({'instruction':f"{verb} {direction} {s.get('name','')}".strip(),'coordinate':m['location'],'distance':s['distance'],'duration':s['duration'],'street':s.get('name','')})
     routes.append({'distance':route['distance'],'duration':route['duration'],'geometry':route['geometry'],'steps':steps})
 except (httpx.HTTPError,KeyError,ValueError,TypeError): raise HTTPException(502,'Provedor de rotas indisponível')
 routes.sort(key=lambda r:r['distance' if body.objective=='shortest' else 'duration'])
 return {'routes':routes,'provider':'Valhalla' if url else 'OSRM','explanation':'Menor distância entre as alternativas retornadas.' if body.objective=='shortest' else 'Menor tempo entre as alternativas retornadas.','warnings':['Sem trânsito ao vivo. Bloqueios locais não alteram o trajeto.']}
