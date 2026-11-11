"""Municipal scope shared with the frontend: Maceió, IBGE 2704302."""
import json
from math import isfinite

from fastapi import HTTPException

from backend.config import ROOT

BOUNDARY=json.loads((ROOT/'data'/'maceio-boundary.json').read_text(encoding='utf8'))
GEOMETRY=BOUNDARY['features'][0]['geometry']
POLYGONS=[GEOMETRY['coordinates']] if GEOMETRY['type']=='Polygon' else GEOMETRY['coordinates']
POINTS=[point for polygon in POLYGONS for ring in polygon for point in ring]
BOUNDS=(min(p[0] for p in POINTS),min(p[1] for p in POINTS),max(p[0] for p in POINTS),max(p[1] for p in POINTS))
CACHE_SCOPE='maceio-ibge-2704302-v1'


def in_ring(lon,lat,ring):
    inside=False
    for i,a in enumerate(ring):
        b=ring[i-1]
        cross=(lon-a[0])*(b[1]-a[1])-(lat-a[1])*(b[0]-a[0])
        if abs(cross)<1e-12 and min(a[0],b[0])-1e-10<=lon<=max(a[0],b[0])+1e-10 and min(a[1],b[1])-1e-10<=lat<=max(a[1],b[1])+1e-10:return True
        if (a[1]>lat)!=(b[1]>lat) and lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]:inside=not inside
    return inside


def is_in_maceio(lat,lon):
    if not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)) or not isfinite(lat) or not isfinite(lon):return False
    if not BOUNDS[0]<=lon<=BOUNDS[2] or not BOUNDS[1]<=lat<=BOUNDS[3]:return False
    return any(in_ring(lon,lat,p[0]) and not any(in_ring(lon,lat,hole) for hole in p[1:]) for p in POLYGONS)


def require_maceio(point,label='Localização'):
    if not is_in_maceio(point.lat,point.lon):raise HTTPException(422,f'{label} fora de Maceió. Informe um ponto dentro do município.')


def require_local_route(body):
    require_maceio(body.origin,'Origem')
    require_maceio(body.destination,'Destino')
    for index,point in enumerate(body.waypoints,1):require_maceio(point,f'Parada {index}')
