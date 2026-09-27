const { app, BrowserWindow, ipcMain, Menu, Notification, powerMonitor, shell, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.RAIL_API_URL || "https://www.yukino.bond/api/rail";
const ICON = path.join(__dirname, "../public/icon-512.png");
const DEFAULT_SETTINGS = {
  date: "", from: "", to: "", train: "", seat: "任意席别", intervalMinutes: 5, enabled: false,
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

function configPath() { return path.join(app.getPath("userData"), "rail-monitor.json"); }

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(configPath(), "utf8")) };
  } catch { return DEFAULT_SETTINGS; }
}

function validate(value) {
  if (!value || typeof value !== "object") throw new Error("无效监控设置");
  const next = {
    date: String(value.date || ""), from: String(value.from || "").trim(),
    to: String(value.to || "").trim(), train: String(value.train || "").trim().toUpperCase(),
    seat: String(value.seat || "任意席别"), intervalMinutes: Number(value.intervalMinutes),
    enabled: Boolean(value.enabled),
  };
  if (next.date && !/^\d{4}-\d{2}-\d{2}$/.test(next.date)) throw new Error("日期格式错误");
  if (next.from.length > 30 || next.to.length > 30 || next.from === next.to && next.from) throw new Error("请填写两个不同的车站");
  if (next.train && !/^[GDCZTKYS]\d{1,4}[A-Z]?$/.test(next.train)) throw new Error("车次格式错误");
  if (!Number.isInteger(next.intervalMinutes) || next.intervalMinutes < 1 || next.intervalMinutes > 60) throw new Error("检查间隔须为 1–60 分钟");
  if (next.enabled && (!next.date || !next.from || !next.to)) throw new Error("请填写日期和车站");
  return next;
}

function snapshot() { return { settings, result, error, checking }; }
function emit() {
  if (window && !window.isDestroyed()) window.webContents.send("rail:update", snapshot());
}

async function apiRequest(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(18000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `接口返回 ${response.status}`);
  return payload;
}

function availableSeats(train, seat) {
  return train.seats.filter((item) => item.available && (seat === "任意席别" || item.label === seat));
}

async function check(value, withNotification = false) {
  const config = validate(value);
  if (!config.date || !config.from || !config.to) throw new Error("请填写日期和车站");
  const params = new URLSearchParams({ date: config.date, from: config.from, to: config.to });
  if (config.train) params.set("train", config.train);
  checking = true;
  error = null;
  emit();
  try {
    const next = await apiRequest(`${API}?${params}`);
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
    error = cause instanceof Error ? cause.message : String(cause);
    throw cause;
  } finally {
    checking = false;
    emit();
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
    width: 1150, height: 860, minWidth: 380, minHeight: 580,
    title: "Yukino 余票提醒", icon: ICON, backgroundColor: "#f8f9f5", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "rail-preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  window.on("close", (event) => {
    if (!quitting) { event.preventDefault(); window.hide(); }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "https://www.12306.cn/" || url.startsWith("https://www.yukino.bond/")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.loadFile(path.join(__dirname, "../dist/index.html"));
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
    ipcMain.handle("rail:stations", () => apiRequest(`${API}?mode=stations`));
    ipcMain.handle("rail:configure", (_event, value) => {
      settings = validate(value);
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
  app.on("before-quit", () => { quitting = true; });
  app.on("window-all-closed", () => { /* monitoring continues in the tray */ });
}
