"""Normalize Valhalla shapes, including servers that return encoded polyline6."""
from math import isfinite


def decode_polyline(value, precision=6):
    if len(value)>2_000_000:raise ValueError('Geometria muito grande')
    result=[];index=0;lat=0;lon=0
    def component():
        nonlocal index
        shift=0;number=0
        while True:
            if index>=len(value) or shift>60:raise ValueError('Polyline inválida')
            byte=ord(value[index])-63;index+=1
            if not 0<=byte<=63:raise ValueError('Polyline inválida')
            number|=(byte&31)<<shift;shift+=5
            if byte<32:break
        return ~(number>>1) if number&1 else number>>1
    while index<len(value):
        lat+=component();lon+=component()
        point=[lon/(10**precision),lat/(10**precision)]
        if not -180<=point[0]<=180 or not -90<=point[1]<=90:raise ValueError('Coordenada fora do intervalo')
        result.append(point)
        if len(result)>100000:raise ValueError('Geometria com pontos em excesso')
    if len(result)<2:raise ValueError('Geometria sem segmentos')
    return result


def coordinates(shape):
    if isinstance(shape,str):return decode_polyline(shape)
    if not isinstance(shape,dict) or shape.get('type')!='LineString':raise ValueError('Geometria inválida')
    points=shape['coordinates']
    if len(points)<2 or len(points)>100000:raise ValueError('Geometria sem segmentos ou muito grande')
    for p in points:
        if len(p)!=2 or not all(isinstance(n,(int,float)) and isfinite(n) for n in p) or not -180<=p[0]<=180 or not -90<=p[1]<=90:
            raise ValueError('Coordenada inválida')
    return points
