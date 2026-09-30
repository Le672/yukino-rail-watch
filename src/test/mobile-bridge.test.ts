import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: { settings: { queryMode: "train", train: "G101", from: "", to: "", date: "2026-09-30", seat: "二等座", intervalMinutes: 1, enabled: false }, result: null, error: null, checking: false },
  native: { getState: vi.fn(), configure: vi.fn(), checkNow: vi.fn(), stations: vi.fn(), addListener: vi.fn() },
  notification: { checkPermissions: vi.fn(), requestPermissions: vi.fn() },
  geo: { checkPermissions: vi.fn(), requestPermissions: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() },
  appListener: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "android", isNativePlatform: () => true }, registerPlugin: () => mocks.native }));
vi.mock("@capacitor/app", () => ({ App: { addListener: mocks.appListener } }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn() } }));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: mocks.geo }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: mocks.notification }));
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  mocks.native.getState.mockResolvedValue(mocks.state);
  mocks.native.configure.mockImplementation(async ({ settings }) => ({ ...mocks.state, settings }));
  mocks.native.addListener.mockResolvedValue({ remove: async () => {} });
  mocks.appListener.mockResolvedValue({ remove: async () => {} });
  mocks.notification.checkPermissions.mockResolvedValue({ display: "granted" });
  mocks.geo.checkPermissions.mockResolvedValue({ location: "granted", coarseLocation: "granted" });
  mocks.geo.watchPosition.mockResolvedValue("watch-1"); mocks.geo.clearWatch.mockResolvedValue(undefined);
});
afterEach(() => { delete window.railLocation; });

it("rejects monitoring if native notifications are denied", async () => {
  mocks.notification.checkPermissions.mockResolvedValue({ display: "denied" });
  const bridge = await import("../mobile/mobile-bridge"); await bridge.initializeMobile();
  await expect(bridge.mobileMonitor!.configure({ ...mocks.state.settings, queryMode: "train", enabled: true })).rejects.toThrow("通知权限未开启");
  expect(mocks.native.configure).not.toHaveBeenCalled();
});

it("does not restart an old query after a delayed notification permission response", async () => {
  let allow!: (permission: { display: string }) => void;
  mocks.notification.checkPermissions.mockResolvedValue({ display: "prompt" });
  mocks.notification.requestPermissions.mockImplementation(() => new Promise(resolve => { allow = resolve; }));
  const bridge = await import("../mobile/mobile-bridge"); await bridge.initializeMobile();
  const pending = bridge.mobileMonitor!.configure({ ...mocks.state.settings, queryMode: "train", enabled: true });
  await vi.waitFor(() => expect(mocks.notification.requestPermissions).toHaveBeenCalled());
  await bridge.mobileMonitor!.configure({ ...mocks.state.settings, queryMode: "train", train: "G102", enabled: false });
  allow({ display: "granted" }); await pending;
  expect(mocks.native.configure).toHaveBeenCalledTimes(1);
  expect(mocks.native.configure).toHaveBeenCalledWith({ settings: expect.objectContaining({ train: "G102", enabled: false }) });
});

it("uses device speed and coordinates without starting GPS before the user's action", async () => {
  const bridge = await import("../mobile/mobile-bridge"); await bridge.initializeMobile();
  expect(mocks.geo.watchPosition).not.toHaveBeenCalled();
  const receive = vi.fn(); window.railLocation!.onUpdate(receive); await window.railLocation!.start();
  const callback = mocks.geo.watchPosition.mock.calls[0][1];
  callback({ coords: { latitude: 23, longitude: 113, accuracy: 8, speed: 50, heading: 120 }, timestamp: 1000 });
  expect(receive).toHaveBeenCalledWith({ fix: { latitude: 23, longitude: 113, accuracy: 8, speed: 50, heading: 120, timestamp: 1000 } });
});

it("disposes a native GPS watch which finishes creating after Stop", async () => {
  let finish!: (id: string) => void;
  mocks.geo.watchPosition.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const bridge = await import("../mobile/mobile-bridge"); await bridge.initializeMobile();
  const pending = window.railLocation!.start();
  await vi.waitFor(() => expect(mocks.geo.watchPosition).toHaveBeenCalled());
  await window.railLocation!.stop(); finish("late-watch"); await pending;
  expect(mocks.geo.clearWatch).toHaveBeenCalledWith({ id: "late-watch" });
});

it("pauses GPS in the background, resumes only a requested watch, and ignores stale fixes", async () => {
  const bridge = await import("../mobile/mobile-bridge"); await bridge.initializeMobile();
  const receive = vi.fn(); window.railLocation!.onUpdate(receive); await window.railLocation!.start();
  const stale = mocks.geo.watchPosition.mock.calls[0][1];
  const appState = mocks.appListener.mock.calls[0][1];
  await appState({ isActive: false });
  stale({ coords: { latitude: 23, longitude: 113, accuracy: 8 }, timestamp: 1000 });
  expect(receive).not.toHaveBeenCalled();
  expect(mocks.geo.clearWatch).toHaveBeenCalledWith({ id: "watch-1" });
  await appState({ isActive: true }); expect(mocks.geo.watchPosition).toHaveBeenCalledTimes(2);
  await window.railLocation!.stop();
  await appState({ isActive: false }); await appState({ isActive: true });
  expect(mocks.geo.watchPosition).toHaveBeenCalledTimes(2);
});
