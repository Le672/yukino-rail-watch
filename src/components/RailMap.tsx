import L from "leaflet";
import { LocateFixed, Map as MapIcon, Maximize2, Satellite } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { wgs84togcj02 } from "coordtransform";
import { positionOnRailway } from "../lib/train-position";
import type { Coordinate, JourneyPosition, TrainJourney } from "../lib/train-position";
import { gcjToWgs84 } from "../lib/rail-gps";
import type { GpsMatch, LocationFix, Wgs84RailwayRoute } from "../lib/rail-gps";
import { stationSimulationPoint } from "../lib/rail-station-coordinates";
import { loadRailNetworkOverview } from "../lib/rail-network";

const basemaps = {
  amap: { name: "高德地图", coordinateSystem: "GCJ02", subdomains: "1234",
    url: "https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&size=1&scl=1&style=8&lang=zh_cn", maxNativeZoom: 18,
    attribution: '&copy; <a href="https://www.amap.com/" target="_blank" rel="noreferrer">高德地图</a>' },
  osm: { name: "OpenStreetMap", coordinateSystem: "WGS84", subdomains: "abc",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>' },
  satellite: { name: "Sentinel-2 卫星图", coordinateSystem: "WGS84", subdomains: "abc",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg", maxNativeZoom: 14,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a> by <a href="https://eox.at" target="_blank" rel="noreferrer">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2025) · <a href="https://maps.eox.at" target="_blank" rel="noreferrer">EOX::Maps</a>' },
} as const;
type MapCoordinates = "GCJ02" | "WGS84";
const displayedPoint = (point: Coordinate, system: MapCoordinates): Coordinate => system === "GCJ02" ? wgs84togcj02(...point) : point;
const displayLatLng = (point: Coordinate, system: MapCoordinates): L.LatLngTuple => {
  const projected = displayedPoint(point, system); return [projected[1], projected[0]];
};
const tooltip = (text: string) => { const element = document.createElement("span"); element.textContent = text; return element; };
const noStations: (Coordinate | null)[] = [];

export function RailMap({ journey, route, stations, position, fix, match, gpsEnabled }: {
  journey: TrainJourney | null; route: Wgs84RailwayRoute | null; position: JourneyPosition | null;
  stations?: (Coordinate | null)[]; // WGS84, in timetable order; missing stations keep their null slot.
  fix: LocationFix | null; match: GpsMatch | null; gpsEnabled: boolean;
}) {
  const host = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null);
  const tracks = useRef<L.LayerGroup | null>(null), markers = useRef<L.LayerGroup | null>(null);
  const networkTracks = useRef<L.LayerGroup | null>(null);
  const [network, setNetwork] = useState<Awaited<ReturnType<typeof loadRailNetworkOverview>> | null>(null);
  const [showNetwork, setShowNetwork] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const [mode, setMode] = useState<"streets" | "satellite">("streets");
  const [streetProvider, setStreetProvider] = useState<"amap" | "osm">("amap");
  const [tileRevision, setTileRevision] = useState(0);
  const source = basemaps[mode === "satellite" ? "satellite" : streetProvider];
  const displaySystem = useRef<MapCoordinates>(source.coordinateSystem);
  const latLng = useMemo(() => (point: Coordinate) => displayLatLng(point, source.coordinateSystem), [source.coordinateSystem]);
  const fittedData = useRef<{ key: string; route: Wgs84RailwayRoute | null; stops: (Coordinate | null)[] } | null>(null);
  const [following, setFollowing] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const gpsCentered = useRef(false);
  const stopPoints = stations ?? route?.stops ?? noStations;
  const availableStops = useMemo(() => stopPoints.filter((point): point is Coordinate => point !== null), [stopPoints]);
  useEffect(() => { if (!gpsEnabled) gpsCentered.current = false; }, [gpsEnabled]);
  const plannedPoint = useMemo(() => position ? route ? positionOnRailway(route, position).coordinate : stationSimulationPoint(stopPoints, position) : null,
    [route, stopPoints, position]);
  const liveFix = gpsEnabled && fix && Date.now() - fix.timestamp >= -5000 && Date.now() - fix.timestamp <= 30000 ? fix : null;
  const point: Coordinate | null = liveFix ? [liveFix.longitude, liveFix.latitude] : plannedPoint;
  const pointRef = useRef(point); pointRef.current = point;
  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current, { center: displayLatLng([111, 29.5], displaySystem.current), zoom: 5, minZoom: 2, maxZoom: 19,
      preferCanvas: true, attributionControl: true, zoomControl: false, scrollWheelZoom: false });
    map.current = instance;
    instance.attributionControl.setPrefix(false);
    L.control.zoom({ zoomInTitle: "放大一级", zoomOutTitle: "缩小一级" }).addTo(instance);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(instance);
    networkTracks.current = L.layerGroup().addTo(instance);
    tracks.current = L.layerGroup().addTo(instance); markers.current = L.layerGroup().addTo(instance);
    instance.on("dragstart", () => setFollowing(false));
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    resize?.observe(host.current);
    return () => { resize?.disconnect(); instance.remove(); map.current = null; tracks.current = null; markers.current = null; networkTracks.current = null; };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    let active = true, revision = 0;
    const refresh = () => {
      const current = ++revision, bounds = instance.getBounds();
      const southwest: Coordinate = [bounds.getWest(), bounds.getSouth()], northeast: Coordinate = [bounds.getEast(), bounds.getNorth()];
      const a = source.coordinateSystem === "GCJ02" ? gcjToWgs84(southwest) : southwest;
      const b = source.coordinateSystem === "GCJ02" ? gcjToWgs84(northeast) : northeast;
      void loadRailNetworkOverview({ bounds: [a[0],a[1],b[0],b[1]], zoom: instance.getZoom() })
        .then(value => { if (active && revision === current) { setNetwork(value); setNetworkError(false); } })
        .catch(() => { if (active && revision === current) setNetworkError(true); });
    };
    instance.on("moveend", refresh); refresh();
    return () => { active = false; instance.off("moveend", refresh); };
  }, [source.coordinateSystem]);
  useEffect(() => {
    const group = networkTracks.current;
    if (!group) return;
    group.clearLayers();
    if (network && showNetwork) L.polyline(network.lines.map(line => line.map(latLng)), {
      color: "#777e69", opacity: .55, weight: 1.3, interactive: false,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
    }).addTo(group).bringToBack();
  }, [network, showNetwork, latLng]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    setTileError(false);
    // Keep the same physical view when switching between GCJ-02 and WGS84 basemaps.
    if (displaySystem.current !== source.coordinateSystem) {
      const center = instance.getCenter();
      const raw: Coordinate = [center.lng, center.lat];
      const wgsCenter = displaySystem.current === "GCJ02" ? gcjToWgs84(raw) : raw;
      displaySystem.current = source.coordinateSystem;
      instance.setView(displayLatLng(wgsCenter, source.coordinateSystem), instance.getZoom(), { animate: false });
    }
    const layer = L.tileLayer(source.url, { maxZoom: 19, maxNativeZoom: source.maxNativeZoom,
      attribution: source.attribution, subdomains: source.subdomains, keepBuffer: 1, updateWhenIdle: true,
      referrerPolicy: "strict-origin-when-cross-origin" });
    let success = 0, failed = 0, active = true, timeout: ReturnType<typeof setTimeout> | undefined;
    layer.on("loading", () => {
      success = 0; failed = 0; clearTimeout(timeout);
      timeout = setTimeout(() => { if (active && !success) setTileError(true); }, 15000);
    });
    layer.on("tileload", () => { if (!active) return; success++; if (success > failed) setTileError(false); });
    layer.on("tileerror", () => { if (!active) return; failed++; if (failed > success && failed >= 2) setTileError(true); });
    layer.on("load", () => { clearTimeout(timeout); });
    layer.addTo(instance);
    return () => { active = false; clearTimeout(timeout); layer.remove(); layer.off(); };
  }, [source, tileRevision]);
  useEffect(() => {
    const instance = map.current, group = tracks.current;
    if (!instance || !group) return;
    group.clearLayers();
    if (!journey) return;
    if (route) {
      L.polyline(route.points.map(latLng), { color: "#fffefb", opacity: 0.85, weight: 7, interactive: false }).addTo(group);
      L.polyline(route.points.map(latLng), { color: "#315c42", weight: 3, interactive: false }).addTo(group);
    }
    journey.stops.forEach((stop, index) => {
      if (!stopPoints[index]) return;
      L.circleMarker(latLng(stopPoints[index]!), { radius: 5, color: "#315c42", fillColor: "#fffefb", fillOpacity: 1, weight: 2 })
        .bindTooltip(tooltip(stop.station), { direction: "top", permanent: journey.stops.length <= 8 }).addTo(group);
    });
    const bounds = route?.points ?? availableStops;
    const key = `${journey.train}/${journey.date}`;
    const alreadyFitted = fittedData.current?.key === key && fittedData.current.route === route && fittedData.current.stops === stopPoints;
    if (bounds.length && !gpsCentered.current && !alreadyFitted) instance.fitBounds(L.latLngBounds(bounds.map(latLng)), { padding: [26, 30], maxZoom: 11, animate: false });
    fittedData.current = { key, route, stops: stopPoints };
  }, [route, journey, stopPoints, availableStops, latLng]);
  useEffect(() => {
    const instance = map.current, group = markers.current;
    if (!instance || !group) return;
    group.clearLayers();
    if (journey && position?.nextIndex !== null && position?.nextIndex !== undefined && stopPoints[position.nextIndex]) {
      const next = position.nextIndex;
      L.circleMarker(latLng(stopPoints[next]!), { radius: 7, color: "#92702c", fillColor: "#f0c86c", fillOpacity: 1, weight: 2 })
        .bindTooltip(tooltip(`下一停靠站：${journey.stops[next].station}${!route ? "（时刻表）" : ""}`), { direction: "top" }).addTo(group);
    }
    if (liveFix) {
      const raw = latLng([liveFix.longitude, liveFix.latitude]);
      L.circle(raw, { radius: liveFix.accuracy, color: "#367ba7", fillColor: "#66a6cf", fillOpacity: 0.12, weight: 1, interactive: false }).addTo(group);
      L.circleMarker(raw, { radius: 7, color: "white", fillColor: "#2678b0", fillOpacity: 1, weight: 3 })
        .bindTooltip(tooltip(`设备实时位置 · 精度 ±${Math.round(liveFix.accuracy)} 米`)).addTo(group);
      if (match?.coordinate) {
        L.circleMarker(latLng(match.coordinate), { radius: 5, color: "#315c42", fillColor: "#315c42", fillOpacity: 1, weight: 2 })
          .bindTooltip(tooltip("GPS 匹配的铁路位置")).addTo(group);
      }
    } else if (plannedPoint) {
      L.circleMarker(latLng(plannedPoint), { radius: 7, color: "#fffefb", fillColor: "#315c42", fillOpacity: 1, weight: 3 })
        .bindTooltip(tooltip(route ? route.inferred ? "沿铁路网推定路径的预估位置" : "时刻表估算位置" : "站间模拟位置 · 未沿铁路径路")).addTo(group);
    }
    if (liveFix && !gpsCentered.current) {
      gpsCentered.current = true;
      instance.setView(latLng([liveFix.longitude, liveFix.latitude]), Math.max(12, instance.getZoom()), { animate: false });
      setFollowing(true);
    } else if (following && point) instance.panTo(latLng(point), { animate: false });
  }, [route, journey, stopPoints, position, liveFix, match, plannedPoint, following, point?.[0], point?.[1], latLng]);
  const locate = () => { const target = pointRef.current; if (target && map.current) { map.current.setView(latLng(target), Math.max(12, map.current.getZoom())); setFollowing(true); } };
  const overview = () => { setFollowing(false); const bounds = route?.points ?? availableStops; if (map.current && bounds.length) map.current.fitBounds(L.latLngBounds(bounds.map(latLng)), { padding: [26, 30], maxZoom: 11 }); };

  return <div className={`rail-map-shell${expanded ? " is-expanded" : ""}`}>
    <div className="rail-map-toolbar">
      <div className="rail-map-modes" role="group" aria-label="地图图层">
        <button type="button" aria-pressed={mode === "streets"} onClick={() => setMode("streets")}><MapIcon size={14} />2D 地图</button>
        <button type="button" aria-pressed={mode === "satellite"} onClick={() => setMode("satellite")}><Satellite size={14} />卫星图</button>
      </div>
      {mode === "streets" && <label className="rail-map-provider">底图<select aria-label="2D 地图来源" value={streetProvider} onChange={event => setStreetProvider(event.target.value as "amap" | "osm")}>
        <option value="amap">高德地图（国内）</option><option value="osm">OpenStreetMap（备用）</option>
      </select></label>}
      <div className="rail-map-view-actions">
        <label className="rail-map-network-toggle"><input type="checkbox" checked={showNetwork} onChange={event => setShowNetwork(event.target.checked)} />铁路网</label>
        <button type="button" onClick={overview} disabled={!route && !availableStops.length}>全程</button>
        <button type="button" onClick={locate} disabled={!point} aria-pressed={following}><LocateFixed size={14} />当前位置</button>
        <button type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "收起地图区域" : "展开地图区域"}><Maximize2 size={14} /></button>
      </div>
    </div>
    <div ref={host} className="rail-map-canvas" role="region" aria-label="完整交互地图，显示铁路路线、停站和当前位置" />
    {tileError && <div className="rail-map-tile-error" role="status"><span>{source.name} 底图加载失败或超时，可重试或切换地图来源。</span>
      <button type="button" onClick={() => setTileRevision(value => value + 1)}>重试底图</button>
      {mode === "satellite" ? <button type="button" onClick={() => setMode("streets")}>切回 2D 地图</button> : streetProvider === "amap" && <button type="button" onClick={() => setStreetProvider("osm")}>使用备用 2D</button>}
    </div>}
    <div className="rail-map-legend"><span><i className="is-gps" />设备位置与精度范围</span><span><i className="is-train" />{match?.position ? route?.inferred ? "GPS 匹配推定路径" : "GPS 匹配铁路位置" : route ? route.inferred ? "沿铁路网预估位置" : "时刻表估算位置" : plannedPoint ? "站间模拟位置（粗估）" : "本车次停靠站"}</span><span><i className="is-next" />下一停靠站{!route && "（时刻表）"}</span>{network && showNetwork && <span><i className="is-network" />铁路网（本站缓存）</span>}</div>
    {(network || route?.source === "server-cache") && <p className="rail-map-note">铁路线路快照 {(network?.manifest.snapshotAt || route?.snapshotAt || "").slice(0,10)} · 缓存包含国铁、地方铁路、城际及香港高铁段，不含地铁等城市轨道交通。{route?.inferred && "绿色路径按本车次停站顺序沿真实轨道推定，实际运行径路可能不同。"} © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>。</p>}
    {networkError && <p className="rail-map-note" role="status">铁路网缓存暂未加载成功，停站表和设备定位仍可使用。</p>}
    {journey && !route && <p className="rail-map-note">已显示 {availableStops.length} / {journey.stops.length} 个停靠站。完整铁路线路暂缺时，按当前两站坐标和时刻表模拟位置，未沿铁路径路；速度按地理距离粗估，停站与下一站仍以官方时刻表为准。开启 GPS 可查看设备实测位置。补充站点坐标 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>。</p>}
    {mode === "satellite" && <p className="rail-map-note">Sentinel-2 2025 年合成卫星影像，约 10 米分辨率；放大后不增加影像细节。</p>}
  </div>;
}
