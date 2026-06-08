export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeoBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

const EARTH_RADIUS_KM = 6371;
const KM_PER_LATITUDE_DEGREE = 111.32;

const toRadians = (degree: number): number => degree * (Math.PI / 180);

export const isValidCoordinate = (value: unknown, min: number, max: number): value is number => {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
};

export const isValidCoordinates = (coordinates: Partial<Coordinates>): coordinates is Coordinates => {
  return isValidCoordinate(coordinates.latitude, -90, 90) && isValidCoordinate(coordinates.longitude, -180, 180);
};

export const distanceKmBetween = (from: Coordinates, to: Coordinates): number => {
  const latDelta = toRadians(to.latitude - from.latitude);
  const lngDelta = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lngDelta / 2) ** 2;
  const clamped = Math.min(1, Math.max(0, a));
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
};

export const roundDistanceKm = (distanceKm: number): number => {
  return Math.round(distanceKm * 100) / 100;
};

export const formatDistanceText = (distanceKm: number): string => {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)}m`;
  return `${Math.round(distanceKm * 10) / 10}km`;
};

export const geoBoundingBox = (center: Coordinates, radiusKm: number): GeoBounds => {
  const latitudeDelta = radiusKm / KM_PER_LATITUDE_DEGREE;
  const longitudeDelta = radiusKm / (KM_PER_LATITUDE_DEGREE * Math.max(Math.cos(toRadians(center.latitude)), 0.01));

  return {
    minLatitude: center.latitude - latitudeDelta,
    maxLatitude: center.latitude + latitudeDelta,
    minLongitude: center.longitude - longitudeDelta,
    maxLongitude: center.longitude + longitudeDelta
  };
};
