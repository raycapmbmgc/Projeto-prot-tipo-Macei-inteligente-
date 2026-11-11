import os
from backend.config import ROOT
from sqlalchemy import create_engine, JSON, String, Integer
from geoalchemy2 import Geometry
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
(ROOT / 'instance').mkdir(exist_ok=True)
database_url = os.getenv('DATABASE_URL') or 'sqlite:///' + (ROOT / 'instance' / 'platform.sqlite3').as_posix()
engine=create_engine(database_url,pool_pre_ping=True, **({'connect_args': {'timeout': 30}} if database_url.startswith('sqlite:') else {}))
if engine.dialect.name == 'sqlite':
 from sqlalchemy import event
 @event.listens_for(engine, 'connect')
 def configure_sqlite(connection, _):
  cursor = connection.cursor()
  cursor.execute('PRAGMA journal_mode=WAL')
  cursor.execute('PRAGMA foreign_keys=ON')
  cursor.close()
Session=sessionmaker(engine)
class Base(DeclarativeBase): pass
class Place(Base):
 __tablename__="places"
 id: Mapped[int]=mapped_column(Integer,primary_key=True)
 data: Mapped[dict]=mapped_column(JSON)
 if engine.dialect.name=="postgresql":
  location: Mapped[object]=mapped_column(Geometry("POINT",srid=4326),nullable=True)
class Road(Base):
 __tablename__="roads"
 id: Mapped[str]=mapped_column(String(40),primary_key=True)
 data: Mapped[dict]=mapped_column(JSON)
class Report(Base):
 __tablename__='reports'
 id: Mapped[str]=mapped_column(String(40),primary_key=True)
 data: Mapped[dict]=mapped_column(JSON)
