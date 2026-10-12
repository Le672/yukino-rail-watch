import type { Station } from "./rail-tickets";
import type { UrbanLine, UrbanNetwork, UrbanRide, UrbanRoute, UrbanStop } from "./urban-rail-types";
export type { UrbanNetwork, UrbanRoute, UrbanRide } from "./urban-rail-types";
export { URBAN_MODES } from "./urban-rail-types";
const clean = (value: string) => value.replace(/站$/, "").replace(/\s/g, "");
export const isUrbanStation = (station: Station) => station.code.startsWith("URB:");
export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radians = Math.PI / 180;
  return Math.hypot((a.lon - b.lon) * Math.cos((a.lat + b.lat) / 2 * radians), a.lat - b.lat) * 111195;
}
type Edge = { to: string; line: UrbanLine; minutes: number };
type Point = { stop: UrbanStop; walk: number };
type State = { id: string; stop: string; line: string; minutes: number; changes: number; previous?: State; edge?: Edge; walk: number; transfer: number; waiting: number };
type Target = { code: string; walk: number };
type Arrival = { state: State; walk: number; minutes: number };
export type UrbanGateway = { station: Station; route: UrbanRoute };
// Assumptions for a planning estimate, not observed train speeds or a published timetable.
const planningSpeed = { subway: 30, light_rail: 28, tram: 18, monorail: 25, maglev: 60, suburban: 45, funicular: 8, people_mover: 25 };
class Heap {
  values: State[] = [];
  push(value: State) { this.values.push(value); let i = this.values.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.values[p].minutes <= value.minutes) break; this.values[i] = this.values[p]; i = p; } this.values[i] = value; }
  pop() { const result = this.values[0], last = this.values.pop(); if (this.values.length && last) { let i = 0; while (i * 2 + 1 < this.values.length) { let child = i * 2 + 1; if (child + 1 < this.values.length && this.values[child + 1].minutes < this.values[child].minutes) child++; if (this.values[child].minutes >= last.minutes) break; this.values[i] = this.values[child]; i = child; } this.values[i] = last; } return result; }
}
export class UrbanRailPlanner {
  readonly stops: Map<string, UrbanStop>;
  private edges = new Map<string, Edge[]>();
  private reverseEdges = new Map<string, Edge[]>();
  private grid = new Map<string, UrbanStop[]>();
  private pointCache = new Map<string, Point[]>();
  private interchangeCache = new Map<string, UrbanStop[]>();
  private gatewayCache = new WeakMap<Station[], Map<string, UrbanGateway[]>>();
  private endpointStops = new Map<string, UrbanStop>();
  private stationList: Station[] = [];
  private routeCache = new Map<string, UrbanRoute | null>();
  private anchorsByName = new Map<string, UrbanNetwork["anchors"]>();
  private anchorsByCode = new Map<string, UrbanNetwork["anchors"]>();
  constructor(readonly network: UrbanNetwork) {
    this.stops = new Map(network.stops.map(stop => [stop.id, stop]));
    for (const anchor of network.anchors) {
      const name = clean(anchor.name), list = this.anchorsByName.get(name) || []; list.push(anchor); this.anchorsByName.set(name, list);
      if (anchor.code) { const coded = this.anchorsByCode.get(anchor.code) || []; coded.push(anchor); this.anchorsByCode.set(anchor.code, coded); }
    }
    for (const stop of network.stops) { const key = this.gridKey(stop); const group = this.grid.get(key) || []; group.push(stop); this.grid.set(key, group); }
    for (const line of network.lines) {
      const pairs = line.stops.slice(1).map((to, i) => [line.stops[i], to] as const);
      const total = pairs.reduce((sum, [a, b]) => sum + (this.stops.has(a) && this.stops.has(b) ? metres(this.stops.get(a)!, this.stops.get(b)!) : 0), 0);
      const add = (from: string, to: string) => {
        const a = this.stops.get(from), b = this.stops.get(to); if (!a || !b || from === to) return;
        const length = metres(a, b);
        // Reject implausible/broken station ordering rather than draw a cross-country shortcut.
        if (length > 50000) return;
        const minutes = line.duration && total > 0 ? Math.max(.5, line.duration * length / total) : Math.max(1, length / 1000 / planningSpeed[line.mode] * 60 + .5);
        const list = this.edges.get(from) || []; list.push({ to, line, minutes }); this.edges.set(from, list);
        const reverse = this.reverseEdges.get(to) || []; reverse.push({ to: from, line, minutes }); this.reverseEdges.set(to, reverse);
      };
      for (const [a, b] of pairs) { add(a, b); if (line.bidirectional) add(b, a); }
      if (line.circular && line.stops[0] !== line.stops.at(-1)) { add(line.stops.at(-1)!, line.stops[0]); if (line.bidirectional) add(line.stops[0], line.stops.at(-1)!); }
    }
    const names = new Map<string, UrbanStop[]>();
    for (const stop of network.stops) {
      const key = clean(stop.name), nearby = names.get(key) || [];
      if (nearby.some(prior => metres(prior, stop) < 350)) continue;
      nearby.push(stop); names.set(key, nearby);
      const label = `${stop.area ? `${stop.area} · ` : ""}${stop.name}（轨道）`;
      let name = label; if (this.stationList.some(s => s.name === name)) name += ` [${stop.id}]`;
      const code = `URB:${stop.id}`;
      this.stationList.push({ name, code, pinyin: stop.name, city: stop.area }); this.endpointStops.set(code, stop);
    }
  }
  stations() { return this.stationList; }
  findStation(input: string) {
    const exact = this.stationList.find(s => s.name === input.trim() || s.code === input.trim()); if (exact) return exact;
    const matches = this.stationList.filter(s => clean(s.pinyin) === clean(input.trim()));
    if (matches.length > 1) throw new Error("轨道站名称重复，请从候选中选择带城市／运营网络的完整站名。");
    return matches[0];
  }
  private gridKey(point: { lat: number; lon: number }) { return `${Math.floor(point.lat * 100)}/${Math.floor(point.lon * 100)}`; }
  private near(point: { lat: number; lon: number }, limit: number) {
    const result: UrbanStop[] = [], y = Math.floor(point.lat * 100), x = Math.floor(point.lon * 100);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const stop of this.grid.get(`${y + dy}/${x + dx}`) || []) if (metres(point, stop) <= limit) result.push(stop);
    return result;
  }
  private points(station: Station): Point[] {
    const key = `${station.code}/${station.name}`;
    const cached = this.pointCache.get(key); if (cached) return cached;
    const points = this.stationPoints(station); this.pointCache.set(key, points); return points;
  }
  private stationPoints(station: Station): Point[] {
    const urban = this.endpointStops.get(station.code);
    if (urban) return this.near(urban, 350).filter(s => clean(s.name) === clean(urban.name)).map(stop => ({ stop, walk: Math.ceil(metres(urban, stop) / 60) }));
    const anchors = this.anchorsByCode.get(station.code) || this.anchorsByName.get(clean(station.name)) || [];
    if (!anchors.length || anchors.some(a => metres(a, anchors[0]) > 2000)) return [];
    const points = new Map<string, Point>();
    for (const anchor of anchors) for (const stop of this.near(anchor, 750)) {
      const walk = Math.ceil(metres(anchor, stop) / 60) + 8;
      if (!points.has(stop.id) || points.get(stop.id)!.walk > walk) points.set(stop.id, { stop, walk });
    }
    return [...points.values()];
  }
  hasAccess(station: Station) { return this.points(station).length > 0; }
  private remember(key: string, route: UrbanRoute | null) {
    if (!this.routeCache.has(key) && this.routeCache.size >= 6000) this.routeCache.delete(this.routeCache.keys().next().value!);
    this.routeCache.set(key, route);
    return route;
  }
  private interchanges(stop: UrbanStop) {
    let possible = this.interchangeCache.get(stop.id);
    if (!possible) {
      possible = this.near(stop, 300).filter(s => clean(s.name) === clean(stop.name));
      if (!possible.some(s => s.id === stop.id)) possible.push(stop);
      this.interchangeCache.set(stop.id, possible);
    }
    return possible;
  }
  private traverse(starts: Point[], targets: Map<string, Target[]>, reverse: boolean, maximum: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const best = new Map<string, number>(), heap = new Heap();
    for (const point of starts) heap.push({ id: `${point.stop.id}/start`, stop: point.stop.id, line: "", minutes: point.walk + 5, changes: 0, walk: point.walk + 5, transfer: 0, waiting: 0 });
    const arrivals = new Map<string, Arrival>(), edges = reverse ? this.reverseEdges : this.edges;
    const targetCodes = new Set([...targets.values()].flatMap(list => list.map(target => target.code)));
    let expanded = 0, completedAt = Infinity;
    while (heap.values.length) {
      if (++expanded % 128 === 0) signal?.throwIfAborted();
      const current = heap.pop()!;
      if (current.minutes >= completedAt) break;
      if (current.minutes > maximum || current.changes > 4) continue;
      if ((best.get(current.id) ?? Infinity) < current.minutes) continue;
      if (current.line) for (const target of targets.get(current.stop) || []) {
        const minutes = current.minutes + target.walk;
        if (minutes <= maximum && minutes < (arrivals.get(target.code)?.minutes ?? Infinity)) arrivals.set(target.code, { state: current, walk: target.walk, minutes });
      }
      if (arrivals.size === targetCodes.size) completedAt = Math.max(...[...arrivals.values()].map(value => value.minutes));
      const stop = this.stops.get(current.stop)!;
      for (const next of this.interchanges(stop)) for (const edge of edges.get(next.id) || []) {
        const different = current.line !== edge.line.id;
        const walking = next.id !== current.stop ? Math.ceil(metres(stop, next) / 60) : 0;
        const waiting = different ? Math.min(30, Math.max(2, (edge.line.interval || 12) / 2)) : 0;
        const transfer = different && current.line ? 5 : 0, changes = current.changes + (transfer ? 1 : 0);
        const value = current.minutes + walking + waiting + transfer + edge.minutes;
        const id = `${edge.to}/${edge.line.id}/${changes}`;
        if (changes > 4 || value > maximum || value >= (best.get(id) ?? Infinity)) continue;
        best.set(id, value); heap.push({ id, stop: edge.to, line: edge.line.id, minutes: value, changes, previous: current, edge: { ...edge, to: edge.to }, walk: walking, transfer, waiting });
      }
    }
    return arrivals;
  }
  private itinerary(key: string, arrival: Arrival, reverse = false): UrbanRoute {
    const steps: State[] = []; let cursor: State | undefined = arrival.state;
    while (cursor) { steps.unshift(cursor); cursor = cursor.previous; }
    let rides: UrbanRide[] = []; let walkingMinutes = arrival.walk, transferMinutes = 0, waitingMinutes = 0;
    for (const step of steps) {
      walkingMinutes += step.walk; transferMinutes += step.transfer; waitingMinutes += step.waiting;
      if (!step.edge || !step.previous) continue;
      const line = step.edge.line, fromName = this.stops.get(step.previous.stop)!.name, toName = this.stops.get(step.stop)!.name;
      let ride = rides.at(-1);
      if (!ride || ride.lineId !== line.id) { ride = { lineId: line.id, line: line.name, mode: line.mode, from: fromName, to: toName, stops: [fromName], minutes: 0, operator: line.operator, hours: line.hours, colour: line.colour }; rides.push(ride); }
      ride.to = toName; ride.stops.push(toName); ride.minutes += step.edge.minutes;
    }
    if (reverse) rides = rides.reverse().map(ride => ({ ...ride, from: ride.to, to: ride.from, stops: [...ride.stops].reverse() }));
    return { id: key + "/" + rides.map(r => r.lineId).join("/"), rides: rides.map(r => ({ ...r, minutes: Math.ceil(r.minutes) })), minutes: Math.ceil(arrival.minutes), walkingMinutes: Math.ceil(walkingMinutes), transferMinutes, waitingMinutes: Math.ceil(waitingMinutes), fare: null,
      estimated: true, operationVerified: false, note: "线路与站序来自开放轨道网络；乘车、候车与邻近站步行耗时为规划估算，未核实指定日期的首末班、停运及票价，请以运营方为准。" };
  }
  route(from: Station, to: Station, signal?: AbortSignal): UrbanRoute | null {
    signal?.throwIfAborted();
    const key = `${from.code}/${to.code}`; if (this.routeCache.has(key)) return this.routeCache.get(key)!;
    const starts = this.points(from), ends = this.points(to); if (!starts.length || !ends.length) return this.remember(key, null);
    if (Math.min(...starts.map(a => Math.min(...ends.map(b => metres(a.stop, b.stop))))) > 180000) return this.remember(key, null);
    const targets = new Map(ends.map(p => [p.stop.id, [{ code: to.code, walk: p.walk }]]));
    const arrival = this.traverse(starts, targets, false, 360, signal).get(to.code);
    const value = arrival ? this.itinerary(key, arrival) : null;
    return this.remember(key, value);
  }
  gateways(endpoint: Station, railway: Station[], limit = 6, direction: "from" | "to" = "from", signal?: AbortSignal, maximum = 180): UrbanGateway[] {
    signal?.throwIfAborted();
    const starts = this.points(endpoint); if (!starts.length) return [];
    let cache = this.gatewayCache.get(railway); if (!cache) { cache = new Map(); this.gatewayCache.set(railway, cache); }
    const key = `${endpoint.code}/${endpoint.name}/${direction}/${maximum}`;
    let candidates = cache.get(key);
    if (!candidates) {
      // Discover gateways from the reachable directed network, before applying
      // a query budget. Nearby disconnected stations cannot hide a useful hub.
      const targets = new Map<string, Target[]>(), byCode = new Map<string, Station>();
      for (const station of railway) {
        if (station.code === endpoint.code) continue;
        byCode.set(station.code, station);
        for (const point of this.points(station)) {
          const list = targets.get(point.stop.id) || [];
          list.push({ code: station.code, walk: point.walk }); targets.set(point.stop.id, list);
        }
      }
      candidates = [...this.traverse(starts, targets, direction === "to", maximum, signal)].map(([code, arrival]) => {
        const routeKey = direction === "from" ? `${endpoint.code}/${code}` : `${code}/${endpoint.code}`;
        const route = this.itinerary(routeKey, arrival, direction === "to");
        this.remember(routeKey, route);
        return { station: byCode.get(code)!, route };
      }).sort((a, b) => a.route.minutes - b.route.minutes || a.station.code.localeCompare(b.station.code));
      cache.set(key, candidates);
    }
    return candidates.slice(0, limit);
  }
}
let loaded: Promise<UrbanRailPlanner> | undefined;
export function loadUrbanRail() {
  return loaded ??= import("../data/urban-rail-network.json").then(({ default: value }) => new UrbanRailPlanner(value as UrbanNetwork)).catch(error => { loaded = undefined; throw error; });
}
