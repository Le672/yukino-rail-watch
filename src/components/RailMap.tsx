import L from "leaflet";
import { LocateFixed, Map as MapIcon, Maximize2, Satellite } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { positionOnRailway } from "../lib/train-position";
import type { Coordinate, JourneyPosition, TrainJourney } from "../lib/train-position";
import type { GpsMatch, LocationFix, Wgs84RailwayRoute } from "../lib/rail-gps";

const basemaps = {
  streets: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>' },
  satellite: { url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg", maxNativeZoom: 14,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a> by <a href="https://eox.at" target="_blank" rel="noreferrer">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2025) · <a href="https://maps.eox.at" target="_blank" rel="noreferrer">EOX::Maps</a>' },
};
const latLng = (coordinate: Coordinate): L.LatLngTuple => [coordinate[1], coordinate[0]];
const tooltip = (text: string) => { const element = document.createElement("span"); element.textContent = text; return element; };
const noStations: (Coordinate | null)[] = [];

export function RailMap({ journey, route, stations, position, fix, match, gpsEnabled }: {
  journey: TrainJourney | null; route: Wgs84RailwayRoute | null; position: JourneyPosition | null;
  stations?: (Coordinate | null)[]; // WGS84, in timetable order; missing stations keep their null slot.
  fix: LocationFix | null; match: GpsMatch | null; gpsEnabled: boolean;
}) {
  const host = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null);
  const tracks = useRef<L.LayerGroup | null>(null), markers = useRef<L.LayerGroup | null>(null);
  const [mode, setMode] = useState<keyof typeof basemaps>("streets");
  const [following, setFollowing] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const gpsCentered = useRef(false);
  const stopPoints = stations ?? route?.stops ?? noStations;
  const availableStops = useMemo(() => stopPoints.filter((point): point is Coordinate => point !== null), [stopPoints]);
  useEffect(() => { if (!gpsEnabled) gpsCentered.current = false; }, [gpsEnabled]);
  const plannedPoint = useMemo(() => route && position ? positionOnRailway(route, position).coordinate : null, [route, position]);
  const liveFix = gpsEnabled && fix && Date.now() - fix.timestamp >= -5000 && Date.now() - fix.timestamp <= 30000 ? fix : null;
  const point: Coordinate | null = liveFix ? [liveFix.longitude, liveFix.latitude] : plannedPoint;
  const pointRef = useRef(point); pointRef.current = point;
  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current, { center: [29.5, 111], zoom: 5, minZoom: 2, maxZoom: 19,
      preferCanvas: true, attributionControl: true, zoomControl: false, scrollWheelZoom: false });
    map.current = instance;
    instance.attributionControl.setPrefix(false);
    L.control.zoom({ zoomInTitle: "放大一级", zoomOutTitle: "缩小一级" }).addTo(instance);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(instance);
    tracks.current = L.layerGroup().addTo(instance); markers.current = L.layerGroup().addTo(instance);
    instance.on("dragstart", () => setFollowing(false));
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    resize?.observe(host.current);
    return () => { resize?.disconnect(); instance.remove(); map.current = null; tracks.current = null; markers.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    setTileError(false);
    const source = basemaps[mode];
    const layer = L.tileLayer(source.url, { maxZoom: 19, maxNativeZoom: source.maxNativeZoom,
      attribution: source.attribution, keepBuffer: 1, updateWhenIdle: true, referrerPolicy: "strict-origin-when-cross-origin" });
    let success = 0, failed = 0;
    layer.on("loading", () => { success = 0; failed = 0; });
    layer.on("tileload", () => { success++; if (success > failed) setTileError(false); });
    layer.on("tileerror", () => { failed++; if (failed > success && failed >= 2) setTileError(true); });
    layer.addTo(map.current);
    return () => { layer.remove(); };
  }, [mode]);
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
    if (bounds.length && !gpsCentered.current) instance.fitBounds(L.latLngBounds(bounds.map(latLng)), { padding: [26, 30], maxZoom: 11, animate: false });
  }, [route, journey, stopPoints, availableStops]);
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
      const raw: L.LatLngTuple = [liveFix.latitude, liveFix.longitude];
      L.circle(raw, { radius: liveFix.accuracy, color: "#367ba7", fillColor: "#66a6cf", fillOpacity: 0.12, weight: 1, interactive: false }).addTo(group);
      L.circleMarker(raw, { radius: 7, color: "white", fillColor: "#2678b0", fillOpacity: 1, weight: 3 })
        .bindTooltip(tooltip(`设备实时位置 · 精度 ±${Math.round(liveFix.accuracy)} 米`)).addTo(group);
      if (match?.coordinate) {
        L.circleMarker(latLng(match.coordinate), { radius: 5, color: "#315c42", fillColor: "#315c42", fillOpacity: 1, weight: 2 })
          .bindTooltip(tooltip("GPS 匹配的铁路位置")).addTo(group);
      }
    } else if (plannedPoint) {
      L.circleMarker(latLng(plannedPoint), { radius: 7, color: "#fffefb", fillColor: "#315c42", fillOpacity: 1, weight: 3 })
        .bindTooltip(tooltip("时刻表估算位置")).addTo(group);
    }
    if (liveFix && !gpsCentered.current) {
      gpsCentered.current = true;
      instance.setView([liveFix.latitude, liveFix.longitude], Math.max(12, instance.getZoom()), { animate: false });
      setFollowing(true);
    } else if (following && point) instance.panTo(latLng(point), { animate: false });
  }, [route, journey, stopPoints, position, liveFix, match, plannedPoint, following, point?.[0], point?.[1]]);
  const locate = () => { const target = pointRef.current; if (target && map.current) { map.current.setView(latLng(target), Math.max(12, map.current.getZoom())); setFollowing(true); } };
  const overview = () => { setFollowing(false); const bounds = route?.points ?? availableStops; if (map.current && bounds.length) map.current.fitBounds(L.latLngBounds(bounds.map(latLng)), { padding: [26, 30], maxZoom: 11 }); };

  return <div className={`rail-map-shell${expanded ? " is-expanded" : ""}`}>
    <div className="rail-map-toolbar">
      <div className="rail-map-modes" role="group" aria-label="地图图层">
        <button type="button" aria-pressed={mode === "streets"} onClick={() => setMode("streets")}><MapIcon size={14} />2D 地图</button>
        <button type="button" aria-pressed={mode === "satellite"} onClick={() => setMode("satellite")}><Satellite size={14} />卫星图</button>
      </div>
      <div className="rail-map-view-actions">
        <button type="button" onClick={overview} disabled={!route && !availableStops.length}>全程</button>
        <button type="button" onClick={locate} disabled={!point} aria-pressed={following}><LocateFixed size={14} />当前位置</button>
        <button type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "收起地图区域" : "展开地图区域"}><Maximize2 size={14} /></button>
      </div>
    </div>
    <div ref={host} className="rail-map-canvas" role="region" aria-label="完整交互地图，显示铁路路线、停站和当前位置" />
    {tileError && <p className="rail-map-tile-error" role="status">部分地图瓦片加载失败，请切换图层或稍后重试。</p>}
    <div className="rail-map-legend"><span><i className="is-gps" />设备位置与精度范围</span><span><i className="is-train" />{match?.position ? "GPS 匹配铁路位置" : route ? "时刻表估算位置" : "本车次停靠站"}</span><span><i className="is-next" />下一停靠站{!route && "（时刻表）"}</span></div>
    {journey && !route && <p className="rail-map-note">已显示 {availableStops.length} / {journey.stops.length} 个停靠站。开启 GPS 可查看设备实时位置；完整铁路线路暂缺时，区间与下一站按时刻表估算。</p>}
    {mode === "satellite" && <p className="rail-map-note">Sentinel-2 2025 年合成卫星影像，约 10 米分辨率；放大后不增加影像细节。</p>}
  </div>;
}
