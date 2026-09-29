import { validLocation } from "./rail-gps";
import type { LocationFix } from "./rail-gps";
import { distanceKm } from "./train-position";

export type SpeedReading = {
  kmh: number | null;
  source: "device" | "position" | null;
  timestamp: number | null;
  sampleSeconds: number | null;
  uncertaintyKmh: number | null;
  reason: string | null;
};
const MAX_SPEED = 600 / 3.6;
const unavailable = (reason: string): SpeedReading => ({
  kmh: null, source: null, timestamp: null, sampleSeconds: null, uncertaintyKmh: null, reason,
});
const reportedSpeed = (fix: LocationFix) => fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0 && fix.speed <= MAX_SPEED;

/** Device current velocity first; a short local regression only when speed is absent. Never uses a timetable. */
export function readRailSpeed(samples: readonly LocationFix[], now: number): SpeedReading {
  const latest = samples.at(-1);
  if (!latest) return unavailable("等待 GPS／设备定位信号。");
  if (!validLocation(latest) || !Number.isFinite(now)) return unavailable("定位数据不完整，暂不测速。");
  if (now - latest.timestamp > 10000 || latest.timestamp > now + 1000)
    return unavailable("超过 10 秒未获得新定位，已暂停实时测速。");
  if (latest.accuracy > 100) return unavailable("定位误差超过 100 米，暂不用于测速。");

  const history: LocationFix[] = [];
  for (const fix of samples) {
    if (!validLocation(fix) || fix.accuracy > 100 || latest.timestamp - fix.timestamp > 12000) continue;
    if (history.length && fix.timestamp <= history.at(-1)!.timestamp) return unavailable("定位时间未连续递增，等待新定位。");
    history.push(fix);
  }
  // A precise-looking velocity must not hide a position teleport or an extreme velocity step.
  const previous = history.at(-2);
  if (previous) {
    const seconds = (latest.timestamp - previous.timestamp) / 1000;
    const moved = distanceKm([previous.longitude, previous.latitude], [latest.longitude, latest.latitude]) * 1000;
    if (moved > MAX_SPEED * seconds + previous.accuracy + latest.accuracy)
      return unavailable("定位发生异常跳跃，等待稳定信号后测速。");
    if (seconds >= 0.5 && seconds <= 5 && reportedSpeed(previous) && reportedSpeed(latest) &&
        Math.abs(latest.speed! - previous.speed!) > 6 * seconds + 3)
      return unavailable("设备速度读数突变，等待下一次稳定读数。");
  }
  if (reportedSpeed(latest)) return {
    kmh: latest.speed! * 3.6, source: "device", timestamp: latest.timestamp,
    sampleSeconds: null, uncertaintyKmh: null, reason: null,
  };
  if (latest.speed !== null && Number.isFinite(latest.speed)) return unavailable("设备速度读数超出有效范围，暂不显示。");

  const window = history.filter(fix => latest.timestamp - fix.timestamp <= 8000);
  const first = window[0], seconds = first ? (latest.timestamp - first.timestamp) / 1000 : 0;
  if (window.length < 3 || seconds < 3) return unavailable("设备未提供速度，正在收集最近几秒的定位点。");
  if (window.some((fix, index) => index > 0 && fix.timestamp - window[index - 1].timestamp > 5000))
    return unavailable("定位采样间隔过长，等待连续信号后测速。");

  // Local WGS84 metres. An 8-second window keeps response short and limits chord/curvature error.
  const radius = 6371000, rad = Math.PI / 180, cos = Math.cos(latest.latitude * rad);
  const points = window.map(fix => ({
    t: (fix.timestamp - latest.timestamp) / 1000,
    x: ((fix.longitude - latest.longitude + 540) % 360 - 180) * rad * radius * cos,
    y: (fix.latitude - latest.latitude) * rad * radius,
    weight: 1 / Math.max(3, fix.accuracy) ** 2,
  }));
  const weight = points.reduce((sum, point) => sum + point.weight, 0);
  const mean = (key: "t" | "x" | "y") => points.reduce((sum, point) => sum + point[key] * point.weight, 0) / weight;
  const t = mean("t"), x = mean("x"), y = mean("y");
  const variance = points.reduce((sum, point) => sum + point.weight * (point.t - t) ** 2, 0);
  if (!variance) return unavailable("定位时间间隔不足，暂不测速。");
  const slope = (key: "x" | "y", centre: number) => points.reduce((sum, point) =>
    sum + point.weight * (point.t - t) * (point[key] - centre), 0) / variance;
  const vx = slope("x", x), vy = slope("y", y), kmh = Math.hypot(vx, vy) * 3.6;
  const uncertaintyKmh = (first.accuracy + latest.accuracy) / seconds * 3.6;
  if (!Number.isFinite(kmh) || kmh > 600 || points.some((point, index) =>
      Math.hypot(point.x - x - vx * (point.t - t), point.y - y - vy * (point.t - t)) > Math.max(20, window[index].accuracy * 3)))
    return unavailable("定位轨迹不稳定，等待稳定信号后测速。");
  if (kmh <= uncertaintyKmh) return unavailable("移动幅度不足以区分定位漂移，暂不判断速度。");
  if (uncertaintyKmh > Math.max(15, kmh * 0.3)) return unavailable("定位误差对测速影响较大，等待更准确的信号。");
  return { kmh, source: "position", timestamp: latest.timestamp, sampleSeconds: seconds, uncertaintyKmh, reason: null };
}
