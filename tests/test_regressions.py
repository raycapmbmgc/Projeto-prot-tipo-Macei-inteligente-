import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException

from backend.providers import calculate, search, cache
from backend.schemas import RouteRequest


def test_empty_routes_have_clear_error():
    response = httpx.Response(200, json={'code': 'Ok', 'routes': []},
                              request=httpx.Request('GET', 'https://example.test'))
    body = RouteRequest(origin={'lat': -9, 'lon': -35}, destination={'lat': -9.1, 'lon': -35})
    with patch.dict('os.environ', {'VALHALLA_URL': ''}), patch('httpx.AsyncClient.get', new=AsyncMock(return_value=response)):
        with pytest.raises(HTTPException) as error:
            asyncio.run(calculate(body))
        assert error.value.status_code == 404


def test_concurrent_identical_searches_use_one_provider_request():
    response = httpx.Response(200, json=[{'display_name': 'Maceio', 'lat': '-9.6', 'lon': '-35.7'}],
                              request=httpx.Request('GET', 'https://example.test'))

    async def run():
        import backend.providers as providers
        providers.lock = asyncio.Lock()
        cache.clear()
        with patch('httpx.AsyncClient.get', new=AsyncMock(return_value=response)) as get:
            results = await asyncio.gather(search('Maceio'), search('Maceio'))
            assert results[0] == results[1]
            assert get.await_count == 1

    asyncio.run(run())
