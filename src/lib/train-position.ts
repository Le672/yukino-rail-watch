/** Journey dates and clock times always use China Standard Time (UTC+08:00). */
export type TimetableStop = {
  station: string; telecode: string; trainCode: string;
  arrival: string; departure: string; arrivalAt: number; departureAt: number; day: number;
};
export type TrainJourney = {
  train: string; date: string; codes: string[]; model: string | null; owner: string | null;
  operator?: string | null; modelSource?: "12306" | "RailGo" | null; modelScope?: "dated" | "reference";
  modelDate?: string; modelNumber?: string | null; modelCheckedAt?: number;
  stops: TimetableStop[]; checkedAt: number;
  source?: "12306";
};
export type TrainDelay = { station: string; telecode: string; code: string; minutes: number; kind?: "arrival" | "departure" };
export type DelayReport = { rows: TrainDelay[]; checkedAt: number; source?: "12306"; warning?: string };
export type Coordinate = [number, number]; // longitude, latitude; RailGo routes are GCJ-02 until explicitly converted.
export type RailwayRoute = {
  points: Coordinate[]; distances: number[]; stopDistances: number[]; stops: Coordinate[]; lengthKm: number;
};
export type RailwayMapData = {
  route: RailwayRoute | null; stations: (Coordinate | null)[]; warning: string | null;
};
export type JourneyPosition = {
  phase: "before" | "running" | "stopped" | "arrived";
  currentIndex: number | null; previousIndex: number | null; nextIndex: number | null;
  progress: number; arrivalAt: number | null; departureAt: number | null;
  delayUsed: boolean; warning: string | null;
};

const DAY = 86_400_000;
export const TRAIN_CODE = /^(?:[GDCZTKYS]\d{1,4}[A-Z]?|\d{4})$/;
export function chinaDateTime(at = Date.now()) { return new Date(at + 8 * 3_600_000).toISOString().slice(0, 16); }
export function isJourneyDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = Date.parse(`${date}T00:00:00+08:00`);
  return Number.isFinite(parsed) && chinaDateTime(parsed).slice(0, 10) === date;
}
export function observationTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || !isJourneyDate(value.slice(0, 10))) return NaN;
  return Date.parse(`${value}:00+08:00`);
}
const clockMinutes = (value: unknown) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

export function parseJourney(payload: unknown, train: string, date: string, checkedAt = Date.now()): TrainJourney {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) throw new Error("请填写有效车次和始发日期");
  const root = record(payload), data = record(root.data);
  if (root.success !== true || !Array.isArray(data.timetable) || data.timetable.length < 2 || data.timetable.length > 400) {
    throw new Error("该日期暂无可用时刻表，车次可能不开行或资料尚未提供");
  }
  if (!Array.isArray(data.numberFull) || !data.numberFull.includes(train)) throw new Error("返回的车次与查询车次不符，已停止位置推算");
  if (!Array.isArray(data.rundays) || !data.rundays.includes(date.replace(/-/g, ""))) throw new Error("未确认该车次在所选始发日期开行");
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  const stops: TimetableStop[] = data.timetable.map((value: unknown, index: number) => {
    const row = record(value);
    const first = index === 0, last = index === data.timetable.length - 1;
    const arrival = Number.isFinite(clockMinutes(row.arrive)) ? row.arrive : first ? row.depart : undefined;
    const departure = Number.isFinite(clockMinutes(row.depart)) ? row.depart : last ? row.arrive : undefined;
    if (typeof row.station !== "string" || !row.station.trim() || !Number.isInteger(row.day) || row.day < 0 || row.day > 14 ||
        !Number.isFinite(clockMinutes(arrival)) || !Number.isFinite(clockMinutes(departure))) throw new Error("时刻表站名、运行日或时间不完整，无法可靠判断下一站");
    const arrivalAt = midnight + row.day * DAY + clockMinutes(arrival) * 60000;
    // The API's day field refers to arrival. A station dwell may cross midnight.
    const departureAt = midnight + (row.day + (clockMinutes(departure) < clockMinutes(arrival) ? 1 : 0)) * DAY + clockMinutes(departure) * 60000;
    return { station: row.station.trim(), telecode: typeof row.stationTelecode === "string" ? row.stationTelecode : "",
      trainCode: typeof row.trainCode === "string" ? row.trainCode : train, arrival, departure, arrivalAt, departureAt, day: row.day };
  });
  if (stops.some((stop, i) => i > 0 && stop.arrivalAt <= stops[i - 1].departureAt)) throw new Error("时刻表站序或跨日时间冲突，无法可靠判断下一站");
  return { train, date, codes: data.numberFull.filter((code: unknown) => typeof code === "string"),
    model: typeof data.car === "string" && data.car.trim() ? data.car : null,
    owner: typeof data.carOwner === "string" && data.carOwner.trim() ? data.carOwner : null, stops, checkedAt };
}

export function parseDelays(payload: unknown, checkedAt = Date.now()): DelayReport {
  const root = record(payload);
  if (root.success !== true || !Array.isArray(root.data)) throw new Error("正晚点资料暂不可用");
  const rows: TrainDelay[] = root.data.flatMap((value: unknown) => {
    const row = record(value);
    if (typeof row.stationName !== "string" || typeof row.stationTelecode !== "string" ||
        !/^(?:ON_TIME|DELAY|EARLY)(?:_PREDICTION)?$/.test(row.delayStatusCode) ||
        !Number.isFinite(row.delayTime) || row.delayTime < 0 || row.delayTime > 1440) return [];
    return [{ station: row.stationName, telecode: row.stationTelecode, code: row.delayStatusCode, minutes: row.delayTime }];
  });
  return { rows, checkedAt };
}

export function adjustedStops(journey: TrainJourney, now: number, report?: DelayReport | null) {
  const usable = report && now >= report.checkedAt - 5000 && now - report.checkedAt <= 180000;
  let used = false;
  const stops = journey.stops.map(stop => {
    const matches = usable ? report.rows.filter(row => row.telecode === stop.telecode && row.station === stop.station) : [];
    if (matches.length !== 1) return stop;
    used = true;
    const row = matches[0];
    const offset = row.code.startsWith("DELAY") ? row.minutes : row.code.startsWith("EARLY") ? -row.minutes : 0;
    const arrivalAt = stop.arrivalAt + (row.kind === "departure" ? 0 : offset) * 60000;
    // Arrival lateness informs an estimate. An early arrival never means early departure.
    const departureAt = Math.max(arrivalAt, stop.departureAt + Math.max(0, offset) * 60000);
    return { ...stop, arrivalAt, departureAt };
  });
  if (stops.some((stop, i) => i > 0 && stop.arrivalAt <= stops[i - 1].departureAt)) {
    return { stops: journey.stops, used: false, warning: "正晚点时间顺序冲突，暂按计划时刻估算" };
  }
  return { stops, used, warning: null };
}

/** Only ordered timetable stops can be a next stop. Map nodes never enter this decision. */
export function locateJourney(journey: TrainJourney, now: number, report?: DelayReport | null): JourneyPosition {
  const { stops, used, warning } = adjustedStops(journey, now, report);
  const common = { delayUsed: used, warning };
  if (now < stops[0].departureAt) return { ...common, phase: "before", currentIndex: 0, previousIndex: null, nextIndex: 1,
    progress: 0, arrivalAt: stops[1].arrivalAt, departureAt: stops[0].departureAt };
  const last = stops.length - 1;
  if (now >= stops[last].arrivalAt) return { ...common, phase: "arrived", currentIndex: last, previousIndex: last - 1, nextIndex: null,
    progress: 1, arrivalAt: stops[last].arrivalAt, departureAt: null };
  for (let i = 1; i < stops.length; i++) {
    if (now < stops[i].arrivalAt) return { ...common, phase: "running", currentIndex: null, previousIndex: i - 1, nextIndex: i,
      progress: Math.max(0, Math.min(1, (now - stops[i - 1].departureAt) / (stops[i].arrivalAt - stops[i - 1].departureAt))),
      arrivalAt: stops[i].arrivalAt, departureAt: null };
    if (now < stops[i].departureAt) return { ...common, phase: "stopped", currentIndex: i, previousIndex: i - 1, nextIndex: i + 1,
      progress: 0, arrivalAt: stops[i + 1].arrivalAt, departureAt: stops[i].departureAt };
  }
  throw new Error("运行状态无法确认");
}

function coordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}
/** Station coordinates remain useful when the provider has no track geometry (e.g. conventional trains). */
export function parseRailwayMap(payload: unknown, journey: TrainJourney): RailwayMapData {
  const root = record(payload), data = record(root.data);
  if (root.success !== true || !Array.isArray(data.stations)) throw new Error("该车次暂无可用地图资料");
  const coordinates = new Map<string, Coordinate | null>();
  for (const item of data.stations) for (const [name, value] of Object.entries(record(item))) {
    if (!coordinate(value)) continue;
    if (!coordinates.has(name)) coordinates.set(name, value);
    else {
      const previous = coordinates.get(name);
      if (!previous || distanceKm(previous, value) > 0.01) coordinates.set(name, null);
    }
  }
  const stations = journey.stops.map(stop => coordinates.get(stop.station) ?? null);
  try {
    if (stations.some(point => point === null)) throw new Error("部分停靠站坐标缺失或存在冲突");
    return { route: parseRailwayRoute(payload, journey), stations, warning: null };
  } catch {
    return { route: null, stations,
      warning: "该车次暂无可用的完整铁路线路，已保留可核实的停靠站；GPS 实时位置仍可显示，下一站按时刻表判断。" };
  }
}
export function distanceKm(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180, dlat = (b[1] - a[1]) * rad, dlon = (b[0] - a[0]) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function projectOntoRoute(target: Coordinate, points: Coordinate[], distances: number[], after: number) {
  let best: { point: Coordinate; distance: number; error: number } | null = null;
  const cos = Math.cos(target[1] * Math.PI / 180);
  for (let i = 1; i < points.length; i++) {
    if (distances[i] < after) continue;
    const a = points[i - 1], b = points[i];
    const dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
    const length = distances[i] - distances[i - 1];
    const minT = length ? Math.max(0, (after - distances[i - 1]) / length) : 0;
    const t = Math.max(minT, Math.min(1, (dx * (target[0] - a[0]) * cos + dy * (target[1] - a[1])) / (dx * dx + dy * dy || 1)));
    const point: Coordinate = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const error = distanceKm(point, target);
    if (!best || error < best.error) best = { point, distance: distances[i - 1] + t * length, error };
  }
  return best;
}

export function parseRailwayRoute(payload: unknown, journey: TrainJourney): RailwayRoute {
  const root = record(payload), data = record(root.data);
  if (root.success !== true || !Array.isArray(data.stations)) throw new Error("该车次暂无可用铁路线路点");
  const stationCoordinates = new Map<string, Coordinate>();
  for (const item of data.stations) for (const [name, value] of Object.entries(record(item))) {
    if (coordinate(value)) stationCoordinates.set(name, value);
  }
  const stops = journey.stops.map(stop => stationCoordinates.get(stop.station));
  if (stops.some(stop => !stop)) throw new Error("线路点与该日期的停站表不一致，暂不显示地图位置");
  const sections = Object.values(record(data.train)).map(record).sort((a, b) => a.index - b.index);
  if (!sections.length || new Set(sections.map(section => section.index)).size !== sections.length || sections.length > 1000 ||
      sections.some(section => !Number.isFinite(section.index) || !Array.isArray(section.line) || section.line.length < 2 || section.line.length > 20000 || !section.line.every(coordinate)) ||
      sections.reduce((total, section) => total + section.line.length, 0) > 20000) {
    throw new Error("铁路线路点资料不完整");
  }
  const points: Coordinate[] = [];
  for (const section of sections) {
    const line: Coordinate[] = section.line.slice();
    const previous = points.length ? points[points.length - 1] : stops[0]!;
    if (distanceKm(previous, line[line.length - 1]) < distanceKm(previous, line[0])) line.reverse();
    if (distanceKm(previous, line[0]) > 3) throw new Error("铁路线路点存在断开，暂不推算地图坐标");
    for (const point of line) if (!points.length || distanceKm(points[points.length - 1], point) > 0.00001) points.push(point);
  }
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + distanceKm(points[i - 1], points[i]));
  const stopDistances: number[] = [];
  for (const stop of stops) {
    const projection = projectOntoRoute(stop!, points, distances, stopDistances.length ? stopDistances[stopDistances.length - 1] + 0.001 : 0);
    if (!projection || projection.error > 2) throw new Error("停靠站未能对应到铁路线路，暂不推算地图坐标");
    stopDistances.push(projection.distance);
  }
  if (stopDistances.some((distance, i) => i > 0 && distance <= stopDistances[i - 1])) throw new Error("线路方向与停站顺序不一致");
  return { points, distances, stopDistances, stops: stops as Coordinate[], lengthKm: stopDistances[stopDistances.length - 1] - stopDistances[0] };
}

export function coordinateAt(route: RailwayRoute, distance: number): Coordinate {
  const target = Math.max(0, Math.min(route.distances[route.distances.length - 1], distance));
  const index = route.distances.findIndex(value => value >= target);
  if (index <= 0) return route.points[0];
  const a = route.points[index - 1], b = route.points[index];
  const t = (target - route.distances[index - 1]) / (route.distances[index] - route.distances[index - 1] || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
export function positionOnRailway(route: RailwayRoute, position: JourneyPosition) {
  const distance = position.currentIndex !== null ? route.stopDistances[position.currentIndex] :
    route.stopDistances[position.previousIndex!] + (route.stopDistances[position.nextIndex!] - route.stopDistances[position.previousIndex!]) * position.progress;
  return { coordinate: coordinateAt(route, distance), coveredKm: distance - route.stopDistances[0], remainingKm: route.stopDistances[route.stopDistances.length - 1] - distance };
}
