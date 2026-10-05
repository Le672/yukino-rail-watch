const { app, BrowserWindow, ipcMain, Menu, Notification, powerMonitor, shell, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createLocationWatcher } = require("./rail-location.cjs");

const API = "https://www.yukino.bond/api/rail";
const ICON = path.join(__dirname, "../public/rail-icon.png");
const DEFAULT_SETTINGS = {
  queryMode: "train", date: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
  from: "", to: "", train: "", seat: "任意席别", intervalMinutes: 5, enabled: false,
};

let window;
let tray;
let timer;
let quitting = false;
let settings = DEFAULT_SETTINGS;
let result = null;
let error = null;
let checking = false;
let availability = {};
let revision = 0;
const locationWatcher = createLocationWatcher(event => {
  if (window && !window.isDestroyed() && window.isVisible()) window.webContents.send("rail:location", event);
});
const TRAIN_CODE = /^(?:[GDCZTKYS]\d{1,4}[A-Z]?|\d{4})$/;

function configPath() { return path.join(app.getPath("userData"), "rail-monitor.json"); }

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return validate({
      ...DEFAULT_SETTINGS, ...saved,
      date: saved.date || DEFAULT_SETTINGS.date,
      queryMode: saved.queryMode || (saved.from || saved.to ? "route" : "train"),
      enabled: saved.queryMode ? Boolean(saved.enabled) : false,
    });
  } catch { return DEFAULT_SETTINGS; }
}

function validate(value) {
  if (!value || typeof value !== "object") throw new Error("无效监控设置");
  const next = {
    queryMode: value.queryMode || (value.from || value.to ? "route" : "train"),
    date: String(value.date || ""), from: String(value.from || "").trim(),
    to: String(value.to || "").trim(), train: String(value.train || "").trim().toUpperCase(),
    seat: String(value.seat || "任意席别"), intervalMinutes: Number(value.intervalMinutes),
    enabled: Boolean(value.enabled),
  };
  if (!["train", "route"].includes(next.queryMode)) throw new Error("请选择按车次或按区间查询");
  if (next.date && !/^\d{4}-\d{2}-\d{2}$/.test(next.date)) throw new Error("日期格式错误");
  if (next.from.length > 30 || next.to.length > 30 || next.train.length > 8) throw new Error("查询条件过长");
  if (!Number.isInteger(next.intervalMinutes) || next.intervalMinutes < 1 || next.intervalMinutes > 60) throw new Error("检查间隔须为 1–60 分钟");
  if (next.enabled && !queryReady(next)) throw new Error("请填写日期，以及有效车次或两个不同的车站");
  return next;
}

function queryReady(config) {
  return !!config.date && (config.queryMode === "train" ? TRAIN_CODE.test(config.train) :
    !!config.from && !!config.to && config.from !== config.to);
}

function snapshot() { return { settings, result, error, checking }; }
function emit() {
  if (window && !window.isDestroyed()) window.webContents.send("rail:update", snapshot());
}

async function apiRequest(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `接口返回 ${response.status}`);
  return payload;
}

function availableSeats(train, seat) {
  return train.seats.filter((item) => item.available && (seat === "任意席别" || item.label === seat));
}

async function check(value, withNotification = false) {
  const config = validate(value);
  if (!queryReady(config)) throw new Error("请填写日期，以及有效车次或两个不同的车站");
  const params = new URLSearchParams({ date: config.date, search: config.queryMode });
  if (config.queryMode === "train") params.set("train", config.train);
  else { params.set("from", config.from); params.set("to", config.to); }
  const requestRevision = revision;
  checking = true;
  error = null;
  emit();
  try {
    const next = await apiRequest(`${API}?${params}`);
    if (requestRevision !== revision) return next;
    result = next;
    if (withNotification) {
      const current = {};
      for (const train of next.trains) {
        const seats = availableSeats(train, config.seat);
        const key = `${config.date}/${train.code}`;
        current[key] = seats.length > 0;
        if (seats.length && !availability[key] && Notification.isSupported()) {
          const notice = new Notification({
            title: `${train.code} 有余票`,
            body: `${config.date} ${train.from} → ${train.to} · ${seats.map((seat) => `${seat.label} ${seat.value}`).join(" · ")}`,
            icon: ICON,
          });
          notice.on("click", showWindow);
          notice.show();
        }
      }
      availability = current;
    }
    return next;
  } catch (cause) {
    if (requestRevision === revision) error = cause instanceof Error ? cause.message : String(cause);
    throw cause;
  } finally {
    if (requestRevision === revision) { checking = false; emit(); }
  }
}

function schedule() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (!settings.enabled) return;
  void check(settings, true).catch(() => {});
  timer = setInterval(() => {
    if (!checking) void check(settings, true).catch(() => {});
  }, settings.intervalMinutes * 60000);
}

function showWindow() {
  if (!window || window.isDestroyed()) createWindow();
  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 920, minHeight: 640,
    title: "Yukino 余票提醒", icon: ICON, backgroundColor: "#edf1f6", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "rail-preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  window.on("close", (event) => {
    if (!quitting) { event.preventDefault(); window.hide(); }
  });
  window.on("hide", () => locationWatcher.stop());
  window.on("closed", () => locationWatcher.stop());
  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} YukinoRailWatch/${app.getVersion()} (+https://cr.yukino.bond/)`);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "https://www.12306.cn/" || url.startsWith("https://www.yukino.bond/") ||
        url === "https://railgo.dev/" || url === "https://api.railgo.dev/" ||
        url === "https://github.com/Le672" || url === "mailto:Raptor@yukino.bond" ||
        url.startsWith("https://commons.wikimedia.org/wiki/File:") ||
        url === "https://www.china-emu.cn/Trains/ALL/" ||
        /^https:\/\/www\.china-emu\.cn\/Trains\/Model\/Detail-\d+-\d+-[A-Z]\.html$/.test(url) ||
        url.startsWith("https://creativecommons.org/licenses/") ||
        url.startsWith("https://creativecommons.org/publicdomain/") ||
        ["https://www.amap.com", "https://www.openstreetmap.org/copyright", "https://s2maps.eu", "https://eox.at", "https://maps.eox.at"].includes(url.replace(/\/$/, ""))) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.loadFile(path.join(__dirname, "../dist/desktop.html"));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(() => {
    app.setAppUserModelId("bond.yukino.rail");
    settings = readSettings();
    createWindow();
    tray = new Tray(ICON);
    tray.setToolTip("Yukino 余票提醒");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开余票提醒", click: showWindow },
      { label: "退出", click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on("double-click", showWindow);
    ipcMain.handle("rail:get-state", () => snapshot());
    const localLocationRequest = event => window && !window.isDestroyed() && event.sender === window.webContents && event.sender.getURL().startsWith("file://");
    ipcMain.handle("rail:location-start", event => { if (!localLocationRequest(event) || !window.isVisible()) throw new Error("位置请求来源无效"); locationWatcher.start(); });
    ipcMain.handle("rail:location-stop", event => { if (localLocationRequest(event)) locationWatcher.stop(); });
    ipcMain.handle("rail:stations", () => apiRequest(`${API}?mode=stations&schema=city-v1`));
    ipcMain.handle("rail:configure", (_event, value) => {
      settings = validate(value);
      revision++;
      checking = false;
      fs.writeFileSync(configPath(), JSON.stringify(settings), "utf8");
      availability = {};
      result = null;
      error = null;
      schedule();
      emit();
      return snapshot();
    });
    ipcMain.handle("rail:check-now", (_event, value) => check(value));
    powerMonitor.on("resume", () => { if (settings.enabled && !checking) void check(settings, true).catch(() => {}); });
    schedule();
  });
  app.on("before-quit", () => { quitting = true; locationWatcher.stop(); });
  app.on("window-all-closed", () => { /* monitoring continues in the tray */ });
}
