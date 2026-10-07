import { wgs84togcj02 } from "coordtransform";
import { coordinateAt, distanceKm } from "./train-position";
import type { Coordinate, JourneyPosition, RailwayRoute, TrainJourney } from "./train-position";

/** Geolocation API / Windows Location API coordinates are WGS84, not RailGo's GCJ-02. */
export type LocationFix = {
  longitude: number; latitude: number; accuracy: number; timestamp: number;
  speed: number | null; heading: number | null;
};
export type Wgs84RailwayRoute = RailwayRoute & { coordinateSystem: "WGS84" };
export type GpsMatch = {
  position: JourneyPosition | null; reason: string | null; coordinate: Coordinate | null;
  distanceKm: number; errorMeters: number; remainingKm: number;
};
export function gcjToWgs84(point: Coordinate): Coordinate {
  // Iterative inverse reduces the one-step conversion's metre-scale error.
  let result: Coordinate = [...point];
  for (let i = 0; i < 6; i++) {
    const mapped = wgs84togcj02(...result);
    const delta: Coordinate = [mapped[0] - point[0], mapped[1] - point[1]];
    result = [result[0] - delta[0], result[1] - delta[1]];
    if (Math.max(Math.abs(delta[0]), Math.abs(delta[1])) < 1e-8) break;
  }
  return result;
}
export function railwayToWgs84(route: RailwayRoute): Wgs84RailwayRoute {
  if (route.coordinateSystem === "WGS84") return { ...route, coordinateSystem: "WGS84" };
  const points = route.points.map(gcjToWgs84), distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + distanceKm(points[i - 1], points[i]));
  const stopDistances = route.stopDistances.map(distance => {
    const index = route.distances.findIndex(value => value >= distance);
    if (index <= 0) return 0;
    const t = (distance - route.distances[index - 1]) / (route.distances[index] - route.distances[index - 1] || 1);
    return distances[index - 1] + t * (distances[index] - distances[index - 1]);
  });
  return { ...route, points, distances, stopDistances, stops: route.stops.map(gcjToWgs84),
    lengthKm: stopDistances[stopDistances.length - 1] - stopDistances[0], coordinateSystem: "WGS84" };
}
export function validLocation(fix: LocationFix) {
  return [fix.latitude, fix.longitude, fix.accuracy, fix.timestamp].every(Number.isFinite) &&
    Math.abs(fix.latitude) <= 90 && Math.abs(fix.longitude) <= 180 && fix.accuracy >= 0 && fix.timestamp > 0;
}

/** Match only this journey's railway and actual stops; through stations never become next stops. */
export function matchGpsJourney(journey: TrainJourney, route: Wgs84RailwayRoute, planned: JourneyPosition,
  fix: LocationFix, now: number, previous?: { distanceKm: number; timestamp: number } | null): GpsMatch {
  const fail = (reason: string): GpsMatch => ({ position: null, reason, coordinate: null, distanceKm: 0, errorMeters: Infinity, remainingKm: 0 });
  if (!validLocation(fix)) return fail("设备返回的定位数据不完整，无法匹配列车位置。");
  if (now - fix.timestamp > 30000 || fix.timestamp > now + 5000) return fail("GPS 定位超过 30 秒未更新，已暂停用定位判断下一站。");
  if (fix.accuracy > 500) return fail("定位精度不足（误差超过 500 米），暂不用于判断下一站。");
  if (now < journey.stops[0].departureAt - 2 * 3600000 || now > journey.stops.at(-1)!.arrivalAt + 24 * 3600000)
    return fail("该始发日期不在当前行程时间内，请选择正在乘坐的车次和始发日期。");
  const target: Coordinate = [fix.longitude, fix.latitude], cos = Math.cos(fix.latitude * Math.PI / 180);
  const start = route.stopDistances[0], end = route.stopDistances.at(-1)!;
  const candidates: { distance: number; error: number }[] = [];
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], length = route.distances[i] - route.distances[i - 1];
    if (!length || route.distances[i] < start || route.distances[i - 1] > end) continue;
    const dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
    const low = Math.max(0, (start - route.distances[i - 1]) / length), high = Math.min(1, (end - route.distances[i - 1]) / length);
    const t = Math.max(low, Math.min(high, (dx * (target[0] - a[0]) * cos + dy * (target[1] - a[1])) / (dx * dx + dy * dy || 1)));
    const point: Coordinate = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    candidates.push({ distance: route.distances[i - 1] + t * length, error: distanceKm(target, point) * 1000 });
  }
  candidates.sort((a, b) => a.error - b.error);
  if (!candidates.length || candidates[0].error > Math.max(250, fix.accuracy * 1.5))
    return fail("设备位置偏离本车次铁路线路，无法确认你正在乘坐此车次。");
  let nearby = candidates.filter(item => item.error <= candidates[0].error + Math.min(60, fix.accuracy));
  if (previous && fix.timestamp > previous.timestamp && fix.timestamp - previous.timestamp <= 60000) {
    const range = (fix.timestamp - previous.timestamp) / 3600000 * 600 + 0.3 + fix.accuracy / 1000;
    const continuous = nearby.filter(item => Math.abs(item.distance - previous.distanceKm) <= range);
    if (!continuous.length) return fail("定位发生异常跳跃，等待下一次稳定定位后再判断。");
    nearby = continuous;
  }
  if (nearby.some(item => Math.abs(item.distance - nearby[0].distance) > 2))
    return fail("线路在此处重叠，当前 GPS 无法唯一确定运行区间。");
  const best = nearby[0], along = best.distance, last = journey.stops.length - 1;
  const radius = Math.max(0.08, Math.min(0.35, fix.accuracy * 1.25 / 1000));
  const atStation = route.stopDistances.findIndex(distance => Math.abs(distance - along) <= radius);
  const moving = fix.speed !== null && Number.isFinite(fix.speed) && fix.speed > 2.5;
  let phase: JourneyPosition["phase"] = "running", currentIndex: number | null = null, previousIndex = 0, nextIndex: number | null = 1, progress = 0;
  if (atStation === 0) {
    if (planned.phase === "before" && !moving) { phase = "before"; currentIndex = 0; }
  } else if (atStation === last && !moving && planned.phase === "arrived") {
    phase = "arrived"; currentIndex = last; previousIndex = last - 1; nextIndex = null; progress = 1;
  } else if (atStation > 0 && atStation < last && !moving && planned.phase === "stopped" && planned.currentIndex === atStation) {
    phase = "stopped"; currentIndex = atStation; previousIndex = atStation - 1; nextIndex = atStation + 1;
  } else {
    nextIndex = route.stopDistances.findIndex((distance, index) => index > 0 && distance > along);
    if (nextIndex < 1) nextIndex = last;
    // A noisy point just past a stop must not silently skip an imminent arrival.
    if (atStation > 0 && !(moving && now >= journey.stops[atStation].departureAt)) nextIndex = atStation;
    previousIndex = nextIndex - 1;
    progress = Math.max(0, Math.min(1, (along - route.stopDistances[previousIndex]) / (route.stopDistances[nextIndex] - route.stopDistances[previousIndex])));
  }
  const sameNext = nextIndex === planned.nextIndex;
  const position: JourneyPosition = { phase, currentIndex, previousIndex: phase === "before" ? null : previousIndex, nextIndex, progress,
    arrivalAt: nextIndex === null ? journey.stops[last].arrivalAt : sameNext ? planned.arrivalAt : journey.stops[nextIndex].arrivalAt,
    departureAt: phase === "before" || phase === "stopped" ? planned.departureAt : null,
    delayUsed: sameNext && planned.delayUsed, warning: planned.warning };
  return { position, reason: null, coordinate: coordinateAt(route, along), distanceKm: along,
    errorMeters: best.error, remainingKm: nextIndex === null ? 0 : Math.max(0, route.stopDistances[nextIndex] - along) };
}
