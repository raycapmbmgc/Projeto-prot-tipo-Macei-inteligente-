import pytest

from backend.geometry import decode_polyline, coordinates


def test_known_polyline_coordinate_order_and_precision():
    points=decode_polyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@',precision=5)
    assert points==[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]


def test_polyline6_and_geojson_are_normalized_consistently():
    # Two zero/near-zero points encoded with six decimal places.
    expected=[[0,0],[.000001,.000001]]
    assert coordinates('??AA')==expected
    assert coordinates({'type':'LineString','coordinates':expected})==expected


@pytest.mark.parametrize('shape',['?', '~~~~~~~', {'type':'LineString','coordinates':[[0,0]]}, {'type':'LineString','coordinates':[[0,0],[181,0]]}])
def test_bad_provider_geometry_is_rejected(shape):
    with pytest.raises(ValueError):coordinates(shape)
