import { ArrowLeft, Bell, BellOff, Clock3, ExternalLink, RefreshCw, TrainFront } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Station = { name: string; code: string; pinyin: string };
type Seat = { label: string; value: string; available: boolean };
type Train = {
  code: string; from: string; to: string; departure: string; arrival: string;
  duration: string; saleStatus: string; seats: Seat[]; trainsetModel: string | null;
};
type Result = { checkedAt: string; date: string; from: string; to: string; trains: Train[] };
type Settings = {
  date: string; from: string; to: string; train: string; seat: string;
  intervalMinutes: number; enabled: boolean;
};
type DesktopState = { settings: Settings; result: Result | null; error: string | null; checking: boolean };
type RailDesktop = {
  getState: () => Promise<DesktopState>;
  configure: (settings: Settings) => Promise<DesktopState>;
  checkNow: (settings: Settings) => Promise<Result>;
  stations: () => Promise<{ stations: Station[] }>;
  onUpdate: (listener: (state: DesktopState) => void) => () => void;
};

declare global { interface Window { railDesktop?: RailDesktop } }

const STORAGE_KEY = "yukino-rail-monitor-v1";
const DEFAULT_SETTINGS: Settings = {
  date: "", from: "", to: "", train: "", seat: "任意席别", intervalMinutes: 5, enabled: false,
};
const SEAT_OPTIONS = ["任意席别", "商务座", "特等座", "一等座", "二等座", "高级软卧", "软卧", "动卧", "硬卧", "软座", "硬座", "无座"];

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<Settings> | null;
    return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

function validSettings(settings: Settings) {
  return /^\d{4}-\d{2}-\d{2}$/.test(settings.date) && !!settings.from.trim() && !!settings.to.trim() &&
    settings.from.trim() !== settings.to.trim() && (!settings.train || /^[GDCZTKYS]\d{1,4}[A-Z]?$/i.test(settings.train.trim())) &&
    Number.isInteger(settings.intervalMinutes) && settings.intervalMinutes >= 1 && settings.intervalMinutes <= 60;
}

function matchingSeats(train: Train, seat: string) {
  return train.seats.filter((item) => item.available && (seat === "任意席别" || item.label === seat));
}

function formatCheckedAt(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function query(settings: Settings): Promise<Result> {
  const params = new URLSearchParams({ date: settings.date, from: settings.from.trim(), to: settings.to.trim() });
  if (settings.train.trim()) params.set("train", settings.train.trim().toUpperCase());
  return fetchJson<Result>(`/api/rail?${params}`);
}

function notifyAvailable(settings: Settings, train: Train, seats: Seat[]) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const detail = seats.map((seat) => `${seat.label} ${seat.value}`).join(" · ");
  const notification = new Notification(`${train.code} 有余票`, {
    body: `${settings.date} ${train.from} → ${train.to} · ${detail}`,
    tag: `yukino-rail-${settings.date}-${train.code}`,
  });
  notification.onclick = () => { window.focus(); window.open("https://www.12306.cn/", "_blank", "noopener,noreferrer"); };
}

export default function Rail() {
  useEffect(() => { document.title = "余票提醒 · Yukino"; }, []);
  const desktop = window.railDesktop;
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [stations, setStations] = useState<Station[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const availability = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const load = desktop ? desktop.stations() : fetchJson<{ stations: Station[] }>("/api/rail?mode=stations");
    load.then((data) => setStations(data.stations)).catch((cause) => setError(`车站列表加载失败：${String(cause)}`));
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onUpdate((state) => {
      setSettings(state.settings);
      setResult(state.result);
      setError(state.error);
      setChecking(state.checking);
    });
    desktop.getState().then((state) => {
      setSettings(state.settings);
      setResult(state.result);
      setError(state.error);
      setChecking(state.checking);
    }).catch((cause) => setError(String(cause)));
    return off;
  }, [desktop]);

  useEffect(() => {
    if (!desktop) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [desktop, settings]);

  const runCheck = useCallback(async (notify = false) => {
    if (!validSettings(settings)) { setError("请填写有效的日期、不同的出发站与到达站，以及 1–60 分钟的间隔"); return; }
    setChecking(true);
    setError(null);
    try {
      const next = desktop ? await desktop.checkNow(settings) : await query(settings);
      setResult(next);
      if (!desktop && notify) {
        const current: Record<string, boolean> = {};
        for (const train of next.trains) {
          const seats = matchingSeats(train, settings.seat);
          const key = `${settings.date}/${train.code}`;
          current[key] = seats.length > 0;
          if (seats.length && !availability.current[key]) notifyAvailable(settings, train, seats);
        }
        availability.current = current;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setChecking(false); }
  }, [desktop, settings]);

  useEffect(() => {
    if (desktop || !settings.enabled || !validSettings(settings)) return;
    void runCheck(true);
    const timer = window.setInterval(() => void runCheck(true), settings.intervalMinutes * 60000);
    return () => window.clearInterval(timer);
  }, [desktop, settings, runCheck]);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch, enabled: false };
    setSettings(next);
    availability.current = {};
    if (desktop) void desktop.configure(next).catch((cause) => setError(String(cause)));
  };

  const toggleMonitor = async () => {
    if (settings.enabled) {
      const next = { ...settings, enabled: false };
      setSettings(next);
      if (desktop) await desktop.configure(next);
      return;
    }
    if (!validSettings(settings)) { setError("先填写有效的日期、车站、车次和轮询间隔"); return; }
    if (!desktop && typeof Notification !== "undefined" && Notification.permission === "default") {
      setPermission(await Notification.requestPermission());
    }
    const next = { ...settings, train: settings.train.trim().toUpperCase(), enabled: true };
    setSettings(next);
    availability.current = {};
    if (desktop) {
      try { await desktop.configure(next); } catch (cause) { setError(String(cause)); }
    }
  };

  const knownStations = useMemo(() => new Set(stations.map((station) => station.name)), [stations]);
  const matched = result?.trains.filter((train) => matchingSeats(train, settings.seat).length > 0) || [];

  return (
    <div className="rail-page">
      <div className="rail-wrap">
        <div className="rail-topline">
          <a className="rail-home" href="https://www.yukino.bond/"><ArrowLeft size={15} /> 返回主页</a>
          <span className="rail-domain">cr.yukino.bond</span>
        </div>
        <header className="rail-hero">
          <div>
            <p className="eyebrow"><span className="status-dot" /> RAIL WATCH / 12306</p>
            <h1>余票提醒<span>.</span></h1>
            <p>选好日期、车站与意向车次。余票变化时，及时收到提醒。</p>
          </div>
          <div className="rail-hero-icon" aria-hidden="true"><TrainFront size={54} strokeWidth={1.25} /></div>
        </header>
        <div className="rail-layout">
          <section className="rail-card rail-form" aria-labelledby="rail-settings-title">
            <div className="rail-card-heading"><div><span className="rail-overline">01 / SEARCH</span><h2 id="rail-settings-title">查询条件</h2></div><span className="rail-small">数据来自 12306</span></div>
            <div className="rail-fields">
              <label>出行日期<input type="date" value={settings.date} onChange={(event) => update({ date: event.target.value })} /></label>
              <label>出发站<input list="rail-stations" placeholder="例如 北京南" value={settings.from} onChange={(event) => update({ from: event.target.value })} aria-invalid={!!settings.from && stations.length > 0 && !knownStations.has(settings.from)} /></label>
              <label>到达站<input list="rail-stations" placeholder="例如 上海虹桥" value={settings.to} onChange={(event) => update({ to: event.target.value })} aria-invalid={!!settings.to && stations.length > 0 && !knownStations.has(settings.to)} /></label>
              <label>车次 <small>可选</small><input type="text" placeholder="例如 G101" value={settings.train} onChange={(event) => update({ train: event.target.value.toUpperCase() })} /></label>
              <label>关注席别<select value={settings.seat} onChange={(event) => update({ seat: event.target.value })}>{SEAT_OPTIONS.map((seat) => <option key={seat}>{seat}</option>)}</select></label>
              <label>检查间隔 <small>1–60 分钟</small><div className="rail-interval"><input type="number" min="1" max="60" step="1" value={settings.intervalMinutes} onChange={(event) => update({ intervalMinutes: Number(event.target.value) })} /><span>分钟</span></div></label>
            </div>
            <datalist id="rail-stations">{stations.map((station) => <option key={station.code} value={station.name}>{station.pinyin}</option>)}</datalist>
            <div className="rail-actions">
              <button className="rail-primary" type="button" onClick={() => void runCheck(false)} disabled={checking}><RefreshCw size={17} className={checking ? "rail-spin" : ""} /> {checking ? "正在查询" : "立即查询"}</button>
              <button className={settings.enabled ? "rail-stop" : "rail-secondary"} type="button" onClick={() => void toggleMonitor()}>{settings.enabled ? <BellOff size={17} /> : <Bell size={17} />}{settings.enabled ? "停止监控" : "开启监控"}</button>
            </div>
            <p className="rail-hint">车站请选用 12306 站名，例如“北京南”。轮询间隔最短 1 分钟；余票以 12306 查询时返回的数据为准。</p>
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
          {!result ? <div className="rail-empty">还没有查询结果。填写日期与车站后点击“立即查询”。</div> : result.trains.length === 0 ? <div className="rail-empty">没有找到符合条件的车次。请检查日期、车站与车次。</div> :
            <div className="rail-trains">{result.trains.map((train) => {
              const available = matchingSeats(train, settings.seat);
              return <article className="rail-train" key={`${train.code}-${train.departure}`}>
                <div className="rail-train-main"><span className="rail-train-code">{train.code}</span><div className="rail-journey"><strong>{train.departure}</strong><span>{train.from}</span></div><div className="rail-route"><span>{train.duration}</span><i /></div><div className="rail-journey"><strong>{train.arrival}</strong><span>{train.to}</span></div><span className={available.length ? "rail-badge is-available" : "rail-badge"}>{available.length ? "有余票" : "暂无余票"}</span></div>
                <div className="rail-seats">{train.seats.filter((seat) => seat.value !== "--").map((seat) => <span className={seat.available ? "rail-seat is-available" : "rail-seat"} key={seat.label}>{seat.label} <strong>{seat.value}</strong></span>)}</div>
                <div className="rail-train-foot"><span>车型：{train.trainsetModel || "12306 未提供准确配属车型"}</span><a href="https://www.12306.cn/" target="_blank" rel="noreferrer">前往 12306 <ExternalLink size={13} /></a></div>
              </article>;
            })}</div>}
        </section>
        <p className="rail-disclaimer">本工具仅展示公开查询结果，不提供购票或抢票。车票状态会随时变化，最终以 12306 官网为准。</p>
      </div>
    </div>
  );
}
