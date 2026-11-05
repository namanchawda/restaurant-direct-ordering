from math import asin, cos, radians, sin, sqrt


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    lat_delta = radians(lat2 - lat1)
    lng_delta = radians(lng2 - lng1)
    value = sin(lat_delta / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(
        lng_delta / 2
    ) ** 2
    return 6371.0 * 2 * asin(sqrt(value))
