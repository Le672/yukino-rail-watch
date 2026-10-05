import { wgs84togcj02 } from "coordtransform";
import type { Coordinate, JourneyPosition, TrainJourney } from "./train-position";

/** Geographic simulation only. This never becomes a railway route or a GPS matching input. */
export function stationSimulationPoint(stations: (Coordinate | null)[], position: JourneyPosition): Coordinate | null {
  if (position.currentIndex !== null) return stations[position.currentIndex] ?? null;
  if (position.previousIndex === null || position.nextIndex === null) return null;
  const a = stations[position.previousIndex], b = stations[position.nextIndex];
  if (!a || !b) return null;
  const progress = Math.max(0, Math.min(1, position.progress));
  return [a[0] + (b[0] - a[0]) * progress, a[1] + (b[1] - a[1]) * progress];
}

/** A local OSM snapshot fills only missing coordinates, with exact official name + telecode matching. */
export async function supplementStationCoordinates(journey: TrainJourney, stations: (Coordinate | null)[]): Promise<(Coordinate | null)[]> {
  if (stations.length === journey.stops.length && stations.every(Boolean)) return stations;
  const snapshot = (await import("../data/rail-station-coordinates.json")).default;
  const byCode = snapshot.stations as Record<string, { name: string; coordinate: number[] }>;
  return journey.stops.map((stop, index) => {
    if (stations[index]) return stations[index];
    const entry = Object.prototype.hasOwnProperty.call(byCode, stop.telecode) ? byCode[stop.telecode] : undefined;
    if (!entry || entry.name !== stop.station || entry.coordinate.length !== 2 || !entry.coordinate.every(Number.isFinite) ||
        Math.abs(entry.coordinate[0]) > 180 || Math.abs(entry.coordinate[1]) > 90) return null;
    return wgs84togcj02(entry.coordinate[0], entry.coordinate[1]);
  });
}
