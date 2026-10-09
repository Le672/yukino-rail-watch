import { Bell, BellOff, MapPin, RefreshCw, Ticket, TrainFront, ExternalLink, ArrowRightLeft, Monitor } from "lucide-react";
import { StationBoard } from "./components/StationBoard";
import { RailPosition } from "./components/RailPosition";
import { TrainIllustration } from "./components/TrainIllustration";
import { RailTransfer } from "./components/RailTransfer";
import { RailResultControls, TrainFare, useTrainListing } from "./components/RailResultControls";
import { money } from "./lib/rail-tickets";
import { equipmentLabel, equipmentTitle } from "./lib/rail-equipment";
import { useRailMonitor, SEAT_OPTIONS, matchingSeats, formatCheckedAt } from "./hooks/useRailMonitor";

export default function DesktopRail() {
  const { desktop, settings, stations, knownStations, result, error, checking, matched, update, runCheck, toggleMonitor, feature, setFeature, positionSelection, setPositionSelection } = useRailMonitor();
  const { filters, setFilters, visibleTrains } = useTrainListing(result?.trains, settings.seat);
  return <div className="desktop-app">
    <header className="desktop-header"><div className="desktop-brand"><img src="./rail-icon.png" width={34} height={34} alt="" aria-hidden="true" /><div><strong>Yukino Rail Watch</strong><span>Windows 余票与行程工具</span></div></div><span className="desktop-connection"><i />{desktop ? "已连接桌面服务" : "桌面界面预览"}</span></header>
    <div className="desktop-workspace">
      <nav className="desktop-nav" aria-label="桌面功能"><button aria-pressed={feature === "tickets"} onClick={() => setFeature("tickets")}><Ticket size={19} />余票监控</button><button aria-pressed={feature === "transfer"} onClick={() => setFeature("transfer")}><ArrowRightLeft size={19}/>中转行程</button><button aria-pressed={feature === "position"} onClick={() => setFeature("position")}><MapPin size={19} />列车位置</button><button aria-pressed={feature === "board"} onClick={() => setFeature("board")}><Monitor size={19}/>车站大屏</button><span>关闭窗口可留在托盘<br />退出请使用托盘菜单</span></nav>
      <main className="desktop-main">
        <div className="desktop-title"><h1>{feature === "tickets" ? "余票监控" : feature === "transfer" ? "中转行程" : feature === "board" ? "车站大屏" : "列车位置"}</h1><span>{feature === "tickets" ? "12306 查询 · Windows 通知" : feature === "transfer" ? "站群换乘 · 多程车次 · 官方票价" : feature === "board" ? "全国车站 · 到发信息 · 全屏展示" : "设备定位 · 下一站 · 实时 / 预估速度"}</span></div>
        <div hidden={feature !== "tickets"} className="desktop-ticket-workspace">
          <section className="desktop-query" aria-label="查询条件">
            <div className="desktop-query-modes" role="group" aria-label="查询方式"><button aria-pressed={settings.queryMode === "train"} onClick={() => update({ queryMode: "train" })}>按车次</button><button aria-pressed={settings.queryMode === "route"} onClick={() => update({ queryMode: "route" })}>按区间</button><span>{settings.queryMode === "train" ? "输入车次即可查询全程余票" : "输入两站即可查询区间全部车次"}</span></div>
            <form onSubmit={(event) => { event.preventDefault(); void runCheck(false); }}>
              <div className={`desktop-fields ${settings.queryMode === "route" ? "is-route" : ""}`}>
                <label>出行日期<input type="date" required value={settings.date} onChange={(event) => update({ date: event.target.value })} /></label>
                {settings.queryMode === "train" ? <label>车次<input placeholder="G101 / K123 / 1461" required value={settings.train} onChange={(event) => update({ train: event.target.value.toUpperCase() })} /></label> : <><label>出发站<input list="desktop-stations" required value={settings.from} placeholder="北京南" aria-invalid={!!settings.from && stations.length > 0 && !knownStations.has(settings.from)} onChange={(event) => update({ from: event.target.value })} /></label><label>到达站<input list="desktop-stations" required value={settings.to} placeholder="上海虹桥" aria-invalid={!!settings.to && stations.length > 0 && !knownStations.has(settings.to)} onChange={(event) => update({ to: event.target.value })} /></label></>}
                <label>关注席别<select value={settings.seat} onChange={(event) => update({ seat: event.target.value })}>{SEAT_OPTIONS.map((seat) => <option key={seat}>{seat}</option>)}</select></label>
                <label>检查间隔（分钟）<input type="number" min="1" max="60" step="1" required value={settings.intervalMinutes} onChange={(event) => update({ intervalMinutes: Number(event.target.value) })} /></label>
              </div>
              <datalist id="desktop-stations">{stations.map((station) => <option key={station.code} value={station.name}>{station.pinyin}</option>)}</datalist>
              <div className="desktop-query-actions"><button className="desktop-primary" disabled={checking} type="submit"><RefreshCw size={15} className={checking ? "rail-spin" : ""} />{checking ? "正在查询" : "立即查询"}</button><button className={settings.enabled ? "desktop-danger" : "desktop-secondary"} type="button" onClick={() => void toggleMonitor()}>{settings.enabled ? <BellOff size={15} /> : <Bell size={15} />}{settings.enabled ? "停止监控" : "开启监控"}</button><span>修改查询条件会停止当前监控</span></div>
            </form>
          </section>
          {error && <div className="rail-error" role="alert">{error}</div>}
          <div className="desktop-results-layout">
            <section className="desktop-results" aria-labelledby="desktop-results-title"><div className="desktop-panel-heading"><h2 id="desktop-results-title">车次列表</h2><span>{result ? `${result.trains.length} 趟 · ${matched.length} 趟有关注席别余票` : "等待查询"}</span></div>
              {result && <p className="desktop-route">{result.date}　{result.from} → {result.to}{result.queryMode === "train" ? " · 全程余票" : ""}</p>}
              {result && result.trains.length > 0 && <RailResultControls filters={filters} onChange={setFilters} trains={result.trains} count={visibleTrains.length}/>}
              {!result || !visibleTrains.length ? <div className="desktop-empty"><TrainFront size={32} strokeWidth={1.3} /><strong>{result ? "没有找到符合条件的车次" : "输入查询条件开始"}</strong><span>{result ? "请检查日期、站名与筛选条件。" : "按车次或区间查询，结果将在此表格显示。"}</span></div> : <div className="desktop-table-scroll"><table className="desktop-trains"><thead><tr><th scope="col">车次 / 车型</th><th scope="col">出发 / 到达</th><th scope="col">历时 / 票价</th><th scope="col">席别余票</th><th scope="col">操作</th></tr></thead><tbody>{visibleTrains.map((train) => <tr key={`${train.code}-${train.departure}`}>
                <td><div className="desktop-train-identity"><strong>{train.code}</strong><TrainIllustration model={train.trainsetModel} /></div><span className="desktop-model" title={equipmentTitle(train)}>{equipmentLabel(train)}</span></td>
                <td className="desktop-timing"><div><strong>{train.departure}</strong><span>{train.from}</span></div><div><strong>{train.arrival}</strong><span>{train.to}</span></div></td><td className="desktop-duration">{train.duration}<TrainFare train={train} seat={settings.seat}/></td>
                <td><div className="desktop-seat-list">{train.seats.filter((seat) => seat.value !== "--").map((seat) => <span key={seat.label} className={seat.available ? "is-available" : ""}>{seat.label} <b>{seat.value}</b>{seat.price != null && <small>{money(seat.price)}</small>}</span>)}</div><span className="desktop-availability">{matchingSeats(train, settings.seat).length ? "有关注席别余票" : "暂无关注席别余票"}</span></td>
                <td><div className="desktop-row-actions"><button onClick={() => { setPositionSelection({ train: train.code, date: train.originDate || result.date }); setFeature("position"); }}>位置 / 下一站</button><a href="https://www.12306.cn/" target="_blank" rel="noreferrer">12306 <ExternalLink size={11} /></a></div></td>
              </tr>)}</tbody></table></div>}
            </section>
            <aside className="desktop-monitor" aria-label="监控状态"><div className="desktop-panel-heading"><h2>监控状态</h2><Bell size={16} /></div><div className={`desktop-monitor-state ${settings.enabled ? "is-active" : ""}`}><i /><strong>{settings.enabled ? "监控运行中" : "监控未开启"}</strong></div><dl><div><dt>检查频率</dt><dd>每 {settings.intervalMinutes} 分钟</dd></div><div><dt>关注席别</dt><dd>{settings.seat}</dd></div><div><dt>通知方式</dt><dd>Windows 系统通知</dd></div><div><dt>最近检查</dt><dd>{result ? formatCheckedAt(result.checkedAt) : "尚未查询"}</dd></div></dl><p>开启后由桌面后台定时查询。关闭窗口仍继续监控，有余票时通过系统通知提醒。</p><a className="desktop-source" href="https://api.railgo.dev/" target="_blank" rel="noreferrer"><TrainFront size={17} /><span><strong>RailGo Data Service</strong><small>仅补充缺失车型与铁路坐标</small></span><ExternalLink size={12} /></a></aside>
          </div>
        </div>
        {feature === "board" && <StationBoard stations={stations} onPosition={(train, date) => { setPositionSelection({ train, date, autoQuery: true }); setFeature("position"); }}/>}
        {feature === "transfer" && <RailTransfer stations={stations} onPosition={(train, date) => { setPositionSelection({ train, date }); setFeature("position"); }}/>}
        {feature === "position" && <div className="desktop-position"><RailPosition key={`${positionSelection.train}/${positionSelection.date}`} initialTrain={positionSelection.train} initialDate={positionSelection.date} autoQuery={positionSelection.autoQuery} /><a className="desktop-position-source" href="https://api.railgo.dev/" target="_blank" rel="noreferrer">车型优先来自 12306；缺失资料与铁路坐标由 RailGo 补充 ↗</a></div>}
      </main>
    </div>
    <footer className="desktop-statusbar"><span><i className={settings.enabled ? "is-active" : ""} />{checking ? "查询中…" : settings.enabled ? `后台监控 · ${settings.intervalMinutes} 分钟` : "就绪"}</span><span>余票、票价与到发信息来自 12306 · 铁路网由本站缓存</span><span>v1.10.7</span></footer>
  </div>;
}
