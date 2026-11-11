from typing import Literal
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator
class Point(BaseModel):
 model_config=ConfigDict(allow_inf_nan=False)
 lat: float=Field(ge=-90,le=90)
 lon: float=Field(ge=-180,le=180)
class RouteRequest(BaseModel):
 origin: Point
 destination: Point
 mode: Literal["car","walk","bike","wheelchair"]="car"
 objective: Literal["fastest","shortest"]="fastest"
 waypoints: list[Point]=Field(default_factory=list,max_length=5)
 avoid_steps: bool=False
 prefer_lit: bool=False
 avoid_hills: bool=False
 @model_validator(mode='after')
 def validate_preferences(self):
  if self.mode not in ('walk','wheelchair') and (self.avoid_steps or self.prefer_lit or self.avoid_hills):
   raise ValueError('Preferências de caminhada exigem modo a pé ou cadeira de rodas.')
  return self
class RoadUpdate(BaseModel):
 status: Literal["Liberada","Bloqueada"]
 location: Point | None=None
 expires_at: datetime | None=None
 @model_validator(mode='after')
 def timezone_required(self):
  if self.expires_at and self.expires_at.tzinfo is None: raise ValueError('Informe fuso horário na validade.')
  return self
class RoadCreate(BaseModel):
 name: str=Field(min_length=1,max_length=120,pattern=r".*\S.*")
 location: Point | None=None
 status: Literal['Liberada','Bloqueada']='Liberada'
 expires_at: datetime | None=None
 @model_validator(mode='after')
 def timezone_required(self):
  if self.expires_at and self.expires_at.tzinfo is None: raise ValueError('Informe fuso horário na validade.')
  return self

class PlaceCreate(Point):
 name: str=Field(min_length=1,max_length=180,pattern=r'.*\S.*')
 category: Literal['hospital','tourism','service']='service'
 address: str=Field(default='',max_length=300)
 source: str=Field(min_length=3,max_length=500)
 wheelchair: Literal['yes','no','unknown']='unknown'
 verified_at: datetime | None=None
 @model_validator(mode='after')
 def verified_accessibility(self):
  if self.wheelchair!='unknown' and self.verified_at is None:
   raise ValueError('Informe a data de verificação da acessibilidade.')
  if self.verified_at and self.verified_at.tzinfo is None: raise ValueError('Informe o fuso horário da verificação.')
  return self

class TransitRequest(BaseModel):
 origin: Point
 destination: Point
 departure: datetime | None=None
 radius: int=Field(default=800,ge=100,le=2000)
 @model_validator(mode='after')
 def timezone_required(self):
  if self.departure and self.departure.tzinfo is None: raise ValueError('Informe fuso horário na partida.')
  return self

class ReportCreate(BaseModel):
 description: str=Field(min_length=5,max_length=500,pattern=r'.*\S.*')
 kind: Literal['blockage','pothole','flood','other']
 location: Point
 consent: Literal[True]

class ReportReview(BaseModel):
 verification: Literal['verified','rejected','resolved']

class AssistantRequest(BaseModel):
 message: str=Field(min_length=3,max_length=1000)
class AssistantReply(BaseModel):
 answer: str=Field(max_length=2000)
 destination_query: str | None=None
 mode: Literal["car","walk","bike","wheelchair"] | None=None
