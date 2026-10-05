import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minimize, RefreshCw, TrainFront } from "lucide-react";
import type { Station } from "../lib/rail-tickets";
import { railApiUrl } from "../lib/rail-api";
import { chinaDateTime } from "../lib/train-position";
import { boardRows, boardStatusText, CHECK_IN_TEXT } from "../lib/rail-board";
import type { BoardDirection, BoardRowDetail, StationBoardData } from "../lib/rail-board";
import "./station-board.css";

const PAGE_SIZE = 6;
type Target = { station: string; date: string };
const detailKey = (direction: BoardDirection, id: string) => `${direction}/${id}`;
function savedStation() { try { return localStorage.getItem("yukino-board-station") || "广州南"; } catch { return "广州南"; } }
async function read<T>(params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const response = await fetch(railApiUrl(new URLSearchParams(params)), { signal });
  const data = await response.json() as T & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error || `查询失败 ${response.status}`);
  return data;
}
function clock(at: number) { return new Date(at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); }

export function StationBoard({ stations, onPosition }: { stations: Station[]; onPosition?: (train: string, originDate: string) => void }) {
  const [station, setStation] = useState(() => new URLSearchParams(window.location.search).get("station") || savedStation());
  const [date, setDate] = useState(() => new URLSearchParams(window.location.search).get("date") || chinaDateTime().slice(0, 10));
  const [target, setTarget] = useState<Target | null>(null);
  const [board, setBoard] = useState<StationBoardData | null>(null);
  const [details, setDetails] = useState<Record<string, BoardRowDetail>>({});
  const [direction, setDirection] = useState<BoardDirection>("D");
  const [search, setSearch] = useState("");
  const [upcoming, setUpcoming] = useState(true);
  const [auto, setAuto] = useState(true);
  const [rotate, setRotate] = useState(false);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const detailCache = useRef(details);
  const boardRef = useRef(board);
  const initialized = useRef(false);
  detailCache.current = details; boardRef.current = board;

  const load = useCallback(async (query: Target) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    setLoading(true); setError(null);
    try {
      const data = await read<StationBoardData>({ mode: "board", ...query }, controller.signal);
      if (controller.signal.aborted) return;
      if (data.source !== "12306" || data.date !== query.date || data.stationCode !== query.station || !Array.isArray(data.rows)) throw new Error("车站大屏返回的车站或日期不符");
      if (boardRef.current?.stationCode !== data.stationCode || boardRef.current.date !== data.date) { setPage(0); setDetails({}); }
      setBoard(data); try { localStorage.setItem("yukino-board-station", data.station); } catch { /* Querying still works when local storage is disabled. */ }
    } catch (reason) {
      if (active.current === controller) setError(controller.signal.aborted ? "车站查询超时，请重试" : reason instanceof Error ? reason.message : "车站查询失败");
    } finally { clearTimeout(timeout); if (active.current === controller) { active.current = null; setLoading(false); } }
  }, []);
  useEffect(() => {
    if (initialized.current || !stations.length) return;
    initialized.current = true;
    const match = stations.find(item => item.name === station || item.code === station);
    if (match) { const query = { station: match.code, date }; setStation(match.name); setTarget(query); void load(query); }
  }, [stations, station, date, load]);
  useEffect(() => () => { active.current?.abort(); active.current = null; initialized.current = false; }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!target || !auto) return;
    const refresh = () => { if (!document.hidden && !active.current && (!boardRef.current || Date.now() - boardRef.current.checkedAt >= 60000)) void load(target); };
    const timer = setInterval(refresh, 60000); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [target, auto, load]);
  const rows = useMemo(() => board ? boardRows(board, direction, search, upcoming && board.date === chinaDateTime(now).slice(0, 10), now) : [], [board, direction, search, upcoming, Math.floor(now / 60000)]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const visibleIds = visible.map(row => row.id).join("|");
  useEffect(() => { setPage(0); }, [direction, search, upcoming]);
  useEffect(() => {
    if (!rotate || pages < 2) return;
    const timer = setInterval(() => { if (!document.hidden) setPage(value => (value + 1) % pages); }, 15000);
    return () => clearInterval(timer);
  }, [rotate, pages]);
  useEffect(() => {
    if (!board || document.hidden || boardRef.current !== board) return;
    const controller = new AbortController();
    const queue = visible.filter(row => !detailCache.current[detailKey(direction, row.id)] || Date.now() - detailCache.current[detailKey(direction, row.id)].checkedAt >= 55000);
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const row = queue.shift()!;
        try {
          const detail = await read<BoardRowDetail>({ mode: "board-row", station: board.stationCode, date: board.date, id: row.id, direction }, controller.signal);
          if (!controller.signal.aborted && detail.id === row.id && detail.direction === direction) setDetails(value => ({ ...value, [detailKey(direction, row.id)]: detail }));
        } catch { /* Each missing detail remains unknown; the timetable remains usable. */ }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => controller.abort();
  }, [board, direction, visibleIds]);
  useEffect(() => {
    const update = () => setFull(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", update); return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const fullscreen = async () => {
    try { if (full) await document.exitFullscreen(); else if (panel.current?.requestFullscreen) await panel.current.requestFullscreen(); else setError("当前环境不支持全屏，请使用浏览器全屏快捷键"); }
    catch { setError("未能进入全屏，请使用浏览器全屏快捷键"); }
  };
  const submit = () => {
    const match = stations.find(item => item.name === station.trim() || item.code === station.trim().toUpperCase());
    if (!match) { setError("请从 12306 车站列表选择车站"); return; }
    const query = { station: match.code, date }; setStation(match.name); setTarget(query); void load(query);
  };
  const openPosition = async (train: string, originDate: string) => {
    if (document.fullscreenElement === panel.current && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch { /* Navigation remains available if exiting fullscreen fails. */ }
    }
    onPosition?.(train, originDate);
  };
  const stale = !!board && now - board.checkedAt > 120000;
  return <section className="station-board-section" aria-label="车站大屏">
    <form className="station-board-controls" onSubmit={event => { event.preventDefault(); submit(); }}>
      <label>车站<input list="station-board-stations" value={station} onChange={event => setStation(event.target.value)} required placeholder="输入车站名称" /></label>
      <datalist id="station-board-stations">{stations.map(item => <option key={item.code} value={item.name}>{item.pinyin}</option>)}</datalist>
      <label>车站到发日期<input type="date" value={date} onChange={event => setDate(event.target.value)} min={chinaDateTime(now - 13 * 86400000).slice(0, 10)} max={chinaDateTime(now + 14 * 86400000).slice(0, 10)} required /></label>
      <button className="station-board-query" type="submit" disabled={loading || !stations.length}><RefreshCw size={16} className={loading ? "rail-spin" : ""}/>{loading ? "查询中" : "查询大屏"}</button>
      <label className="station-board-option"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)}/>每分钟刷新</label>
    </form>
    {error && <p className="rail-error" role="alert">{error}{board ? "；保留上次查询，状态可能已变化" : ""}</p>}
    <div className={`station-board-screen ${full ? "is-full" : ""}`} ref={panel}>
      <header className="station-board-heading"><div><span className="station-board-kicker">RAILWAY INFORMATION</span><h2><TrainFront size={29}/>{board?.station || "车站"}<span>列车到发信息</span></h2><p>{board?.date || date} <span>北京时间 UTC+8</span></p></div><div className="station-board-clock"><time>{clock(now)}</time><button type="button" onClick={() => void fullscreen()} aria-label={full ? "退出大屏全屏" : "大屏全屏"}>{full ? <Minimize size={17}/> : <Maximize size={17}/>}<span>{full ? "退出全屏" : "全屏"}</span></button></div></header>
      <div className="station-board-toolbar"><div className="station-board-directions" role="group" aria-label="大屏到发方向"><button type="button" aria-pressed={direction === "D"} onClick={() => setDirection("D")}>出发 <small>DEPARTURES</small></button><button type="button" aria-pressed={direction === "A"} onClick={() => setDirection("A")}>到达 <small>ARRIVALS</small></button></div><label className="station-board-filter"><span className="sr-only">筛选大屏车次或到发站</span><input type="search" placeholder="筛选车次 / 到发站" value={search} onChange={event => setSearch(event.target.value)}/></label><label className="station-board-option"><input type="checkbox" checked={upcoming} onChange={event => setUpcoming(event.target.checked)}/>近期车次</label></div>
      <div className="station-board-table-wrap" tabIndex={0} aria-label="车站到发大屏，窄屏可左右滑动"><table className="station-board-table"><thead><tr><th scope="col">车次<small>TRAIN</small></th><th scope="col">始发站<small>FROM</small></th><th scope="col">终到站<small>TO</small></th><th scope="col">到达 / 出发<small>SCHEDULED</small></th><th scope="col">停靠<small>DWELL</small></th><th scope="col">站台<small>PLATFORM</small></th><th scope="col">检票口<small>GATE</small></th><th scope="col">列车状态<small>STATUS</small></th><th scope="col">检票状态<small>CHECK-IN</small></th></tr></thead><tbody>{visible.map(row => {
        const saved = details[detailKey(direction, row.id)], detail = saved && now - saved.checkedAt <= 120000 && !stale ? saved : undefined;
        const overnight = row.departureAt !== null && chinaDateTime(row.departureAt).slice(0, 10) !== board?.date;
        return <tr key={row.id} className={detail?.checkIn === "checking" ? "is-checking" : ""}><th scope="row">{onPosition ? <button type="button" className="station-board-train-link" aria-label={`查看 ${row.train} 的实时位置`} title="查看列车位置与下一站" onClick={() => void openPosition(row.train, row.originDate)}><strong>{row.train}</strong></button> : <strong>{row.train}</strong>}{row.originDate !== board?.date && <small>始发 {row.originDate.slice(5)}</small>}</th><td>{row.from}</td><td>{row.to}</td><td className="station-board-times"><span className={direction === "A" ? "is-focus" : ""}>{row.arrival || "—"}</span><span className={direction === "D" ? "is-focus" : ""}>{row.departure || "—"}{overnight && <sup>+1</sup>}</span></td><td className="station-board-dwell">{row.dwellMinutes !== null ? `${row.dwellMinutes} 分` : row.fromCode === board?.stationCode ? "始发" : row.toCode === board?.stationCode ? "终到" : "—"}</td><td className="station-board-platform">{saved?.platform || "—"}</td><td className="station-board-gate" title={saved?.wicket || undefined}>{saved?.wicket || "—"}</td><td className={`station-board-service is-${detail?.status || "unknown"}`} title={detail?.sourceAt ? `官方状态查询于 ${clock(detail.sourceAt)}` : "12306 暂未提供有效状态"}>{boardStatusText(detail)}</td><td className={`station-board-check is-${detail?.checkIn || "unknown"}`}>{CHECK_IN_TEXT[detail?.checkIn || "unknown"]}</td></tr>;
      })}{!visible.length && <tr><td colSpan={9} className="station-board-empty">{loading ? "正在读取 12306 到发信息…" : !board ? "选择车站，开启到发大屏" : board.rows.length ? "当前筛选下没有车次，可关闭“近期车次”或清空筛选" : "12306 未返回该站当日到发车次，不能据此判断停运"}</td></tr>}</tbody></table></div>
      <footer className="station-board-footer"><div><span className={`station-board-live-dot ${stale || !board ? "is-stale" : ""}`}/><span>{board ? `${stale ? "旧快照" : "已查询"} ${clock(board.checkedAt)}` : "等待查询"}</span><span>{rows.length} 趟 · 计划到发</span></div><div className="station-board-pages"><label className="station-board-option"><input type="checkbox" checked={rotate} onChange={event => setRotate(event.target.checked)}/>自动翻页</label><button type="button" aria-label="大屏上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18}/></button><span>{currentPage + 1} / {pages}</span><button type="button" aria-label="大屏下一页" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18}/></button></div></footer>
      <p className="station-board-notice">到发时刻与停靠时长为计划信息；当前屏逐日核验开行，“当日不开行”与临时取消分别显示。正晚点按官方结果显示；检票状态、站台或检票口未提供时显示“未提供”或“—”，请以车站现场为准。{stale && "自动更新未完成，实时状态已隐藏。"}</p>
    </div>
    <p className="station-board-help">支持 12306 全国车站。候车、检票中、停检及取消仅在官方返回对应状态时展示；网页进入后台后暂停自动查询，回到前台继续刷新。</p>
  </section>;
}
