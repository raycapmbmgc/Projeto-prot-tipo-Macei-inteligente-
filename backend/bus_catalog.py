"""Official city terminals/lines plus explicitly separate OSM route geometries."""
import argparse
import io
import json
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import PurePosixPath
from zipfile import ZipFile
from xml.etree import ElementTree as ET

import httpx
from fastapi import HTTPException

from backend.config import ROOT
from backend.geo import distance

OFFICIAL_PAGE='https://observatoriodacidade.maceio.al.gov.br/'
SHEET='https://docs.google.com/spreadsheets/d/1PHEvkxevz7he7MTXt8AxaZDwJaHvXlOD/export?format=xlsx'
FILE=ROOT/'data'/'transit-maceio.json'
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def sheet_rows(archive, name, strings):
    root=ET.fromstring(archive.read(name))
    result=[]
    for row in root.findall('s:sheetData/s:row',NS):
        values={}
        for cell in row.findall('s:c',NS):
            column=re.sub(r'\d','',cell.attrib['r'])
            value=cell.find('s:v',NS)
            text=value.text if value is not None else ''
            if cell.attrib.get('t')=='s': text=strings[int(text)]
            elif cell.attrib.get('t')=='inlineStr':text=''.join(cell.find('s:is',NS).itertext())
            values[column]=text or ''
        result.append(values)
    return result


def parse_official(content):
    with ZipFile(io.BytesIO(content)) as archive:
        if sum(i.file_size for i in archive.infolist())>20_000_000: raise ValueError('Planilha de transporte muito grande')
        strings=[''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si',NS)]
        workbook=ET.fromstring(archive.read('xl/workbook.xml'))
        relationships=ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets={r.attrib['Id']:r.attrib['Target'] for r in relationships}
        sheets=[]
        for sheet in workbook.findall('s:sheets/s:sheet',NS):
            target=targets[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            path=target.lstrip('/') if target.startswith('/') else str(PurePosixPath('xl')/target)
            sheets.append(sheet_rows(archive,path,strings))
    if len(sheets)!=2 or 'LATITUDE' not in sheets[0][0].get('D','') or 'LINHA' not in sheets[1][0].get('B',''):
        raise ValueError('A estrutura da planilha oficial mudou')
    stops=[]
    for row in sheets[0][1:]:
        if not row.get('B'):continue
        lat,lon=float(row['D']),float(row['E'])
        if not (-9.85<=lat<=-9.3 and -35.95<=lon<=-35.45):raise ValueError('Parada fora da região esperada')
        stops.append({'id':'city-'+str(int(float(row['A']))),'name':row['B'],'type':'terminal' if 'Terminal' in row['C'] else 'stop',
                      'lat':lat,'lon':lon,'district':row['F'],'source':OFFICIAL_PAGE})
    lines={}
    for row in sheets[1][1:]:
        if not row.get('B'):continue
        match=re.fullmatch(r'\s*([\w]+(?:\.0)?)(?:\s*[-–]\s*(.*))?\s*',row['B'])
        if not match:raise ValueError('Linha sem código reconhecível: '+row['B'])
        code,name=match.groups()
        code=code[:-2] if code.endswith('.0') else code
        name=(name or '').strip() or 'Denominação não informada pela fonte'
        terminal_id='city-'+str(int(float(row['A'])))
        line=lines.setdefault(code,{'id':'city-'+code,'code':code,'name':name,'terminal_ids':[],'source':OFFICIAL_PAGE,'geometry':None})
        if terminal_id not in line['terminal_ids']:line['terminal_ids'].append(terminal_id)
    if not lines or not stops:raise ValueError('Planilha oficial vazia')
    return stops,list(lines.values())


def parse_osm(data):
    routes=[]
    for relation in data.get('elements',[]):
        tags=relation.get('tags',{})
        if relation.get('type')!='relation' or tags.get('route')!='bus':continue
        segments=[];stops=[]
        for member in relation.get('members',[]):
            if member['type']=='way' and member.get('geometry') and member.get('role','') not in ('platform','platform_entry_only','platform_exit_only'):
                segment=[[p['lon'],p['lat']] for p in member['geometry'] if p and 'lat' in p and 'lon' in p]
                if len(segment)>=2:segments.append(segment)
            if member['type']=='node' and ('stop' in member.get('role','') or 'platform' in member.get('role','')) and 'lat' in member:
                stops.append({'id':'osm-'+str(member['ref']),'lat':member['lat'],'lon':member['lon'],'role':member.get('role')})
        if segments:
            routes.append({'id':'osm-'+str(relation['id']),'code':tags.get('ref',''),'name':tags.get('name','Linha sem nome'),
                           'from':tags.get('from'),'to':tags.get('to'),'operator':tags.get('operator'),
                           'geometry':{'type':'MultiLineString','coordinates':segments},'stops':stops,
                           'source':'https://www.openstreetmap.org/relation/'+str(relation['id']),'source_kind':'osm'})
    return routes


@lru_cache(maxsize=1)
def _read(version):
    data=json.loads(FILE.read_text(encoding='utf8'))
    if data.get('schema_version')!=1:raise ValueError('Catálogo de transporte inválido')
    return data


def snapshot():
    return _read(FILE.stat().st_mtime_ns) if FILE.exists() else None


def status():
    data=snapshot()
    if not data:return {'configured':False,'lines':0,'stops':0,'mapped_routes':0}
    return {'configured':True,'lines':len(data['lines']),'stops':len(data['stops']),'mapped_routes':len(data.get('mapped_routes',[])),
            'source':OFFICIAL_PAGE,'fetched_at':data['fetched_at'],'schedule_available':False,
            'coverage':'Linhas por terminal e paradas da planilha municipal; geometrias OSM identificadas separadamente. Sem horários ou previsão em tempo real.'}


def nearby_stops(lat,lon,radius):
    data=snapshot()
    if not data:return []
    values=[]
    for stop in data['stops']:
        d=distance(lat,lon,stop['lat'],stop['lon'])
        if d<=radius:
            lines=[{'id':l['id'],'code':l['code'],'name':l['name']} for l in data['lines'] if stop['id'] in l['terminal_ids']]
            values.append(dict(stop,distance_m=round(d),lines=lines))
    return sorted(values,key=lambda s:s['distance_m'])[:60]


def point_segment_distance(lat,lon,a,b):
    from math import cos,radians
    scale=cos(radians(lat));ax=(a[0]-lon)*scale;ay=a[1]-lat;dx=(b[0]-a[0])*scale;dy=b[1]-a[1]
    t=max(0,min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy or 1)))
    return distance(lat,lon,a[1]+t*(b[1]-a[1]),a[0]+t*(b[0]-a[0]))


def lines(q='',lat=None,lon=None,radius=800):
    data=snapshot()
    if not data:return {'lines':[],'mapped_routes':[],'source':OFFICIAL_PAGE}
    official=[dict(l,terminals=[s for s in data['stops'] if s['id'] in l['terminal_ids']]) for l in data['lines'] if q.casefold() in (l['code']+' '+l['name']).casefold()]
    mapped=[]
    for route in data.get('mapped_routes',[]):
        if q.casefold() not in (route['code']+' '+route['name']).casefold():continue
        d=None
        if lat is not None and lon is not None:
            d=min(point_segment_distance(lat,lon,a,b) for segment in route['geometry']['coordinates'] for a,b in zip(segment,segment[1:]))
            if d>radius:continue
        mapped.append({k:v for k,v in route.items() if k!='geometry'}|{'distance_m':round(d) if d is not None else None})
    if lat is not None and lon is not None:
        for line in official:
            distances=[distance(lat,lon,s['lat'],s['lon']) for s in line['terminals']]
            line['terminal_distance_m']=round(min(distances)) if distances else None
        official.sort(key=lambda l:l['terminal_distance_m'] if l['terminal_distance_m'] is not None else float('inf'))
        mapped.sort(key=lambda l:l['distance_m'])
    return {'lines':official,'mapped_routes':mapped,'source':OFFICIAL_PAGE,'fetched_at':data['fetched_at'],
            'note':'A proximidade de um terminal não comprova que a linha passa no hospital. Somente os itinerários mapeados podem ser comparados geometricamente.'}


def route(route_id):
    data=snapshot()
    for route in (data or {}).get('mapped_routes',[]):
        if route['id']==route_id:return route
    raise HTTPException(404,'Geometria deste itinerário não está disponível na fonte.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Atualizar linhas/terminais oficiais e geometrias públicas de ônibus de Maceió')
    parser.add_argument('--skip-osm',action='store_true');args=parser.parse_args()
    with httpx.Client(timeout=60,follow_redirects=True,headers={'User-Agent':'MaceioInteligente/0.2 public-data-import'}) as client:
        response=client.get(SHEET);response.raise_for_status();stops,official=parse_official(response.content)
        mapped=[]
        if not args.skip_osm:
            query='[out:json][timeout:45];rel[route=bus](-9.85,-35.95,-9.3,-35.45);out body geom;'
            for endpoint in ('https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'):
                try:
                    response=client.get(endpoint,params={'data':query},timeout=60);response.raise_for_status()
                    mapped=parse_osm(response.json());break
                except (httpx.HTTPError,ValueError):continue
            if not mapped:
                previous=snapshot()
                mapped=(previous or {}).get('mapped_routes',[])
    result={'schema_version':1,'fetched_at':datetime.now(timezone.utc).isoformat(),'source_url':OFFICIAL_PAGE,'spreadsheet_url':SHEET,
            'stops':stops,'lines':official,'mapped_routes':mapped}
    temporary=FILE.with_suffix('.tmp');temporary.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8');temporary.replace(FILE)
    print(json.dumps(status(),ensure_ascii=True))
