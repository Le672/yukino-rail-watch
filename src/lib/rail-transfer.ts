import { railApiUrl } from "./rail-api";
import { candidateHubs, findStation, interchangeVariants, stationVariants, transferLink } from "./rail-station-groups";
import type { TransferLink } from "./rail-station-groups";
import { chinaDateTime, isJourneyDate } from "./train-position";
import { compareNullable, minutes, seatScore, trainIdentity, trainPrice } from "./rail-tickets";
import type { Station, Train, TrainFilters } from "./rail-tickets";
export type Leg = Train & { date: string; departureAt: number; arrivalAt: number; fromCode: string; toCode: string };
export type Trip = { id: string; legs: Leg[]; connections: TransferLink[]; access?: TransferLink; egress?: TransferLink; departureAt: number; arrivalAt: number; duration: number };
export type TransferSettings = { date: string; from: string; to: string; via: string; via2: string; maxChanges: 1 | 2; minimum: number; maximumWait: number; cityMinutes: number; allowCity: boolean; stationGroupEndpoints: boolean; earliest: string };
export type TransferResult = { date: string; from: string; to: string; checkedAt: string; trips: Trip[]; hubs: Station[]; warnings: string[]; queryCount: number };
export type TransferProgress = { queryCount: number; text: string };
export const DEFAULT_TRANSFER: TransferSettings = { date: chinaDateTime().slice(0, 10), from: "", to: "", via: "", via2: "", maxChanges: 1, minimum: 20, maximumWait: 240, cityMinutes: 90, allowCity: true, stationGroupEndpoints: true, earliest: "00:00" };
const routeCache = new Map<string, { at: number; trains: Train[]; checkedAt: string }>();
const DAY = 86400000;
export function tripFare(trip: Trip, seat: string) {
  const prices = trip.legs.map(t => trainPrice(t, seat));
  return prices.some(p => p == null) ? null : Math.round(prices.reduce<number>((sum, p) => sum + p!, 0) * 100) / 100;
}
export function tripSeats(trip: Trip, seat: string) { return Math.min(...trip.legs.map(t => seatScore(t, seat))); }
export function sortTrips(trips: Trip[], filters: TrainFilters, requireEveryModel = false) {
  return trips.filter(trip => (!filters.availableOnly || tripSeats(trip, filters.seat) > 0) && (!filters.model ||
    (requireEveryModel ? trip.legs.every(t => t.trainsetModel === filters.model) : trip.legs.some(t => t.trainsetModel === filters.model))))
    .sort((a, b) => {
      let order = 0;
      if (filters.sort === "price") order = compareNullable(tripFare(a, filters.seat), tripFare(b, filters.seat));
      else if (filters.sort === "seats") order = tripSeats(b, filters.seat) - tripSeats(a, filters.seat);
      else if (filters.sort === "model") order = a.legs.some(l => !l.trainsetModel) !== b.legs.some(l => !l.trainsetModel) ? (a.legs.some(l => !l.trainsetModel) ? 1 : -1) : a.legs.map(l => l.trainsetModel || "").join(" / ").localeCompare(b.legs.map(l => l.trainsetModel || "").join(" / "), "zh-CN", { numeric: true });
      else if (filters.sort === "duration") order = a.duration - b.duration;
      else order = (filters.sort === "arrival" ? a.arrivalAt - b.arrivalAt : a.departureAt - b.departureAt);
      return order || a.duration - b.duration || a.departureAt - b.departureAt || a.id.localeCompare(b.id);
    });
}
export function timedLeg(train: Train, date: string): Leg | null {
  const start = minutes(train.departure), duration = minutes(train.duration);
  if (start == null || start >= 1440 || duration == null || duration <= 0 || !train.fromCode || !train.toCode || !isJourneyDate(date)) return null;
  const departureAt = Date.parse(`${date}T00:00:00+08:00`) + start * 60000;
  const arrivalAt = departureAt + duration * 60000;
  if (chinaDateTime(arrivalAt).slice(11) !== train.arrival) return null;
  return { ...train, date, departureAt, arrivalAt, fromCode: train.fromCode, toCode: train.toCode };
}
export function makeTrip(legs: Leg[], connections: TransferLink[], settings: TransferSettings, access?: TransferLink, egress?: TransferLink): Trip | null {
  if (!legs.length || connections.length !== legs.length - 1 || new Set(legs.map(l => `${l.trainNo || l.code}/${l.originDate || l.date}`)).size !== legs.length) return null;
  const departureAt = legs[0].departureAt - (access?.minimum || 0) * 60000, arrivalAt = legs.at(-1)!.arrivalAt + (egress?.minimum || 0) * 60000;
  const earliest = Date.parse(`${settings.date}T${settings.earliest}:00+08:00`);
  if (!Number.isFinite(earliest) || departureAt < earliest) return null;
  for (let i = 0; i < connections.length; i++) {
    const link = connections[i], wait = (legs[i + 1].departureAt - legs[i].arrivalAt) / 60000;
    if (legs[i].toCode !== link.from.code || legs[i + 1].fromCode !== link.to.code || wait < link.minimum || wait > settings.maximumWait) return null;
  }
  const visits = new Set<string>();
  for (const leg of legs) {
    if (visits.has(leg.toCode)) return null;
    visits.add(leg.fromCode); visits.add(leg.toCode);
  }
  return { id: legs.map(l => trainIdentity(l)).join("|"), legs, connections, access, egress, departureAt, arrivalAt, duration: Math.round((arrivalAt - departureAt) / 60000) };
}
async function json<T>(params: URLSearchParams, signal?: AbortSignal) {
  const response = await fetch(railApiUrl(params), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || data.source !== "12306") throw new Error(data.error || "12306 查询资料暂不可用");
  return data as T;
}
export async function searchTransfers(settings: TransferSettings, stations: Station[], signal: AbortSignal, onProgress: (progress: TransferProgress) => void): Promise<TransferResult> {
  const from = findStation(stations, settings.from), to = findStation(stations, settings.to);
  if (!from || !to || from.code === to.code || !isJourneyDate(settings.date) || minutes(settings.earliest) == null || minutes(settings.earliest)! >= 1440 ||
      ![1, 2].includes(settings.maxChanges) || !Number.isInteger(settings.minimum) || settings.minimum < 10 || settings.minimum > 180 ||
      !Number.isInteger(settings.maximumWait) || settings.maximumWait < settings.minimum || settings.maximumWait > 1440 || !Number.isInteger(settings.cityMinutes) || settings.cityMinutes < 45 || settings.cityMinutes > 360) throw new Error("请选择两个不同车站、有效日期和时间；同站预留 10–180 分钟，最长等待不超过 1440 分钟，站外预留 45–360 分钟。");
  const manual = [settings.via, settings.via2].filter(Boolean).map(value => findStation(stations, value));
  if (manual.some(s => !s) || (settings.via2 && !settings.via) || (settings.via2 && settings.maxChanges !== 2)) throw new Error("请使用官方站名填写中转站；第二中转站需要允许两次中转。");
  if (manual.some(s => s!.code === from.code || s!.code === to.code) || manual.length === 2 && manual[0]!.code === manual[1]!.code) throw new Error("中转站不能与起终点或另一中转站相同。");
  const warnings = new Set<string>(), local = new Map<string, Promise<Leg[]>>(), trips = new Map<string, Trip>();
  let queryCount = 0, active = 0;
  const queue: (() => void)[] = [];
  const limited = async <T,>(operation: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    if (active >= 3) await new Promise<void>(resolve => queue.push(resolve)); else active++;
    try { signal.throwIfAborted(); return await operation(); } finally { const next = queue.shift(); if (next) next(); else active--; }
  };
  const route = (a: Station, b: Station, date: string): Promise<Leg[]> => {
    if (a.code === b.code) return Promise.resolve([]);
    const key = `${date}/${a.code}/${b.code}`;
    if (local.has(key)) return local.get(key)!;
    const operation = limited(async () => {
      const cached = routeCache.get(key);
      if (cached && Date.now() - cached.at < 30000) return cached.trains.flatMap(t => { const l = timedLeg(t, date); return l ? [l] : []; });
      if (++queryCount > 140) { warnings.add("已达到本次自动查询范围，请指定中转站缩小范围后继续查询。"); return []; }
      onProgress({ queryCount, text: `${date} · ${a.name} → ${b.name}` });
      try {
        const data = await json<{ trains: Train[]; checkedAt: string }>(new URLSearchParams({ date, search: "route", from: a.code, to: b.code }), signal);
        if (!Array.isArray(data.trains)) throw new Error("12306 区间响应格式异常");
        if (routeCache.size >= 300) routeCache.delete(routeCache.keys().next().value!);
        routeCache.set(key, { at: Date.now(), trains: data.trains, checkedAt: data.checkedAt });
        return data.trains.flatMap(t => { const leg = timedLeg(t, date); return leg && leg.fromCode === a.code && leg.toCode === b.code ? [leg] : []; });
      } catch (cause) {
        signal.throwIfAborted();
        warnings.add(`${a.name} → ${b.name}（${date}）查询失败：${cause instanceof Error ? cause.message : String(cause)}`);
        return [];
      }
    });
    local.set(key, operation);
    return operation;
  };
  let official: Station[] = [];
  if (!manual.length) {
    onProgress({ queryCount, text: "读取官方中转节点与城际站群" });
    try { official = (await json<{ hubs: Station[] }>(new URLSearchParams({ mode: "hubs", date: settings.date, from: from.code, to: to.code }), signal)).hubs; }
    catch (cause) { signal.throwIfAborted(); warnings.add(`官方推荐节点暂不可用，继续查询城际站群；可指定中转站：${cause instanceof Error ? cause.message : String(cause)}`); }
  }
  let hubs = manual.length ? [...new Map(manual.flatMap(s => interchangeVariants(s!, stations, settings.allowCity)).map(s => [s.code, s])).values()] : candidateHubs(from, to, stations, official, settings.allowCity);
  if (hubs.length > 28) { hubs = hubs.slice(0, 28); warnings.add("自动查询优先覆盖 28 个节点，可指定中转站进一步查询。"); }
  const origins = settings.stationGroupEndpoints ? stationVariants(from, stations) : [from], destinations = settings.stationGroupEndpoints ? stationVariants(to, stations) : [to];
  const station = (code: string) => stations.find(s => s.code === code)!;
  const firstLegs = new Map<string, Leg[]>();
  const add = (legs: Leg[], links: TransferLink[]) => {
    const access = legs[0].fromCode !== from.code ? transferLink(from, station(legs[0].fromCode), 0) || undefined : undefined;
    const last = legs.at(-1)!, egress = last.toCode !== to.code ? transferLink(station(last.toCode), to, 0) || undefined : undefined;
    const trip = makeTrip(legs, links, settings, access, egress);
    if (trip && trips.size < 50000) trips.set(trip.id, trip);
    else if (trip) warnings.add("方案组合超过 50000 个，请指定节点或缩短等待范围。");
  };
  if (!manual.length) for (const a of origins) for (const b of destinations) for (const leg of await route(a, b, settings.date)) add([leg], []);
  await Promise.all(hubs.map(async hub => {
    const values = (await Promise.all(origins.map(origin => route(origin, hub, settings.date)))).flat();
    firstLegs.set(hub.code, values);
  }));
  const datesAfter = (values: Leg[], link: TransferLink) => [...new Set(values.flatMap(leg => {
    const start = leg.arrivalAt + link.minimum * 60000, end = leg.arrivalAt + settings.maximumWait * 60000;
    if (end < start) return [];
    const dates: string[] = [];
    for (let at = start; at <= end; at += DAY) dates.push(chinaDateTime(at).slice(0, 10));
    dates.push(chinaDateTime(end).slice(0, 10));
    return dates;
  }))].sort();
  const linksFor = (arrivals: Station[], departures: Station[]) => arrivals.flatMap(a => departures.flatMap(b => {
    const link = transferLink(a, b, settings.minimum, settings.allowCity, settings.cityMinutes);
    return link && !origins.some(s => s.code === a.code || s.code === b.code) && !destinations.some(s => s.code === a.code || s.code === b.code) ? [link] : [];
  }));
  const manual1 = manual[0] ? interchangeVariants(manual[0]!, stations, settings.allowCity) : hubs, manual2 = manual[1] ? interchangeVariants(manual[1]!, stations, settings.allowCity) : hubs;
  if (manual.length < 2) await Promise.all(linksFor(manual1, manual1).map(async link => {
    const first = firstLegs.get(link.from.code) || [];
    if (!first.length) return;
    const second = (await Promise.all(datesAfter(first, link).flatMap(date => destinations.map(dest => route(link.to, dest, date))))).flat();
    for (const a of first) for (const b of second) add([a, b], [link]);
  }));
  if (settings.maxChanges === 2) {
    const links1 = linksFor(manual1, manual1).filter(l => firstLegs.get(l.from.code)?.length), links2 = linksFor(manual2, manual2);
    let connectors = 0;
    for (const l1 of links1) for (const l2 of links2) {
      signal.throwIfAborted();
      if (l1.from.code === l2.from.code || l1.to.code === l2.to.code || transferLink(l1.to, l2.from, 0, true)) continue;
      if (!manual.length && connectors >= 36) { warnings.add("两次中转优先查询 36 条节点连接，指定两个中转站可完整查询所选路径。"); continue; }
      connectors++;
      const first = firstLegs.get(l1.from.code)!;
      const middle = (await Promise.all(datesAfter(first, l1).map(date => route(l1.to, l2.from, date)))).flat();
      const usable = middle.filter(b => first.some(a => (b.departureAt - a.arrivalAt) / 60000 >= l1.minimum && (b.departureAt - a.arrivalAt) / 60000 <= settings.maximumWait));
      if (!usable.length) continue;
      const last = (await Promise.all(datesAfter(usable, l2).flatMap(date => destinations.map(dest => route(l2.to, dest, date))))).flat();
      for (const a of first) for (const b of usable) {
        const wait = (b.departureAt - a.arrivalAt) / 60000;
        if (wait < l1.minimum || wait > settings.maximumWait) continue;
        for (const c of last) add([a, b, c], [l1, l2]);
      }
    }
  }
  signal.throwIfAborted();
  if (!trips.size && warnings.size) warnings.add("部分区间查询失败，暂无方案不代表没有可行中转。");
  return { date: settings.date, from: from.name, to: to.name, checkedAt: new Date().toISOString(), trips: [...trips.values()], hubs, warnings: [...warnings], queryCount: Math.min(queryCount, 140) };
}
