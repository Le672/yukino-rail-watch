import fs from "node:fs/promises";

// Usage: node scripts/build-rail-station-coordinates.mjs osm-nodes.json official-stations.json
const [osmPath, officialPath] = process.argv.slice(2);
if (!osmPath || !officialPath) throw new Error("Supply OSM node data and the official station list");
const osm = JSON.parse(await fs.readFile(osmPath, "utf8")), official = JSON.parse(await fs.readFile(officialPath, "utf8"));
if (!Array.isArray(osm.elements) || !Array.isArray(official.stations)) throw new Error("Invalid coordinate source");
const candidates = new Map();
for (const node of osm.elements) {
  const tags = node.tags || {};
  if (node.type !== "node" || tags.railway !== "station" || tags.station === "subway" || tags.subway === "yes" || tags.train === "no" ||
      !Number.isFinite(node.lon) || !Number.isFinite(node.lat)) continue;
  const names = new Set([tags["name:zh"], tags["name:zh-Hans"], tags.name, tags["official_name:zh"], tags.official_name, tags.alt_name]
    .filter(value => typeof value === "string").flatMap(value => value.split(";")).map(value => value.trim().replace(/站$/, "")));
  for (const name of names) {
    const list = candidates.get(name) || []; list.push(node); candidates.set(name, list);
  }
}
const separationKm = (a, b) => Math.hypot((a.lon - b.lon) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180), a.lat - b.lat) * 111.2;
const stations = {}, ambiguous = [];
for (const station of official.stations) {
  if (!/^[A-Z]{3}$/.test(station.code) || typeof station.name !== "string") continue;
  const nodes = [...new Map((candidates.get(station.name.replace(/站$/, "")) || []).map(node => [node.id, node])).values()];
  if (!nodes.length) continue;
  if (nodes.some(a => nodes.some(b => separationKm(a, b) > 1))) { ambiguous.push(station.name); continue; }
  nodes.sort((a, b) => Number(b.tags.train === "yes") - Number(a.tags.train === "yes") || a.id - b.id);
  const primary = nodes[0];
  stations[station.code] = { name: station.name, coordinate: [Number(primary.lon.toFixed(6)), Number(primary.lat.toFixed(6))], osmNodes: nodes.map(node => node.id) };
}
const snapshot = { source: "OpenStreetMap contributors", license: "ODbL-1.0", coordinateSystem: "WGS84",
  sourceUrl: "https://www.openstreetmap.org/copyright", snapshotAt: osm.osm3s?.timestamp_osm_base, stations };
if (Object.keys(stations).length < 500) throw new Error("Snapshot coverage is insufficient");
await fs.writeFile("src/data/rail-station-coordinates.json", JSON.stringify(snapshot) + "\n");
console.log(JSON.stringify({ matched: Object.keys(stations).length, official: official.stations.length, ambiguous,
  feedbackStations: ["HEA", "HUA", "TAU"].map(code => ({ code, ...stations[code] })) }, null, 2));
