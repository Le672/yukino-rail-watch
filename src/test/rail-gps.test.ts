import { describe, expect, it } from "vitest";
import { wgs84togcj02 } from "coordtransform";
import { gcjToWgs84, matchGpsJourney, railwayToWgs84 } from "../lib/rail-gps";
import type { LocationFix, Wgs84RailwayRoute } from "../lib/rail-gps";
import { coordinateAt, distanceKm, locateJourney, parseJourney } from "../lib/train-position";
import type { Coordinate } from "../lib/train-position";

const journey = parseJourney({ success: true, data: { numberFull: ["G6003"], rundays: ["20260929"], timetable: [
  { station: "长沙南", stationTelecode: "CWQ", day: 0, arrive: "10:00", depart: "10:00" },
  { station: "广州南", stationTelecode: "IZQ", day: 0, arrive: "12:02", depart: "12:06" },
  { station: "深圳北", stationTelecode: "IOQ", day: 0, arrive: "12:35", depart: "12:35" },
] } }, "G6003", "2026-09-29");
const points: Coordinate[] = [[113.06, 28.15], [113.11, 26], [113.26, 22.99], [114.03, 22.61]];
const distances = [0];
for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + distanceKm(points[i - 1], points[i]));
const route: Wgs84RailwayRoute = { points, distances, stops: [points[0], points[2], points[3]],
  stopDistances: [0, distances[2], distances[3]], lengthKm: distances[3], coordinateSystem: "WGS84" };
const clock = (time: string) => Date.parse(`2026-09-29T${time}:00+08:00`);
function fixAt(distance: number, time = "10:01"): LocationFix {
  const [longitude, latitude] = coordinateAt(route, distance);
  return { longitude, latitude, accuracy: 20, timestamp: clock(time), speed: 70, heading: 180 };
}
const match = (fix: LocationFix, time = "10:01") => matchGpsJourney(journey, route, locateJourney(journey, clock(time)), fix, clock(time));

describe("GPS rail matching", () => {
  it("G6003 GPS just south of Changsha has Guangzhou South as next stop", () => {
    const result = match(fixAt(5));
    expect(result.position?.nextIndex).toBe(1);
    expect(result.position?.phase).toBe("running");
    expect(result.remainingKm).toBeGreaterThan(500);
  });
  it("uses GPS ahead of timetable: a late train before Guangzhou still has Guangzhou as next stop", () => {
    expect(locateJourney(journey, clock("12:15")).nextIndex).toBe(2);
    expect(match(fixAt(distances[2] - 25, "12:15"), "12:15").position?.nextIndex).toBe(1);
  });
  it("changes to Shenzhen only after physically passing Guangzhou", () => {
    const result = match(fixAt(distances[2] + 5, "12:15"), "12:15");
    expect(result.position?.previousIndex).toBe(1);
    expect(result.position?.nextIndex).toBe(2);
  });
  it("matches station dwell and terminal without skipping an approaching stop", () => {
    expect(match({ ...fixAt(distances[2], "12:03"), speed: 0 }, "12:03").position?.phase).toBe("stopped");
    expect(match({ ...fixAt(distances[2] - .02, "12:01"), speed: 2 }, "12:01").position?.nextIndex).toBe(1);
    expect(match({ ...fixAt(distances[3], "12:36"), speed: 0 }, "12:36").position?.nextIndex).toBeNull();
  });
  it("rejects stale, future, invalid and inaccurate fixes", () => {
    const fix = fixAt(5);
    expect(match({ ...fix, timestamp: fix.timestamp - 31000 }).reason).toContain("30 秒");
    expect(match({ ...fix, timestamp: fix.timestamp + 6000 }).position).toBeNull();
    expect(match({ ...fix, accuracy: 501 }).reason).toContain("精度不足");
    expect(match({ ...fix, longitude: NaN }).position).toBeNull();
  });
  it("does not apply another journey date or a location away from this railway", () => {
    expect(match({ ...fixAt(5), longitude: 114.5 }).reason).toContain("偏离");
    const later = Date.parse("2026-10-01T10:01:00+08:00");
    expect(matchGpsJourney(journey, route, locateJourney(journey, later), { ...fixAt(5), timestamp: later }, later).position).toBeNull();
  });
  it("rejects implausible movement between consecutive fixes", () => {
    const fix = fixAt(300); fix.timestamp += 10000;
    expect(matchGpsJourney(journey, route, locateJourney(journey, fix.timestamp), fix, fix.timestamp,
      { distanceKm: 5, timestamp: fix.timestamp - 10000 }).reason).toContain("异常跳跃");
  });
});
describe("GPS / basemap coordinate consistency", () => {
  it("converts RailGo GCJ-02 back to WGS84 with metre-level accuracy", () => {
    for (const point of points) expect(distanceKm(gcjToWgs84(wgs84togcj02(...point)), point) * 1000).toBeLessThan(1);
    expect(gcjToWgs84([-74, 40])).toEqual([-74, 40]);
  });
  it("recomputes route distance after conversion and preserves stop order", () => {
    const raw = { ...route, points: points.map(point => wgs84togcj02(...point)), stops: route.stops.map(point => wgs84togcj02(...point)) };
    const converted = railwayToWgs84(raw);
    expect(converted.coordinateSystem).toBe("WGS84");
    expect(distanceKm(converted.points[0], points[0]) * 1000).toBeLessThan(1);
    expect(converted.stopDistances[2]).toBeGreaterThan(converted.stopDistances[1]);
  });
});
