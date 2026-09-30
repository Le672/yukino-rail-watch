import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import type { DesktopState, RailDesktop, Result, Settings, Station } from "../hooks/useRailMonitor";
import type { LocationFix } from "../lib/rail-gps";

interface NativeMonitor {
  getState(): Promise<DesktopState>;
  configure(options: { settings: Settings }): Promise<DesktopState>;
  checkNow(options: { settings: Settings }): Promise<Result>;
  stations(): Promise<{ stations: Station[] }>;
  addListener(event: "state", listener: (state: DesktopState) => void): Promise<PluginListenerHandle>;
}
const RailMonitor = registerPlugin<NativeMonitor>("RailMonitor");
export const mobilePlatform = Capacitor.getPlatform();
export let mobileMonitor: RailDesktop | undefined;
type LocationEvent = { fix?: LocationFix; error?: { code: number; message: string } };

export async function initializeMobile() {
  if (!Capacitor.isNativePlatform()) return;
  const listeners = new Set<(state: DesktopState) => void>();
  let configurationGeneration = 0;
  await RailMonitor.addListener("state", (state) => listeners.forEach(listener => listener(state)));
  mobileMonitor = {
    getState: () => RailMonitor.getState(), stations: () => RailMonitor.stations(),
    checkNow: settings => RailMonitor.checkNow({ settings }),
    configure: async (settings) => {
      const current = ++configurationGeneration;
      if (settings.enabled) {
        let permission = await LocalNotifications.checkPermissions();
        if (permission.display === "prompt" || permission.display === "prompt-with-rationale") permission = await LocalNotifications.requestPermissions();
        if (current !== configurationGeneration) return RailMonitor.getState();
        if (permission.display !== "granted") throw new Error("通知权限未开启。请在系统设置中允许通知后重试。");
      }
      if (current !== configurationGeneration) return RailMonitor.getState();
      return RailMonitor.configure({ settings });
    },
    onUpdate: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };

  let watchId: string | null = null, generation = 0, desired = false, foreground = true;
  const locationListeners = new Set<(event: LocationEvent) => void>();
  const emit = (event: LocationEvent) => locationListeners.forEach(listener => listener(event));
  const clear = async () => { generation++; const id = watchId; watchId = null; if (id) await Geolocation.clearWatch({ id }); };
  const watch = async () => {
    if (!foreground || !desired) return;
    const current = ++generation, previous = watchId; watchId = null;
    try {
      if (previous) await Geolocation.clearWatch({ id: previous });
      let permission = await Geolocation.checkPermissions();
      if (permission.location !== "granted" && permission.coarseLocation !== "granted") permission = await Geolocation.requestPermissions({ permissions: ["location"] });
      if (permission.location !== "granted" && permission.coarseLocation !== "granted") { emit({ error: { code: 1, message: "定位权限未开启" } }); return; }
      if (current !== generation || !foreground || !desired) return;
      const id = await Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 1000, timeout: 20000, minimumUpdateInterval: 1000, interval: 1000, enableLocationFallback: true }, (position, cause) => {
        if (current !== generation || !foreground || !desired) return;
        if (cause) { emit({ error: { code: /0003|0008/.test(String(cause.code)) ? 1 : /0010/.test(String(cause.code)) ? 3 : 2, message: String(cause.message) } }); return; }
        if (position) emit({ fix: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, speed: position.coords.speed, heading: position.coords.heading, timestamp: position.timestamp } });
      });
      if (current !== generation || !foreground || !desired) await Geolocation.clearWatch({ id }); else watchId = id;
    } catch (cause) { if (current === generation) emit({ error: { code: /0003|0008/.test(String((cause as { code?: string }).code)) ? 1 : 2, message: String(cause) } }); }
  };
  window.railLocation = {
    start: async () => { desired = true; await watch(); }, stop: async () => { desired = false; await clear(); },
    onUpdate: listener => { locationListeners.add(listener); return () => { locationListeners.delete(listener); }; },
  };
  await App.addListener("appStateChange", async ({ isActive }) => {
    foreground = isActive;
    try {
      if (!isActive) await clear();
      else { await watch(); const state = await RailMonitor.getState(); listeners.forEach(listener => listener(state)); }
    } catch (cause) { emit({ error: { code: 2, message: String(cause) } }); }
  });
  document.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
    if (anchor && /^https:\/\//.test(anchor.href)) { event.preventDefault(); void Browser.open({ url: anchor.href }); }
  });
}
