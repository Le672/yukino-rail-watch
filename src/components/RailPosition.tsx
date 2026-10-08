import { Clock3, LocateFixed, MapPin, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadDelays, loadJourney, loadJourneyEquipment, loadRailway } from "../lib/rail-position-data";
import { chinaDateTime, locateJourney, observationTime } from "../lib/train-position";
import type { DelayReport, RailwayMapData, TrainJourney } from "../lib/train-position";
import { gcjToWgs84, matchGpsJourney, railwayToWgs84 } from "../lib/rail-gps";
import { useRailLocation } from "../hooks/useRailLocation";
import { useRailTrainDetection } from "../hooks/useRailTrainDetection";
import type { DetectedTrain } from "../lib/rail-train-detection";
import { RailMap } from "./RailMap";
import { RailSpeed } from "./RailSpeed";
import { readRailSpeed } from "../lib/rail-speed";
import { estimateRailMotion } from "../lib/rail-motion";
import { TrainIllustration } from "./TrainIllustration";
import { equipmentLabel, equipmentTitle } from "../lib/rail-equipment";
import { useJourneyStopBoard } from "../hooks/useJourneyStopBoard";
import { visibleStopDetail } from "../lib/rail-stop-info";
import { boardStatusText, CHECK_IN_TEXT } from "../lib/rail-board";
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

export function RailPosition({ initialTrain = "", initialDate = chinaDateTime().slice(0, 10), autoQuery = false }: { initialTrain?: string; initialDate?: string; autoQuery?: boolean }) {
  const [train, setTrain] = useState(initialTrain);
  const [date, setDate] = useState(initialDate);
  const [live, setLive] = useState(true);
  const [customTime, setCustomTime] = useState(chinaDateTime());
  const [now, setNow] = useState(Date.now());
  const [journey, setJourney] = useState<TrainJourney | null>(null);
  const [mapData, setMapData] = useState<RailwayMapData | null>(null);
  const route = mapData?.route ?? null;
  const [delays, setDelays] = useState<DelayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [delayError, setDelayError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const generation = useRef(0);
  const refreshing = useRef(false);
  const gps = useRailLocation();
  const [autoIdentify, setAutoIdentify] = useState(!initialTrain);
  const [gpsIdentified, setGpsIdentified] = useState(false);
  const identifiedKey = useRef("");
  const detection = useRailTrainDetection(gps.enabled && live && autoIdentify, gps.fix, gps.samples, now);
  const stopBoard = useJourneyStopBoard(journey, live);
  const gpsHistory = useRef<{ distanceKm: number; timestamp: number } | null>(null);
  const wgsRoute = useMemo(() => route ? railwayToWgs84(route) : null, [route]);
  const wgsStations = useMemo(() => mapData?.stations.map(point => point ? mapData.coordinateSystem === "WGS84" ? point : gcjToWgs84(point) : null) ?? [], [mapData]);
  useEffect(() => { gpsHistory.current = null; }, [route, train, date, gps.enabled]);

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
    generation.current++; setJourney(null); setMapData(null); setDelays(null); setError(null);
    setRouteError(null); setDelayError(null); setLoading(false); setDetailsLoading(false);
    identifiedKey.current = ""; setGpsIdentified(false);
  };
  const useDetectedTrain = (candidate: DetectedTrain, automatic: boolean) => {
    if (automatic && identifiedKey.current === candidate.key) return;
    identifiedKey.current = candidate.key;
    const version = ++generation.current;
    setTrain(candidate.journey.train); setDate(candidate.journey.date);
    setJourney(candidate.journey); setMapData(candidate.map); setDelays(null);
    setError(null); setRouteError(null); setDelayError(null); setLoading(false); setDetailsLoading(true);
    setGpsIdentified(automatic); if (!automatic) setAutoIdentify(false);
    void loadJourneyEquipment(candidate.journey).then(equipment => {
      if (version === generation.current) setJourney(current => current ? { ...current, ...equipment } : current);
    }).catch(() => {});
    void loadDelays(candidate.journey.train, candidate.journey.date).then(value => {
      if (version === generation.current) { setDelays(value); setDelayError(value.warning || null); }
    }).catch(() => { if (version === generation.current) setDelayError("正晚点资料暂不可用，当前按计划时刻估算。"); })
      .finally(() => { if (version === generation.current) setDetailsLoading(false); });
  };
  useEffect(() => { if (autoIdentify && detection.automatic) useDetectedTrain(detection.automatic, true); }, [autoIdentify, detection.automatic]);
  const queryPosition = async () => {
    if (!train.trim()) { setAutoIdentify(true); setLive(true); setNow(Date.now()); if (!gps.enabled) gps.start(); return; }
    setAutoIdentify(false); setGpsIdentified(false); identifiedKey.current = "";
    const version = ++generation.current;
    setLoading(true); setDetailsLoading(false); setError(null); setJourney(null); setMapData(null); setDelays(null);
    setRouteError(null); setDelayError(null);
    try {
      const next = await loadJourney(train.trim().toUpperCase(), date);
      if (version !== generation.current) return;
      setJourney(next); setLoading(false); setDetailsLoading(true);
      void loadJourneyEquipment(next).then(equipment => {
        if (version === generation.current) setJourney(current => current ? { ...current, ...equipment } : current);
      }).catch(() => {});
      const extra = await Promise.allSettled([loadRailway(next), live ? loadDelays(next.train, next.date) : Promise.resolve(null)]);
      if (version !== generation.current) return;
      if (extra[0].status === "fulfilled") setMapData(extra[0].value);
      else setRouteError("线路资料暂不可用或与停站表不一致，仍可查看运行区间和下一站。");
      if (extra[1].status === "fulfilled") { setDelays(extra[1].value); setDelayError(extra[1].value?.warning || null); }
      else setDelayError("正晚点资料暂不可用，当前按计划时刻估算。");
    } catch (cause) { if (version === generation.current) setError(cause instanceof Error ? cause.message : "位置查询失败"); }
    finally { if (version === generation.current) { setLoading(false); setDetailsLoading(false); } }
  };
  useEffect(() => { if (autoQuery && initialTrain) void queryPosition(); }, [autoQuery, initialTrain, initialDate]);

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
          void loadJourneyEquipment(updated).then(equipment => {
            if (version === generation.current) setJourney(current => current?.checkedAt === updated.checkedAt ? { ...current, ...equipment } : current);
          }).catch(() => {});
          setMapData(extra[0].status === "fulfilled" ? extra[0].value : null);
          setRouteError(extra[0].status === "fulfilled" ? null : "线路资料暂不可用，仍可查看运行区间和下一站。");
          setDelays(extra[1].status === "fulfilled" ? extra[1].value : null);
          setDelayError(extra[1].status === "fulfilled" ? extra[1].value?.warning || null : "12306 正晚点资料暂不可用，当前按官方计划时刻估算。");
          return;
        }
        const updated = await loadDelays(journey.train, journey.date);
        if (active && version === generation.current) { setDelays(updated); setDelayError(updated.warning || null); }
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
  const plannedPosition = journey && Number.isFinite(observation) && !stale ? locateJourney(journey, observation, live ? delays : null) : null;
  const gpsMatch = gps.enabled && live && journey && wgsRoute && plannedPosition && gps.fix ?
    matchGpsJourney(journey, wgsRoute, plannedPosition, gps.fix, now, gpsHistory.current) : null;
  const gpsPosition = gpsMatch?.position;
  const freshFix = gps.enabled && gps.fix && now - gps.fix.timestamp >= -5000 && now - gps.fix.timestamp <= 30000 ? gps.fix : null;
  const speed = useMemo(() => readRailSpeed(gps.samples, now), [gps.samples, now]);
  const motion = useMemo(() => journey && plannedPosition ? estimateRailMotion(journey, wgsRoute, observation, live ? delays : null, wgsStations) : null,
    [journey, plannedPosition, wgsRoute, observation, live, delays, wgsStations]);
  const position = gpsPosition || motion?.position || plannedPosition;
  useEffect(() => {
    if (gpsMatch?.position && gps.fix) gpsHistory.current = { distanceKm: gpsMatch.distanceKm, timestamp: gps.fix.timestamp };
  }, [gps.fix, gpsMatch?.position, gpsMatch?.distanceKm]);
  const current = journey && position?.currentIndex !== null && position?.currentIndex !== undefined ? journey.stops[position.currentIndex] : null;
  const previous = journey && position?.previousIndex !== null && position?.previousIndex !== undefined ? journey.stops[position.previousIndex] : null;
  const next = journey && position?.nextIndex !== null && position?.nextIndex !== undefined ? journey.stops[position.nextIndex] : null;
  const status = !position ? "" : position.phase === "before" ? "尚未发车" : position.phase === "arrived" ? "已到终点" : position.phase === "stopped" ? gpsPosition ? "停靠站附近" : "停站中" : "区间运行中";

  return <section className="rail-position-section" aria-labelledby="rail-position-title">
    <div className="rail-card rail-position-form">
      <div className="rail-card-heading"><div><span className="rail-overline">ON BOARD / NEXT STOP</span><h2 id="rail-position-title">列车位置与下一站</h2></div><span className="rail-small">北京时间 · UTC+8</span></div>
      <p className="rail-search-help">可直接输入车次，也可留空后开启 GPS，结合运行方向、铁路线路与 12306 时刻表推断候选车次和下一站。</p>
      <form onSubmit={event => { event.preventDefault(); void queryPosition(); }}>
        <div className="rail-position-fields">
          <label>定位车次（可留空）<input aria-label="定位车次" placeholder="留空自动识别，或输入 G6003、K123" value={train} onChange={event => { invalidate(); setAutoIdentify(!event.target.value.trim()); setTrain(event.target.value.toUpperCase()); }} /></label>
          <label>始发日期<input type="date" value={date} onChange={event => { invalidate(); setDate(event.target.value); }} required /></label>
          <label className="rail-clock-option"><input type="checkbox" checked={live} onChange={event => { gps.stop(); setLive(event.target.checked); setNow(Date.now()); setCustomTime(chinaDateTime()); }} />跟随当前时间</label>
          {live && <label className="rail-clock-option"><input type="checkbox" checked={autoIdentify} onChange={event => { setAutoIdentify(event.target.checked); if (event.target.checked) { invalidate(); setTrain(""); } }} />根据 GPS 识别车次</label>}
          {live ? <div className="rail-current-clock"><Clock3 size={16} /><span>{timeLabel(now)}<small>每秒更新位置估算</small></span></div> :
            <label>观察时间（北京时间）<input type="datetime-local" value={customTime} onChange={event => setCustomTime(event.target.value)} required /></label>}
        </div>
        <div className="rail-actions"><button className="rail-primary" type="submit" disabled={loading}><RefreshCw size={16} className={loading ? "rail-spin" : ""} />{loading ? "正在查时刻表" : "查询位置"}</button>
          <button className="rail-gps-button" type="button" aria-pressed={gps.enabled} onClick={() => { if (gps.enabled) gps.stop(); else { setLive(true); setNow(Date.now()); gps.start(); } }}><LocateFixed size={16} />{gps.enabled ? "停止 GPS 定位" : "开启 GPS 实时定位"}</button></div>
      </form>
      <div className="rail-gps-overview"><div className={`rail-gps-status${gpsPosition ? " is-matched" : ""}`} role="status">
        <strong>{gps.enabled ? freshFix ? `定位精度 ±${Math.round(freshFix.accuracy)} 米` : "正在等待 GPS／设备定位信号" : "GPS 未开启"}</strong>
        <span>{gps.error || gpsMatch?.reason || (gpsPosition ? `${gpsMatch?.approximate ? "低精度 GPS 铁路近似匹配" : "已匹配本车次线路"} · 距线路约 ${Math.round(gpsMatch!.errorMeters)} 米` : gps.enabled ? journey ? route ? "等待有效定位后判断下一站。" : detailsLoading ? "正在读取铁路线路，暂按时刻表显示。" : freshFix ? "地图显示设备 GPS 位置；完整线路暂缺，下一站按时刻表判断。" : "等待 GPS 信号后显示设备位置；完整线路暂缺，下一站按时刻表判断。" : autoIdentify ? "正在根据定位与官方到发车次推断，连续移动轨迹有助于区分车次。" : "输入车次并查询后，将用定位匹配下一站。" : "仅在乘坐此车次时开启；GPS 未开启时按时刻表估算。")}</span>
        {gps.fix && gps.enabled && <small>定位更新于 {timeLabel(gps.fix.timestamp)}</small>}
      </div><RailSpeed reading={speed} estimate={motion} enabled={gps.enabled} live={live} matched={Boolean(gpsPosition)} now={now} error={gps.error} /></div>
      {autoIdentify && gps.enabled && live && <div className="rail-train-detection" aria-label="GPS 车次识别">
        <div className="rail-card-heading"><h3>{gpsIdentified ? "GPS 推断车次" : "GPS 车次识别"}</h3><span className="rail-small">{detection.loading ? "正在比对" : "持续校核定位"}</span></div>
        <p role="status">{detection.error || (!freshFix ? "等待定位信号后自动查询附近车站的到发车次。" : detection.candidates.length ? detection.automatic ? `当前高概率车次：${detection.automatic.journey.codes.join(" / ")}，已自动显示行程。` : "当前定位无法唯一确定车次，以下列出相符的候选行程。" : detection.loading ? "正在查询官方时刻表与铁路线路，候选结果会逐步显示。" : "暂未找到相符车次。继续移动并等待新定位，或直接输入已知车次。")}</p>
        {detection.candidates.length > 0 && <div className="rail-detection-candidates">{detection.candidates.map(candidate => <button type="button" key={candidate.key} onClick={() => useDetectedTrain(candidate, false)}>
          <strong>{candidate.journey.codes.join(" / ")}</strong><span>下一停靠站：{candidate.journey.stops[candidate.nextIndex].station}</span>
          <small>{candidate.journey.date} 始发 · {candidate.direction === "same" ? "方向相符" : "方向待确认"} · 距路径 {Math.round(candidate.errorMeters)} 米</small>
          <small>时刻偏差约 {Math.round(Math.abs(candidate.timeErrorMinutes))} 分钟 · 点击查看此行程</small>
        </button>)}</div>}
        <small>已比对 {detection.progress.stations} 个附近车站、{detection.progress.timetables} 份时刻表。{detection.progress.failed > 0 && ` ${detection.progress.failed} 项资料暂不可用。`}{detection.progress.truncated && " 高密度区先比对时间最接近的候选，尚未穷尽全部车次。"}同一线路与时刻重合的列车无法仅凭 GPS 区分；推断结果不代表官方列车身份。</small>
      </div>}
      <p className="rail-gps-privacy">定位在设备上匹配，不保存位置历史或上传到本站。地图服务会接收当前视野的瓦片请求；精度取决于 GPS 和系统定位，车厢或隧道内可能暂时无信号。</p>
      <p className="rail-hint">跨日普速车请填列车从首站发车的日期，可能早于你的乘车日期。下一站仅指本车次实际停靠站；自定义观察时间按计划时刻推算。</p>
    </div>
    {error && <div role="alert" className="rail-error">{error}</div>}
    {journey && !Number.isFinite(observation) && <div role="alert" className="rail-error">请填写完整的观察日期和时间。</div>}
    {stale && <div role="alert" className="rail-error">时刻表超过 20 分钟未能刷新，已暂停位置推算。请重新查询。</div>}
    {journey && position && <div className="rail-position-result">
      <div className="rail-position-summary rail-card">
        <div className="rail-position-identity"><div><span className="rail-overline">{journey.date} 始发</span><h3>{journey.codes.join(" / ")}</h3></div><TrainIllustration model={journey.model} /></div>
        <p className="rail-small" title={equipmentTitle({ trainsetModel: journey.model, trainsetSource: journey.modelSource, trainsetScope: journey.modelScope, trainsetDate: journey.modelDate, trainsetNumber: journey.modelNumber })}>{equipmentLabel({ trainsetModel: journey.model, trainsetOwner: journey.owner, trainOperator: journey.operator, trainsetScope: journey.modelScope })}</p>
        {gpsIdentified && <p className="rail-small">车次来自 GPS 轨迹推断{!detection.automatic && " · 当前信号尚不足以唯一确认"}</p>}
        <span className="rail-position-status"><MapPin size={14} />{status} · {gpsPosition ? gpsMatch?.approximate ? "GPS 近似匹配" : "GPS 实时匹配" : position.delayUsed ? "结合正晚点估算" : "按时刻表估算"}</span>
        <p className="rail-position-current">{position.phase === "running" ? `${previous!.station} → ${next!.station}` : `${current!.station}${position.phase === "before" ? " · 等待始发" : position.phase === "arrived" ? " · 行程结束" : " · 停站中"}`}</p>
        <div className="rail-next-stop" aria-label="下一停靠站">
          <span>{position.phase === "arrived" ? "终点站" : "下一停靠站"}</span>
          <strong>{next ? next.station : current!.station}</strong>
          {next && position.arrivalAt !== null ? <><p>{position.delayUsed ? "估计到达" : "计划到达"} {stopClock(position.arrivalAt, journey.date)}</p><small>{gpsPosition ? `距下一站沿铁路约 ${gpsMatch!.remainingKm.toFixed(1)} km` : `${position.phase === "before" ? "尚未发车 · " : ""}距到站约 ${durationLabel(position.arrivalAt - observation)}`}</small>{gpsPosition && position.arrivalAt < now && <small className="rail-gps-late">计划到达时刻已过，请以列车广播为准。</small>}</> : <p>已到达 · 无下一站</p>}
        </div>
        {position.departureAt !== null && <p className="rail-position-departure">{position.phase === "before" ? "预计始发" : "预计开车"} {stopClock(position.departureAt, journey.date)}</p>}
        {position.phase === "running" && <div className="rail-position-progress"><progress max="1" value={position.progress} aria-label="当前停站区间运行进度" /><small>当前区间{gpsPosition ? "定位" : "估算"}进度 {Math.round(position.progress * 100)}%</small></div>}
        <p className="rail-position-observed">{gpsPosition ? "GPS 定位于" : "观察于"} {timeLabel(gpsPosition ? gps.fix!.timestamp : observation)}</p>
      </div>
      <div className="rail-position-route rail-card"><RailMap journey={journey} route={wgsRoute} stations={wgsStations} position={position} fix={gps.fix} match={gpsMatch} gpsEnabled={gps.enabled} />
        {(!route || detailsLoading) && <p className="rail-position-explanation">{detailsLoading ? "正在读取铁路线路点…" : routeError || mapData?.warning}</p>}
        <p className="rail-position-explanation">{route ? "蓝点为设备实测位置，绿色为铁路匹配位置或时刻表估算，金色为下一停靠站。" : "蓝点为设备实测位置，绿色为停靠站与站间模拟位置，金色为按时刻表判断的下一站。"}定位不能证明列车身份，请确认正在乘坐所选车次。</p>
      </div>
      <div className="rail-card rail-position-timetable">
        <div className="rail-card-heading"><div><span className="rail-overline">TIMETABLE</span><h3>本车次停站表</h3></div><span className="rail-small">{journey.stops.length} 站 · 不列通过站</span></div>
        <div className="rail-timetable-scroll" role="region" aria-label="停站表，窄屏可左右滑动" tabIndex={0}><table aria-label="本车次停站表"><thead><tr><th scope="col">停靠站</th><th scope="col">车次</th><th scope="col">始发站</th><th scope="col">终到站</th><th scope="col">到达</th><th scope="col">发车</th><th scope="col">停靠</th><th scope="col">站台</th><th scope="col">检票口</th><th scope="col">列车状态</th><th scope="col">检票状态</th><th scope="col">行程进度</th></tr></thead><tbody>{journey.stops.map((stop, index) => {
          const detail = visibleStopDetail(stopBoard.rows[index]?.detail, now, live, delays, stop);
          return (
          <tr key={`${stop.station}-${index}`} className={index === position.nextIndex ? "is-next" : index === position.currentIndex ? "is-current" : ""}>
            <th scope="row"><span>{index + 1}</span>{stop.station}</th><td>{stop.trainCode}</td><td>{journey.stops[0].station}</td><td>{journey.stops.at(-1)!.station}</td>
            <td>{index ? stopClock(stop.arrivalAt, journey.date) : "始发"}</td><td>{index === journey.stops.length - 1 ? "终到" : stopClock(stop.departureAt, journey.date)}</td>
            <td>{index === 0 ? "始发" : index === journey.stops.length - 1 ? "终到" : `${(stop.departureAt - stop.arrivalAt) / 60000} 分`}</td>
            <td>{detail?.platform || "—"}</td><td className="rail-timetable-gate">{detail?.wicket || "—"}</td>
            <td className={`rail-stop-status is-${detail?.status || "unknown"}`}>{boardStatusText(detail)}</td><td className={`rail-stop-checkin is-${detail?.checkIn || "unknown"}`}>{CHECK_IN_TEXT[detail?.checkIn || "unknown"]}</td>
            <td>{index === position.currentIndex ? position.phase === "arrived" ? "已到终点" : position.phase === "before" ? "等待发车" : "当前停站" : index === position.nextIndex ? "下一停靠站" : index < (position.nextIndex ?? journey.stops.length) ? "已过" : "待到达"}</td>
          </tr>);
        })}</tbody></table></div>
        <p className="rail-hint">表内为计划时刻 · 时刻表获取于 {timeLabel(journey.checkedAt)}{live && delays ? ` · 正晚点获取于 ${timeLabel(delays.checkedAt)}` : ""}。</p>
        <p className="rail-hint">站台、检票口及列车／检票状态直接查询 12306，按各站实际到发日期显示。实时状态每分钟刷新，官方未提供时保留“未提供”；自定义观察时间仅显示计划资料，请以车站现场为准。</p>
        {stopBoard.warning && <p className="rail-position-warning" role="status">{stopBoard.warning}</p>}
      </div>
    </div>}
    {!journey && !loading && !error && <div className="rail-empty">输入车次和始发日期，或留空开启 GPS 识别候选车次；选定行程后显示下一停靠站和列车位置。</div>}
    {!position && <div className="rail-card rail-position-route"><RailMap journey={journey} route={wgsRoute} stations={wgsStations} position={null} fix={gps.fix} match={gpsMatch} gpsEnabled={gps.enabled} /></div>}
    {(delayError || position?.warning) && journey && <p className="rail-position-warning">{position?.warning || delayError}</p>}
    <p className="rail-hint rail-position-source">车次、停站时刻表和正晚点来自 12306，车型优先查询 12306。铁路网使用本站服务器缓存，覆盖国铁、城际及香港高铁段，排除城市轨道交通；按停站顺序推定的路径不代表官方确认的运行径路。官方缺少车型或缓存路径不可用时才使用第三方补充资料。开启 GPS 显示设备实测位置；模拟位置与速度仍可能受临时限速、停车和改线影响，请以列车广播、站内显示和 12306 为准。</p>
  </section>;
}
