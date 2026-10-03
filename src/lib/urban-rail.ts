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
  private grid = new Map<string, UrbanStop[]>();
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
  route(from: Station, to: Station, signal?: AbortSignal): UrbanRoute | null {
    const key = `${from.code}/${to.code}`; if (this.routeCache.has(key)) return this.routeCache.get(key)!;
    const starts = this.points(from), ends = this.points(to); if (!starts.length || !ends.length) { this.routeCache.set(key, null); return null; }
    if (Math.min(...starts.map(a => Math.min(...ends.map(b => metres(a.stop, b.stop))))) > 180000) { this.routeCache.set(key, null); return null; }
    const targets = new Map(ends.map(p => [p.stop.id, p.walk]));
    const best = new Map<string, number>(), heap = new Heap();
    for (const point of starts) heap.push({ id: `${point.stop.id}/start`, stop: point.stop.id, line: "", minutes: point.walk + 5, changes: 0, walk: point.walk + 5, transfer: 0, waiting: 0 });
    let winner: State | undefined, elapsed = Infinity, endWalk = 0, expanded = 0;
    while (heap.values.length) {
      if (++expanded % 128 === 0) signal?.throwIfAborted();
      const current = heap.pop()!;
      if (current.minutes >= elapsed || current.minutes > 360 || current.changes > 4) continue;
      if ((best.get(current.id) ?? Infinity) < current.minutes) continue;
      if (targets.has(current.stop) && current.line && current.minutes + targets.get(current.stop)! < elapsed) { winner = current; endWalk = targets.get(current.stop)!; elapsed = current.minutes + endWalk; }
      const stop = this.stops.get(current.stop)!;
      const possible = this.near(stop, 300).filter(s => clean(s.name) === clean(stop.name));
      if (!possible.some(s => s.id === stop.id)) possible.push(stop);
      for (const next of possible) for (const edge of this.edges.get(next.id) || []) {
        const different = current.line !== edge.line.id;
        const walking = next.id !== current.stop ? Math.ceil(metres(stop, next) / 60) : 0;
        const waiting = different ? Math.min(30, Math.max(2, (edge.line.interval || 12) / 2)) : 0;
        const transfer = different && current.line ? 5 : 0, changes = current.changes + (transfer ? 1 : 0);
        const value = current.minutes + walking + waiting + transfer + edge.minutes;
        const id = `${edge.to}/${edge.line.id}/${changes}`;
        if (changes > 4 || value >= (best.get(id) ?? Infinity)) continue;
        best.set(id, value); heap.push({ id, stop: edge.to, line: edge.line.id, minutes: value, changes, previous: current, edge: { ...edge, to: edge.to }, walk: walking, transfer, waiting });
      }
    }
    if (!winner) { this.routeCache.set(key, null); return null; }
    const steps: State[] = []; let cursor: State | undefined = winner;
    while (cursor) { steps.unshift(cursor); cursor = cursor.previous; }
    const rides: UrbanRide[] = []; let walkingMinutes = endWalk, transferMinutes = 0, waitingMinutes = 0;
    for (const step of steps) {
      walkingMinutes += step.walk; transferMinutes += step.transfer; waitingMinutes += step.waiting;
      if (!step.edge || !step.previous) continue;
      const line = step.edge.line, fromName = this.stops.get(step.previous.stop)!.name, toName = this.stops.get(step.stop)!.name;
      let ride = rides.at(-1);
      if (!ride || ride.lineId !== line.id) { ride = { lineId: line.id, line: line.name, mode: line.mode, from: fromName, to: toName, stops: [fromName], minutes: 0, operator: line.operator, hours: line.hours, colour: line.colour }; rides.push(ride); }
      ride.to = toName; ride.stops.push(toName); ride.minutes += step.edge.minutes;
    }
    const value: UrbanRoute = { id: key + "/" + rides.map(r => r.lineId).join("/"), rides: rides.map(r => ({ ...r, minutes: Math.ceil(r.minutes) })), minutes: Math.ceil(elapsed), walkingMinutes: Math.ceil(walkingMinutes), transferMinutes, waitingMinutes: Math.ceil(waitingMinutes), fare: null,
      estimated: true, operationVerified: false, note: "线路与站序来自开放轨道网络；乘车、候车与邻近站步行耗时为规划估算，未核实指定日期的首末班、停运及票价，请以运营方为准。" };
    if (!value.rides.length) return null;
    this.routeCache.set(key, value); return value;
  }
  gateways(endpoint: Station, railway: Station[], limit = 6) {
    const starts = this.points(endpoint); if (!starts.length) return [];
    const candidates = railway.flatMap(station => {
      if (station.code === endpoint.code) return [];
      const points = this.points(station); if (!points.length) return [];
      const distance = Math.min(...points.map(p => Math.min(...starts.map(a => metres(p.stop, a.stop)))));
      return distance < 80000 ? [{ station, distance }] : [];
    }).sort((a, b) => a.distance - b.distance).slice(0, 24);
    return candidates.flatMap(({ station }) => {
      const route = this.route(endpoint, station); return route && route.minutes <= 180 ? [{ station, route }] : [];
    }).sort((a, b) => a.route.minutes - b.route.minutes).slice(0, limit);
  }
}
let loaded: Promise<UrbanRailPlanner> | undefined;
export function loadUrbanRail() {
  return loaded ??= import("../data/urban-rail-network.json").then(({ default: value }) => new UrbanRailPlanner(value as UrbanNetwork)).catch(error => { loaded = undefined; throw error; });
}
