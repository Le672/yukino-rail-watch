import { adjustedStops, distanceKm, locateJourney } from "./train-position";
import type { Coordinate, DelayReport, JourneyPosition, RailwayRoute, TrainJourney } from "./train-position";

type AccelerationBand = { untilKmh: number; acceleration: number };
export type MotionPerformance = {
  label: string; maxKmh: number; acceleration: AccelerationBand[]; braking: number;
};
type MotionSegment = { seconds: number; from: number; to: number };
export type MotionProfile = {
  distanceMeters: number; seconds: number; peakKmh: number; segments: MotionSegment[];
};
export type RailMotionEstimate = {
  kmh: number | null; stage: string; reason: string | null; detail: string;
  position: JourneyPosition; peakKmh: number | null;
  basis?: "railway" | "stations";
};

// Operating ceilings are separate from the approximate, NOT measured, ramp parameters.
const highSpeed: Omit<MotionPerformance, "label"> = { maxKmh: 350, braking: .45,
  acceleration: [{ untilKmh: 200, acceleration: .4 }, { untilKmh: 300, acceleration: .16 }, { untilKmh: 350, acceleration: .08 }] };
const regional: Omit<MotionPerformance, "label"> = { maxKmh: 250, braking: .45,
  acceleration: [{ untilKmh: 160, acceleration: .4 }, { untilKmh: 250, acceleration: .22 }] };
const conventional: Omit<MotionPerformance, "label"> = { maxKmh: 160, braking: .35,
  acceleration: [{ untilKmh: 100, acceleration: .22 }, { untilKmh: 160, acceleration: .14 }] };

export function motionPerformance(model: string | null, train: string): MotionPerformance {
  const name = (model || "").toUpperCase().replace(/\s+/g, "");
  if (/^CR400[AB]F|^CRH380/.test(name)) return { ...highSpeed, label: "350 km/h 级动车组" };
  if (/^CR300[AB]F|^CRH(?:1|2[ABE]|3A|5)/.test(name)) return { ...regional, label: "250 km/h 级动车组" };
  if (/^CR200J/.test(name)) return { ...conventional, label: "160 km/h 级动力集中动车组" };
  if (/^CRH6[AF]/.test(name)) {
    const maxKmh = name.startsWith("CRH6F") ? 160 : 200;
    return { label: `${maxKmh} km/h 级城际动车组`, maxKmh, braking: .6,
      acceleration: [{ untilKmh: 80, acceleration: .6 }, { untilKmh: 160, acceleration: .3 }, { untilKmh: 200, acceleration: .18 }] };
  }
  if (/^[GDC]/.test(train)) return { ...highSpeed, label: "动车组参数参考 · 车型待明确" };
  const maxKmh = train.startsWith("K") ? 120 : train.startsWith("T") ? 140 : 160;
  return { ...conventional, maxKmh, label: "按车次等级估计牵引参数" };
}

function accelerationSegments(peak: number, performance: MotionPerformance) {
  const segments: MotionSegment[] = [];
  let from = 0;
  for (const band of performance.acceleration) {
    const to = Math.min(peak, band.untilKmh / 3.6);
    if (to > from) segments.push({ from, to, seconds: (to - from) / band.acceleration });
    from = to;
    if (from >= peak) break;
  }
  return segments;
}
const duration = (segments: MotionSegment[]) => segments.reduce((total, segment) => total + segment.seconds, 0);
const distance = (segments: MotionSegment[]) => segments.reduce((total, segment) => total + (segment.from + segment.to) / 2 * segment.seconds, 0);

/** Solve peak velocity so the integral of the ramps and cruise equals the rail distance. */
export function buildMotionProfile(distanceMeters: number, seconds: number, performance: MotionPerformance): MotionProfile | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || !Number.isFinite(seconds) || seconds <= 0 ||
      !Number.isFinite(performance.maxKmh) || performance.maxKmh <= 0 || !Number.isFinite(performance.braking) || performance.braking <= 0 ||
      !performance.acceleration.length || performance.acceleration.some((band, i, bands) => !Number.isFinite(band.untilKmh) ||
        !Number.isFinite(band.acceleration) || band.acceleration <= 0 || band.untilKmh <= (i ? bands[i - 1].untilKmh : 0)) ||
      performance.acceleration.at(-1)!.untilKmh < performance.maxKmh) return null;

  const shape = (peak: number) => {
    const acceleration = accelerationSegments(peak, performance);
    const braking = { from: peak, to: 0, seconds: peak / performance.braking };
    const ramps = duration(acceleration) + braking.seconds;
    return { acceleration, braking, ramps, meters: distance(acceleration) + distance([braking]) + peak * Math.max(0, seconds - ramps) };
  };
  // For a short leg, the peak is reached just as braking begins (a triangular profile).
  let low = 0, high = performance.maxKmh / 3.6;
  if (shape(high).ramps > seconds) {
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2;
      if (shape(mid).ramps > seconds) high = mid; else low = mid;
    }
    high = low;
  }
  // Never increase the model ceiling to hide an inconsistent route or timetable.
  if (shape(high).meters + 1e-5 < distanceMeters) return null;
  low = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (shape(mid).meters < distanceMeters) low = mid; else high = mid;
  }
  const peak = (low + high) / 2, result = shape(peak);
  return { distanceMeters, seconds, peakKmh: peak * 3.6, segments: [...result.acceleration,
    { from: peak, to: peak, seconds: Math.max(0, seconds - result.ramps) }, result.braking] };
}

export function sampleMotionProfile(profile: MotionProfile, elapsedSeconds: number) {
  if (elapsedSeconds <= 0) return { kmh: 0, meters: 0, stage: "线性加速" };
  if (elapsedSeconds >= profile.seconds) return { kmh: 0, meters: profile.distanceMeters, stage: "已到站" };
  let remaining = elapsedSeconds, covered = 0;
  for (const segment of profile.segments) {
    if (segment.seconds <= 1e-8) continue;
    if (remaining < segment.seconds) {
      const acceleration = (segment.to - segment.from) / segment.seconds;
      return { kmh: (segment.from + acceleration * remaining) * 3.6,
        meters: covered + segment.from * remaining + .5 * acceleration * remaining ** 2,
        stage: acceleration > 0 ? "线性加速" : acceleration < 0 ? "线性减速" : "匀速巡航" };
    }
    covered += (segment.from + segment.to) / 2 * segment.seconds;
    remaining -= segment.seconds;
  }
  return { kmh: 0, meters: profile.distanceMeters, stage: "已到站" };
}

export function estimateRailMotion(journey: TrainJourney, route: RailwayRoute | null, now: number, report?: DelayReport | null,
  stations?: (Coordinate | null)[]): RailMotionEstimate {
  const position = locateJourney(journey, now, report);
  const unavailable = (reason: string): RailMotionEstimate => ({ position, kmh: null, peakKmh: null, stage: "等待预估资料", detail: "", reason });
  if (!Number.isFinite(now)) return unavailable("请填写有效的观察时间。");
  if (position.phase !== "running") return { position, kmh: 0, peakKmh: 0, reason: null, detail: "依据本车次停站时刻推算。",
    stage: position.phase === "before" ? "尚未发车" : position.phase === "arrived" ? "已到终点" : "停站中" };
  const previous = position.previousIndex!, next = position.nextIndex!;
  const railway = route?.stopDistances.length === journey.stops.length;
  const a = stations?.[previous], b = stations?.[next];
  if (!railway && (!a || !b)) return unavailable("当前区间的线路和车站坐标均未提供，暂不能预估地图位置与速度。");
  const kilometers = railway ? route!.stopDistances[next] - route!.stopDistances[previous] : distanceKm(a!, b!);
  const { stops } = adjustedStops(journey, now, report);
  const seconds = (stops[next].arrivalAt - stops[previous].departureAt) / 1000;
  const performance = motionPerformance(journey.model, journey.train);
  const profile = buildMotionProfile(kilometers * 1000, seconds, performance);
  if (!profile) return unavailable("线路距离与时刻表无法满足车型速度约束，暂不能可靠预估。");
  const sample = sampleMotionProfile(profile, (now - stops[previous].departureAt) / 1000);
  return { kmh: sample.kmh, stage: sample.stage, reason: null, peakKmh: profile.peakKmh, basis: railway ? "railway" : "stations",
    position: { ...position, progress: Math.max(0, Math.min(1, sample.meters / profile.distanceMeters)) },
    detail: `${kilometers.toFixed(1)} km ${railway ? "停站区间" : "两站地理距离（未含线路绕行）"} · ${performance.label}${position.delayUsed ? " · 已结合正晚点" : ""}` };
}
