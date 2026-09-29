import { Clock3, MapPin, Navigation, RefreshCw, TrainFront } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadDelays, loadJourney, loadRailway } from "../lib/rail-position-data";
import { chinaDateTime, locateJourney, observationTime, positionOnRailway } from "../lib/train-position";
import type { Coordinate, DelayReport, JourneyPosition, RailwayRoute, TrainJourney } from "../lib/train-position";
import { TrainIllustration, TrainArtReferences } from "./TrainIllustration";
import "./rail-position.css";

function timeLabel(at: number) { return chinaDateTime(at).replace("T", " "); }
function durationLabel(milliseconds: number) {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
}
function stopClock(at: number, origin: string) {
  const value = chinaDateTime(at);
  return `${value.slice(0, 10) === origin ? "" : `${value.slice(5, 10)} `}${value.slice(11)}`;
}

function RouteMap({ journey, route, position }: { journey: TrainJourney; route: RailwayRoute; position: JourneyPosition }) {
  const marker = positionOnRailway(route, position);
  const cos = Math.cos(route.points.reduce((total, point) => total + point[1], 0) / route.points.length * Math.PI / 180);
  const xs = route.points.map(point => point[0] * cos), ys = route.points.map(point => -point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), rangeX = Math.max(...xs) - minX, rangeY = Math.max(...ys) - minY;
  const scale = Math.min(540 / (rangeX || 1), 270 / (rangeY || 1));
  const transform = (point: Coordinate) => [90 + (540 - rangeX * scale) / 2 + (point[0] * cos - minX) * scale,
    45 + (270 - rangeY * scale) / 2 + (-point[1] - minY) * scale];
  const [markerX, markerY] = transform(marker.coordinate);
  return <div className="rail-position-map">
    <div className="rail-position-map-heading"><span><Navigation size={14} /> 铁路线路走向</span><small>位置为沿线估算</small></div>
    <svg viewBox="0 0 720 360" role="img" aria-label={`${journey.train} 铁路线路图，${journey.stops.map(stop => stop.station).join(" → ")}，标记为估算位置`}>
      <defs><pattern id="rail-map-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 L 0 0 0 30" fill="none" stroke="#dfe9da" strokeWidth="0.5" /></pattern></defs>
      <rect width="720" height="360" fill="url(#rail-map-grid)" />
      <polyline points={route.points.map(point => transform(point).join(",")).join(" ")} fill="none" stroke="#e1eadc" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={route.points.map(point => transform(point).join(",")).join(" ")} fill="none" stroke="#638666" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {journey.stops.map((stop, index) => {
        const [x, y] = transform(route.stops[index]);
        const next = index === position.nextIndex, current = index === position.currentIndex;
        const showLabel = journey.stops.length <= 9 || index % Math.ceil(journey.stops.length / 7) === 0 || next || current || index === journey.stops.length - 1;
        return <g key={`${stop.station}-${index}`}><title>{stop.station} · 停靠站 · {stopClock(stop.arrivalAt, journey.date)} 到</title><circle cx={x} cy={y} r={next || current ? 6 : 4} fill={next ? "#d6aa54" : "#fffefb"} stroke="#315c42" strokeWidth="2" />{showLabel && <text x={x + (index % 2 ? -12 : 12)} y={y + 5} textAnchor={index % 2 ? "end" : "start"} fill="#315c42" fontSize="13" fontWeight={next || current ? 700 : 500}>{stop.station}</text>}</g>;
      })}
      <g><title>列车估算位置</title><circle cx={markerX} cy={markerY} r="13" fill="#315c4224" /><circle cx={markerX} cy={markerY} r="7" fill="#315c42" stroke="#fffefb" strokeWidth="3" /></g>
    </svg>
    <p>沿线路约 {Math.round(marker.coveredKm)} km／{Math.round(route.lengthKm)} km · GCJ-02 坐标</p>
  </div>;
}

export function RailPosition({ initialTrain = "", initialDate = chinaDateTime().slice(0, 10) }: { initialTrain?: string; initialDate?: string }) {
  const [train, setTrain] = useState(initialTrain);
  const [date, setDate] = useState(initialDate);
  const [live, setLive] = useState(true);
  const [customTime, setCustomTime] = useState(chinaDateTime());
  const [now, setNow] = useState(Date.now());
  const [journey, setJourney] = useState<TrainJourney | null>(null);
  const [route, setRoute] = useState<RailwayRoute | null>(null);
  const [delays, setDelays] = useState<DelayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [delayError, setDelayError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const generation = useRef(0);
  const refreshing = useRef(false);

  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const update = () => setNow(Date.now());
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [live]);
  useEffect(() => () => { generation.current++; }, []);

  const invalidate = () => {
    generation.current++; setJourney(null); setRoute(null); setDelays(null); setError(null);
    setRouteError(null); setDelayError(null); setLoading(false); setDetailsLoading(false);
  };
  const queryPosition = async () => {
    const version = ++generation.current;
    setLoading(true); setDetailsLoading(false); setError(null); setJourney(null); setRoute(null); setDelays(null);
    setRouteError(null); setDelayError(null);
    try {
      const next = await loadJourney(train.trim().toUpperCase(), date);
      if (version !== generation.current) return;
      setJourney(next); setLoading(false); setDetailsLoading(true);
      const extra = await Promise.allSettled([loadRailway(next), live ? loadDelays(next.train, next.date) : Promise.resolve(null)]);
      if (version !== generation.current) return;
      if (extra[0].status === "fulfilled") setRoute(extra[0].value);
      else setRouteError("线路资料暂不可用或与停站表不一致，仍可查看运行区间和下一站。");
      if (extra[1].status === "fulfilled") setDelays(extra[1].value);
      else setDelayError("正晚点资料暂不可用，当前按计划时刻估算。");
    } catch (cause) { if (version === generation.current) setError(cause instanceof Error ? cause.message : "位置查询失败"); }
    finally { if (version === generation.current) { setLoading(false); setDetailsLoading(false); } }
  };

  useEffect(() => {
    if (!journey || !live || detailsLoading) return;
    let active = true;
    const version = generation.current;
    const refresh = async () => {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        if (Date.now() - journey.checkedAt >= 15 * 60000) {
          const updated = await loadJourney(journey.train, journey.date);
          if (!active || version !== generation.current) return;
          // Commit the new timetable and its matching route/report together.
          const extra = await Promise.allSettled([loadRailway(updated), loadDelays(updated.train, updated.date)]);
          if (!active || version !== generation.current) return;
          setJourney(updated);
          setRoute(extra[0].status === "fulfilled" ? extra[0].value : null);
          setRouteError(extra[0].status === "fulfilled" ? null : "线路资料暂不可用，仍可查看运行区间和下一站。");
          setDelays(extra[1].status === "fulfilled" ? extra[1].value : null);
          setDelayError(extra[1].status === "fulfilled" ? null : "正晚点资料暂不可用，当前按计划时刻估算。");
          return;
        }
        const updated = await loadDelays(journey.train, journey.date);
        if (active && version === generation.current) { setDelays(updated); setDelayError(null); }
      } catch { if (active && version === generation.current) setDelayError("资料刷新失败；正晚点超过 3 分钟自动停用，时刻表超过 20 分钟不再推算。"); }
      finally { refreshing.current = false; }
    };
    // One delay query per minute; coordinate animation itself makes no requests.
    if (!delays && !delayError) void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [journey, live, detailsLoading]);

  const observation = live ? now : observationTime(customTime);
  const stale = live && journey && now - journey.checkedAt > 20 * 60000;
  const position = journey && Number.isFinite(observation) && !stale ? locateJourney(journey, observation, live ? delays : null) : null;
  const current = journey && position?.currentIndex !== null && position?.currentIndex !== undefined ? journey.stops[position.currentIndex] : null;
  const previous = journey && position?.previousIndex !== null && position?.previousIndex !== undefined ? journey.stops[position.previousIndex] : null;
  const next = journey && position?.nextIndex !== null && position?.nextIndex !== undefined ? journey.stops[position.nextIndex] : null;
  const status = !position ? "" : position.phase === "before" ? "尚未发车" : position.phase === "arrived" ? "已到终点" : position.phase === "stopped" ? "停站中" : "区间运行中";

  return <section className="rail-position-section" aria-labelledby="rail-position-title">
    <div className="rail-card rail-position-form">
      <div className="rail-card-heading"><div><span className="rail-overline">ON BOARD / NEXT STOP</span><h2 id="rail-position-title">列车位置与下一站</h2></div><span className="rail-small">北京时间 · UTC+8</span></div>
      <p className="rail-search-help">按该日期的停站时刻判断下一停靠站，结合铁路线路走向估算当前位置。</p>
      <form onSubmit={event => { event.preventDefault(); void queryPosition(); }}>
        <div className="rail-position-fields">
          <label>定位车次<input placeholder="例如 G6003" value={train} onChange={event => { invalidate(); setTrain(event.target.value.toUpperCase()); }} required /></label>
          <label>始发日期<input type="date" value={date} onChange={event => { invalidate(); setDate(event.target.value); }} required /></label>
          <label className="rail-clock-option"><input type="checkbox" checked={live} onChange={event => { setLive(event.target.checked); setNow(Date.now()); setCustomTime(chinaDateTime()); }} />跟随当前时间</label>
          {live ? <div className="rail-current-clock"><Clock3 size={16} /><span>{timeLabel(now)}<small>每秒更新位置估算</small></span></div> :
            <label>观察时间（北京时间）<input type="datetime-local" value={customTime} onChange={event => setCustomTime(event.target.value)} required /></label>}
        </div>
        <div className="rail-actions"><button className="rail-primary" type="submit" disabled={loading}><RefreshCw size={16} className={loading ? "rail-spin" : ""} />{loading ? "正在查时刻表" : "查询位置"}</button></div>
      </form>
      <p className="rail-hint">跨日列车请填首站发车的日期。下一站仅指本车次实际停靠站；自定义观察时间按计划时刻推算。</p>
    </div>
    {error && <div role="alert" className="rail-error">{error}</div>}
    {journey && !Number.isFinite(observation) && <div role="alert" className="rail-error">请填写完整的观察日期和时间。</div>}
    {stale && <div role="alert" className="rail-error">时刻表超过 20 分钟未能刷新，已暂停位置推算。请重新查询。</div>}
    {journey && position && <div className="rail-position-result">
      <div className="rail-position-summary rail-card">
        <div className="rail-position-identity"><div><span className="rail-overline">{journey.date} 始发</span><h3>{journey.codes.join(" / ")}</h3></div><TrainIllustration model={journey.model} /></div>
        <span className="rail-position-status"><MapPin size={14} />{status} · {position.delayUsed ? "结合正晚点估算" : "按时刻表估算"}</span>
        <p className="rail-position-current">{position.phase === "running" ? `${previous!.station} → ${next!.station}` : `${current!.station}${position.phase === "before" ? " · 等待始发" : position.phase === "arrived" ? " · 行程结束" : " · 停站中"}`}</p>
        <div className="rail-next-stop" aria-label="下一停靠站">
          <span>{position.phase === "arrived" ? "终点站" : "下一停靠站"}</span>
          <strong>{next ? next.station : current!.station}</strong>
          {next && position.arrivalAt !== null ? <><p>{position.delayUsed ? "估计到达" : "计划到达"} {stopClock(position.arrivalAt, journey.date)}</p><small>{position.phase === "before" ? "尚未发车 · " : ""}距到站约 {durationLabel(position.arrivalAt - observation)}</small></> : <p>已到达 · 无下一站</p>}
        </div>
        {position.departureAt !== null && <p className="rail-position-departure">{position.phase === "before" ? "预计始发" : "预计开车"} {stopClock(position.departureAt, journey.date)}</p>}
        {position.phase === "running" && <div className="rail-position-progress"><progress max="1" value={position.progress} aria-label="当前停站区间运行进度估算" /><small>当前区间估算进度 {Math.round(position.progress * 100)}%</small></div>}
        <p className="rail-position-observed">观察于 {timeLabel(observation)}</p>
      </div>
      <div className="rail-position-route rail-card">{route ? <RouteMap journey={journey} route={route} position={position} /> : <div className="rail-position-map-empty"><TrainFront size={32} /><p>{detailsLoading ? "正在读取铁路线路点…" : routeError || "暂无线路图"}</p></div>}
        <p className="rail-position-explanation">位置按相邻停站间的时间比例沿铁路线路插值，无法反映途中加减速、临时停车或设备定位。线路资料不按日期查询，已核对停站顺序；下一站始终由所选日期的停站表决定。</p>
      </div>
      <div className="rail-card rail-position-timetable">
        <div className="rail-card-heading"><div><span className="rail-overline">TIMETABLE</span><h3>本车次停站表</h3></div><span className="rail-small">{journey.stops.length} 站 · 不列通过站</span></div>
        <div className="rail-timetable-scroll"><table><thead><tr><th scope="col">停靠站</th><th scope="col">到达</th><th scope="col">发车</th><th scope="col">状态</th></tr></thead><tbody>{journey.stops.map((stop, index) =>
          <tr key={`${stop.station}-${index}`} className={index === position.nextIndex ? "is-next" : index === position.currentIndex ? "is-current" : ""}>
            <th scope="row"><span>{index + 1}</span>{stop.station}</th><td>{index ? stopClock(stop.arrivalAt, journey.date) : "始发"}</td><td>{index === journey.stops.length - 1 ? "终到" : stopClock(stop.departureAt, journey.date)}</td>
            <td>{index === position.currentIndex ? position.phase === "arrived" ? "已到终点" : position.phase === "before" ? "等待发车" : "当前停站" : index === position.nextIndex ? "下一停靠站" : index < (position.nextIndex ?? journey.stops.length) ? "已过" : "待到达"}</td>
          </tr>)}</tbody></table></div>
        <p className="rail-hint">表内为计划时刻 · 时刻表获取于 {timeLabel(journey.checkedAt)}{live && delays ? ` · 正晚点获取于 ${timeLabel(delays.checkedAt)}` : ""}。</p>
      </div>
    </div>}
    {!journey && !loading && !error && <div className="rail-empty">输入车次和始发日期，查看运行区间、下一停靠站及铁路线路图。</div>}
    {(delayError || position?.warning) && journey && <p className="rail-position-warning">{position?.warning || delayError}</p>}
    {journey && <TrainArtReferences models={[journey.model]} />}
    <p className="rail-hint rail-position-source">时刻表、线路点与正晚点来自 RailGo 数据服务。此功能提供位置估算；实际到发及临时停站请以列车广播、站内显示和 12306 为准。</p>
  </section>;
}
