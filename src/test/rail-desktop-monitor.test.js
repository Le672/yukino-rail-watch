// @vitest-environment node
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const source = readFileSync(new URL("../../electron/rail-main.cjs", import.meta.url), "utf8");
const config = { queryMode: "train", date: "2026-10-10", train: "G101", from: "", to: "", seat: "二等座", intervalMinutes: 1, enabled: false };
const answer = available => ({ checkedAt: "2026-10-10T01:00:00Z", date: config.date, trains: [{ code: "G101", from: "北京南", to: "上海虹桥", seats: [{ label: "二等座", value: available ? "有" : "无", available }] }] });
async function desktop(saved = config) {
  const handlers = new Map(), intervals = new Map(), notices = [], clock = { now: Date.parse("2026-10-10T01:00:00Z") };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const app = Object.assign(new EventEmitter(), { getPath: () => "/audit", getVersion: () => "1.10.13", requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), setAppUserModelId: vi.fn(), quit: vi.fn() });
  class Window extends EventEmitter {
    webContents = { send: vi.fn(), getUserAgent: () => "test", setUserAgent: vi.fn(), setWindowOpenHandler: vi.fn(), getURL: () => "file:///desktop.html" };
    isDestroyed() { return false; } isVisible() { return true; } show() {} focus() {} hide() {} loadFile() {}
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  class Notification extends EventEmitter { static isSupported() { return true; } constructor(value) { super(); this.value = value; } show() { notices.push(this.value); } }
  const fs = { readFileSync: () => JSON.stringify(saved), writeFileSync: vi.fn() }, request = vi.fn().mockImplementation(async () => new Response(JSON.stringify(answer(true))));
  const electron = { app, BrowserWindow: Window, Tray, Notification, Menu: { buildFromTemplate: value => value }, ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, powerMonitor: new EventEmitter(), shell: { openExternal: vi.fn() } };
  runInNewContext(source, { require: id => id === "electron" ? electron : id === "node:fs" ? fs : id === "node:path" ? { join: (...parts) => parts.join("/") } : { createLocationWatcher: () => ({ start() {}, stop() {} }) }, __dirname: "/audit/electron", Date: ClockDate, URL, URLSearchParams, AbortController, AbortSignal, fetch: request, setInterval: fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id) });
  await Promise.resolve();
  return { call: (key, ...args) => handlers.get(`rail:${key}`)(null, ...args), request, fs, notices, intervals, clock };
}
describe("Windows monitor backend", () => {
  it("normalizes saved past dates, disables old monitoring and reports the real runtime version", async () => {
    const d = await desktop({ ...config, date: "2026-09-30", enabled: true });
    expect(d.call("get-state")).toMatchObject({ settings: { date: config.date, enabled: false }, version: "1.10.13" });
    expect(d.call("get-state").notice).toContain("2026-09-30"); expect(d.request).not.toHaveBeenCalled();
  });
  it("coalesces an in-flight query and sends Windows notifications only on unavailable-to-available changes", async () => {
    const d = await desktop(); let resolve;
    d.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const enabled = { ...config, enabled: true }; d.call("configure", enabled);
    const pending = d.call("check-now", enabled); expect(d.request).toHaveBeenCalledTimes(1);
    expect(d.request.mock.calls[0][1]).toMatchObject({ method: "POST", cache: "no-store" });
    resolve(new Response(JSON.stringify(answer(true)))); await pending; expect(d.notices).toHaveLength(1);
    await d.intervals.values().next().value(); await Promise.resolve(); await d.call("check-now", enabled); expect(d.notices).toHaveLength(1);
    d.request.mockResolvedValueOnce(new Response(JSON.stringify(answer(false)))); await d.intervals.values().next().value(); await d.call("check-now", enabled);
    d.request.mockResolvedValueOnce(new Response(JSON.stringify(answer(true)))); await d.intervals.values().next().value(); await d.call("check-now", enabled); expect(d.notices).toHaveLength(2);
  });
  it("aborts stopped monitoring and discards late results and notifications", async () => {
    const d = await desktop(); let resolve;
    d.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const enabled = { ...config, enabled: true }; d.call("configure", enabled); const pending = d.call("check-now", enabled);
    const signal = d.request.mock.calls[0][1].signal; d.call("configure", config); expect(signal.aborted).toBe(true);
    resolve(new Response(JSON.stringify(answer(true)))); await pending;
    expect(d.notices).toHaveLength(0); expect(d.call("get-state")).toMatchObject({ result: null, checking: false, settings: { enabled: false } });
  });
  it("stops background monitoring when its date expires at China midnight", async () => {
    const d = await desktop(); const enabled = { ...config, enabled: true }; d.call("configure", enabled); await d.call("check-now", enabled);
    d.clock.now = Date.parse("2026-10-10T16:01:00Z"); d.intervals.values().next().value(); await Promise.resolve();
    expect(d.call("get-state").settings.enabled).toBe(false); expect(d.call("get-state").error).toContain("已过期"); expect(d.intervals.size).toBe(0); expect(d.fs.writeFileSync).toHaveBeenCalled();
  });
  it("rejects dates outside the sale window and translates non-JSON gateway failures", async () => {
    const d = await desktop();
    for (const date of ["2026-10-09", "2026-10-25", "2026-02-30"]) await expect(d.call("check-now", { ...config, date })).rejects.toThrow(/日期|预售期/);
    expect(d.request).not.toHaveBeenCalled();
    d.request.mockResolvedValueOnce(new Response("<h1>Bad Gateway</h1>", { status: 502 })); await expect(d.call("check-now", config)).rejects.toThrow("HTTP 502");
    d.request.mockResolvedValueOnce(new Response("null")); await expect(d.call("check-now", config)).rejects.toThrow("资料不完整");
  });
});
