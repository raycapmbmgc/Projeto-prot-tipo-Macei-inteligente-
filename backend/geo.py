"""Distances in metres; independent of the database engine."""
from math import atan2, cos, radians, sin, sqrt


def distance(lat, lon, other_lat, other_lon):
    a = sin(radians(other_lat-lat)/2)**2 + cos(radians(lat))*cos(radians(other_lat))*sin(radians(other_lon-lon)/2)**2
    a = min(1, max(0, a))
    return 6371000 * 2 * atan2(sqrt(a), sqrt(1-a))
