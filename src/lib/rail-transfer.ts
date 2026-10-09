import { requestRailData } from "./rail-api";
import type { RailRetry } from "./rail-api";
import { candidateHubs, findStation, interchangeVariants, stationVariants, transferLink } from "./rail-station-groups";
import type { TransferLink } from "./rail-station-groups";
import { chinaDateTime, isJourneyDate } from "./train-position";
import { ticketDateError } from "./rail-ticket-date";
import { compareNullable, minutes, seatScore, trainIdentity, trainPrice } from "./rail-tickets";
import type { Station, Train, TrainFilters } from "./rail-tickets";
import { isUrbanStation, loadUrbanRail } from "./urban-rail";
import type { UrbanRailPlanner, UrbanRoute } from "./urban-rail";
export type Leg = Train & { date: string; departureAt: number; arrivalAt: number; fromCode: string; toCode: string };
export type Trip = { id: string; legs: Leg[]; connections: TransferLink[]; access?: TransferLink; egress?: TransferLink; urbanOnly?: UrbanRoute; departureAt: number; arrivalAt: number; duration: number };
export type TransferSettings = { date: string; from: string; to: string; via: string; via2: string; maxChanges: 1 | 2; minimum: number; maximumWait: number; cityMinutes: number; allowCity: boolean; stationGroupEndpoints: boolean; earliest: string; hubLimit?: number; allowUrban?: boolean };
export type TransferResult = { date: string; from: string; to: string; checkedAt: string; trips: Trip[]; hubs: Station[]; warnings: string[]; queryCount: number; candidateCount: number; hubLimit: number; serviceUnavailable?: boolean; incomplete?: boolean; urban?: { lines: number; stops: number; sourceDate: string } };
export type TransferProgress = { queryCount: number; text: string };
export const DEFAULT_TRANSFER: TransferSettings = { date: chinaDateTime().slice(0, 10), from: "", to: "", via: "", via2: "", maxChanges: 1, minimum: 20, maximumWait: 240, cityMinutes: 90, allowCity: true, stationGroupEndpoints: true, earliest: "00:00", hubLimit: 64, allowUrban: false };
const routeCache = new Map<string, { at: number; trains: Train[]; checkedAt: string }>();
const DAY = 86400000;
export function tripRailFare(trip: Trip, seat: string) {
  if (!trip.legs.length) return null;
  const prices = trip.legs.map(t => trainPrice(t, seat));
  return prices.some(p => p == null) ? null : Math.round(prices.reduce<number>((sum, p) => sum + p!, 0) * 100) / 100;
}
export function hasUrban(trip: Trip) { return !!trip.urbanOnly || [trip.access, ...trip.connections, trip.egress].some(link => link?.kind === "urban"); }
export function tripFare(trip: Trip, seat: string) {
  if (trip.urbanOnly) return trip.urbanOnly.fare;
  const railway = tripRailFare(trip, seat), urban = [trip.access, ...trip.connections, trip.egress].flatMap(link => link?.urban ? [link.urban.fare] : []);
  return railway == null || urban.some(fare => fare == null) ? null : Math.round((railway + urban.reduce<number>((sum, fare) => sum + fare!, 0)) * 100) / 100;
}
export function tripSeats(trip: Trip, seat: string) { return trip.legs.length ? Math.min(...trip.legs.map(t => seatScore(t, seat))) : 0; }
export function sortTrips(trips: Trip[], filters: TrainFilters, requireEveryModel = false, railFirst = true) {
  return trips.filter(trip => (!filters.availableOnly || tripSeats(trip, filters.seat) > 0) && (!filters.model ||
    (requireEveryModel ? trip.legs.length > 0 && trip.legs.every(t => t.trainsetModel === filters.model) : trip.legs.some(t => t.trainsetModel === filters.model))))
    .sort((a, b) => {
      if (railFirst && hasUrban(a) !== hasUrban(b)) return hasUrban(a) ? 1 : -1;
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
  const urbanIds = [access, ...connections, egress].flatMap(link => link?.urban ? [link.urban.id] : []);
  return { id: legs.map(l => trainIdentity(l)).join("|") + (urbanIds.length ? `|urban:${urbanIds.join("|")}` : ""), legs, connections, access, egress, departureAt, arrivalAt, duration: Math.round((arrivalAt - departureAt) / 60000) };
}
async function json<T>(params: URLSearchParams, signal?: AbortSignal, onRetry?: (retry: RailRetry) => void) {
  const data = await requestRailData<T & { source?: string }>(params, signal, onRetry);
  if (data.source !== "12306") throw new Error("12306 查询资料暂不可用");
  return data as T;
}
export async function searchTransfers(settings: TransferSettings, stations: Station[], signal: AbortSignal, onProgress: (progress: TransferProgress) => void, onPartialResult?: (result: TransferResult) => void): Promise<TransferResult> {
  const dateError = ticketDateError(settings.date);
  if (dateError) throw new Error(dateError);
  let urban: UrbanRailPlanner | undefined;
  if (settings.allowUrban) { onProgress({ queryCount: 0, text: "载入全国城市轨道网络" }); urban = await loadUrbanRail(); signal.throwIfAborted(); }
  const from = findStation(stations, settings.from) || urban?.findStation(settings.from), to = findStation(stations, settings.to) || urban?.findStation(settings.to);
  const hubLimit = settings.hubLimit ?? 64, queryLimit = hubLimit * 8;
  if (!from || !to || from.code === to.code || !isJourneyDate(settings.date) || minutes(settings.earliest) == null || minutes(settings.earliest)! >= 1440 ||
      ![1, 2].includes(settings.maxChanges) || !Number.isInteger(settings.minimum) || settings.minimum < 10 || settings.minimum > 180 ||
      !Number.isInteger(settings.maximumWait) || settings.maximumWait < settings.minimum || settings.maximumWait > 1440 || !Number.isInteger(settings.cityMinutes) || settings.cityMinutes < 45 || settings.cityMinutes > 360 || !Number.isInteger(hubLimit) || hubLimit < 32 || hubLimit > 512) throw new Error("请选择两个不同车站、有效日期和时间；同站预留 10–180 分钟，最长等待不超过 1440 分钟，站外预留 45–360 分钟。");
  const manual = [settings.via, settings.via2].filter(Boolean).map(value => findStation(stations, value));
  if (manual.some(s => !s) || (settings.via2 && !settings.via) || (settings.via2 && settings.maxChanges !== 2)) throw new Error("请使用官方站名填写中转站；第二中转站需要允许两次中转。");
  if (manual.some(s => s!.code === from.code || s!.code === to.code) || manual.length === 2 && manual[0]!.code === manual[1]!.code) throw new Error("中转站不能与起终点或另一中转站相同。");
  const warnings = new Set<string>(), local = new Map<string, Promise<Leg[]>>(), trips = new Map<string, Trip>();
  const urbanLink = (a: Station, b: Station, enteringRail = true): TransferLink | null => {
    if (!urban || a.code === b.code) return null;
    const route = urban.route(a, b, signal);
    return route ? { from: a, to: b, kind: "urban", minimum: route.minutes + (enteringRail ? settings.minimum : 0), note: route.note, urban: route } : null;
  };
  const accessLinks = new Map<string, TransferLink>(), egressLinks = new Map<string, TransferLink>();
  const originRail = isUrbanStation(from) ? [] : settings.stationGroupEndpoints ? stationVariants(from, stations) : [from];
  const destinationRail = isUrbanStation(to) ? [] : settings.stationGroupEndpoints ? stationVariants(to, stations) : [to];
  const directUrban = urban && !manual.length ? urban.route(from, to, signal) : null;
  if (directUrban && isUrbanStation(from) && isUrbanStation(to)) {
    const departureAt = Date.parse(`${settings.date}T${settings.earliest}:00+08:00`);
    // A local urban-rail journey does not require hundreds of unrelated 12306 queries.
    return { date: settings.date, from: from.name, to: to.name, checkedAt: new Date().toISOString(), trips: [{ id: directUrban.id, legs: [], connections: [], urbanOnly: directUrban, departureAt, arrivalAt: departureAt + directUrban.minutes * 60000, duration: directUrban.minutes }],
      hubs: [], warnings: [directUrban.note], queryCount: 0, candidateCount: 0, hubLimit,
      urban: { lines: urban!.network.lines.length, stops: urban!.stations().length, sourceDate: urban!.network.sourceDate } };
  }
  if (urban) {
    // Search all mapped railway anchors, not a city whitelist. A small gateway budget keeps official requests bounded.
    for (const gateway of urban.gateways(from, stations, isUrbanStation(from) ? 6 : 2)) { const link = urbanLink(from, gateway.station); if (link && !originRail.some(s => s.code === gateway.station.code)) { originRail.push(gateway.station); accessLinks.set(gateway.station.code, link); } }
    for (const gateway of urban.gateways(to, stations, isUrbanStation(to) ? 6 : 2)) { const link = urbanLink(gateway.station, to, false); if (link && !destinationRail.some(s => s.code === gateway.station.code)) { destinationRail.push(gateway.station); egressLinks.set(gateway.station.code, link); } }
    const route = directUrban;
    if (route) {
      const departureAt = Date.parse(`${settings.date}T${settings.earliest}:00+08:00`);
      trips.set(route.id, { id: route.id, legs: [], connections: [], urbanOnly: route, departureAt, arrivalAt: departureAt + route.minutes * 60000, duration: route.minutes });
    }
    warnings.add("城市轨道为可选的估算方案；没有对应日期的班次、首末班或停运资料时，不保证可赶上衔接列车，轨道票价未知时不会把铁路小计当作总价。");
    if (!originRail.length || !destinationRail.length) warnings.add("所选轨道站暂无已核实坐标与可达线路的铁路接驳节点；仍展示可找到的纯轨道方案，未收录线路不代表没有轨道服务。");
  }
  let queryCount = 0, active = 0, consecutiveFailures = 0, serviceUnavailable = false;
  let lastPartialAt = -Infinity;
  const snapshot = (incomplete = false): TransferResult => ({ date: settings.date, from: from.name, to: to.name, checkedAt: new Date().toISOString(),
    trips: [...trips.values()], hubs, warnings: [...warnings], queryCount, candidateCount, hubLimit, serviceUnavailable, incomplete,
    urban: urban ? { lines: urban.network.lines.length, stops: urban.stations().length, sourceDate: urban.network.sourceDate } : undefined });
  const publishPartial = () => {
    if (!onPartialResult || !trips.size || Date.now() - lastPartialAt < 750) return;
    lastPartialAt = Date.now(); onPartialResult(snapshot(true));
  };
  const queue: (() => void)[] = [];
  const limited = async <T,>(operation: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    if (active >= 2) await new Promise<void>(resolve => queue.push(resolve)); else active++;
    try { signal.throwIfAborted(); return await operation(); } finally { const next = queue.shift(); if (next) next(); else active--; }
  };
  const route = (a: Station, b: Station, date: string): Promise<Leg[]> => {
    if (a.code === b.code) return Promise.resolve([]);
    if (ticketDateError(date)) {
      warnings.add(`${date} 的衔接程超出当前余票查询日期范围，已跳过；尚未开售不代表没有车次。`);
      return Promise.resolve([]);
    }
    const key = `${date}/${a.code}/${b.code}`;
    if (local.has(key)) return local.get(key)!;
    const operation = limited(async () => {
      if (serviceUnavailable) return [];
      const cached = routeCache.get(key);
      if (cached && Date.now() - cached.at < 30000) return cached.trains.flatMap(t => { const l = timedLeg(t, date); return l ? [l] : []; });
      if (queryCount >= queryLimit) { warnings.add("已达到本次区间查询范围，可扩大搜索范围或指定中转站继续查询。"); return []; }
      queryCount++;
      onProgress({ queryCount, text: `${date} · ${a.name} → ${b.name}` });
      try {
        const data = await json<{ trains: Train[]; checkedAt: string }>(new URLSearchParams({ date, search: "route", from: a.code, to: b.code }), signal,
          retry => onProgress({ queryCount, text: `${date} · ${a.name} → ${b.name} · 稍候 ${Math.ceil(retry.delayMs / 1000)} 秒后自动重试（${retry.attempt}/2）` }));
        if (!Array.isArray(data.trains)) throw new Error("12306 区间响应格式异常");
        consecutiveFailures = 0;
        if (routeCache.size >= 300) routeCache.delete(routeCache.keys().next().value!);
        routeCache.set(key, { at: Date.now(), trains: data.trains, checkedAt: data.checkedAt });
        return data.trains.flatMap(t => { const leg = timedLeg(t, date); return leg && leg.fromCode === a.code && leg.toCode === b.code ? [leg] : []; });
      } catch (cause) {
        signal.throwIfAborted();
        warnings.add(`${a.name} → ${b.name}（${date}）查询失败：${cause instanceof Error ? cause.message : String(cause)}`);
        if (++consecutiveFailures >= 8) {
          serviceUnavailable = true;
          warnings.add("12306 连续多个区间查询失败，本次已停止继续请求；已有方案保留，未查询区间不代表没有车次，请稍后重试。");
        }
        publishPartial();
        return [];
      }
    });
    local.set(key, operation);
    return operation;
  };
  let official: Station[] = [];
  if (!manual.length) {
    onProgress({ queryCount, text: "读取当日官方推荐与全国车站节点" });
    const pairs = originRail.slice(0, 2).flatMap(a => destinationRail.slice(0, 2).map(b => [a, b] as const));
    await Promise.all(pairs.map(([a, b]) => limited(async () => {
      try {
        const data = await json<{ hubs: Station[] }>(new URLSearchParams({ mode: "hubs", date: settings.date, from: a.code, to: b.code }), signal);
        if (!Array.isArray(data.hubs)) throw new Error("12306 推荐节点响应格式异常");
        official.push(...data.hubs);
      } catch (cause) { signal.throwIfAborted(); warnings.add(`官方推荐节点暂不可用，继续查询全国车站候选；可指定中转站：${cause instanceof Error ? cause.message : String(cause)}`); }
    })));
    official = [...new Map(official.map(s => [s.code, s])).values()];
  }
  let hubs = manual.length ? [...new Map(manual.flatMap(s => interchangeVariants(s!, stations, settings.allowCity || !!settings.allowUrban)).map(s => [s.code, s])).values()] : candidateHubs(from, to, stations, official, settings.allowCity || !!settings.allowUrban);
  const candidateCount = hubs.length;
  if (!manual.length && hubs.length > hubLimit) { hubs = hubs.slice(0, hubLimit); warnings.add(`本次优先查询 ${hubLimit} / ${candidateCount} 个全国候选站，可扩大搜索范围或指定中转站补查。`); }
  const origins = [...new Map(originRail.map(s => [s.code, s])).values()], destinations = [...new Map(destinationRail.map(s => [s.code, s])).values()];
  const station = (code: string) => stations.find(s => s.code === code)!;
  const firstLegs = new Map<string, Leg[]>();
  const add = (legs: Leg[], links: TransferLink[]) => {
    const access = legs[0].fromCode !== from.code ? accessLinks.get(legs[0].fromCode) || transferLink(from, station(legs[0].fromCode), 0) || undefined : undefined;
    const last = legs.at(-1)!, egress = last.toCode !== to.code ? egressLinks.get(last.toCode) || transferLink(station(last.toCode), to, 0) || undefined : undefined;
    if (legs[0].fromCode !== from.code && !access || last.toCode !== to.code && !egress) return;
    const trip = makeTrip(legs, links, settings, access, egress);
    if (trip && trips.size < 50000) { trips.set(trip.id, trip); publishPartial(); }
    else if (trip) warnings.add("方案组合超过 50000 个，请指定节点或缩短等待范围。");
  };
  if (!manual.length) for (const a of origins) for (const b of destinations) for (const leg of await route(a, b, settings.date)) add([leg], []);
  const readFirst = async (nodes: Station[]) => Promise.all(nodes.filter(hub => !firstLegs.has(hub.code)).map(async hub => {
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
    if (origins.some(s => s.code === a.code || s.code === b.code) || destinations.some(s => s.code === a.code || s.code === b.code)) return [];
    const link = transferLink(a, b, settings.minimum, settings.allowCity, settings.cityMinutes);
    const optional = a.code !== b.code && firstLegs.get(a.code)?.length && link?.kind !== "walk" ? urbanLink(a, b) : null;
    return [link, optional].filter((value): value is TransferLink => !!value);
  }));
  const manual1 = manual[0] ? interchangeVariants(manual[0]!, stations, settings.allowCity || !!settings.allowUrban) : hubs, manual2 = manual[1] ? interchangeVariants(manual[1]!, stations, settings.allowCity || !!settings.allowUrban) : hubs;
  const readSecond = async (links: TransferLink[]) => Promise.all(links.map(async link => {
    const first = firstLegs.get(link.from.code) || [];
    if (!first.length) return;
    const second = (await Promise.all(datesAfter(first, link).flatMap(date => destinations.map(dest => route(link.to, dest, date))))).flat();
    for (const a of first) for (const b of second) add([a, b], [link]);
  }));
  const readThird = async (links1: TransferLink[], links2: TransferLink[]) => {
    let connectors = 0;
    for (const l1 of links1) for (const l2 of links2) {
      signal.throwIfAborted();
      if (serviceUnavailable) break;
      if (l1.from.code === l2.from.code || l1.to.code === l2.to.code || transferLink(l1.to, l2.from, 0, false)) continue;
      if (!manual.length && connectors >= hubLimit * 2) { warnings.add(`两次中转优先查询 ${hubLimit * 2} 条节点连接，指定两个中转站可补查所选路径。`); continue; }
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
  if (manual.length) {
    // Confirm the requested physical nodes first. The same route cache is reused by the full city/nationwide search below.
    const priority1 = stationVariants(manual[0]!, stations);
    await readFirst(priority1);
    const links1 = linksFor(priority1, priority1).filter(link => firstLegs.get(link.from.code)?.length);
    if (manual[1]) {
      const priority2 = stationVariants(manual[1], stations);
      await readThird(links1, linksFor(priority2, priority2));
    } else await readSecond(links1);
  }
  await readFirst(hubs);
  if (manual.length < 2) await readSecond(linksFor(manual1, manual1));
  if (settings.maxChanges === 2) await readThird(linksFor(manual1, manual1).filter(l => firstLegs.get(l.from.code)?.length), linksFor(manual2, manual2));
  signal.throwIfAborted();
  if (!trips.size && warnings.size) warnings.add("部分区间尚未完成查询，暂无方案不代表没有可行中转。");
  return snapshot();
}
