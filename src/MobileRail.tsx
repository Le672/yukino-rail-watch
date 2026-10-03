import { Bell, BellOff, MapPin, RefreshCw, Ticket, Info, ExternalLink, ArrowRightLeft } from "lucide-react";
import { useState } from "react";
import { useRailMonitor, SEAT_OPTIONS, matchingSeats, formatCheckedAt } from "./hooks/useRailMonitor";
import { RailPosition } from "./components/RailPosition";
import { TrainIllustration } from "./components/TrainIllustration";
import { mobileMonitor, mobilePlatform } from "./mobile/mobile-bridge";
import { RailTransfer } from "./components/RailTransfer";
import { RailResultControls, TrainFare, useTrainListing } from "./components/RailResultControls";
import { money } from "./lib/rail-tickets";
import mobileVersion from "../mobile-version.json";

export default function MobileRail() {
  const { settings, update, stations, result, error, checking, matched, runCheck, toggleMonitor, positionSelection, setPositionSelection } = useRailMonitor(mobileMonitor);
  const [tab, setTab] = useState<"tickets" | "transfer" | "position" | "about">("tickets");
  const { filters, setFilters, visibleTrains } = useTrainListing(result?.trains, settings.seat);
  const background = mobilePlatform === "android" ? `后台最短约 ${Math.max(15, settings.intervalMinutes)} 分钟检查，系统省电可能延迟。` : mobilePlatform === "ios" ? "后台由 iOS 决定检查时间，不能保证每分钟执行；强制退出后不会继续检查。" : "界面预览：网页打开时检查，原生安装后使用手机通知。";
  return <div className="mobile-app">
    <header className="mobile-header"><div><img src="./rail-icon.png" width={40} height={40} alt=""/><span><strong>Yukino 余票</strong><small>{tab === "transfer" ? "中转行程与站群换乘" : tab === "position" ? "列车位置与下一站" : tab === "about" ? "使用说明与隐私" : "查询与到票提醒"}</small></span></div><span className={settings.enabled ? "mobile-running" : "mobile-idle"}>{settings.enabled ? "监控中" : "未监控"}</span></header>
    <main className="mobile-content">
      <div hidden={tab !== "tickets"}>
        <section className="mobile-panel"><h1>查询余票</h1><div className="mobile-modes" role="group" aria-label="查询方式"><button aria-pressed={settings.queryMode === "train"} onClick={() => update({ queryMode: "train" })}>按车次</button><button aria-pressed={settings.queryMode === "route"} onClick={() => update({ queryMode: "route" })}>按区间</button></div>
          <form onSubmit={event => { event.preventDefault(); void runCheck(); }}><div className="mobile-fields"><label>出行日期<input type="date" required value={settings.date} onChange={event => update({ date: event.target.value })}/></label>
            {settings.queryMode === "train" ? <label>车次<input required placeholder="G101 / K123 / 1461" value={settings.train} onChange={event => update({ train: event.target.value.toUpperCase() })}/></label> : <><label>出发站<input list="mobile-stations" required placeholder="广州南" value={settings.from} onChange={event => update({ from: event.target.value })}/></label><label>到达站<input list="mobile-stations" required placeholder="香港西九龙" value={settings.to} onChange={event => update({ to: event.target.value })}/></label></>}
            <label>关注席别<select value={settings.seat} onChange={event => update({ seat: event.target.value })}>{SEAT_OPTIONS.map(seat => <option key={seat}>{seat}</option>)}</select></label><label>前台间隔（分钟）<input type="number" min="1" max="60" required value={settings.intervalMinutes} onChange={event => update({ intervalMinutes: Number(event.target.value) })}/></label></div><datalist id="mobile-stations">{stations.map(station => <option value={station.name} key={station.code}>{station.pinyin}</option>)}</datalist>
            <div className="mobile-actions"><button type="submit" className="mobile-primary" disabled={checking}><RefreshCw size={16} className={checking ? "rail-spin" : ""}/>{checking ? "正在查询" : "立即查询"}</button><button type="button" className="mobile-secondary" onClick={() => void toggleMonitor()}>{settings.enabled ? <BellOff size={16}/> : <Bell size={16}/>}{settings.enabled ? "停止监控" : "开启监控"}</button></div></form>
          <p className="mobile-hint">{settings.queryMode === "train" ? "车次查询显示全程余票，中途乘车请切换区间查询。" : "使用 12306 站名，修改条件会停止当前监控。"}</p>
        </section>
        <section className="mobile-monitor" aria-label="监控状态"><strong><Bell size={15}/>{settings.enabled ? "到票提醒已开启" : "到票提醒未开启"}</strong><p>前台每 {settings.intervalMinutes} 分钟检查。{background}</p><small>最近检查：{result ? formatCheckedAt(result.checkedAt) : "尚未查询"}</small></section>
        {error && <div className="rail-error" role="alert">{error}</div>}
        <div className="mobile-results-heading"><h2>车次结果</h2><span>{result ? `${result.trains.length} 趟 · ${matched.length} 趟有票` : "等待查询"}</span></div>
        {result && <p className="mobile-route">{result.date} · {result.from} → {result.to}</p>}
        {result && result.trains.length > 0 && <RailResultControls filters={filters} onChange={setFilters} trains={result.trains} count={visibleTrains.length}/>}
        {!result || !visibleTrains.length ? <div className="mobile-empty">{result ? "未找到符合条件的车次，请检查日期和站名。" : "输入车次或区间，即可查看余票和车型。"}</div> : visibleTrains.map(train => <article className="mobile-train" key={`${train.code}-${train.departure}`}><div className="mobile-train-title"><strong>{train.code}</strong><TrainIllustration model={train.trainsetModel}/><span className={matchingSeats(train, settings.seat).length ? "mobile-available" : "mobile-unavailable"}>{matchingSeats(train, settings.seat).length ? "有余票" : "暂无余票"}</span></div><div className="mobile-journey"><div><strong>{train.departure}</strong><span>{train.from}</span></div><span>{train.duration}<i>→</i></span><div><strong>{train.arrival}</strong><span>{train.to}</span></div></div><div className="mobile-seats">{train.seats.filter(seat => seat.value !== "--").map(seat => <span key={seat.label} className={seat.available ? "is-available" : ""}>{seat.label} <b>{seat.value}</b>{seat.price != null && <small>{money(seat.price)}</small>}</span>)}</div><p className="mobile-model">{train.trainsetModel || "车型暂无资料"}{train.trainsetOwner && ` · ${train.trainsetOwner}`}</p><TrainFare train={train} seat={settings.seat}/><div className="mobile-train-links"><button onClick={() => { setPositionSelection({ train: train.code, date: train.originDate || result.date }); setTab("position"); }}>位置 / 下一站</button><a href="https://www.12306.cn/">12306 <ExternalLink size={12}/></a></div></article>)}
      </div>
      {tab === "transfer" && <RailTransfer stations={stations} onPosition={(train, date) => { setPositionSelection({ train, date }); setTab("position"); }}/>}
      {tab === "position" && <RailPosition initialTrain={positionSelection.train} initialDate={positionSelection.date} key={`${positionSelection.train}/${positionSelection.date}`}/>}
      {tab === "about" && <section className="mobile-panel mobile-about"><h1>使用说明</h1><p>本应用展示公开余票信息，不登录 12306，不提供购票或抢票。余票以 12306 实际查询结果为准。</p><h2>到票提醒</h2><p>首次开启监控会提醒当前有票的车次；之后仅在所选席别从无票变为有票时提醒。修改条件会停止监控。{background}</p><h2>定位与测速</h2><p>乘坐所选车次时再开启 GPS。只在当前页面显示时读取位置，切到后台会暂停；定位和速度在设备上计算，不上传位置历史。无有效 GPS 时显示标明来源的时刻表预估。</p><h2>隐私与支持</h2><p>查询设置和最近结果保存在本机。车次、日期及区间会发给查询服务；地图供应商会接收瓦片视野请求。没有广告、账号和统计 SDK。</p><a href="https://cr.yukino.bond/rail-privacy.html">查看完整隐私政策 ↗</a><a href="https://github.com/Le672/yukino-rail-watch/issues">反馈问题 ↗</a><small>手机版 {mobileVersion.version} · Android / iOS</small></section>}
      <a className="mobile-source" href="https://api.railgo.dev/"><strong>RailGo Data Service ↗</strong><span>车型、配属与铁路坐标补充服务</span></a>
    </main>
    <nav className="mobile-tabs" aria-label="手机功能"><button aria-pressed={tab === "tickets"} onClick={() => setTab("tickets")}><Ticket size={21}/>余票</button><button aria-pressed={tab === "transfer"} onClick={() => setTab("transfer")}><ArrowRightLeft size={21}/>中转</button><button aria-pressed={tab === "position"} onClick={() => setTab("position")}><MapPin size={21}/>位置</button><button aria-pressed={tab === "about"} onClick={() => setTab("about")}><Info size={21}/>说明</button></nav>
  </div>;
}
