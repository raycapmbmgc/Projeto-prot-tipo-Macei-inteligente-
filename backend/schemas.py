from typing import Literal
from pydantic import BaseModel, Field, ConfigDict
class Point(BaseModel):
 model_config=ConfigDict(allow_inf_nan=False)
 lat: float=Field(ge=-90,le=90)
 lon: float=Field(ge=-180,le=180)
class RouteRequest(BaseModel):
 origin: Point
 destination: Point
 mode: Literal["car","walk","bike"]="car"
 objective: Literal["fastest","shortest"]="fastest"
class RoadUpdate(BaseModel):
 status: Literal["Liberada","Bloqueada"]
class RoadCreate(BaseModel):
 name: str=Field(min_length=1,max_length=120,pattern=r".*\S.*")

class AssistantRequest(BaseModel):
 message: str=Field(min_length=3,max_length=1000)
class AssistantReply(BaseModel):
 answer: str=Field(max_length=2000)
 destination_query: str | None=None
 mode: Literal["car","walk","bike"] | None=None
