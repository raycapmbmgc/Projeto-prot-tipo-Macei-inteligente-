"""Small live-provider check with public fixed points and an isolated database."""
import json
import os
import time
from pathlib import Path
from tempfile import TemporaryDirectory

with TemporaryDirectory(prefix='maceio-routing-') as temporary:
    os.environ['DATABASE_URL']='sqlite:///'+(Path(temporary)/'qa.sqlite3').as_posix()
    os.environ['REDIS_URL']=''
    os.environ['TRAFFIC_FEED_URL']=''
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.database import engine
    try:
        with TestClient(app) as client:
            destination=next(p for p in client.get('/api/hospitals').json() if 'GERAL DO ESTADO' in p['name'])
            summaries=[]
            for mode in ('car','walk','bike'):
                response=client.post('/api/routes',json={'origin':{'lat':-9.6498,'lon':-35.7089},'destination':{'lat':destination['lat'],'lon':destination['lon']},'mode':mode})
                response.raise_for_status()
                data=response.json();route=data['routes'][0]
                assert route['steps'] and len(route['geometry']['coordinates'])>1
                summaries.append({'mode':mode,'provider':data['provider'],'distance_m':route['distance'],'duration_s':route['duration'],'instructions':len(route['steps'])})
                time.sleep(1.1)
            print(json.dumps({'live_routing':summaries}))
    finally:
        engine.dispose()
