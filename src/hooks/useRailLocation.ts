import { useEffect, useState } from "react";
import { validLocation } from "../lib/rail-gps";
import type { LocationFix } from "../lib/rail-gps";

type LocationEvent = { fix?: LocationFix; error?: { code: number; message: string } };
declare global { interface Window { railLocation?: {
  start: () => Promise<void>; stop: () => Promise<void>;
  onUpdate: (listener: (event: LocationEvent) => void) => () => void;
} } }
const locationError = (code: number) => code === 1 ? "定位权限未开启。请在浏览器或系统定位设置中允许后重试。" :
  code === 3 ? "暂未收到新的 GPS 定位，请靠近车窗或等待信号恢复。" : "设备暂时无法获取定位，请检查定位服务与信号。";

/** No automatic permission request, no IP fallback, no persisted location history. */
export function useRailLocation() {
  const [enabled, setEnabled] = useState(false);
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) { setFix(null); return; }
    let active = true, watch: number | null = null;
    const desktop = window.railLocation;
    const update = (event: LocationEvent) => {
      if (!active) return;
      if (event.fix && validLocation(event.fix)) { setFix(event.fix); setError(null); }
      else if (event.error) { setError(locationError(event.error.code)); if (event.error.code === 1) setEnabled(false); }
    };
    const unsubscribe = desktop?.onUpdate(update);
    const stop = () => {
      if (desktop) void desktop.stop().catch(() => {});
      if (watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; }
    };
    const start = () => {
      if (document.hidden) return;
      setError(null);
      if (desktop) { void desktop.start().catch(() => update({ error: { code: 2, message: "" } })); return; }
      if (!window.isSecureContext || !navigator.geolocation) {
        setError("当前环境不支持安全定位，请使用 HTTPS 页面或 Windows 版。"); setEnabled(false); return;
      }
      watch = navigator.geolocation.watchPosition(position => update({ fix: {
        longitude: position.coords.longitude, latitude: position.coords.latitude, accuracy: position.coords.accuracy,
        speed: Number.isFinite(position.coords.speed) && position.coords.speed! >= 0 ? position.coords.speed : null,
        heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null, timestamp: position.timestamp,
      } }), cause => update({ error: { code: cause.code, message: cause.message } }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    };
    start();
    const onVisibility = () => { stop(); if (!document.hidden) start(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; stop(); unsubscribe?.(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [enabled]);
  return { enabled, fix, error, start: () => { setFix(null); setError(null); setEnabled(true); }, stop: () => { setEnabled(false); setFix(null); setError(null); } };
}
