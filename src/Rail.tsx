import { ArrowLeft, Bell, BellOff, Clock3, ExternalLink, RefreshCw, TrainFront } from "lucide-react";
import { TrainIllustration } from "./components/TrainIllustration";
import { RailPosition } from "./components/RailPosition";
import { useRailMonitor, SEAT_OPTIONS, matchingSeats, formatCheckedAt } from "./hooks/useRailMonitor";

export default function Rail() {
  const { desktop, settings, stations, result, error, checking, feature, setFeature, positionSelection, setPositionSelection, permission, knownStations, matched, update, runCheck, toggleMonitor } = useRailMonitor();
  return (
    <div className="rail-page">
      <div className="rail-wrap">
        <div className="rail-topline">
          <a className="rail-home" href="https://www.yukino.bond/" target="_blank" rel="noreferrer"><ArrowLeft size={15} /> 返回主页</a>
          <span className="rail-domain">cr.yukino.bond</span>
        </div>
        <header className="rail-hero">
          <div>
            <p className="eyebrow"><span className="status-dot" /> RAIL WATCH / 12306</p>
            <h1>余票提醒<span>.</span></h1>
            <p>查询余票、查看列车运行区间与下一停靠站。余票变化时，及时收到提醒。</p>
          </div>
          <div className="rail-hero-icon" aria-hidden="true"><TrainFront size={54} strokeWidth={1.25} /></div>
        </header>
        <div className="rail-feature-tabs" role="group" aria-label="功能选择">
          <button type="button" aria-pressed={feature === "tickets"} onClick={() => setFeature("tickets")}>余票查询与监控</button>
          <button type="button" aria-pressed={feature === "position"} onClick={() => setFeature("position")}>列车位置与下一站</button>
        </div>
        <div hidden={feature !== "tickets"}>
        <div className="rail-layout">
          <section className="rail-card rail-form" aria-labelledby="rail-settings-title">
            <div className="rail-card-heading"><div><span className="rail-overline">01 / SEARCH</span><h2 id="rail-settings-title">查询条件</h2></div><span className="rail-small">数据来自 12306</span></div>
            <div className="rail-search-modes" role="group" aria-label="查询方式">
              <button type="button" aria-pressed={settings.queryMode === "train"} onClick={() => update({ queryMode: "train" })}>按车次查询</button>
              <button type="button" aria-pressed={settings.queryMode === "route"} onClick={() => update({ queryMode: "route" })}>按区间查询</button>
            </div>
            <p className="rail-search-help">{settings.queryMode === "train" ? "只需输入车次，自动识别该日期的始发和终到站，查询全程余票。" : "只需选择出发站和到达站，查询该区间全部车次，无需填写车次。"}</p>
            <div className="rail-fields">
              <label className={settings.queryMode === "route" ? "rail-date" : undefined}>出行日期<input type="date" value={settings.date} onChange={(event) => update({ date: event.target.value })} /></label>
              {settings.queryMode === "train" ?
                <label>车次<input type="text" placeholder="例如 G101 或 1461" value={settings.train} onChange={(event) => update({ train: event.target.value.toUpperCase() })} /></label> : <>
                  <label>出发站<input list="rail-stations" placeholder="例如 北京南" value={settings.from} onChange={(event) => update({ from: event.target.value })} aria-invalid={!!settings.from && stations.length > 0 && !knownStations.has(settings.from)} /></label>
                  <label>到达站<input list="rail-stations" placeholder="例如 上海虹桥" value={settings.to} onChange={(event) => update({ to: event.target.value })} aria-invalid={!!settings.to && stations.length > 0 && !knownStations.has(settings.to)} /></label>
                </>}
              <label>关注席别<select value={settings.seat} onChange={(event) => update({ seat: event.target.value })}>{SEAT_OPTIONS.map((seat) => <option key={seat}>{seat}</option>)}</select></label>
              <label><span className="rail-field-heading">检查间隔 <small>1–60 分钟</small></span><div className="rail-interval"><input type="number" min="1" max="60" step="1" value={settings.intervalMinutes} onChange={(event) => update({ intervalMinutes: Number(event.target.value) })} /><span>分钟</span></div></label>
            </div>
            <datalist id="rail-stations">{stations.map((station) => <option key={station.code} value={station.name}>{station.pinyin}</option>)}</datalist>
            <div className="rail-actions">
              <button className="rail-primary" type="button" onClick={() => void runCheck(false)} disabled={checking}><RefreshCw size={17} className={checking ? "rail-spin" : ""} /> {checking ? "正在查询" : "立即查询"}</button>
              <button className={settings.enabled ? "rail-stop" : "rail-secondary"} type="button" onClick={() => void toggleMonitor()}>{settings.enabled ? <BellOff size={17} /> : <Bell size={17} />}{settings.enabled ? "停止监控" : "开启监控"}</button>
            </div>
            <p className="rail-hint">{settings.queryMode === "train" ? "全程余票表示始发站到终到站；查询中途乘车余票请切换到区间查询。" : "车站请选用 12306 站名，例如“北京南”。"}轮询间隔最短 1 分钟；余票以 12306 查询时返回的数据为准。</p>
          </section>
          <aside className="rail-card rail-status" aria-label="监控状态">
            <span className="rail-overline">02 / MONITOR</span>
            <div className="rail-status-icon">{settings.enabled ? <Bell size={25} /> : <Clock3 size={25} />}</div>
            <h2>{settings.enabled ? "正在监控" : "等待开始"}</h2>
            <p>{settings.enabled ? `每 ${settings.intervalMinutes} 分钟检查一次` : "填写条件后开启余票监控"}</p>
            <div className="rail-status-meta"><span>通知方式</span><strong>{desktop ? "Windows 系统通知" : permission === "granted" ? "浏览器系统通知" : "需允许浏览器通知"}</strong></div>
            <div className="rail-status-meta"><span>最近检查</span><strong>{result ? formatCheckedAt(result.checkedAt) : "尚未查询"}</strong></div>
            <p className="rail-note">{desktop ? "关闭窗口后会留在系统托盘继续监控。" : "网页监控需要保持此页面打开；浏览器休眠时检查可能延迟。"}</p>
          </aside>
        </div>
        {error && <div className="rail-error" role="alert">查询失败：{error}</div>}
        <section className="rail-results" aria-labelledby="rail-results-title">
          <div className="rail-section-heading"><div><span className="rail-overline">03 / RESULTS</span><h2 id="rail-results-title">查询结果</h2></div>{result && <span>{result.trains.length} 趟车 · {matched.length} 趟有关注席别余票</span>}</div>
          {result && <p className="rail-result-route">{result.date} · {result.from} → {result.to}{result.queryMode === "train" ? " · 全程余票" : ""}</p>}
          {!result ? <div className="rail-empty">还没有查询结果。填写车次或乘车区间后点击“立即查询”。</div> : result.trains.length === 0 ? <div className="rail-empty">没有找到符合条件的余票数据。请检查日期，或前往 12306 查看开行情况。</div> :
            <div className="rail-trains">{result.trains.map((train) => {
              const available = matchingSeats(train, settings.seat);
              return <article className="rail-train" key={`${train.code}-${train.departure}`}>
                <div className="rail-train-main"><div className="rail-train-identity"><span className="rail-train-code">{train.code}</span><TrainIllustration model={train.trainsetModel} /></div><div className="rail-journey"><strong>{train.departure}</strong><span>{train.from}</span></div><div className="rail-route"><span>{train.duration}</span><i /></div><div className="rail-journey"><strong>{train.arrival}</strong><span>{train.to}</span></div><span className={available.length ? "rail-badge is-available" : "rail-badge"}>{available.length ? "有余票" : "暂无余票"}</span></div>
                <div className="rail-seats">{train.seats.filter((seat) => seat.value !== "--").map((seat) => <span className={seat.available ? "rail-seat is-available" : "rail-seat"} key={seat.label}>{seat.label} <strong>{seat.value}</strong></span>)}</div>
                <div className="rail-train-foot"><span>车型：{train.trainsetModel || "暂无可核实资料"}{train.trainsetOwner ? ` · 配属 ${train.trainsetOwner}` : ""}</span><div className="rail-train-links"><button type="button" onClick={() => { setPositionSelection({ train: train.code, date: result.date }); setFeature("position"); }}>位置／下一站</button><a href="https://www.12306.cn/" target="_blank" rel="noreferrer">前往 12306 <ExternalLink size={13} /></a></div></div>
              </article>;
            })}</div>}
        </section>
        </div>
        {feature === "position" && <RailPosition key={`${positionSelection.train}/${positionSelection.date}`} initialTrain={positionSelection.train} initialDate={positionSelection.date} />}
        <p className="rail-disclaimer">本工具仅展示公开查询结果，不提供购票或抢票。车票状态会随时变化，最终以 12306 官网为准。</p>
        <a className="rail-attribution" href="https://api.railgo.dev/" target="_blank" rel="noreferrer" aria-label="车型、时刻表与线路数据来源：RailGo 数据服务（打开数据服务文档）">
          <span className="rail-attribution-main">
            <span className="rail-attribution-icon" aria-hidden="true"><TrainFront size={28} strokeWidth={1.4} /></span>
            <span className="rail-attribution-copy"><strong>RailGo Data Service</strong><span>api.railgo.dev</span></span>
            <ExternalLink className="rail-attribution-external" size={17} aria-hidden="true" />
          </span>
          <span className="rail-attribution-caption">车型、时刻表、线路与正晚点数据由 RailGo 数据服务提供</span>
        </a>
        <footer className="rail-site-footer" role="contentinfo" aria-label="Yukino 页脚">
          <div className="rail-site-footer-main">
            <div className="rail-site-footer-brand"><a className="footer-brand" href="https://www.yukino.bond/" target="_blank" rel="noreferrer">Yukino.</a><span>慢慢写，慢慢长。</span></div>
            <nav aria-label="页脚导航">
              <a href="https://github.com/Le672" target="_blank" rel="noreferrer">GitHub ↗</a>
              <a href="mailto:Raptor@yukino.bond" target="_blank" rel="noreferrer">邮件 ↗</a>
              <a href="https://www.yukino.bond/changelog" target="_blank" rel="noreferrer">更新日志</a>
              <a href="https://www.yukino.bond/rss" target="_blank" rel="noreferrer">订阅</a>
            </nav>
          </div>
          <div className="rail-site-footer-caption">© {new Date().getFullYear()} Yukino</div>
        </footer>
      </div>
    </div>
  );
}
