import os
from sqlalchemy import create_engine, JSON, String, Integer
from geoalchemy2 import Geometry
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
engine=create_engine(os.getenv("DATABASE_URL","sqlite:///instance/platform.sqlite3"),pool_pre_ping=True)
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
