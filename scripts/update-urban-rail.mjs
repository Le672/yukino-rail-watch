import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Run manually when publishing a network update. Clients use the bundled snapshot,
// never send their trip/GPS to a public Overpass server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".rail-art-work/urban");
const query = '[out:json][timeout:90];(rel["type"="route"]["route"~"^(subway|light_rail|tram|monorail|funicular)$"](18,73,54,136);rel["type"="route"]["route"="train"]["passenger"~"^(urban|suburban|local)$"](18,73,54,136);rel["type"="route"]["route"="train"]["service"="commuter"](18,73,54,136);rel["type"="route"]["route"="train"]["name"~"磁浮|磁悬浮|磁懸浮|maglev|APM|apm"](18,73,54,136);)->.routes;.routes out body;node(r.routes);out body;way(r.routes)["public_transport"="platform"];out center tags;rel(r.routes)["public_transport"~"^(station|stop_area)$"];out center body;way(r.routes)["railway"~"^(monorail|maglev|funicular|tram|light_rail)$"];out tags;node["railway"="station"]["station"!="subway"](18,73,54,136);out body;node["place"="city"](18,73,54,136);out body;';
const distance = (a, b) => {
  const radians = Math.PI / 180, x = (a.lon - b.lon) * Math.cos((a.lat + b.lat) / 2 * radians), y = a.lat - b.lat;
  return Math.hypot(x, y) * 111195;
};
function polygons(text) {
  const rings = []; let ring = null;
  for (const row of text.trim().split(/\r?\n/).slice(1)) {
    const value = row.trim(), coords = value.split(/\s+/).map(Number);
    if (value === "END") { if (ring) rings.push(ring); ring = null; }
    else if (coords.length === 2 && coords.every(Number.isFinite)) ring?.points.push(coords);
    else ring = { hole: value.startsWith("!"), points: [] };
  }
  return rings;
}
function inside(point, rings) {
  let result = false;
  for (const ring of rings) {
    let contains = false;
    for (let i = 0, j = ring.points.length - 1; i < ring.points.length; j = i++) {
      const [x, y] = ring.points[i], [u, v] = ring.points[j];
      if ((y > point.lat) !== (v > point.lat) && point.lon < (u - x) * (point.lat - y) / (v - y) + x) contains = !contains;
    }
    if (contains) { if (ring.hole) return false; result = true; }
  }
  return result;
}
const nameOf = tags => tags?.["name:zh-Hans"] || tags?.["name:zh"] || tags?.name || "";
const cleanName = value => value.replace(/\s*\([^)]*(?:方向|站台|月台)[^)]*\)\s*/g, "").replace(/站$/, "").trim();
function duration(value) {
  if (!value) return undefined;
  if (/^\d{1,3}$/.test(value)) return Number(value) || undefined;
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !Number.isFinite(p))) return undefined;
  return parts[0] * 60 + parts[1] + (parts[2] || 0) / 60;
}
export function buildNetwork(payload, regionPolygons, extraElements = [], minimumLines = 100, minimumStops = 1000) {
  if (payload.remark || !Array.isArray(payload.elements) || !payload.elements.length) throw new Error(payload.remark || "Incomplete urban network response; previous snapshot retained");
  const elements = new Map([...payload.elements, ...extraElements].map(e => [`${e.type}/${e.id}`, e]));
  const cities = [...elements.values()].filter(e => e.type === "node" && e.tags?.place === "city" && nameOf(e.tags) && inside(e, regionPolygons));
  const stops = new Map(), lines = [], used = new Set(); let excluded = 0;
  for (const relation of elements.values()) {
    const tags = relation.tags || {}, mode = tags.route;
    if (relation.type !== "relation" || tags.type !== "route") continue;
    // A bus stop named 磁器口/磁家务 is not a magnetic-levitation railway.
    if (!["subway", "light_rail", "tram", "monorail", "funicular", "maglev", "train"].includes(mode)) { excluded++; continue; }
    if (["construction", "proposed", "disused", "abandoned"].some(key => tags[key] || tags.status === key) || /^(no|private)$/.test(tags.access || "")) { excluded++; continue; }
    let kind = /磁浮|磁悬浮|磁懸浮|maglev/i.test(`${tags.name || ""} ${tags.network || ""}`) ? "maglev" : mode === "train" ? "suburban" : mode;
    const tracks = new Set((relation.members || []).flatMap(m => m.type === "way" ? [elements.get(`way/${m.ref}`)?.tags?.railway] : []));
    if (tracks.has("maglev")) kind = "maglev";
    else if (kind !== "maglev" && tracks.has("monorail")) kind = "monorail";
    else if (kind !== "maglev" && tracks.has("funicular")) kind = "funicular";
    if (/\bAPM\b|旅客捷运系统|旅客捷運系統/i.test(`${tags.name || ""} ${tags.network || ""}`)) kind = "people_mover";
    if (!["subway", "light_rail", "tram", "monorail", "maglev", "suburban", "funicular", "people_mover"].includes(kind)) { excluded++; continue; }
    if (mode === "train" && kind !== "maglev" && kind !== "people_mover" && !/^(urban|suburban|local)$/.test(tags.passenger || "") && tags.service !== "commuter") { excluded++; continue; }
    // These fare/timetable services remain with 12306; map geometry must not become an invented metro service.
    if (kind === "suburban" && /12306|中国铁路|中國鐵路|国铁|國鐵|穗深城际|穗深城際|珠三角城际|珠三角城際|粤港澳大湾区城际|粵港澳大灣區城際/.test(`${tags.name || ""} ${tags.network || ""} ${tags.operator || ""} ${tags.website || ""}`)) { excluded++; continue; }
    const area = nameOf({ name: tags["network:zh"] || tags.network || tags["operator:zh"] || tags.operator || "" });
    const available = prefix => (relation.members || []).filter(member => new RegExp(`^${prefix}(_|$)`).test(member.role || ""));
    const complete = members => members.length >= 2 && members.every(member => {
      const element = elements.get(`${member.type}/${member.ref}`), point = element?.center || element;
      return !!nameOf(element?.tags) && Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
    });
    // PTv2 lists stop_positions first and platforms second. They are alternatives,
    // not a journey that runs the whole line twice.
    const stopMembers = available("stop"), platformMembers = available("platform");
    const members = complete(stopMembers) ? stopMembers : complete(platformMembers) ? platformMembers : stopMembers.length ? stopMembers : platformMembers;
    const sequence = []; let broken = false;
    for (const member of members) {
      const element = elements.get(`${member.type}/${member.ref}`), coordinate = element?.center || element;
      if (!element || !Number.isFinite(coordinate?.lat) || !Number.isFinite(coordinate?.lon)) { broken = true; continue; }
      if (element.tags?.railway === "construction" || element.tags?.construction || element.tags?.disused === "yes") { broken = true; continue; }
      const name = nameOf(element.tags).replace(/\s*\([^)]*(?:方向|站台|月台)[^)]*\)\s*/g, "").trim();
      if (!name) { broken = true; continue; }
      const id = `${member.type}/${member.ref}`;
      let displayArea = area;
      if (!displayArea && cities.length) {
        const nearby = cities.map(city => ({ city, metres: distance(coordinate, city) })).sort((a, b) => a.metres - b.metres)[0];
        if (nearby.metres < 60000) displayArea = `近${nameOf(nearby.city.tags).replace(/市$/, "")}`;
      }
      const stop = { id, name, lat: Number(coordinate.lat.toFixed(6)), lon: Number(coordinate.lon.toFixed(6)), area: displayArea };
      const prior = sequence.length && stops.get(sequence.at(-1));
      if (prior && prior.name === name && distance(prior, stop) < 450) continue;
      stops.set(id, stop); sequence.push(id);
    }
    if (broken || sequence.length < 2 || !sequence.every(id => inside(stops.get(id), regionPolygons))) { excluded++; continue; }
    for (const id of sequence) used.add(id);
    lines.push({ id: String(relation.id), name: nameOf(tags) || tags.ref || `${area} ${kind}`, mode: kind, operator: tags["operator:zh"] || tags.operator || undefined,
      stops: sequence, bidirectional: tags["public_transport:version"] !== "2" && tags.oneway !== "yes", circular: tags.roundtrip === "yes",
      duration: duration(tags.duration), hours: tags.opening_hours || undefined, interval: duration(tags.interval), colour: /^#[0-9a-f]{6}$/i.test(tags.colour || "") ? tags.colour : undefined });
  }
  const anchors = [...elements.values()].flatMap(e => {
    const tags = e.tags || {}, coordinate = e.center || e;
    if (tags.railway !== "station" || /subway|light_rail|monorail|tram/.test(tags.station || "") || tags.subway === "yes" || tags.construction || !nameOf(tags) || !inside(coordinate, regionPolygons)) return [];
    const code = tags["ref:12306"] || tags["ref:cr"] || tags["ref:CR"] || tags.ref;
    return [{ name: cleanName(nameOf(tags)), lat: coordinate.lat, lon: coordinate.lon, code: /^[A-Z]{3}$/.test(code || "") ? code : undefined }];
  });
  if (lines.length < minimumLines || used.size < minimumStops) throw new Error(`National snapshot unexpectedly small: ${lines.length} routes; previous snapshot retained`);
  return { schema: 1, updatedAt: new Date().toISOString(), sourceDate: payload.osm3s?.timestamp_osm_base || "unknown", source: "OpenStreetMap", stops: [...stops.values()].filter(s => used.has(s.id)), lines, anchors, excluded };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(scratch, { recursive: true });
  let rawFile = process.argv[2];
  if (!rawFile) {
    const endpoint = process.env.URBAN_OVERPASS_URL || "https://maps.mail.ru/osm/tools/overpass/api/interpreter";
    const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(110000), headers: { "User-Agent": "YukinoRailWatch (https://github.com/Le672/yukino-rail-watch)" } });
    if (!response.ok) throw new Error(`Network refresh HTTP ${response.status}`);
    rawFile = path.join(scratch, "osm-network.json"); await writeFile(rawFile, await response.text());
  }
  const regions = [];
  for (const name of ["china", "taiwan"]) {
    const file = path.join(scratch, `${name}.poly`);
    let text; try { text = await readFile(file, "utf8"); } catch {
      const response = await fetch(`https://download.geofabrik.de/asia/${name}.poly`); if (!response.ok) throw new Error("Region boundary unavailable");
      text = await response.text(); await writeFile(file, text);
    }
    regions.push(...polygons(text));
  }
  const extras = [];
  for (const name of ["rail-anchors.json", "rail-modes-places.json"]) { try { extras.push(...JSON.parse(await readFile(path.join(scratch, name), "utf8")).elements); } catch {} }
  const network = buildNetwork(JSON.parse(await readFile(rawFile, "utf8")), regions, extras);
  await mkdir(path.join(root, "src/data"), { recursive: true });
  await writeFile(path.join(root, "src/data/urban-rail-network.json"), JSON.stringify(network) + "\n");
  console.log(JSON.stringify({ lines: network.lines.length, stops: network.stops.length, anchors: network.anchors.length, sourceDate: network.sourceDate,
    modes: Object.fromEntries([...new Set(network.lines.map(l => l.mode))].map(mode => [mode, network.lines.filter(l => l.mode === mode).length])), excluded: network.excluded }));
}
