import { describe, expect, it } from "vitest";
import { buildMotionProfile, estimateRailMotion, motionPerformance, sampleMotionProfile } from "../lib/rail-motion";
import type { MotionPerformance } from "../lib/rail-motion";
import { observationTime, parseJourney, positionOnRailway } from "../lib/train-position";
import type { RailwayRoute } from "../lib/train-position";

const at = (time: string) => observationTime(`2026-09-29T${time}`);
const journey = parseJourney({ success: true, data: { numberFull: ["G1"], rundays: ["20260929"], car: "CR400AF-AS", timetable: [
  { station: "甲", stationTelecode: "AAA", day: 0, arrive: "10:00", depart: "10:00" },
  { station: "乙", stationTelecode: "BBB", day: 0, arrive: "11:00", depart: "11:05" },
  { station: "丙", stationTelecode: "CCC", day: 0, arrive: "11:35", depart: "11:35" },
] } }, "G1", "2026-09-29", at("10:00"));
const route: RailwayRoute = { points: [[113, 28], [113, 26], [114, 25]], distances: [0, 180, 280],
  stopDistances: [0, 180, 280], stops: [[113, 28], [113, 26], [114, 25]], lengthKm: 280 };
const constant: MotionPerformance = { label: "test", maxKmh: 350, braking: .5, acceleration: [{ untilKmh: 350, acceleration: .4 }] };

describe("distance-conserving instantaneous timetable motion", () => {
  it("accelerates and brakes linearly rather than reporting the interval average", () => {
    const profile = buildMotionProfile(180000, 3600, constant)!;
    expect(sampleMotionProfile(profile, 10).kmh).toBeCloseTo(14.4);
    expect(sampleMotionProfile(profile, 20).kmh).toBeCloseTo(28.8);
    expect(sampleMotionProfile(profile, 3590).kmh).toBeCloseTo(18);
    expect(sampleMotionProfile(profile, 3580).kmh).toBeCloseTo(36);
    expect(sampleMotionProfile(profile, 1800).stage).toBe("匀速巡航");
    expect(sampleMotionProfile(profile, 1800).kmh).toBeGreaterThan(180);
  });
  it("has continuous velocity and covers exactly the railway distance at the scheduled arrival", () => {
    const profile = buildMotionProfile(190000, 2400, motionPerformance("CR400AF", "G1"))!;
    let time = 0;
    for (const segment of profile.segments.slice(0, -1)) {
      time += segment.seconds;
      expect(Math.abs(sampleMotionProfile(profile, time - .001).kmh - sampleMotionProfile(profile, time + .001).kmh)).toBeLessThan(.01);
    }
    const integral = profile.segments.reduce((meters, segment) => meters + (segment.from + segment.to) / 2 * segment.seconds, 0);
    expect(integral).toBeCloseTo(190000, 5);
    expect(profile.segments.reduce((seconds, segment) => seconds + segment.seconds, 0)).toBeCloseTo(2400, 7);
    expect(sampleMotionProfile(profile, 2400)).toEqual({ kmh: 0, meters: 190000, stage: "已到站" });
    expect(profile.peakKmh).toBeLessThanOrEqual(350);
    expect(profile.segments.filter(segment => segment.to > segment.from)).toHaveLength(3);
  });
  it("uses a triangular ramp for a short leg that has no cruise time", () => {
    const profile = buildMotionProfile(400, 60, constant)!;
    expect(profile.peakKmh).toBeCloseTo(48);
    expect(profile.segments.find(segment => segment.from === segment.to)!.seconds).toBeLessThan(1e-5);
    expect(sampleMotionProfile(profile, 20).stage).toBe("线性加速");
    expect(sampleMotionProfile(profile, 50).stage).toBe("线性减速");
  });
  it("uses model ceilings and rejects a distance that cannot fit the available running time", () => {
    const slow = motionPerformance("CR200J1-C(长编)", "C206");
    expect(slow.maxKmh).toBe(160);
    expect(buildMotionProfile(200000, 3600, slow)).toBeNull();
    expect(buildMotionProfile(200000, 3600, motionPerformance("CR400AF-A", "G1"))).not.toBeNull();
    expect(motionPerformance("CR300BF", "D1").maxKmh).toBe(250);
    expect(motionPerformance("CRH6F-A", "C1").maxKmh).toBe(160);
    expect(motionPerformance("CRH6A", "C1").maxKmh).toBe(200);
    expect(motionPerformance(null, "G1").label).toContain("车型待明确");
  });
  it("rejects invalid distances, durations, or ramp parameters", () => {
    for (const value of [NaN, Infinity, 0, -1]) {
      expect(buildMotionProfile(value, 60, constant)).toBeNull();
      expect(buildMotionProfile(100, value, constant)).toBeNull();
    }
    expect(buildMotionProfile(100, 60, { ...constant, braking: 0 })).toBeNull();
    expect(buildMotionProfile(100, 60, { ...constant, acceleration: [{ untilKmh: 100, acceleration: .4 }] })).toBeNull();
  });
  it("integrates the same velocity into map progress and leaves the next stopping station intact", () => {
    const before = estimateRailMotion(journey, route, at("10:00") + 29000);
    const now = estimateRailMotion(journey, route, at("10:00") + 30000);
    const after = estimateRailMotion(journey, route, at("10:00") + 31000);
    const mapVelocity = (positionOnRailway(route, after.position).coveredKm - positionOnRailway(route, before.position).coveredKm) * 1000 / 2 * 3.6;
    expect(mapVelocity).toBeCloseTo(now.kmh!, 7);
    expect(now.position.nextIndex).toBe(1);
    expect(now.position.progress).toBeLessThan(30 / 3600);
    expect(now.kmh).toBeCloseTo(43.2);
  });
  it.each(["09:59", "11:00", "11:04", "11:35"])("shows zero outside the running phase at %s, even without a route", time => {
    expect(estimateRailMotion(journey, null, at(time)).kmh).toBe(0);
  });
  it("excludes dwell time and begins the new acceleration ramp at departure", () => {
    const departure = estimateRailMotion(journey, route, at("11:05"));
    expect(departure.kmh).toBe(0);
    expect(departure.position.nextIndex).toBe(2);
    expect(estimateRailMotion(journey, route, at("11:05") + 10000).kmh).toBeCloseTo(14.4);
  });
  it("applies fresh delays to both motion and next-station time; ignores stale or conflicting delays", () => {
    const now = at("11:02"), report = { checkedAt: now, rows: [{ station: "乙", telecode: "BBB", code: "DELAY_PREDICTION", minutes: 10 }] };
    const late = estimateRailMotion(journey, route, now, report);
    expect(late.position.phase).toBe("running");
    expect(late.position.nextIndex).toBe(1);
    expect(late.position.arrivalAt).toBe(at("11:10"));
    expect(late.detail).toContain("已结合正晚点");
    expect(estimateRailMotion(journey, route, now + 181000, report)).toEqual(estimateRailMotion(journey, route, now + 181000));
    const conflict = { ...report, rows: [{ station: "甲", telecode: "AAA", code: "DELAY", minutes: 90 }] };
    expect(estimateRailMotion(journey, route, now, conflict).position.warning).toContain("冲突");
  });
  it("keeps speed unknown when neither track distance nor station coordinates are available", () => {
    const missing = estimateRailMotion(journey, null, at("10:30"));
    expect(missing.kmh).toBeNull();
    expect(missing.reason).toContain("线路和车站坐标均未提供");
    expect(missing.position.nextIndex).toBe(1);
    const impossible = estimateRailMotion(journey, { ...route, stopDistances: [0, 500, 800] }, at("10:30"));
    expect(impossible.kmh).toBeNull();
    expect(impossible.reason).toContain("速度约束");
  });
  it("uses full timestamps through a midnight station dwell", () => {
    const overnight = { ...journey, stops: journey.stops.map(stop => ({ ...stop, arrivalAt: stop.arrivalAt + 13 * 3600000, departureAt: stop.departureAt + 13 * 3600000 })) };
    const departure = observationTime("2026-09-30T00:05");
    expect(estimateRailMotion(overnight, route, departure - 60000).kmh).toBe(0);
    expect(estimateRailMotion(overnight, route, departure + 10000).kmh).toBeCloseTo(14.4);
    expect(estimateRailMotion(overnight, route, departure + 10000).position.nextIndex).toBe(2);
  });
});
