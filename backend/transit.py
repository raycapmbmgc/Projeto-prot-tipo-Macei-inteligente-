"""GTFS schedule import and direct-trip search. Does not invent realtime arrivals."""
import argparse
import csv
import io
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, time, timezone
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from backend.config import ROOT
from backend.geo import distance


def database_path():
    return Path(os.getenv('GTFS_DB') or ROOT / 'instance' / 'gtfs.sqlite3')


def seconds(value):
    hours, minutes, secs = map(int, value.split(':'))
    if hours < 0 or hours > 71 or not 0 <= minutes < 60 or not 0 <= secs < 60:
        raise ValueError('Horário GTFS inválido')
    return hours*3600 + minutes*60 + secs


def import_feed(archive, source, target=None):
    """Atomic replacement: a rejected feed never replaces the working schedule."""
    target = Path(target or database_path())
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_name(target.name + '.' + uuid4().hex + '.tmp')
    try:
        with ZipFile(archive) as feed, closing(sqlite3.connect(staging)) as db:
            members = {Path(n).name: n for n in feed.namelist() if not n.endswith('/')}
            if len(members) != len([n for n in feed.namelist() if not n.endswith('/')]):
                raise ValueError('Arquivos GTFS duplicados')
            if sum(i.file_size for i in feed.infolist()) > 512_000_000:
                raise ValueError('GTFS descompactado excede 512 MB')
            for name in ('agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'):
                if name not in members: raise ValueError('Arquivo obrigatório ausente: ' + name)
            if not {'calendar.txt', 'calendar_dates.txt'} & members.keys():
                raise ValueError('GTFS precisa de calendário de serviço')
            # Frequency and flexible service need a different planner; reject rather than fabricate departures.
            if 'frequencies.txt' in members or 'locations.geojson' in members:
                raise ValueError('Este planejador aceita horários fixos; feeds por frequência/flexíveis ainda não são suportados')

            def rows(name):
                if name not in members: return
                with feed.open(members[name]) as raw:
                    yield from csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig', newline=''))

            agencies = list(rows('agency.txt'))
            zones = {a['agency_timezone'] for a in agencies}
            if len(zones) != 1: raise ValueError('O feed precisa usar um único fuso de agência')
            zone = zones.pop()
            ZoneInfo(zone)
            db.executescript('''
                PRAGMA foreign_keys=ON;
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE stops (id TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, wheelchair TEXT);
                CREATE TABLE routes (id TEXT PRIMARY KEY, name TEXT);
                CREATE TABLE trips (id TEXT PRIMARY KEY, route TEXT REFERENCES routes(id), service TEXT, headsign TEXT);
                CREATE TABLE times (trip TEXT REFERENCES trips(id), stop TEXT REFERENCES stops(id), seq INTEGER, arrival INTEGER, departure INTEGER, pickup TEXT, dropoff TEXT, PRIMARY KEY(trip,seq));
                CREATE INDEX times_stop ON times(stop,departure);
                CREATE TABLE calendar (id TEXT PRIMARY KEY, start TEXT, end TEXT, days TEXT);
                CREATE TABLE exceptions (id TEXT, day TEXT, type TEXT, PRIMARY KEY(id,day));
            ''')
            for r in rows('stops.txt'):
                if r.get('location_type', '0') not in ('', '0'): continue
                lat, lon = float(r['stop_lat']), float(r['stop_lon'])
                if not -90 <= lat <= 90 or not -180 <= lon <= 180: raise ValueError('Coordenada inválida')
                db.execute('INSERT INTO stops VALUES(?,?,?,?,?)', (r['stop_id'], r['stop_name'], lat, lon, r.get('wheelchair_boarding', '0')))
            for r in rows('routes.txt'):
                db.execute('INSERT INTO routes VALUES(?,?)', (r['route_id'], ' · '.join(filter(None, [r.get('route_short_name'), r.get('route_long_name')]))))
            for r in rows('trips.txt'):
                db.execute('INSERT INTO trips VALUES(?,?,?,?)', (r['trip_id'], r['route_id'], r['service_id'], r.get('trip_headsign', '')))
            for r in rows('stop_times.txt'):
                if not r.get('arrival_time') or not r.get('departure_time'):
                    raise ValueError('Feed contém horários intermediários sem tempo; interpolação não implementada')
                arrival, departure = seconds(r['arrival_time']), seconds(r['departure_time'])
                if arrival > departure: raise ValueError('Chegada posterior à saída na mesma parada')
                db.execute('INSERT INTO times VALUES(?,?,?,?,?,?,?)', (r['trip_id'], r['stop_id'], int(r['stop_sequence']), arrival, departure, r.get('pickup_type', '0'), r.get('drop_off_type', '0')))
            weekdays = ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
            for r in rows('calendar.txt'):
                datetime.strptime(r['start_date'], '%Y%m%d'); datetime.strptime(r['end_date'], '%Y%m%d')
                db.execute('INSERT INTO calendar VALUES(?,?,?,?)', (r['service_id'], r['start_date'], r['end_date'], ''.join(r[d] for d in weekdays)))
            for r in rows('calendar_dates.txt'):
                datetime.strptime(r['date'], '%Y%m%d')
                if r['exception_type'] not in ('1', '2'): raise ValueError('Exceção GTFS inválida')
                db.execute('INSERT INTO exceptions VALUES(?,?,?)', (r['service_id'], r['date'], r['exception_type']))
            if db.execute('SELECT 1 FROM times LIMIT 1').fetchone() is None:
                raise ValueError('GTFS sem horários')
            if db.execute('SELECT 1 FROM (SELECT departure, LEAD(arrival) OVER (PARTITION BY trip ORDER BY seq) AS next_arrival FROM times) WHERE departure>next_arrival LIMIT 1').fetchone():
                raise ValueError('Horários da viagem fora de ordem')
            metadata = {'source': source, 'timezone': zone, 'imported_at': datetime.now(timezone.utc).isoformat(),
                        'stops': db.execute('SELECT COUNT(*) FROM stops').fetchone()[0], 'scheduled_only': True}
            db.executemany('INSERT INTO meta VALUES(?,?)', ((k, json.dumps(v)) for k,v in metadata.items()))
            db.commit()
        os.replace(staging, target)
        return metadata
    finally:
        if staging.exists(): staging.unlink()


def connect():
    path = database_path().resolve()
    if not path.is_file(): raise HTTPException(503, 'Importe um GTFS oficial para habilitar o transporte público.')
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db


def status():
    if not database_path().is_file(): return {'configured': False, 'scheduled_only': True}
    with closing(connect()) as db:
        return dict(configured=True, **{r['key']: json.loads(r['value']) for r in db.execute('SELECT * FROM meta')})


def nearby_stops(db, lat, lon, radius):
    # A latitude prefilter keeps the exact haversine pass small, including near the poles.
    values = []
    for row in db.execute('SELECT * FROM stops WHERE lat BETWEEN ? AND ?', (lat-radius/110000, lat+radius/110000)):
        d = distance(lat, lon, row['lat'], row['lon'])
        if d <= radius: values.append(dict(row, distance=round(d)))
    return sorted(values, key=lambda s:s['distance'])[:20]


def stops(lat, lon, radius):
    with closing(connect()) as db: return nearby_stops(db, lat, lon, radius)


def active_services(db, day):
    date = day.strftime('%Y%m%d')
    active = {r['id'] for r in db.execute('SELECT * FROM calendar WHERE start<=? AND end>=?', (date,date)) if r['days'][day.weekday()]=='1'}
    for r in db.execute('SELECT * FROM exceptions WHERE day=?', (date,)):
        if r['type']=='1': active.add(r['id'])
        else: active.discard(r['id'])
    return active


def journeys(body):
    with closing(connect()) as db:
        metadata = {r['key']:json.loads(r['value']) for r in db.execute('SELECT * FROM meta')}
        zone = ZoneInfo(metadata['timezone'])
        start = (body.departure or datetime.now(timezone.utc)).astimezone(zone)
        if abs((start-datetime.now(zone)).total_seconds()) > 7*86400:
            raise HTTPException(422, 'Pesquise uma partida nos próximos sete dias.')
        origin = nearby_stops(db, body.origin.lat, body.origin.lon, body.radius)
        destination = nearby_stops(db, body.destination.lat, body.destination.lon, body.radius)
        options = []
        if not origin or not destination: return {'journeys': [], 'source': metadata['source'], 'scheduled_only': True}
        origins = {s['id']:s for s in origin}; destinations = {s['id']:s for s in destination}
        placeholders = lambda items: ','.join('?' for _ in items)
        query = f'''SELECT a.trip,a.stop AS boarding,b.stop AS alighting,a.departure,b.arrival,t.service,t.headsign,r.name
                    FROM times a JOIN times b ON a.trip=b.trip AND b.seq>a.seq
                    JOIN trips t ON t.id=a.trip JOIN routes r ON r.id=t.route
                    WHERE a.stop IN ({placeholders(origins)}) AND b.stop IN ({placeholders(destinations)})
                    AND a.pickup IN ('','0') AND b.dropoff IN ('','0') AND a.departure>=? AND a.departure<=?
                    ORDER BY a.departure LIMIT 5000'''
        # Up to 71h GTFS times can belong to the preceding two service dates.
        for offset in (-2,-1,0,1):
            day = start.date()+timedelta(days=offset)
            midnight = datetime.combine(day, time(), zone)
            active = active_services(db, day)
            low = int((start-midnight).total_seconds())
            for r in db.execute(query, (*origins, *destinations, low, low+86400)):
                if r['service'] not in active: continue
                board, alight = origins[r['boarding']], destinations[r['alighting']]
                departure = midnight+timedelta(seconds=r['departure'])
                arrival = midnight+timedelta(seconds=r['arrival'])
                # Walking is explicitly an estimate, not a street routing result.
                walk_before = board['distance']/1.2
                if departure < start+timedelta(seconds=walk_before+60): continue
                options.append({'trip_id':r['trip'],'line':r['name'],'headsign':r['headsign'], 'boarding':board,'alighting':alight,
                                'departure':departure.isoformat(),'arrival':arrival.isoformat(),
                                'walking_estimate_minutes':round((walk_before+alight['distance']/1.2)/60),
                                'total_minutes':round((arrival-start).total_seconds()/60+alight['distance']/72)})
        options.sort(key=lambda j:j['total_minutes'])
        unique = {}; seen = set()
        for option in options:
            key = (option['trip_id'],option['departure'][:10])
            if key not in seen:
                seen.add(key); unique[key] = option
        return {'journeys':list(unique.values())[:5], 'source':metadata['source'], 'scheduled_only':True,
                'warning':'Horários programados, sem posição dos veículos. Apenas linhas diretas. Caminhadas estimadas em linha reta; confirme o acesso às paradas.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Importar horários GTFS oficiais sem alterar o banco principal')
    parser.add_argument('archive'); parser.add_argument('--source', required=True)
    args = parser.parse_args()
    print(json.dumps(import_feed(args.archive, args.source), ensure_ascii=False))
