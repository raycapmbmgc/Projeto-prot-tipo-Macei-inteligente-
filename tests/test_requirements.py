import asyncio
import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from backend.main import app
from backend.providers import calculate
from backend.schemas import RouteRequest


def test_hospitals_do_not_claim_live_availability():
    with TestClient(app) as client:
        hospitals = client.get('/api/hospitals').json()
        assert hospitals
        for hospital in hospitals:
            if hospital.get('demo'):
                assert 'status' not in hospital and 'time' not in hospital
                assert hospital['wheelchair'] == 'unknown'
        response = client.get('/api/places/nearby?lat=-9.65&lon=-35.73&radius=20000&category=hospital')
        assert response.status_code == 200
        distances = [p['distance_m'] for p in response.json()]
        assert distances == sorted(distances)


def test_accessibility_requires_a_record_and_admin_access():
    body = {'name':'Hospital de teste', 'lat':-9.65, 'lon':-35.73, 'source':'Cadastro de teste', 'category':'hospital','wheelchair':'yes'}
    headers = {'Authorization':'Bearer admin-test'}
    with TestClient(app) as client, patch.dict(os.environ, {'ADMIN_TOKEN':'admin-test'}):
        assert client.post('/api/places',json=body).status_code == 401
        assert client.post('/api/places',json=body,headers=headers).status_code == 422
        body['verified_at'] = datetime.now(timezone.utc).isoformat()
        created = client.post('/api/places',json=body,headers=headers)
        assert created.status_code == 201
        nearby = client.get('/api/places/nearby?lat=-9.65&lon=-35.73&wheelchair=true').json()
        assert any(p['id']==created.json()['id'] for p in nearby)
        assert client.get('/api/admin/indicators').status_code == 401
        assert client.get('/api/admin/indicators',headers=headers).json()['places_with_accessibility_record'] >= 1


def test_community_reports_need_consent_and_review_before_affecting_routes():
    body = {'description':'Via bloqueada em teste', 'kind':'blockage','location':{'lat':-9.66,'lon':-35.72}}
    raw = {'trip':{'summary':{'length':1,'time':60},'legs':[{'shape':{'type':'LineString','coordinates':[[-35.7,-9.6],[-35.71,-9.61]]},'maneuvers':[]}]}}
    response = httpx.Response(200,json=raw,request=httpx.Request('POST','https://example.test/route'))
    with TestClient(app) as client, patch.dict(os.environ, {'ADMIN_TOKEN':'review-test','VALHALLA_URL':'https://example.test'}):
        assert client.post('/api/reports',json=body).status_code == 422
        report = client.post('/api/reports',json=dict(body,consent=True,verification='verified')).json()
        assert report['verification'] == 'unverified'
        route = {'origin':{'lat':-9.6,'lon':-35.7},'destination':{'lat':-9.61,'lon':-35.71}}
        with patch('httpx.AsyncClient.post',new=AsyncMock(return_value=response)) as post:
            assert client.post('/api/routes',json=route).status_code == 200
            assert body['location'] not in post.call_args.kwargs['json'].get('exclude_locations',[])
            assert client.patch('/api/reports/'+report['id'],json={'verification':'verified'}).status_code == 401
            assert client.patch('/api/reports/'+report['id'],json={'verification':'verified'},headers={'Authorization':'Bearer review-test'}).status_code == 200
            assert client.post('/api/routes',json=route).status_code == 200
            assert body['location'] in post.call_args.kwargs['json']['exclude_locations']


def test_multiple_stops_and_wheelchair_preferences_reach_the_provider():
    raw = {'trip':{'summary':{'length':1,'time':60},'legs':[{'shape':{'type':'LineString','coordinates':[[-35.7,-9.6],[-35.71,-9.61]]},'maneuvers':[]}]}}
    response = httpx.Response(200,json=raw,request=httpx.Request('POST','https://example.test/route'))
    body = RouteRequest(origin={'lat':-9.6,'lon':-35.7},destination={'lat':-9.61,'lon':-35.71},waypoints=[{'lat':-9.605,'lon':-35.705}],mode='wheelchair',avoid_steps=True,prefer_lit=True,avoid_hills=True)
    with patch.dict(os.environ,{'VALHALLA_URL':'https://example.test'}), patch('httpx.AsyncClient.post',new=AsyncMock(return_value=response)) as post:
        result = asyncio.run(calculate(body))
        payload = post.call_args.kwargs['json']
        assert len(payload['locations']) == 3
        assert payload['locations'][1] == body.waypoints[0].model_dump()
        assert payload['costing_options']['pedestrian'] == {'type':'wheelchair','step_penalty':3600,'use_lit':1,'use_hills':0}
        assert any('não garantem' in w for w in result['warnings'])


def test_stop_limit_and_local_admin_restriction():
    with TestClient(app,client=('203.0.113.9',1234)) as client:
        assert client.post('/api/admin/session').status_code == 503
        assert client.post('/api/roads',json={'name':'Via sem autorização'}).status_code == 503
    with TestClient(app) as client:
        body = {'origin':{'lat':-9.6,'lon':-35.7},'destination':{'lat':-9.61,'lon':-35.71},'waypoints':[{'lat':-9.6,'lon':-35.7}]*6}
        assert client.post('/api/routes',json=body).status_code == 422
