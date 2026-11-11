import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock,patch

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.config import ROOT
from backend.main import app
from backend.providers import search,cache
from backend.region import is_in_maceio


@pytest.mark.parametrize('lat,lon',[(-9.6498,-35.7089),(-9.663,-35.699),(-9.48836,-35.57539)])
def test_maceio_neighbourhoods_are_allowed(lat,lon):assert is_in_maceio(lat,lon)


@pytest.mark.parametrize('lat,lon',[(-23.5505,-46.6333),(-9.4788,-35.8531),(0,0),(float('nan'),-35.7)])
def test_other_cities_and_invalid_positions_are_rejected(lat,lon):assert not is_in_maceio(lat,lon)


def test_frontend_and_backend_use_the_same_municipal_boundary():
    assert json.loads((ROOT/'data/maceio-boundary.json').read_text())==json.loads((ROOT/'frontend/src/maceio-boundary.json').read_text())


def test_geocoder_is_bounded_and_filters_out_of_city_results_even_if_provider_ignores_limits():
    response=httpx.Response(200,request=httpx.Request('GET','https://example.test'),json=[
        {'display_name':'Rua de teste, Maceió','lat':'-9.6498','lon':'-35.7089'},
        {'display_name':'Praça da Sé, São Paulo','lat':'-23.5505','lon':'-46.6333'}])
    async def run():
        import backend.providers as providers
        providers.lock=asyncio.Lock();cache.clear()
        with patch('httpx.AsyncClient.get',new=AsyncMock(return_value=response)) as get:
            result=await search('Rua de teste')
            assert len(result)==1 and 'Maceió' in result[0]['name']
            params=get.call_args.kwargs['params']
            assert params['bounded']==1 and 'viewbox' in params and 'Maceió' in params['q']
    asyncio.run(run())


def test_api_does_not_route_from_sao_paulo_or_through_out_of_city_stops():
    local={'lat':-9.6498,'lon':-35.7089};outside={'lat':-23.5505,'lon':-46.6333}
    with TestClient(app) as client,patch('backend.main.calculate',new=AsyncMock()) as calculate:
        for body in ({'origin':outside,'destination':local},{'origin':local,'destination':outside},{'origin':local,'destination':local,'waypoints':[outside]}):
            response=client.post('/api/routes',json=body)
            assert response.status_code==422 and 'Maceió' in response.json()['detail']
        assert calculate.await_count==0


def test_nearby_bus_lines_filter_uses_the_origin_reference():
    with TestClient(app) as client:
        response=client.get('/api/transit/lines?lat=-9.67431778273&lon=-35.7612415083&radius=500&nearby_only=true')
        assert response.status_code==200
        assert all(line['terminal_distance_m']<=500 for line in response.json()['lines'])
        assert client.get('/api/transit/lines?nearby_only=true').status_code==422
