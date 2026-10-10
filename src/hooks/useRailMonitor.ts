import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enrichTrainList, mergeTrainDetails } from "../lib/rail-enrichment";
import { trainIdentity } from "../lib/rail-tickets";
import { officialStationCatalog } from "../lib/rail-official-stations";
import type { Train, Station, Seat } from "../lib/rail-tickets";
export type { Train, Station, Seat } from "../lib/rail-tickets";
export { matchingSeats } from "../lib/rail-tickets";
import { matchingSeats } from "../lib/rail-tickets";
import { railApiUrl, readRailResponse, requestRailData } from "../lib/rail-api";
import { ticketDateError, ticketDateRange } from "../lib/rail-ticket-date";
import { isJourneyDate } from "../lib/train-position";
import { railFeatureFromLocation, railPositionFromLocation } from "../lib/rail-navigation";
import type { RailFeature, RailPositionSelection } from "../lib/rail-navigation";

type QueryMode = "train" | "route";
export type Result = { checkedAt: string; date: string; from: string; to: string; fromCode?: string; toCode?: string; queryMode?: QueryMode; trains: Train[]; modelCheckedAt?: string | null };
export type Settings = {
  queryMode: QueryMode;
  date: string; from: string; to: string; train: string; seat: string;
  intervalMinutes: number; enabled: boolean;
};
export type DesktopState = { settings: Settings; result: Result | null; error: string | null; checking: boolean; version?: string; notice?: string | null };
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
export const SEAT_OPTIONS = ["任意席别", "商务座", "特等座", "优选一等座", "一等座", "二等座", "高级软卧", "软卧", "动卧", "硬卧", "软座", "硬座", "无座"];

function loadSettings(): { settings: Settings; notice: string | null } {
  const today = ticketDateRange().min;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<Settings> | null;
    const validDate = typeof saved?.date === "string" && isJourneyDate(saved.date);
    const expired = validDate && saved!.date! < today;
    const next = saved && typeof saved === "object" && !Array.isArray(saved) ? {
      ...DEFAULT_SETTINGS,
      date: validDate && !expired ? saved.date! : today,
      from: typeof saved.from === "string" ? saved.from.slice(0, 100) : "",
      to: typeof saved.to === "string" ? saved.to.slice(0, 100) : "",
      train: typeof saved.train === "string" ? saved.train.slice(0, 20) : "",
      seat: typeof saved.seat === "string" && SEAT_OPTIONS.includes(saved.seat) ? saved.seat : DEFAULT_SETTINGS.seat,
      intervalMinutes: Number.isInteger(saved.intervalMinutes) && Number(saved.intervalMinutes) >= 1 && Number(saved.intervalMinutes) <= 60 ? Number(saved.intervalMinutes) : DEFAULT_SETTINGS.intervalMinutes,
      queryMode: saved.queryMode === "train" || saved.queryMode === "route" ? saved.queryMode : saved.from || saved.to ? "route" : "train",
      enabled: !!saved.queryMode && saved.enabled === true && validDate && !ticketDateError(saved.date!),
    } : { ...DEFAULT_SETTINGS, date: today };
    return { settings: next, notice: expired ? `上次保存的乘车日期 ${saved!.date} 已过期，已更新为今天 ${today}；监控已停止，请核对日期后重新开启。` : null };
  } catch { return { settings: { ...DEFAULT_SETTINGS, date: today }, notice: null }; }
}

function validSettings(settings: Settings) {
  const queryValid = settings.queryMode === "train"
    ? /^(?:[GDCZTKYS]\d{1,4}[A-Z]?|\d{4})$/i.test(settings.train.trim())
    : settings.queryMode === "route" && !!settings.from.trim() && !!settings.to.trim() && settings.from.trim() !== settings.to.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(settings.date) && queryValid &&
    Number.isInteger(settings.intervalMinutes) && settings.intervalMinutes >= 1 && settings.intervalMinutes <= 60;
}

export function formatCheckedAt(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return readRailResponse<T>(response);
}

async function query(settings: Settings, signal?: AbortSignal): Promise<Result> {
  const params = new URLSearchParams({ date: settings.date, search: settings.queryMode });
  if (settings.queryMode === "train") params.set("train", settings.train.trim().toUpperCase());
  else { params.set("from", settings.from.trim()); params.set("to", settings.to.trim()); }
  return requestRailData<Result>(params, signal);
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
  const [initial] = useState(loadSettings);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [dateNotice, setDateNotice] = useState(initial.notice);
  const [dateRange, setDateRange] = useState(ticketDateRange);
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feature, setFeature] = useState<RailFeature>(railFeatureFromLocation);
  const [positionSelection, setPositionSelection] = useState<RailPositionSelection>(railPositionFromLocation);
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const availability = useRef<Record<string, boolean>>({});
  const requestGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const refresh = () => setDateRange(ticketDateRange());
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); activeRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    const load = desktop ? desktop.stations() : fetchJson<{ stations: Station[] }>(railApiUrl(new URLSearchParams({ mode: "stations" })));
    load.then((data) => setStations(officialStationCatalog(data.stations))).catch((cause) => setError(`车站列表加载失败：${String(cause)}`));
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onUpdate((state) => {
      setSettings(state.settings);
      setResult(state.result);
      setError(state.error);
      setChecking(state.checking);
      setDesktopVersion(state.version || null);
      if (state.notice) setDateNotice(state.notice);
    });
    desktop.getState().then((state) => {
      setSettings(state.settings);
      setResult(state.result);
      setError(state.error);
      setChecking(state.checking);
      setDesktopVersion(state.version || null);
      if (state.notice) setDateNotice(state.notice);
      if (ticketDateError(state.settings.date)) setDateNotice(ticketDateError(state.settings.date));
    }).catch((cause) => setError(String(cause)));
    return off;
  }, [desktop]);

  useEffect(() => {
    if (desktop) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [desktop, settings]);

  useEffect(() => {
    if (!settings.enabled) return;
    const message = ticketDateError(settings.date);
    if (!message) return;
    requestGeneration.current++;
    activeRequest.current?.abort(); activeRequest.current = null;
    const next = { ...settings, enabled: false };
    setSettings(next); setChecking(false); setDateNotice(message); setError(message);
    if (desktop) void desktop.configure(next).catch(cause => setError(String(cause)));
  }, [dateRange.min, desktop, settings]);

  useEffect(() => {
    if (!result) return;
    const controller = new AbortController(), identity = `${result.checkedAt}/${result.date}/${result.from}/${result.to}`;
    void enrichTrainList(result.trains, result.date, updates => {
      const byId = new Map(updates.map(t => [trainIdentity(t, result.date), t]));
      setResult(current => current && `${current.checkedAt}/${current.date}/${current.from}/${current.to}` === identity
        ? { ...current, trains: current.trains.map(t => mergeTrainDetails(t, byId.get(trainIdentity(t, current.date)))) } : current);
    }, controller.signal);
    return () => controller.abort();
  }, [result?.checkedAt, result?.date, result?.from, result?.to]);

  const runCheck = useCallback(async (notify = false) => {
    const dateError = ticketDateError(settings.date);
    if (dateError) {
      setError(dateError);
      if (settings.enabled) {
        const next = { ...settings, enabled: false }; setSettings(next);
        if (desktop) void desktop.configure(next).catch(() => {});
      }
      return;
    }
    if (!validSettings(settings)) { setError("请填写有效日期和 1–60 分钟的间隔；按车次填车次，按区间填两个不同的车站"); return; }
    if (notify && activeRequest.current) return;
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    const generation = ++requestGeneration.current;
    setChecking(true);
    setError(null);
    try {
      const next = desktop ? await desktop.checkNow(settings) : await query(settings, controller.signal);
      if (generation !== requestGeneration.current) return;
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
      if (generation === requestGeneration.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (generation === requestGeneration.current) setChecking(false);
    }
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
    activeRequest.current?.abort(); activeRequest.current = null;
    setSettings(next);
    setResult(null);
    setError(null);
    setChecking(false);
    if (patch.date !== undefined) setDateNotice(null);
    availability.current = {};
    if (desktop) void desktop.configure(next).catch((cause) => setError(String(cause)));
  };

  const toggleMonitor = async () => {
    if (settings.enabled) {
      requestGeneration.current++; activeRequest.current?.abort(); activeRequest.current = null; setChecking(false);
      const next = { ...settings, enabled: false };
      setSettings(next);
      if (desktop) { try { await desktop.configure(next); } catch (cause) { setError(String(cause)); } }
      return;
    }
    const dateError = ticketDateError(settings.date);
    if (dateError) { setError(dateError); return; }
    if (!validSettings(settings)) { setError("先选择查询方式，填写日期及车次或乘车区间，并设置 1–60 分钟的间隔"); return; }
    if (!desktop && typeof Notification !== "undefined" && Notification.permission === "default") {
      setPermission(await Notification.requestPermission());
    }
    const next = { ...settings, train: settings.train.trim().toUpperCase(), enabled: true };
    setSettings(next);
    availability.current = {};
    if (desktop) {
      try { await desktop.configure(next); } catch (cause) { setSettings({ ...next, enabled: false }); setError(String(cause)); }
    }
  };

  const knownStations = useMemo(() => new Set(stations.map((station) => station.name)), [stations]);
  const matched = result?.trains.filter((train) => matchingSeats(train, settings.seat).length > 0) || [];

  return { desktop, desktopVersion, settings, dateRange, dateNotice, stations, result, error, storageError, checking, feature, setFeature, positionSelection, setPositionSelection, permission, knownStations, matched, update, runCheck, toggleMonitor };
}
