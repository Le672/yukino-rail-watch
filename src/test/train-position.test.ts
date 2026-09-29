import { describe, expect, it } from "vitest";
import { chinaDateTime, coordinateAt, isJourneyDate, locateJourney, observationTime, parseDelays, parseJourney, parseRailwayRoute, positionOnRailway } from "../lib/train-position";

// Public RailGo V2 G6003 timetable fetched 2026-09-29. This is a regression fixture,
// never a fallback timetable in the product.
export const g6003 = { success: true, data: { numberFull: ["G6003"], rundays: ["20260929"], car: "CR400AF-A", timetable: [
  { station: "长沙南", stationTelecode: "CWQ", trainCode: "G6003", day: 0, arrive: "10:00", depart: "10:00" },
  { station: "广州南", stationTelecode: "IZQ", trainCode: "G6003", day: 0, arrive: "12:02", depart: "12:06" },
  { station: "深圳北", stationTelecode: "IOQ", trainCode: "G6003", day: 0, arrive: "12:35", depart: "12:35" },
] } };
const at = (time: string) => observationTime(`2026-09-29T${time}`);
const journey = parseJourney(g6003, "G6003", "2026-09-29", at("10:01"));

describe("date-specific train position and next stopping station", () => {
  it("G6003 at 10:01 selects Guangzhou South, never a station the train passes", () => {
    const position = locateJourney(journey, at("10:01"));
    expect(position.phase).toBe("running");
    expect(journey.stops[position.previousIndex!].station).toBe("长沙南");
    expect(journey.stops[position.nextIndex!].station).toBe("广州南");
    expect(chinaDateTime(position.arrivalAt!)).toBe("2026-09-29T12:02");
    expect(position.progress).toBeCloseTo(1 / 122);
  });
  it.each(["09:59", "10:00", "12:01", "12:02", "12:05", "12:06", "12:35", "23:00"])("handles the timetable boundary at %s", (time) => {
    const position = locateJourney(journey, at(time));
    const expected: Record<string, [string, number | null]> = { "09:59": ["before", 1], "10:00": ["running", 1], "12:01": ["running", 1], "12:02": ["stopped", 2],
      "12:05": ["stopped", 2], "12:06": ["running", 2], "12:35": ["arrived", null], "23:00": ["arrived", null] };
    expect([position.phase, position.nextIndex]).toEqual(expected[time]);
  });
  it("uses arrival day and rolls a midnight dwell's departure into the next day", () => {
    const value = structuredClone(g6003);
    value.data.timetable[0].arrive = value.data.timetable[0].depart = "22:00";
    value.data.timetable[1].arrive = "23:58"; value.data.timetable[1].depart = "00:05";
    value.data.timetable[2].arrive = value.data.timetable[2].depart = "01:00"; value.data.timetable[2].day = 1;
    const overnight = parseJourney(value, "G6003", "2026-09-29");
    const position = locateJourney(overnight, observationTime("2026-09-30T00:01"));
    expect(position.phase).toBe("stopped"); expect(position.currentIndex).toBe(1); expect(position.nextIndex).toBe(2);
    expect(chinaDateTime(position.departureAt!)).toBe("2026-09-30T00:05");
  });
  it("corrects a late arrival without treating the planned arrival as an actual stop", () => {
    const now = at("12:03");
    const delay = parseDelays({ success: true, data: [{ stationName: "广州南", stationTelecode: "IZQ", delayStatusCode: "DELAY_PREDICTION", delayTime: 10 }] }, now);
    const position = locateJourney(journey, now, delay);
    expect(position.phase).toBe("running"); expect(position.nextIndex).toBe(1); expect(position.delayUsed).toBe(true);
    expect(chinaDateTime(position.arrivalAt!)).toBe("2026-09-29T12:12");
    expect(locateJourney(journey, now + 181000, delay).delayUsed).toBe(false);
  });
  it("an early arrival does not move the planned departure earlier", () => {
    const now = at("12:05");
    const delay = parseDelays({ success: true, data: [{ stationName: "广州南", stationTelecode: "IZQ", delayStatusCode: "EARLY", delayTime: 2 }] }, now);
    expect(locateJourney(journey, now, delay).phase).toBe("stopped");
    expect(chinaDateTime(locateJourney(journey, now, delay).departureAt!)).toBe("2026-09-29T12:06");
  });
  it("rejects another date, another train, malformed time and an unordered timetable", () => {
    expect(() => parseJourney(g6003, "G6004", "2026-09-29")).toThrow(/车次不符/);
    expect(() => parseJourney(g6003, "G6003", "2026-09-30")).toThrow(/开行/);
    expect(isJourneyDate("2026-02-30")).toBe(false);
    expect(Number.isNaN(observationTime("2026-09-29T25:00"))).toBe(true);
    const malformed = structuredClone(g6003); malformed.data.timetable[1].arrive = "09:00";
    expect(() => parseJourney(malformed, "G6003", "2026-09-29")).toThrow(/冲突/);
  });
});

describe("route coordinates cannot change next stopping station", () => {
  const line = { success: true, data: { stations: [{ 长沙南: [113, 28] }, { 广州南: [113.2, 23] }, { 深圳北: [114, 22.6] }], train: {
    "长沙南-中间线路点": { index: 1, line: [[113, 28], [112.7, 26]] },
    "中间线路点-广州南": { index: 2, line: [[112.7, 26], [113.2, 23]] },
    "广州南-深圳北": { index: 3, line: [[113.2, 23], [114, 22.6]] },
  } } };
  it("interpolates on the bent railway, not a straight line between stopping stations", () => {
    const route = parseRailwayRoute(line, journey);
    const position = locateJourney(journey, at("11:01"));
    const marker = positionOnRailway(route, position);
    expect(marker.coordinate[0]).toBeLessThan(113.1);
    expect(journey.stops[position.nextIndex!].station).toBe("广州南");
    expect(coordinateAt(route, route.stopDistances[1])[0]).toBeCloseTo(113.2);
  });
  it("sorts unordered sections and orients a reversed railway segment", () => {
    const reversed = structuredClone(line); reversed.data.train["广州南-深圳北"].line.reverse();
    const route = parseRailwayRoute(reversed, journey);
    expect(route.points[route.points.length - 1]).toEqual([114, 22.6]);
  });
  it("refuses a disconnected or different-date route without guessing a position", () => {
    const changed = structuredClone(line); changed.data.stations[1] = { 广州东: [113.2, 23] } as any;
    expect(() => parseRailwayRoute(changed, journey)).toThrow(/不一致/);
    const disconnected = structuredClone(line); disconnected.data.train["广州南-深圳北"].line[0] = [115, 24];
    expect(() => parseRailwayRoute(disconnected, journey)).toThrow(/断开/);
  });
});
