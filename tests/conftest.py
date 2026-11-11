"""All platform tests use an isolated database, never the project instance."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

_directory = TemporaryDirectory(prefix='maceio-tests-')
os.environ['DATABASE_URL'] = 'sqlite:///' + (Path(_directory.name) / 'platform.sqlite3').as_posix()
for _name in ('REDIS_URL', 'ADMIN_TOKEN', 'VALHALLA_URL', 'TRAFFIC_FEED_URL', 'TRAFFIC_FEED_SOURCE', 'OLLAMA_URL', 'OLLAMA_MODEL'):
    os.environ[_name] = ''
os.environ['GTFS_DB'] = str(Path(_directory.name) / 'gtfs.sqlite3')


@pytest.fixture(scope='session', autouse=True)
def database():
    from backend.database import Base, engine
    Base.metadata.create_all(engine)
    yield
    engine.dispose()
    _directory.cleanup()
