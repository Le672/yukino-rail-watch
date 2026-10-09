import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, RefreshCw, X, ExternalLink } from "lucide-react";
import { SEAT_OPTIONS } from "../hooks/useRailMonitor";
import { enrichTrainList, mergeTrainDetails } from "../lib/rail-enrichment";
import { chinaDateTime, isJourneyDate } from "../lib/train-position";
import { ticketDateRange } from "../lib/rail-ticket-date";
import { DEFAULT_TRANSFER, searchTransfers, sortTrips, tripFare, tripRailFare, tripSeats, hasUrban } from "../lib/rail-transfer";
import type { TransferSettings, TransferResult, TransferProgress } from "../lib/rail-transfer";
import { DEFAULT_TRAIN_FILTERS, durationLabel, money, trainIdentity } from "../lib/rail-tickets";
import type { Station, TrainFilters } from "../lib/rail-tickets";
import { RailResultControls, TrainFare } from "./RailResultControls";
import { officialCityKey } from "../lib/rail-national-network";
import { TrainIllustration } from "./TrainIllustration";
import { loadUrbanRail } from "../lib/urban-rail";
import { UrbanRailRoute } from "./UrbanRailRoute";
import { equipmentLabel, equipmentTitle } from "../lib/rail-equipment";
import "./rail-transfer.css";
const STORAGE = "yukino-rail-transfer-v1";
function initialSettings(): { settings: TransferSettings; notice: string | null } {
  const today = ticketDateRange().min, defaults = { ...DEFAULT_TRANSFER, date: today };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { settings: defaults, notice: null };
    const validDate = typeof saved.date === "string" && isJourneyDate(saved.date), expired = validDate && saved.date < today;
    return { settings: { ...defaults, ...saved, date: validDate && !expired ? saved.date : today },
      notice: expired ? `上次保存的乘车日期 ${saved.date} 已过期，已更新为今天 ${today}，请核对出行日期。` : null };
  } catch { return { settings: defaults, notice: null }; }
}
export function RailTransfer({ stations, onPosition }: { stations: Station[]; onPosition: (train: string, date: string) => void }) {
  const [initial] = useState(initialSettings);
  const [settings, setSettings] = useState(initial.settings), [dateNotice, setDateNotice] = useState(initial.notice);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [dateRange, setDateRange] = useState(ticketDateRange);
  const [filters, setFilters] = useState<TrainFilters>({ ...DEFAULT_TRAIN_FILTERS, sort: "duration" });
  const [seat, setSeat] = useState("任意席别"), [everyModel, setEveryModel] = useState(false), [page, setPage] = useState(1);
  const [checking, setChecking] = useState(false), [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TransferProgress | null>(null), [details, setDetails] = useState<{ done: number; total: number } | null>(null);
  const [urbanStations, setUrbanStations] = useState<Station[]>([]), [urbanLoading, setUrbanLoading] = useState(false), [urbanError, setUrbanError] = useState<string | null>(null);
  const [urbanStats, setUrbanStats] = useState<{ lines: number; sourceDate: string } | null>(null), [railFirst, setRailFirst] = useState(true);
  const controller = useRef<AbortController | null>(null), generation = useRef(0);
  useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(settings)); } catch { /* Querying remains available without browser storage. */ } }, [settings]);
  useEffect(() => {
    const refresh = () => setDateRange(ticketDateRange());
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => () => { controller.current?.abort(); generation.current++; }, []);
  useEffect(() => {
    if (!settings.allowUrban) return;
    let disposed = false; setUrbanLoading(true); setUrbanError(null);
    void loadUrbanRail().then(planner => { if (!disposed) { setUrbanStations(planner.stations()); setUrbanStats({ lines: planner.network.lines.length, sourceDate: planner.network.sourceDate }); } })
      .catch(cause => { if (!disposed) setUrbanError(cause instanceof Error ? cause.message : "轨道网络加载失败，请重新开启选项重试"); })
      .finally(() => { if (!disposed) setUrbanLoading(false); });
    return () => { disposed = true; };
  }, [settings.allowUrban]);
  const update = (patch: Partial<TransferSettings>) => {
    controller.current?.abort(); generation.current++;
    if (patch.date !== undefined) setDateNotice(null);
    setSettings(current => ({ ...current, ...patch })); setResult(null); setChecking(false); setProgress(null); setDetails(null); setError(null); setPage(1);
  };
  const run = async (query = settings) => {
    controller.current?.abort(); const current = ++generation.current, abort = new AbortController(); controller.current = abort;
    setChecking(true); setError(null); setResult(null); setDetails(null); setPage(1);
    try {
      const next = await searchTransfers(query, stations, abort.signal, value => { if (current === generation.current) setProgress(value); });
      if (current !== generation.current) return;
      setResult(next); setChecking(false); setProgress(null);
      const unique = [...new Map(next.trips.flatMap(trip => trip.legs).map(l => [trainIdentity(l), l])).values()];
      if (!unique.length) return;
      setDetails({ done: 0, total: unique.length });
      await enrichTrainList(unique, query.date, (updates, done) => {
        const byId = new Map(updates.map(t => [trainIdentity(t), t]));
        if (current !== generation.current) return;
        setResult(previous => previous ? { ...previous, trips: previous.trips.map(trip => ({ ...trip, legs: trip.legs.map(l => mergeTrainDetails(l, byId.get(trainIdentity(l)))) })) } : previous);
        setDetails({ done, total: unique.length });
      }, abort.signal);
    } catch (cause) { if (current === generation.current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (current === generation.current) { setChecking(false); setProgress(null); } }
  };
  const currentFilters = useMemo(() => ({ ...filters, seat }), [filters, seat]);
  const sorted = useMemo(() => sortTrips(result?.trips || [], currentFilters, everyModel, railFirst), [result, currentFilters, everyModel, railFirst]);
  const pages = Math.max(1, Math.ceil(sorted.length / 20)), currentPage = Math.min(page, pages), shown = sorted.slice((currentPage - 1) * 20, currentPage * 20);
  const trains = useMemo(() => result?.trips.flatMap(t => t.legs) || [], [result]);
  const filter = (value: TrainFilters) => { setFilters(value); setPage(1); };
  const cityCount = new Set(stations.flatMap(s => officialCityKey(s) ? [officialCityKey(s)!] : [])).size;
  const endpointStations = useMemo(() => [...stations, ...(settings.allowUrban ? urbanStations : [])], [stations, settings.allowUrban, urbanStations]);
  const suggestions = (value: string, list = endpointStations) => {
    const tokens = value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(s => tokens.every(token => `${s.name} ${s.city || ""} ${s.pinyin}`.toLocaleLowerCase().includes(token))).slice(0, 80);
  };
  return <section className="rail-transfer" aria-label="中转行程查询">
    <div className="rail-transfer-intro"><span className="rail-overline">NATIONWIDE TRANSFER / 12306</span><h2>中转行程</h2><p>全国铁路、高铁、普速与 12306 城际／市域列车一起规划。可选城市轨道接驳，铁路方案默认优先。</p></div>
    <form className="rail-transfer-form" onSubmit={event => { event.preventDefault(); void run(); }}>
      <div className="rail-transfer-fields">
        <label>首程乘车日期<input type="date" required min={dateRange.min} max={dateRange.max} value={settings.date} onChange={e => update({ date: e.target.value })}/></label>
        <label>出发站<input list="rail-transfer-origins" required placeholder={settings.allowUrban ? "输入城市／站名检索候选" : "例如 深圳北"} value={settings.from} onChange={e => update({ from: e.target.value })}/></label>
        <label>到达站<input list="rail-transfer-destinations" required placeholder={settings.allowUrban ? "输入城市／站名检索候选" : "例如 西平西 / 树木岭"} value={settings.to} onChange={e => update({ to: e.target.value })}/></label>
        <label>最早出发<input type="time" required value={settings.earliest} onChange={e => update({ earliest: e.target.value })}/></label>
        <label>最多中转<select value={settings.maxChanges} onChange={e => update({ maxChanges: Number(e.target.value) as 1 | 2, via2: e.target.value === "1" ? "" : settings.via2 })}><option value={1}>1 次 · 最多 2 程</option><option value={2}>2 次 · 最多 3 程</option></select></label>
        <label>搜索范围<select value={settings.hubLimit ?? 64} onChange={e => update({ hubLimit: Number(e.target.value) })}><option value={64}>标准 · 64 个候选站</option><option value={128}>扩展 · 128 个候选站</option><option value={256}>深度 · 256 个候选站</option><option value={512}>广域 · 512 个候选站（耗时较长）</option></select></label>
        <label>中转站 1（可选）<input list="rail-transfer-via1" placeholder="自动发现铁路中转节点" value={settings.via} onChange={e => update({ via: e.target.value })}/></label>
        {settings.maxChanges === 2 && <label>中转站 2（可选）<input list="rail-transfer-via2" placeholder="指定两站可查询完整路径" value={settings.via2} onChange={e => update({ via2: e.target.value })}/></label>}
        <label>同站最短预留（分钟）<input type="number" min={10} max={180} required value={settings.minimum} onChange={e => update({ minimum: Number(e.target.value) })}/></label>
        <label>单次最长等待（分钟）<input type="number" min={settings.minimum} max={1440} required value={settings.maximumWait} onChange={e => update({ maximumWait: Number(e.target.value) })}/></label>
        <label>站外预留（分钟）<input type="number" min={45} max={360} required value={settings.cityMinutes} onChange={e => update({ cityMinutes: Number(e.target.value) })}/></label>
      </div>
      <p className="rail-transfer-help" role={dateNotice ? "status" : undefined}>{dateNotice || `余票查询范围：${dateRange.min} 至 ${dateRange.max}（含当天 15 天）；已过期的保存日期会自动更新为今天。`}</p>
      <datalist id="rail-transfer-origins">{suggestions(settings.from).map(s => <option key={s.code} value={s.name}>{s.city || s.pinyin}</option>)}</datalist>
      <datalist id="rail-transfer-destinations">{suggestions(settings.to).map(s => <option key={s.code} value={s.name}>{s.city || s.pinyin}</option>)}</datalist>
      <datalist id="rail-transfer-via1">{suggestions(settings.via, stations).map(s => <option key={s.code} value={s.name}>{s.city || s.pinyin}</option>)}</datalist>
      <datalist id="rail-transfer-via2">{suggestions(settings.via2, stations).map(s => <option key={s.code} value={s.name}>{s.city || s.pinyin}</option>)}</datalist>
      <div className="rail-transfer-options"><label><input type="checkbox" checked={settings.stationGroupEndpoints} onChange={e => update({ stationGroupEndpoints: e.target.checked })}/>起终点也纳入相邻站群</label><label><input type="checkbox" checked={settings.allowCity} onChange={e => update({ allowCity: e.target.checked })}/>允许全国同城异站换乘（需站外交通）</label></div>
      <div className="rail-transfer-options rail-urban-option"><label><input type="checkbox" checked={!!settings.allowUrban} onChange={e => update({ allowUrban: e.target.checked })}/>城市轨道交通（可选，默认关闭）</label><span>地铁、轻轨、有轨电车、单轨、磁浮、市域、APM 与轨道缆车，作为备选接驳</span></div>
      {settings.allowUrban && <div className="rail-urban-status" role="status">{urbanLoading ? "正在加载全国轨道线路与站点…" : urbanError ? urbanError : urbanStats ? <>已载入 {urbanStats.lines} 条方向／支线、{urbanStations.length} 个轨道站 · 数据快照 {urbanStats.sourceDate.slice(0, 10)}。输入城市或站名检索，展示前 80 个匹配候选；重复名称需选择完整站名。<br/>网络覆盖全国已收录线路，开放数据可能漏站或缺线；未录入的线路不会伪造接驳。班次、运营日期与票价缺失时标为待确认。</> : "轨道网络待加载"}</div>}
      <p className="rail-transfer-help">已载入 {stations.length} 个官方车站、{cityCount} 个城市标识，全国车站均可作为中转候选。北京、上海、成渝、长三角、东北、西北、西南及各地城际／市域车次以当日 12306 返回为准；选择中转站后也会检查同城异站，可关闭站外换乘。</p>
      <p className="rail-transfer-help">广州南／番禺等七组已核对的相邻站群按方向至少预留 20–40 分钟；其他同城异站按站外交通预留，不能视为同站通道。含未核实城区范围的站点至少预留 180 分钟，地面路线需自行确认；站外交通费用不计入铁路总票价。</p>
      <div className="rail-transfer-actions"><button className="rail-transfer-primary" disabled={checking || !stations.length || !!settings.allowUrban && (urbanLoading || !!urbanError)} type="submit"><ArrowRightLeft size={16}/>{checking ? "正在规划" : result ? "重新查询 / 刷新余票" : "查询中转"}</button>{checking && <button type="button" onClick={() => { controller.current?.abort(); generation.current++; setChecking(false); setProgress(null); }}><X size={15}/>取消查询</button>}<span>{!stations.length ? "正在加载官方车站表…" : progress ? `${progress.queryCount} 个区间 · ${progress.text}` : "铁路车次、时刻、余票及票价来自 12306"}</span></div>
    </form>
    {error && <div className="rail-error" role="alert">{error}</div>}
    {result && <div className="rail-transfer-results">
      <div className="rail-transfer-results-heading"><h3>{result.from} → {result.to}</h3><span>{result.date} · {result.trips.length} 个方案</span></div>
      {!settings.via && result.hubs.length < result.candidateCount && result.hubLimit < 512 && <div className="rail-transfer-actions"><button type="button" onClick={() => { const next = { ...settings, hubLimit: Math.min(512, result.hubLimit * 2) }; setSettings(next); void run(next); }}>扩大范围重新查询</button><span>本次选取 {result.hubs.length} / {result.candidateCount} 个全国候选站；扩大范围需更多查询时间。</span></div>}
      <div className="rail-transfer-seat-filter"><label>票价与余票席别<select value={seat} onChange={e => { setSeat(e.target.value); setPage(1); }}>{SEAT_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></label><label className="rail-control-checkbox"><input type="checkbox" checked={everyModel} onChange={e => { setEveryModel(e.target.checked); setPage(1); }}/>车型筛选要求每程均匹配</label>{result.urban && <label>方案优先顺序<select value={railFirst ? "railway" : "sort"} onChange={e => { setRailFirst(e.target.value === "railway"); setPage(1); }}><option value="railway">铁路方案优先，轨道作为备选</option><option value="sort">按所选排序统一比较</option></select></label>}</div>
      <RailResultControls filters={currentFilters} onChange={filter} trains={trains} count={sorted.length} multi railSegmentsOnly={!!result.urban}/>
      <p className="rail-transfer-help">总耗时包含乘车、等待与站群步行；总票价按所选席别逐程相加，“任意席别”取各程最低适用票价。余票按最少的一程排序，“有”表示未提供精确数量。未知价格排在已知总价之后。</p>
      {result.urban && <p className="rail-transfer-help">默认先显示铁路方案，各组内按所选条件排序；可切换为统一比较。城市轨道票价不明时，总价保持未知并单列铁路小计；余票和车型筛选只核验铁路程，轨道段没有实时余票，首末班与预估时间需另行确认。</p>}
      {details && details.done < details.total && <p className="rail-transfer-loading" role="status"><RefreshCw size={13} className="rail-spin"/> 正在补充车型及缺失票价：{details.done} / {details.total}；筛选结果会随资料更新。</p>}
      {result.warnings.length > 0 && <details className="rail-transfer-warnings" open={!result.trips.length}><summary>查询范围与未完成区间（{result.warnings.length}）</summary><ul>{result.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      {!shown.length ? <div className="rail-transfer-empty">{result.trips.length ? "没有符合当前车型或余票筛选的方案。" : result.serviceUnavailable ? "12306 暂时无法完成查询，请稍后重试；不能据此判断没有可行中转。" : "当前查询范围内暂无符合预留时间的方案，可调整时间或指定中转站。"}</div> : shown.map(trip => <article className="rail-trip" key={trip.id}>
        <header className="rail-trip-header"><div><strong>{hasUrban(trip) ? "预估行程 · " : ""}{chinaDateTime(trip.departureAt).replace("T", " ")} → {chinaDateTime(trip.arrivalAt).replace("T", " ")}</strong><span>{durationLabel(trip.duration)} · {trip.urbanOnly ? "纯轨道备选" : trip.legs.length === 1 ? "1 程铁路" : `${trip.legs.length - 1} 次铁路中转`}{hasUrban(trip) ? " · 含城市轨道（运营待确认）" : trip.connections.some(c => c.kind === "city") ? " · 含站外换乘" : ""}</span></div><div className="rail-trip-total"><strong>{money(tripFare(trip, seat))}</strong>{hasUrban(trip) && trip.legs.length > 0 && <span>铁路小计 {money(tripRailFare(trip, seat))} · 轨道费用未计</span>}<span>{!trip.legs.length ? "轨道班次及余票暂无实时数据" : tripSeats(trip, seat) > 0 ? hasUrban(trip) ? "铁路段有关注席别余票 · 轨道段待确认" : "全程有关注席别余票" : "部分铁路车次暂无关注席别余票"}</span></div></header>
        {trip.urbanOnly && <UrbanRailRoute route={trip.urbanOnly} title="城市轨道行程（备选）"/>}
        {trip.access && <div className="rail-trip-connection"><b>{trip.access.urban ? "出发轨道接驳" : "出发站群"}：{trip.access.from.name} → {trip.access.to.name}</b><span>至少预留 {trip.access.minimum} 分钟（含进站）</span>{trip.access.urban ? <UrbanRailRoute route={trip.access.urban}/> : <small>{trip.access.note}</small>}</div>}
        {trip.legs.map((leg, index) => <div className="rail-trip-leg-block" key={trainIdentity(leg)}>
          {index > 0 && <div className={`rail-trip-connection is-${trip.connections[index - 1].kind}`}><b>{trip.connections[index - 1].kind === "same" ? "同站换乘" : trip.connections[index - 1].kind === "walk" ? "相邻站群换乘" : trip.connections[index - 1].kind === "urban" ? "城市轨道接驳（备选）" : "站外换乘"}：{trip.connections[index - 1].from.name}{trip.connections[index - 1].from.code !== trip.connections[index - 1].to.code ? ` → ${trip.connections[index - 1].to.name}` : ""}</b><span>间隔 {(leg.departureAt - trip.legs[index - 1].arrivalAt) / 60000} 分钟 · 至少预留 {trip.connections[index - 1].minimum} 分钟</span>{trip.connections[index - 1].urban ? <UrbanRailRoute route={trip.connections[index - 1].urban!}/> : <small>{trip.connections[index - 1].note}</small>}</div>}
          <div className="rail-trip-leg"><div className="rail-trip-leg-title"><span>第 {index + 1} 程 · {leg.date}</span><div><strong>{leg.code}</strong><TrainIllustration model={leg.trainsetModel}/></div><p title={equipmentTitle(leg)}>{equipmentLabel(leg)}</p></div>
          <div className="rail-trip-leg-times"><div><strong>{leg.departure}</strong><span>{leg.from}</span></div><div className="rail-trip-leg-duration">{durationLabel(Math.round((leg.arrivalAt - leg.departureAt) / 60000))}<span>→</span></div><div><strong>{leg.arrival}</strong><span>{leg.to}</span>{chinaDateTime(leg.arrivalAt).slice(0, 10) !== leg.date && <small>{chinaDateTime(leg.arrivalAt).slice(0, 10)} 到达</small>}</div></div>
          <TrainFare train={leg} seat={seat}/><div className="rail-trip-seats">{leg.seats.filter(s => s.value !== "--").map(s => <span key={s.label} className={s.available ? "is-available" : ""}>{s.label} <b>{s.value}</b><small>{money(s.price)}{s.priceMax && s.price && s.priceMax > s.price ? `–${money(s.priceMax)}` : ""}</small></span>)}</div><div className="rail-trip-leg-links"><button type="button" onClick={() => onPosition(leg.code, leg.originDate || leg.date)}>位置 / 下一站</button><a href="https://www.12306.cn/" target="_blank" rel="noreferrer">前往 12306 <ExternalLink size={12}/></a></div></div>
        </div>)}
        {trip.egress && <div className="rail-trip-connection"><b>{trip.egress.urban ? "到达轨道接驳" : "到达站群"}：{trip.egress.from.name} → {trip.egress.to.name}</b><span>预估至少 {trip.egress.minimum} 分钟</span>{trip.egress.urban ? <UrbanRailRoute route={trip.egress.urban}/> : <small>{trip.egress.note}</small>}</div>}
      </article>)}
      {pages > 1 && <nav className="rail-trip-pagination" aria-label="中转结果分页"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pages} · 每页 20 个</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
      <p className="rail-transfer-help">已请求 {result.queryCount} 个区间，本次选取 {result.hubs.length} / {result.candidateCount} 个全国候选站 · {new Date(result.checkedAt).toLocaleString("zh-CN", { hour12: false })}。未完成区间见上方提示；本次结果不保证穷尽所有组合，可扩大范围或指定任意官方中转站补查，余票与检票截止以 12306 和车站现场为准。</p>
      {settings.allowUrban && <p className="rail-urban-credit">轨道网络数据 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a>；全国已收录线路，不保证无遗漏。</p>}
    </div>}
  </section>;
}
