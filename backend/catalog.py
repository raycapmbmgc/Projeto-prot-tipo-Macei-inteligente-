"""Reproducible public CNES snapshot, limited to hospital and urgent-care units."""
import argparse
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from backend.config import ROOT

CNES_URL = 'https://apidadosabertos.saude.gov.br/cnes/estabelecimentos'
SNAPSHOT = ROOT / 'data' / 'healthcare-maceio.json'
TYPES = {5:'Hospital geral',7:'Hospital especializado',15:'Unidade mista',20:'Pronto-socorro geral',21:'Pronto-socorro especializado',62:'Hospital-dia',73:'Pronto atendimento'}


def normalize(row, fetched_at):
    if int(row.get('codigo_municipio', 0)) != 270430:
        raise ValueError('CNES retornou um município diferente do solicitado')
    code = int(row['codigo_tipo_unidade'])
    if code not in TYPES or row.get('codigo_motivo_desabilitacao_estabelecimento') not in (None, '', 0, '0'):
        return None
    name = (row.get('nome_fantasia') or row['nome_razao_social']).strip()
    nature = str(row.get('descricao_natureza_juridica_estabelecimento') or '').strip()
    ownership = 'public' if nature.startswith('1') else 'private' if nature[:1] in ('2','3','4','5') else 'unknown'
    try:
        lat, lon = float(row['latitude_estabelecimento_decimo_grau']), float(row['longitude_estabelecimento_decimo_grau'])
        if not (math.isfinite(lat) and math.isfinite(lon) and -9.85<=lat<=-9.3 and -35.95<=lon<=-35.45): raise ValueError()
    except (TypeError, ValueError, KeyError):
        lat = lon = None
    cnes = str(row['codigo_cnes']).zfill(7)
    address = ', '.join(str(row[k]).strip() for k in ('endereco_estabelecimento','numero_estabelecimento','bairro_estabelecimento') if row.get(k))
    return {'cnes':cnes,'name':name,'address':address+' — Maceió/AL','lat':lat,'lon':lon,
            'category':'hospital','facility_type':'upa' if 'UPA' in name.upper().split() else 'urgent_care' if code in (20,21,73) else 'hospital',
            'unit_type':TYPES[code],'unit_type_code':code,'ownership':ownership,'routable':lat is not None,
            'phone':row.get('numero_telefone_estabelecimento'),'outpatient_sus':row.get('estabelecimento_faz_atendimento_ambulatorial_sus')=='SIM',
            'registry_updated_at':row.get('data_atualizacao'),'source':'Ministério da Saúde · CNES',
            'source_url':f'{CNES_URL}/{int(cnes)}','source_dataset':'cnes','fetched_at':fetched_at,
            'wheelchair':'unknown','active':True,'demo':False}


def download(client):
    fetched_at = datetime.now(timezone.utc).isoformat()
    records = {}
    counts = {}
    for code in TYPES:
        seen = set()
        for offset in range(0,10000,20):
            response = client.get(CNES_URL,params={'codigo_municipio':270430,'codigo_tipo_unidade':code,'status':1,'limit':20,'offset':offset})
            response.raise_for_status()
            rows = response.json()['estabelecimentos']
            if not isinstance(rows,list): raise ValueError('Resposta CNES inválida')
            ids = {str(r['codigo_cnes']) for r in rows}
            if ids & seen: raise ValueError('CNES repetiu registros; paginação interrompida sem publicar carga parcial')
            seen.update(ids)
            for row in rows:
                if int(row['codigo_tipo_unidade']) != code: raise ValueError('CNES ignorou o filtro de tipo de unidade')
                item = normalize(row,fetched_at)
                if item: records[item['cnes']] = item
            if len(rows)<20: break
            time.sleep(.2)
        else: raise ValueError('Limite de paginação excedido')
        counts[str(code)] = len(seen)
    if not records: raise ValueError('CNES não retornou unidades; a carga anterior foi preservada')
    facilities = sorted(records.values(),key=lambda r:r['name'])
    return {'schema_version':1,'source_url':CNES_URL,'municipality':'2704302','fetched_at':fetched_at,'type_counts':counts,
            'coverage':'Tipos CNES 5, 7, 15, 20, 21, 62 e 73 de Maceió; sem garantia de funcionamento ou atualização em tempo real.',
            'facilities':facilities}


def snapshot():
    if not SNAPSHOT.is_file(): return None
    data = json.loads(SNAPSHOT.read_text(encoding='utf8'))
    if data.get('schema_version')!=1 or data.get('municipality')!='2704302' or not data.get('facilities'):
        raise ValueError('Snapshot de unidades de saúde inválido')
    return data


def sync(db):
    from sqlalchemy import select
    from backend.database import Place, engine
    data = snapshot()
    if not data: return
    entries = {p.data.get('cnes'):p for p in db.scalars(select(Place)) if p.data.get('source_dataset')=='cnes'}
    incoming = {r['cnes'] for r in data['facilities']}
    for cnes, place in entries.items():
        if cnes not in incoming: place.data = dict(place.data,active=False)
    for item in data['facilities']:
        place = entries.get(item['cnes'])
        if place is None:
            place = Place(id=100000000+int(item['cnes']),data=item)
            db.add(place)
        else:
            preserved = {k:place.data[k] for k in ('wheelchair','verified_at','accessibility_source') if place.data.get('verified_at') and k in place.data}
            place.data = dict(item,**preserved)
        if engine.dialect.name=='postgresql':
            place.location = f"SRID=4326;POINT({item['lon']} {item['lat']})" if item['routable'] else None
    # Retire only untouched original seed rows, never arbitrary user-created records.
    seed = json.loads((ROOT/'seed.json').read_text(encoding='utf8'))['hospitals']
    for i, original in enumerate(seed,1):
        place = db.get(Place,i)
        if place and place.data==original: db.delete(place)


def status():
    data = snapshot()
    if not data: return {'configured':False,'count':0}
    return {'configured':True,**{k:v for k,v in data.items() if k!='facilities'},'count':len(data['facilities']),
            'routable':sum(r['routable'] for r in data['facilities'])}


if __name__=='__main__':
    parser = argparse.ArgumentParser(description='Atualizar cadastro público de hospitais e urgências de Maceió')
    parser.parse_args()
    with httpx.Client(timeout=40,follow_redirects=True,headers={'User-Agent':'MaceioInteligente/0.2 public-data-import'}) as client:
        data = download(client)
    temporary = SNAPSHOT.with_suffix('.tmp')
    temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    temporary.replace(SNAPSHOT)
    print(json.dumps(status(),ensure_ascii=True))
