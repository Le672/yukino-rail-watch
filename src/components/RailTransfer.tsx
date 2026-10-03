import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, RefreshCw, X, ExternalLink } from "lucide-react";
import { SEAT_OPTIONS } from "../hooks/useRailMonitor";
import { enrichTrainList, mergeTrainDetails } from "../lib/rail-enrichment";
import { chinaDateTime } from "../lib/train-position";
import { DEFAULT_TRANSFER, searchTransfers, sortTrips, tripFare, tripSeats } from "../lib/rail-transfer";
import type { TransferSettings, TransferResult, TransferProgress } from "../lib/rail-transfer";
import { DEFAULT_TRAIN_FILTERS, durationLabel, money, trainIdentity } from "../lib/rail-tickets";
import type { Station, TrainFilters } from "../lib/rail-tickets";
import { RailResultControls, TrainFare } from "./RailResultControls";
import { TrainIllustration } from "./TrainIllustration";
import "./rail-transfer.css";
const STORAGE = "yukino-rail-transfer-v1";
function initialSettings(): TransferSettings {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE) || "null"); return saved && typeof saved === "object" ? { ...DEFAULT_TRANSFER, ...saved } : DEFAULT_TRANSFER; }
  catch { return DEFAULT_TRANSFER; }
}
export function RailTransfer({ stations, onPosition }: { stations: Station[]; onPosition: (train: string, date: string) => void }) {
  const [settings, setSettings] = useState(initialSettings), [result, setResult] = useState<TransferResult | null>(null);
  const [filters, setFilters] = useState<TrainFilters>({ ...DEFAULT_TRAIN_FILTERS, sort: "duration" });
  const [seat, setSeat] = useState("任意席别"), [everyModel, setEveryModel] = useState(false), [page, setPage] = useState(1);
  const [checking, setChecking] = useState(false), [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TransferProgress | null>(null), [details, setDetails] = useState<{ done: number; total: number } | null>(null);
  const controller = useRef<AbortController | null>(null), generation = useRef(0);
  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(settings)); }, [settings]);
  useEffect(() => () => { controller.current?.abort(); generation.current++; }, []);
  const update = (patch: Partial<TransferSettings>) => {
    controller.current?.abort(); generation.current++;
    setSettings(current => ({ ...current, ...patch })); setResult(null); setChecking(false); setProgress(null); setDetails(null); setError(null); setPage(1);
  };
  const run = async () => {
    controller.current?.abort(); const current = ++generation.current, abort = new AbortController(); controller.current = abort;
    setChecking(true); setError(null); setResult(null); setDetails(null); setPage(1);
    try {
      const next = await searchTransfers(settings, stations, abort.signal, value => { if (current === generation.current) setProgress(value); });
      if (current !== generation.current) return;
      setResult(next); setChecking(false); setProgress(null);
      const unique = [...new Map(next.trips.flatMap(trip => trip.legs).map(l => [trainIdentity(l), l])).values()];
      if (!unique.length) return;
      setDetails({ done: 0, total: unique.length });
      await enrichTrainList(unique, settings.date, (updates, done) => {
        const byId = new Map(updates.map(t => [trainIdentity(t), t]));
        if (current !== generation.current) return;
        setResult(previous => previous ? { ...previous, trips: previous.trips.map(trip => ({ ...trip, legs: trip.legs.map(l => mergeTrainDetails(l, byId.get(trainIdentity(l)))) })) } : previous);
        setDetails({ done, total: unique.length });
      }, abort.signal);
    } catch (cause) { if (current === generation.current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (current === generation.current) { setChecking(false); setProgress(null); } }
  };
  const currentFilters = useMemo(() => ({ ...filters, seat }), [filters, seat]);
  const sorted = useMemo(() => sortTrips(result?.trips || [], currentFilters, everyModel), [result, currentFilters, everyModel]);
  const pages = Math.max(1, Math.ceil(sorted.length / 20)), currentPage = Math.min(page, pages), shown = sorted.slice((currentPage - 1) * 20, currentPage * 20);
  const trains = useMemo(() => result?.trips.flatMap(t => t.legs) || [], [result]);
  const filter = (value: TrainFilters) => { setFilters(value); setPage(1); };
  return <section className="rail-transfer" aria-label="中转行程查询">
    <div className="rail-transfer-intro"><span className="rail-overline">TRANSFER / 12306</span><h2>中转行程</h2><p>同站、相邻站群与站外衔接一起规划。每程保持真实站名，按换乘所需时间筛选。</p></div>
    <form className="rail-transfer-form" onSubmit={event => { event.preventDefault(); void run(); }}>
      <div className="rail-transfer-fields">
        <label>首程乘车日期<input type="date" required value={settings.date} onChange={e => update({ date: e.target.value })}/></label>
        <label>出发站<input list="rail-transfer-stations" required placeholder="例如 深圳北" value={settings.from} onChange={e => update({ from: e.target.value })}/></label>
        <label>到达站<input list="rail-transfer-stations" required placeholder="例如 西平西 / 树木岭" value={settings.to} onChange={e => update({ to: e.target.value })}/></label>
        <label>最早出发<input type="time" required value={settings.earliest} onChange={e => update({ earliest: e.target.value })}/></label>
        <label>最多中转<select value={settings.maxChanges} onChange={e => update({ maxChanges: Number(e.target.value) as 1 | 2, via2: e.target.value === "1" ? "" : settings.via2 })}><option value={1}>1 次 · 最多 2 程</option><option value={2}>2 次 · 最多 3 程</option></select></label>
        <label>中转站 1（可选）<input list="rail-transfer-stations" placeholder="自动发现中转节点" value={settings.via} onChange={e => update({ via: e.target.value })}/></label>
        {settings.maxChanges === 2 && <label>中转站 2（可选）<input list="rail-transfer-stations" placeholder="指定两站可查询完整路径" value={settings.via2} onChange={e => update({ via2: e.target.value })}/></label>}
        <label>同站最短预留（分钟）<input type="number" min={10} max={180} required value={settings.minimum} onChange={e => update({ minimum: Number(e.target.value) })}/></label>
        <label>单次最长等待（分钟）<input type="number" min={settings.minimum} max={1440} required value={settings.maximumWait} onChange={e => update({ maximumWait: Number(e.target.value) })}/></label>
        <label>站外预留（分钟）<input type="number" min={45} max={360} required value={settings.cityMinutes} onChange={e => update({ cityMinutes: Number(e.target.value) })}/></label>
      </div>
      <datalist id="rail-transfer-stations">{stations.map(s => <option key={s.code} value={s.name}>{s.city || s.pinyin}</option>)}</datalist>
      <div className="rail-transfer-options"><label><input type="checkbox" checked={settings.stationGroupEndpoints} onChange={e => update({ stationGroupEndpoints: e.target.checked })}/>起终点也纳入相邻站群</label><label><input type="checkbox" checked={settings.allowCity} onChange={e => update({ allowCity: e.target.checked })}/>允许长株潭高铁与城际站外衔接</label></div>
      <p className="rail-transfer-help">广州南／番禺、广州新塘／新塘南、虎门／虎门北按相邻站群衔接。相邻站群按方向至少预留 20–35 分钟；站外需另行安排地面交通，费用不计入铁路总票价。</p>
      <div className="rail-transfer-actions"><button className="rail-transfer-primary" disabled={checking || !stations.length} type="submit"><ArrowRightLeft size={16}/>{checking ? "正在规划" : result ? "重新查询 / 刷新余票" : "查询中转"}</button>{checking && <button type="button" onClick={() => { controller.current?.abort(); generation.current++; setChecking(false); setProgress(null); }}><X size={15}/>取消查询</button>}<span>{!stations.length ? "正在加载官方车站表…" : progress ? `${progress.queryCount} 个区间 · ${progress.text}` : "车次、时刻、余票及票价来自 12306"}</span></div>
    </form>
    {error && <div className="rail-error" role="alert">{error}</div>}
    {result && <div className="rail-transfer-results">
      <div className="rail-transfer-results-heading"><h3>{result.from} → {result.to}</h3><span>{result.date} · {result.trips.length} 个方案</span></div>
      <div className="rail-transfer-seat-filter"><label>票价与余票席别<select value={seat} onChange={e => { setSeat(e.target.value); setPage(1); }}>{SEAT_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></label><label className="rail-control-checkbox"><input type="checkbox" checked={everyModel} onChange={e => { setEveryModel(e.target.checked); setPage(1); }}/>车型筛选要求每程均匹配</label></div>
      <RailResultControls filters={currentFilters} onChange={filter} trains={trains} count={sorted.length} multi/>
      <p className="rail-transfer-help">总耗时包含乘车、等待与站群步行；总票价按所选席别逐程相加，“任意席别”取各程最低适用票价。余票按最少的一程排序，“有”表示未提供精确数量。未知价格排在已知总价之后。</p>
      {details && details.done < details.total && <p className="rail-transfer-loading" role="status"><RefreshCw size={13} className="rail-spin"/> 正在补充车型及缺失票价：{details.done} / {details.total}；筛选结果会随资料更新。</p>}
      {result.warnings.length > 0 && <details className="rail-transfer-warnings" open={!result.trips.length}><summary>查询范围与未完成区间（{result.warnings.length}）</summary><ul>{result.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      {!shown.length ? <div className="rail-transfer-empty">{result.trips.length ? "没有符合当前车型或余票筛选的方案。" : "当前查询范围内暂无符合预留时间的方案，可调整时间或指定中转站。"}</div> : shown.map(trip => <article className="rail-trip" key={trip.id}>
        <header className="rail-trip-header"><div><strong>{chinaDateTime(trip.departureAt).replace("T", " ")} → {chinaDateTime(trip.arrivalAt).replace("T", " ")}</strong><span>{durationLabel(trip.duration)} · {trip.legs.length === 1 ? "直达" : `${trip.legs.length - 1} 次中转`}{trip.connections.some(c => c.kind === "city") ? " · 含站外换乘" : ""}</span></div><div className="rail-trip-total"><strong>{money(tripFare(trip, seat))}</strong><span>{tripSeats(trip, seat) > 0 ? "全程有关注席别余票" : "部分车次暂无关注席别余票"}</span></div></header>
        {trip.access && <div className="rail-trip-connection"><b>出发站群：{trip.access.from.name} → {trip.access.to.name}</b><span>预留 {trip.access.minimum} 分钟步行／进站</span><small>{trip.access.note}</small></div>}
        {trip.legs.map((leg, index) => <div className="rail-trip-leg-block" key={trainIdentity(leg)}>
          {index > 0 && <div className={`rail-trip-connection is-${trip.connections[index - 1].kind}`}><b>{trip.connections[index - 1].kind === "same" ? "同站换乘" : trip.connections[index - 1].kind === "walk" ? "相邻站群换乘" : "站外换乘"}：{trip.connections[index - 1].from.name}{trip.connections[index - 1].from.code !== trip.connections[index - 1].to.code ? ` → ${trip.connections[index - 1].to.name}` : ""}</b><span>间隔 {(leg.departureAt - trip.legs[index - 1].arrivalAt) / 60000} 分钟 · 至少预留 {trip.connections[index - 1].minimum} 分钟</span><small>{trip.connections[index - 1].note}</small></div>}
          <div className="rail-trip-leg"><div className="rail-trip-leg-title"><span>第 {index + 1} 程 · {leg.date}</span><div><strong>{leg.code}</strong><TrainIllustration model={leg.trainsetModel}/></div><p>车型：{leg.trainsetModel || "暂无可核实资料"}{leg.trainsetOwner ? ` · ${leg.trainsetOwner}` : ""}</p></div>
          <div className="rail-trip-leg-times"><div><strong>{leg.departure}</strong><span>{leg.from}</span></div><div className="rail-trip-leg-duration">{durationLabel(Math.round((leg.arrivalAt - leg.departureAt) / 60000))}<span>→</span></div><div><strong>{leg.arrival}</strong><span>{leg.to}</span>{chinaDateTime(leg.arrivalAt).slice(0, 10) !== leg.date && <small>{chinaDateTime(leg.arrivalAt).slice(0, 10)} 到达</small>}</div></div>
          <TrainFare train={leg} seat={seat}/><div className="rail-trip-seats">{leg.seats.filter(s => s.value !== "--").map(s => <span key={s.label} className={s.available ? "is-available" : ""}>{s.label} <b>{s.value}</b><small>{money(s.price)}{s.priceMax && s.price && s.priceMax > s.price ? `–${money(s.priceMax)}` : ""}</small></span>)}</div><div className="rail-trip-leg-links"><button type="button" onClick={() => onPosition(leg.code, leg.originDate || leg.date)}>位置 / 下一站</button><a href="https://www.12306.cn/" target="_blank" rel="noreferrer">前往 12306 <ExternalLink size={12}/></a></div></div>
        </div>)}
        {trip.egress && <div className="rail-trip-connection"><b>到达站群：{trip.egress.from.name} → {trip.egress.to.name}</b><span>预留 {trip.egress.minimum} 分钟步行／进站</span><small>{trip.egress.note}</small></div>}
      </article>)}
      {pages > 1 && <nav className="rail-trip-pagination" aria-label="中转结果分页"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pages} · 每页 20 个</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
      <p className="rail-transfer-help">已查询 {result.queryCount} 个区间、{result.hubs.length} 个中转节点 · {new Date(result.checkedAt).toLocaleString("zh-CN", { hour12: false })}。自动查询覆盖已发现节点，指定中转站可补查其他路径；余票与检票截止以 12306 和车站现场为准。</p>
    </div>}
  </section>;
}
