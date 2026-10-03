import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enrichWithRailGo } from "../lib/railgo";

export type Station = { name: string; code: string; pinyin: string };
export type Seat = { label: string; value: string; available: boolean };
export type Train = {
  code: string; from: string; to: string; departure: string; arrival: string;
  duration: string; saleStatus: string; seats: Seat[]; trainsetModel: string | null; trainsetOwner?: string | null;
};
type QueryMode = "train" | "route";
export type Result = { checkedAt: string; date: string; from: string; to: string; fromCode?: string; toCode?: string; queryMode?: QueryMode; trains: Train[]; modelCheckedAt?: string | null };
export type Settings = {
  queryMode: QueryMode;
  date: string; from: string; to: string; train: string; seat: string;
  intervalMinutes: number; enabled: boolean;
};
export type DesktopState = { settings: Settings; result: Result | null; error: string | null; checking: boolean };
export type RailDesktop = {
  getState: () => Promise<DesktopState>;
  configure: (settings: Settings) => Promise<DesktopState>;
  checkNow: (settings: Settings) => Promise<Result>;
  stations: () => Promise<{ stations: Station[] }>;
  onUpdate: (listener: (state: DesktopState) => void) => () => void;
};

declare global { interface Window { railDesktop?: RailDesktop } }

const STORAGE_KEY = "yukino-rail-monitor-v1";
const DEFAULT_SETTINGS: Settings = {
  queryMode: "train", date: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
  from: "", to: "", train: "", seat: "任意席别", intervalMinutes: 5, enabled: false,
};
export const SEAT_OPTIONS = ["任意席别", "商务座", "特等座", "一等座", "二等座", "高级软卧", "软卧", "动卧", "硬卧", "软座", "硬座", "无座"];

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<Settings> | null;
    return saved ? {
      ...DEFAULT_SETTINGS, ...saved,
      date: saved.date || DEFAULT_SETTINGS.date,
      queryMode: saved.queryMode === "train" || saved.queryMode === "route" ? saved.queryMode : saved.from || saved.to ? "route" : "train",
      enabled: saved.queryMode ? Boolean(saved.enabled) : false,
    } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

function validSettings(settings: Settings) {
  const queryValid = settings.queryMode === "train"
    ? /^(?:[GDCZTKYS]\d{1,4}[A-Z]?|\d{4})$/i.test(settings.train.trim())
    : settings.queryMode === "route" && !!settings.from.trim() && !!settings.to.trim() && settings.from.trim() !== settings.to.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(settings.date) && queryValid &&
    Number.isInteger(settings.intervalMinutes) && settings.intervalMinutes >= 1 && settings.intervalMinutes <= 60;
}

export function matchingSeats(train: Train, seat: string) {
  return train.seats.filter((item) => item.available && (seat === "任意席别" || item.label === seat));
}

export function formatCheckedAt(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function query(settings: Settings): Promise<Result> {
  const params = new URLSearchParams({ date: settings.date, search: settings.queryMode });
  if (settings.queryMode === "train") params.set("train", settings.train.trim().toUpperCase());
  else { params.set("from", settings.from.trim()); params.set("to", settings.to.trim()); }
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

export function useRailMonitor(desktop = window.railDesktop) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [stations, setStations] = useState<Station[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [feature, setFeature] = useState<"tickets" | "position">("tickets");
  const [positionSelection, setPositionSelection] = useState<{ train: string; date?: string }>({ train: "" });
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const availability = useRef<Record<string, boolean>>({});
  const requestGeneration = useRef(0);

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

  useEffect(() => {
    if (!desktop || !result || result.modelCheckedAt) return;
    let active = true;
    void enrichWithRailGo(result).then((next) => { if (active) setResult(next); });
    return () => { active = false; };
  }, [desktop, result]);

  const runCheck = useCallback(async (notify = false) => {
    if (!validSettings(settings)) { setError("请填写有效日期和 1–60 分钟的间隔；按车次填车次，按区间填两个不同的车站"); return; }
    const generation = ++requestGeneration.current;
    setChecking(true);
    setError(null);
    try {
      const next = desktop ? await desktop.checkNow(settings) : await query(settings);
      if (generation !== requestGeneration.current) return;
      setResult(next);
      if (!desktop) void enrichWithRailGo(next).then(enriched => {
        if (generation === requestGeneration.current) setResult(enriched);
      });
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
      if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (generation === requestGeneration.current) setChecking(false); }
  }, [desktop, settings]);

  useEffect(() => {
    if (desktop || !settings.enabled || !validSettings(settings)) return;
    void runCheck(true);
    const timer = window.setInterval(() => void runCheck(true), settings.intervalMinutes * 60000);
    return () => window.clearInterval(timer);
  }, [desktop, settings, runCheck]);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch, enabled: false };
    requestGeneration.current++;
    setSettings(next);
    setResult(null);
    setError(null);
    setChecking(false);
    availability.current = {};
    if (desktop) void desktop.configure(next).catch((cause) => setError(String(cause)));
  };

  const toggleMonitor = async () => {
    if (settings.enabled) {
      const next = { ...settings, enabled: false };
      setSettings(next);
      if (desktop) {
        try { await desktop.configure(next); }
        catch (cause) { setSettings(settings); setError(cause instanceof Error ? cause.message : String(cause)); }
      }
      return;
    }
    if (!validSettings(settings)) { setError("先选择查询方式，填写日期及车次或乘车区间，并设置 1–60 分钟的间隔"); return; }
    if (!desktop && typeof Notification !== "undefined" && Notification.permission === "default") {
      setPermission(await Notification.requestPermission());
    }
    const next = { ...settings, train: settings.train.trim().toUpperCase(), enabled: true };
    setSettings(next);
    availability.current = {};
    if (desktop) {
      try { await desktop.configure(next); } catch (cause) { setSettings({ ...settings, enabled: false }); setError(cause instanceof Error ? cause.message : String(cause)); }
    }
  };

  const knownStations = useMemo(() => new Set(stations.map((station) => station.name)), [stations]);
  const matched = result?.trains.filter((train) => matchingSeats(train, settings.seat).length > 0) || [];

  return { desktop, settings, stations, result, error, checking, feature, setFeature, positionSelection, setPositionSelection, permission, knownStations, matched, update, runCheck, toggleMonitor };
}
