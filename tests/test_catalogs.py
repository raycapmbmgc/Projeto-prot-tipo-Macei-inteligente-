from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend import catalog,bus_catalog
from backend.main import app
from backend.schemas import RouteRequest


def test_official_healthcare_snapshot_is_complete_for_its_imported_types():
    data=catalog.snapshot()
    assert data and data['municipality']=='2704302'
    assert len({r['cnes'] for r in data['facilities']})==len(data['facilities'])
    assert sum(data['type_counts'].values())==len(data['facilities'])
    assert {r['ownership'] for r in data['facilities']} >= {'public','private'}
    assert any(r['facility_type']=='upa' for r in data['facilities'])
    for row in data['facilities']:
        assert row['source_dataset']=='cnes' and row['active']
        assert row['source_url'].startswith(catalog.CNES_URL+'/')
        if row['routable']:
            assert -9.85<=row['lat']<=-9.3 and -35.95<=row['lon']<=-35.45


def test_healthcare_filters_do_not_include_disabled_or_out_of_city_records():
    row={'codigo_municipio':270430,'codigo_tipo_unidade':5,'codigo_cnes':123,'nome_fantasia':'Hospital',
         'descricao_natureza_juridica_estabelecimento':'3999','latitude_estabelecimento_decimo_grau':0,'longitude_estabelecimento_decimo_grau':0}
    item=catalog.normalize(row,datetime.now(timezone.utc).isoformat())
    assert item['ownership']=='private' and item['routable'] is False
    assert item['lat'] is None
    assert catalog.normalize(dict(row,codigo_motivo_desabilitacao_estabelecimento='01'),'date') is None
    with pytest.raises(ValueError):catalog.normalize(dict(row,codigo_municipio=123456),'date')


def test_catalog_api_replaces_seed_and_offers_real_nearby_stops():
    with TestClient(app) as client:
        hospitals=client.get('/api/hospitals').json()
        assert any(r.get('cnes') for r in hospitals)
        assert not any(r.get('demo') for r in hospitals)
        lines=client.get('/api/transit/lines?q=104').json()
        assert any(r['code']=='104' for r in lines['lines'])
        stops=client.get('/api/transit/catalog/stops?lat=-9.67431778273&lon=-35.7612415083&radius=500').json()
        assert stops and any(s['type']=='terminal' for s in stops)
        assert [r['distance_m'] for r in stops]==sorted(r['distance_m'] for r in stops)
        assert client.get('/api/transit/lines?lat=-9.6').status_code==422
        assert client.get('/api/transit/lines/unknown').status_code==404


def test_bus_terminal_links_are_valid_and_not_claimed_as_full_itineraries():
    data=bus_catalog.snapshot()
    assert data
    stops={s['id']:s for s in data['stops']}
    for line in data['lines']:
        assert line['terminal_ids']
        assert all(stop_id in stops and stops[stop_id]['type']=='terminal' for stop_id in line['terminal_ids'])
        assert line['geometry'] is None
    assert bus_catalog.status()['schedule_available'] is False


def test_vehicle_profiles_require_declaration_and_keep_normal_road_access():
    body={'origin':{'lat':-9.65,'lon':-35.7},'destination':{'lat':-9.67,'lon':-35.75},'vehicle_profile':'ambulance'}
    with pytest.raises(ValidationError):RouteRequest(**body)
    with pytest.raises(ValidationError):RouteRequest(**body,authorization_declared=True,mode='walk')
    raw={'trip':{'summary':{'length':1,'time':60},'legs':[{'shape':{'type':'LineString','coordinates':[[-35.7,-9.65],[-35.75,-9.67]]},'maneuvers':[]}]}}
    response=httpx.Response(200,json=raw,request=httpx.Request('POST','https://example.test/route'))
    with TestClient(app) as client, patch('backend.providers.valhalla_url',return_value='https://example.test'),patch('httpx.AsyncClient.post',new=AsyncMock(return_value=response)) as post:
        reply=client.post('/api/routes',json=dict(body,authorization_declared=True))
        assert reply.status_code==200
        assert reply.json()['vehicle_profile']=='ambulance'
        assert reply.json()['routing_policy']=='normal-road-access'
        options=post.call_args.kwargs['json']['costing_options']['auto']
        assert 'ignore_access' not in options and 'ignore_oneways' not in options
