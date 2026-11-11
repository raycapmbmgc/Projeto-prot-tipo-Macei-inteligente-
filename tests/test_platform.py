import os
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from backend.main import app

def test_persistence_and_validation():
 with TestClient(app) as c:
  assert c.get('/api/health').json()['status']=='ok'
  assert c.get('/api/hospitals').json()
  road=c.get('/api/roads').json()[0]
  assert c.patch('/api/roads/'+road['id'],json={'status':'Bloqueada'}).status_code==200
  assert c.get('/api/roads').json()[0]['status']=='Bloqueada'
  assert c.patch('/api/roads/'+road['id'],json={'status':'invalid'}).status_code==422
  assert c.post('/api/roads',json={'name':'   '}).status_code==422
  assert c.post('/api/roads',json={'name':'Via de teste'}).status_code==201
  assert c.post('/api/routes',json={'origin':{'lat':91,'lon':0},'destination':{'lat':0,'lon':0}}).status_code==422

def test_events():
 with TestClient(app) as c:
  with c.websocket_connect('/ws/events') as ws:
   road=c.get('/api/roads').json()[0]
   c.patch('/api/roads/'+road['id'],json={'status':'Liberada'})
   assert ws.receive_json()['type']=='roads.changed'

def test_provider_failure_and_unsupported_modes():
 with TestClient(app) as c:
  body={'origin':{'lat':-9.6,'lon':-35.7},'destination':{'lat':-9.65,'lon':-35.71}}
  with patch.dict(os.environ,{'VALHALLA_URL':''}):
   assert c.post('/api/routes',json=dict(body,mode='walk')).status_code==503
  with patch('backend.main.calculate',new=AsyncMock(return_value={'routes':[]})):
   assert c.post('/api/routes',json=body).json()=={'routes':[]}

def test_admin():
 with TestClient(app) as c,patch.dict(os.environ,{'ADMIN_TOKEN':'test-secret'}):
  assert c.post('/api/roads',json={'name':'New'}).status_code==401
  assert c.post('/api/roads',json={'name':'New'},headers={'Authorization':'Bearer test-secret'}).status_code==201

def test_assistant_uses_local_planner_without_external_model():
 with TestClient(app) as c,patch.dict(os.environ,{'OLLAMA_URL':'','OLLAMA_MODEL':''}):
  response=c.post('/api/assistant',json={'message':'Quero ir ao HGE de ambulância'})
  assert response.status_code==200
  assert response.json()['provider']=='local'
  assert response.json()['vehicle_profile']=='ambulance'
  assert response.json()['destination_query']

def test_osrm_normalization():
 import asyncio
 import httpx
 from backend.providers import calculate
 from backend.schemas import RouteRequest
 raw={'code':'Ok','routes':[{'distance':120,'duration':30,'geometry':{'type':'LineString','coordinates':[[-35,-9],[-35.001,-9]]},'legs':[{'steps':[{'distance':120,'duration':30,'name':'Rua A','maneuver':{'type':'depart','location':[-35,-9]}}]}]}]}
 response=httpx.Response(200,json=raw,request=httpx.Request('GET','https://example.test'))
 with patch.dict(os.environ,{'VALHALLA_URL':''}),patch('httpx.AsyncClient.get',new=AsyncMock(return_value=response)):
  result=asyncio.run(calculate(RouteRequest(origin={'lat':-9,'lon':-35},destination={'lat':-9,'lon':-35.001})))
  assert result['routes'][0]['steps'][0]['street']=='Rua A'
  assert result['routes'][0]['distance']==120
