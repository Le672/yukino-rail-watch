import { distanceKm } from "./train-position";
import type { Coordinate, RailwayMapData, RailwayRoute, TrainJourney } from "./train-position";

export type NetworkAsset = { file: string; bytes: number; sha256: string };
export type RailwayNetworkManifest = {
  schema: 1; version: string; coordinateSystem: "WGS84"; snapshotAt: string;
  source: string; license: string; counts: { ways: number; edges: number; officialStations: number; mappedStations: number; trackKm: number };
  graph: NetworkAsset; overview: NetworkAsset;
  geometry: (NetworkAsset & { first: number; count: number; bounds: number[] })[];
};
export type RailwayNetworkGraph = {
  schema: 1; version: string; nodes: Coordinate[];
  // OSM junction indexes, physical length in metres, tagged maxspeed, class flags.
  edges: [number, number, number, number, number][];
  stations: Record<string, { name: string; coordinate: Coordinate; candidates: number[] }>;
};
type Overview = { schema: 1; version: string; lines: Coordinate[][]; tiles?: (NetworkAsset & { bounds: number[] })[] };
type Geometry = Overview & { first: number };
type GraphPart = NetworkAsset & { first: number; count: number };
type SplitGraph = { schema: 1; version: string; nodeFiles: GraphPart[]; edgeFiles: GraphPart[]; stations: RailwayNetworkGraph["stations"] };
type IndexedGraph = { graph: RailwayNetworkGraph; offsets: Uint32Array; connections: Uint32Array };
type LegPath = { from: number; to: number; edges: { index: number; from: number; to: number }[]; meters: number };
const pending = new Map<string, Promise<unknown>>();
const assets = new Map<string, unknown>();
let manifestCache: { until: number; value: RailwayNetworkManifest } | null = null;
let indexCache: { version: string; value: IndexedGraph } | null = null;

function assetUrl(file: string) {
  if (!/^[a-zA-Z0-9._/-]+\.json$/.test(file) || file.includes("..")) throw new Error("无效的铁路缓存文件");
  const native = typeof window !== "undefined" && window.location.protocol === "file:";
  return `${native ? "https://www.yukino.bond" : ""}/rail-network/${file}`;
}
async function readAsset(file: string, expected?: NetworkAsset): Promise<any> {
  if (assets.has(file)) return assets.get(file);
  if (pending.has(file)) return pending.get(file);
  const request = (async () => {
    const response = await fetch(assetUrl(file), { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("本站铁路缓存暂不可用");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 25 * 1024 * 1024 || expected && bytes.byteLength !== expected.bytes) throw new Error("铁路缓存文件不完整");
    if (expected && globalThis.crypto?.subtle) {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2,"0")).join("");
      if (digest !== expected.sha256) throw new Error("铁路缓存版本或校验值不一致");
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value.schema !== 1) throw new Error("铁路缓存格式不支持");
    if (file !== "manifest.json") {
      if (assets.size >= 48) assets.delete(assets.keys().next().value!);
      assets.set(file, value);
    }
    return value;
  })();
  pending.set(file, request);
  try { return await request; } finally { pending.delete(file); }
}
export async function loadRailNetworkManifest(): Promise<RailwayNetworkManifest> {
  if (manifestCache && manifestCache.until > Date.now()) return manifestCache.value;
  const value = await readAsset("manifest.json") as RailwayNetworkManifest;
  if (value.coordinateSystem !== "WGS84" || !/^[a-zA-Z0-9._-]+$/.test(value.version) || !value.graph || !value.overview || !Array.isArray(value.geometry)) throw new Error("铁路缓存索引不完整");
  manifestCache = { until: Date.now() + 5 * 60000, value };
  return value;
}
export async function loadRailNetworkOverview(view?: { bounds: number[]; zoom: number }) {
  const manifest = await loadRailNetworkManifest();
  const overview = await readAsset(manifest.overview.file, manifest.overview) as Overview;
  if (overview.version !== manifest.version || !Array.isArray(overview.lines)) throw new Error("铁路网概览版本不一致");
  const overlaps = (bounds: number[]) => !view || bounds[0] <= view.bounds[2] && bounds[2] >= view.bounds[0] && bounds[1] <= view.bounds[3] && bounds[3] >= view.bounds[1];
  if (view && view.zoom >= 8 && overview.tiles) {
    const tiles = overview.tiles.filter(tile => overlaps(tile.bounds));
    const lines: Coordinate[][] = [];
    for (let first = 0; first < tiles.length; first += 4) {
      const loaded = await Promise.all(tiles.slice(first, first + 4).map(async tile => {
        const value = await readAsset(tile.file, tile) as Overview;
        if (value.version !== manifest.version || !Array.isArray(value.lines)) throw new Error("铁路地图片段不完整");
        return value.lines;
      }));
      for (const rows of loaded) lines.push(...rows);
    }
    return { manifest, lines };
  }
  const lines = view ? overview.lines.filter(line => {
    let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
    for (const [x,y] of line) { left = Math.min(left,x); bottom = Math.min(bottom,y); right = Math.max(right,x); top = Math.max(top,y); }
    return overlaps([left,bottom,right,top]);
  }) : overview.lines;
  return { manifest, lines };
}

async function loadGraph(manifest: RailwayNetworkManifest): Promise<RailwayNetworkGraph> {
  const raw = await readAsset(manifest.graph.file, manifest.graph) as RailwayNetworkGraph | SplitGraph;
  if (raw.version !== manifest.version) throw new Error("铁路图版本不一致");
  if ("nodes" in raw && Array.isArray(raw.nodes)) return raw;
  const split = raw as SplitGraph;
  if (!Array.isArray(split.nodeFiles) || !Array.isArray(split.edgeFiles)) throw new Error("铁路图分片索引不完整");
  const readParts = async (parts: GraphPart[], key: "nodes" | "edges", limit: number) => {
    const rows: any[] = [];
    for (let i = 0; i < parts.length; i += 4) {
      const group = await Promise.all(parts.slice(i,i+4).map(async part => {
        const value = await readAsset(part.file, part);
        if (value.version !== manifest.version || value.first !== part.first || !Array.isArray(value[key]) || value[key].length !== part.count) throw new Error("铁路连接分片不完整");
        return { part, rows: value[key] as any[] };
      }));
      for (const { part, rows: values } of group) {
        if (part.first !== rows.length || rows.length + values.length > limit) throw new Error("铁路连接分片顺序异常");
        for (const row of values) rows.push(row);
      }
    }
    return rows;
  };
  const [nodes, edges] = await Promise.all([readParts(split.nodeFiles, "nodes", 1500000), readParts(split.edgeFiles, "edges", 2000000)]);
  return { schema: 1, version: raw.version, nodes, edges, stations: split.stations };
}
export function indexRailwayGraph(graph: RailwayNetworkGraph): IndexedGraph {
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.stations || graph.nodes.length > 1500000 || graph.edges.length > 2000000) throw new Error("铁路连接索引不完整");
  const offsets = new Uint32Array(graph.nodes.length + 1);
  for (let i = 0; i < graph.edges.length; i++) {
    const [from, to, meters] = graph.edges[i];
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= graph.nodes.length || to >= graph.nodes.length || !Number.isFinite(meters) || meters <= 0) throw new Error("铁路连接资料异常");
    offsets[from + 1]++; if (to !== from) offsets[to + 1]++;
  }
  for (let i = 1; i < offsets.length; i++) offsets[i] += offsets[i - 1];
  const connections = new Uint32Array(offsets.at(-1)!);
  const cursor = offsets.slice();
  for (let i = 0; i < graph.edges.length; i++) { const [a,b] = graph.edges[i]; connections[cursor[a]++] = i; if (a !== b) connections[cursor[b]++] = i; }
  return { graph, offsets, connections };
}

class Queue {
  rows: { node: number; priority: number; cost: number }[] = [];
  push(row: { node: number; priority: number; cost: number }) {
    let index = this.rows.push(row) - 1;
    while (index > 0) { const parent = (index - 1) >> 1; if (this.rows[parent].priority <= row.priority) break; this.rows[index] = this.rows[parent]; index = parent; }
    this.rows[index] = row;
  }
  pop() {
    const first = this.rows[0], tail = this.rows.pop();
    if (this.rows.length && tail) {
      let index = 0;
      while (index * 2 + 1 < this.rows.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.rows.length && this.rows[child + 1].priority < this.rows[child].priority) child++;
        if (this.rows[child].priority >= tail.priority) break;
        this.rows[index] = this.rows[child]; index = child;
      }
      this.rows[index] = tail;
    }
    return first;
  }
}

/** Only original OSM node connectivity forms paths. Crossings are not junctions. */
export function routeRailwayLeg(indexed: IndexedGraph, origins: number[], destinations: number[], train: string): LegPath | null {
  const { graph, offsets, connections } = indexed;
  const valid = (node: number) => Number.isInteger(node) && node >= 0 && node < graph.nodes.length;
  if (!origins.length || !destinations.length || !origins.every(valid) || !destinations.every(valid)) return null;
  const targets = new Set(destinations), starts = new Set(origins), queue = new Queue();
  const costs = new Float64Array(graph.nodes.length); costs.fill(Infinity);
  const previousNode = new Int32Array(graph.nodes.length); previousNode.fill(-1);
  const previousEdge = new Int32Array(graph.nodes.length); previousEdge.fill(-1);
  const heuristic = (node: number) => Math.min(...destinations.map(target => distanceKm(graph.nodes[node], graph.nodes[target]) * 1000));
  for (const node of origins) { costs[node] = 0; queue.push({ node, priority: heuristic(node), cost: 0 }); }
  let reached = -1;
  while (queue.rows.length) {
    const row = queue.pop();
    if (row.cost !== costs[row.node]) continue;
    if (targets.has(row.node)) { reached = row.node; break; }
    for (let adjacent = offsets[row.node]; adjacent < offsets[row.node + 1]; adjacent++) {
      const edgeIndex = connections[adjacent];
      const [a, b, meters, , flags] = graph.edges[edgeIndex];
      // A normal 12306 train cannot use a non-standard gauge shortcut.
      if (flags & 8 || flags & 4) continue;
      const next = a === row.node ? b : a;
      const factor = (flags & 2 ? 20 : 1) * (train.startsWith("G") && !(flags & 1) ? 1.8 : 1);
      const cost = row.cost + meters * factor;
      if (cost >= costs[next]) continue;
      costs[next] = cost; previousNode[next] = row.node; previousEdge[next] = edgeIndex;
      queue.push({ node: next, cost, priority: cost + heuristic(next) });
    }
  }
  if (reached < 0) return null;
  const edges: LegPath["edges"] = []; let node = reached, meters = 0;
  while (!starts.has(node)) {
    const previous = previousNode[node], edgeIndex = previousEdge[node];
    if (previous < 0 || edgeIndex < 0) return null;
    edges.push({ index: edgeIndex, from: previous, to: node }); meters += graph.edges[edgeIndex][2]; node = previous;
  }
  if (!edges.length) return null;
  return { from: node, to: reached, edges: edges.reverse(), meters };
}

export async function loadCachedRailway(journey: TrainJourney): Promise<RailwayMapData | null> {
  const manifest = await loadRailNetworkManifest();
  let indexed: IndexedGraph;
  if (indexCache?.version === manifest.version) indexed = indexCache.value;
  else {
    const graph = await loadGraph(manifest);
    indexed = indexRailwayGraph(graph); indexCache = { version: manifest.version, value: indexed };
  }
  const stations = journey.stops.map(stop => {
    const entry = Object.prototype.hasOwnProperty.call(indexed.graph.stations, stop.telecode) ? indexed.graph.stations[stop.telecode] : undefined;
    return entry?.name === stop.station ? entry : null;
  });
  if (stations.some(station => !station)) return null;
  const legs: LegPath[] = [];
  for (let i = 1; i < stations.length; i++) {
    const origins = legs.length ? [legs.at(-1)!.to] : stations[0]!.candidates;
    const leg = routeRailwayLeg(indexed, origins, stations[i]!.candidates, journey.train);
    if (!leg) return null;
    // Reject a geographically implausible detour, including disconnected
    // directions whose only connection is a very distant crossover.
    const direct = distanceKm(stations[i - 1]!.coordinate, stations[i]!.coordinate) * 1000;
    const hours = (journey.stops[i].arrivalAt - journey.stops[i - 1].departureAt) / 3600000;
    if (leg.meters > Math.max(50000, direct * 4.5) || leg.meters / 1000 / hours > 430) return null;
    legs.push(leg);
  }
  const selectedEdges = new Set(legs.flatMap(leg => leg.edges.map(edge => edge.index)));
  const chunks = manifest.geometry.filter(chunk => Array.from(selectedEdges).some(edge => edge >= chunk.first && edge < chunk.first + chunk.count));
  const loaded = await Promise.all(chunks.map(async chunk => {
    const geometry = await readAsset(chunk.file, chunk) as Geometry;
    if (geometry.version !== manifest.version || geometry.first !== chunk.first || geometry.lines.length !== chunk.count) throw new Error("铁路几何缓存版本不一致");
    return geometry;
  }));
  const geometryByEdge = new Map<number, Coordinate[]>();
  for (const chunk of loaded) chunk.lines.forEach((line, i) => { if (selectedEdges.has(chunk.first + i)) geometryByEdge.set(chunk.first + i, line); });
  const points: Coordinate[] = [], distances: number[] = [], stopDistances = [0], snappedStops = [indexed.graph.nodes[legs[0].from]];
  for (const leg of legs) {
    for (const edge of leg.edges) {
      const source = geometryByEdge.get(edge.index);
      if (!source || source.length < 2) throw new Error("铁路几何缓存不完整");
      const line = indexed.graph.edges[edge.index][0] === edge.from ? source : source.slice().reverse();
      if (points.length && distanceKm(points.at(-1)!, line[0]) > .0001) throw new Error("铁路连接几何断开");
      for (const point of line) {
        if (points.length && distanceKm(points.at(-1)!, point) < .000001) continue;
        distances.push(points.length ? distances.at(-1)! + distanceKm(points.at(-1)!, point) : 0); points.push(point);
      }
    }
    stopDistances.push(distances.at(-1)!); snappedStops.push(indexed.graph.nodes[leg.to]);
  }
  const route: RailwayRoute = { points, distances, stopDistances, stops: snappedStops, lengthKm: distances.at(-1)!,
    coordinateSystem: "WGS84", source: "server-cache", inferred: true, snapshotAt: manifest.snapshotAt, networkVersion: manifest.version };
  return { route, coordinateSystem: "WGS84", stations: stations.map(station => station!.coordinate),
    warning: "路径沿本站缓存的真实铁路网、按本车次停站顺序推定，未获官方实际运行径路确认；位置与速度仍为时刻表预估，临时改线请以现场信息为准。" };
}
