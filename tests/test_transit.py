import io
from datetime import datetime, timedelta, timezone
from zipfile import ZipFile

import pytest

from backend import transit
from backend.schemas import TransitRequest


def feed(day, exception='1'):
    data={
        'agency.txt':'agency_id,agency_name,agency_url,agency_timezone\na,Teste,https://example.test,America/Maceio\n',
        'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\na,Embarque,-9.65,-35.70\nb,Hospital,-9.67,-35.73\n',
        'routes.txt':'route_id,route_short_name,route_long_name\nr,101,Hospital\n',
        'trips.txt':'route_id,service_id,trip_id,trip_headsign\nr,s,t,Hospital\n',
        'stop_times.txt':'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt,24:10:00,24:10:00,a,1\nt,24:25:00,24:25:00,b,2\n',
        'calendar_dates.txt':f'service_id,date,exception_type\ns,{day:%Y%m%d},{exception}\n',
    }
    buffer=io.BytesIO()
    with ZipFile(buffer,'w') as archive:
        for name,text in data.items():archive.writestr(name,text)
    buffer.seek(0)
    return buffer


def test_fixed_schedule_after_midnight_and_exception_dates(tmp_path,monkeypatch):
    target=tmp_path/'gtfs.sqlite3';monkeypatch.setenv('GTFS_DB',str(target))
    day=(datetime.now(timezone.utc)+timedelta(days=1)).date()
    transit.import_feed(feed(day),'Fixture GTFS',target)
    request=TransitRequest(origin={'lat':-9.65,'lon':-35.70},destination={'lat':-9.67,'lon':-35.73},departure=datetime.fromisoformat(f'{day}T23:55:00-03:00'))
    result=transit.journeys(request)
    assert len(result['journeys'])==1
    assert result['journeys'][0]['departure'].startswith(str(day+timedelta(days=1)))
    assert result['scheduled_only'] is True
    transit.import_feed(feed(day,'2'),'Fixture GTFS',target)
    assert transit.journeys(request)['journeys']==[]


def test_rejected_import_keeps_previous_feed(tmp_path):
    target=tmp_path/'gtfs.sqlite3'
    day=datetime.now(timezone.utc).date()
    transit.import_feed(feed(day),'Fixture',target)
    previous=target.read_bytes()
    broken=io.BytesIO()
    with ZipFile(broken,'w') as archive:archive.writestr('stops.txt','invalid')
    broken.seek(0)
    with pytest.raises(ValueError):transit.import_feed(broken,'Invalid',target)
    assert target.read_bytes()==previous


def test_gtfs_time_validation():
    assert transit.seconds('25:15:00')==90900
    with pytest.raises(ValueError):transit.seconds('10:70:00')
