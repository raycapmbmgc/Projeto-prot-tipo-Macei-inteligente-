"""Optional, operator-supplied GeoJSON feed. No fabricated live traffic."""
import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field, AwareDatetime, ValidationError, model_validator

from backend.schemas import Point


class Incident(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    status: Literal['closed', 'slow']
    observed_at: AwareDatetime
    expires_at: AwareDatetime

    @model_validator(mode='after')
    def valid_period(self):
        if self.expires_at <= self.observed_at:
            raise ValueError('Validade anterior à observação')
        return self


_cache = None
_lock = asyncio.Lock()


async def traffic():
    global _cache
    url = os.getenv('TRAFFIC_FEED_URL')
    source = os.getenv('TRAFFIC_FEED_SOURCE')
    if not url or not source:
        return {'configured': False, 'source': None, 'features': [], 'type': 'FeatureCollection'}
    async with _lock:
        if _cache and _cache[0] == url and time.monotonic()-_cache[1] < 30:
            result = _cache[2]
        else:
            try:
                async with httpx.AsyncClient(timeout=8) as client:
                    async with client.stream('GET', url) as response:
                        response.raise_for_status()
                        raw = bytearray()
                        async for chunk in response.aiter_bytes():
                            raw.extend(chunk)
                            if len(raw) > 2_000_000: raise ValueError('Feed muito grande')
                import json
                data = json.loads(raw)
                if data['type'] != 'FeatureCollection' or len(data['features']) > 2000:
                    raise ValueError('GeoJSON inválido')
                features = []
                for feature in data['features']:
                    if feature['geometry']['type'] != 'Point': raise ValueError('Incidente deve ser um ponto')
                    lon, lat = feature['geometry']['coordinates']
                    point = Point(lat=lat, lon=lon)
                    incident = Incident.model_validate(feature['properties'])
                    features.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [point.lon, point.lat]}, 'properties': incident.model_dump(mode='json')})
                result = {'configured': True, 'source': source, 'features': features, 'type': 'FeatureCollection', 'fetched_at': datetime.now(timezone.utc).isoformat()}
                _cache = (url, time.monotonic(), result)
            except (httpx.HTTPError, ValueError, KeyError, TypeError, ValidationError):
                raise HTTPException(502, 'Fonte de trânsito indisponível ou inválida')
    now = datetime.now(timezone.utc)
    return dict(result, features=[f for f in result['features'] if datetime.fromisoformat(f['properties']['observed_at']) <= now < datetime.fromisoformat(f['properties']['expires_at'])])
