import { describe, expect, it } from "vitest";
import { stationSimulationPoint, supplementStationCoordinates } from "../lib/rail-station-coordinates";
import { gcjToWgs84 } from "../lib/rail-gps";
import { estimateRailMotion } from "../lib/rail-motion";
import { locateJourney, observationTime } from "../lib/train-position";
import type { TrainJourney } from "../lib/train-position";

const at = (time: string) => observationTime(`2026-10-05T${time}`);
// Official G2789 stop times checked on 2026-10-05; this fixture never supplies product timetables.
const journey: TrainJourney = { train: "G2789", date: "2026-10-05", codes: ["G2788", "G2789"], model: "CRH380BL", owner: null, checkedAt: at("21:58"),
  stops: [
    { station: "河源东", telecode: "HEA", trainCode: "G2789", arrival: "21:39", departure: "21:41", arrivalAt: at("21:39"), departureAt: at("21:41"), day: 0 },
    { station: "惠州北", telecode: "HUA", trainCode: "G2789", arrival: "22:00", departure: "22:02", arrivalAt: at("22:00"), departureAt: at("22:02"), day: 0 },
    { station: "深圳", telecode: "SZQ", trainCode: "G2789", arrival: "22:35", departure: "22:35", arrivalAt: at("22:35"), departureAt: at("22:35"), day: 0 },
  ] };
describe("coordinate fallback without invented railway geometry", () => {
  it("fills the exact official G2789 stations missing from the line provider, retaining supplied coordinates", async () => {
    const supplied: [number, number] = [114.117168, 22.531675];
    const points = await supplementStationCoordinates(journey, [null, null, supplied]);
    expect(points[2]).toBe(supplied); expect(points.every(Boolean)).toBe(true);
    expect(gcjToWgs84(points[0]!)[0]).toBeGreaterThan(114.6);
    expect(gcjToWgs84(points[1]!)[1]).toBeGreaterThan(23.1);
    const wrongName = { ...journey, stops: [{ ...journey.stops[0], station: "河源" }] };
    expect(await supplementStationCoordinates(wrongName, [null])).toEqual([null]);
  });
  it("keeps next-stop identity and integrates acceleration, cruise and braking into the same simulated point", async () => {
    const stations = (await supplementStationCoordinates(journey, [null, null, null])).map(point => point ? gcjToWgs84(point) : null);
    const accelerate = estimateRailMotion(journey, null, at("21:41") + 30000, null, stations);
    const cruise = estimateRailMotion(journey, null, at("21:50"), null, stations);
    const brake = estimateRailMotion(journey, null, at("22:00") - 10000, null, stations);
    expect(accelerate.stage).toBe("线性加速"); expect(accelerate.kmh).toBeCloseTo(43.2);
    expect(cruise.stage).toBe("匀速巡航"); expect(brake.stage).toBe("线性减速");
    expect(cruise.basis).toBe("stations"); expect(cruise.detail).toContain("未含线路绕行");
    expect(cruise.position.nextIndex).toBe(1); expect(cruise.position.progress).toBeGreaterThan(0);
    const point = stationSimulationPoint(stations, cruise.position)!;
    expect(point[1]).toBeLessThan(stations[0]![1]); expect(point[1]).toBeGreaterThan(stations[1]![1]);
    expect(stationSimulationPoint(stations, locateJourney(journey, at("22:01")))).toEqual(stations[1]);
    expect(stationSimulationPoint([null, stations[1], null], cruise.position)).toBeNull();
    expect(estimateRailMotion(journey, null, at("21:50"), null, [null, stations[1], null]).kmh).toBeNull();
  });
});
