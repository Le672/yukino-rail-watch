import type { Station } from "./rail-tickets";
import type { TimetableStop } from "./train-position";
import { chinaDateTime } from "./train-position";
import { parseOfficialDelay } from "./rail-official";
import { emptyBoardDetail, parseBoardExit, parseBoardOperating, parseBoardRealtime, parseStationBoard } from "./rail-board";
import type { BoardDirection, BoardRowDetail, StationBoardData } from "./rail-board";

const MOBILE = "https://mobile.12306.cn";
const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: `${MOBILE}/`, "Content-Type": "application/x-www-form-urlencoded" };
const boards = new Map<string, { at: number; data: StationBoardData }>();
const boardPending = new Map<string, Promise<StationBoardData>>();
const details = new Map<string, BoardRowDetail>();
const detailPending = new Map<string, Promise<BoardRowDetail>>();
const screens = new Map<string, { at: number; value: unknown; available: boolean }>();
const screenPending = new Map<string, Promise<unknown>>();
const exits = new Map<string, { at: number; data: ReturnType<typeof parseBoardExit> }>();
const operating = new Map<string, { at: number; value: boolean | null }>();
function prune<T>(cache: Map<string, T>, max: number) { if (cache.size >= max) cache.delete(cache.keys().next().value!); }

export async function getStationBoard(station: Station, date: string): Promise<StationBoardData> {
  const key = `${station.code}/${date}`, cached = boards.get(key);
  if (cached && Date.now() - cached.at < 60000) return cached.data;
  if (boardPending.has(key)) return boardPending.get(key)!;
  const request = (async () => {
    const response = await fetch(`${MOBILE}/wxxcx/wechat/bigScreen/queryTrainByStation`, { method: "POST", headers: HEADERS,
      body: new URLSearchParams({ train_station_code: station.code, train_start_date: date.replace(/-/g, "") }), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`12306 车站到发查询返回 ${response.status}`);
    const data = parseStationBoard(await response.json(), station, date);
    prune(boards, 60); boards.set(key, { at: Date.now(), data }); return data;
  })();
  boardPending.set(key, request);
  try { return await request; } finally { boardPending.delete(key); }
}

async function realtimeScreen(board: StationBoardData, direction: BoardDirection): Promise<unknown> {
  const key = `${board.stationCode}/${board.date}/${direction}`, cached = screens.get(key);
  // A failed upstream is retried after five minutes, not for every row.
  if (cached && Date.now() - cached.at < (cached.available ? 55000 : 300000)) return cached.value;
  if (screenPending.has(key)) return screenPending.get(key)!;
  const request = (async () => {
    let value: unknown = null, available = false;
    try {
      const query = new URLSearchParams({ stationCode: board.stationCode, trainDate: board.date.replace(/-/g, ""), type: direction, reqType: "form" });
      const url = `${MOBILE}/wxxcx/openplatform-inner/miniprogram/wifiapps/appFrontEnd/v2/lounge/open-smooth-common/kpBigScreen/getBigScreenByStationCodeAndTrainDate?${query}`;
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
      if (response.ok) {
        value = await response.json();
        const result = value as { content?: { data?: unknown } };
        available = Array.isArray(result?.content?.data);
      }
    } catch { /* The official delay query below can still provide a service status. */ }
    prune(screens, 80); screens.set(key, { at: Date.now(), value, available }); return value;
  })();
  screenPending.set(key, request);
  try { return await request; } finally { screenPending.delete(key); }
}

export async function getStationBoardRow(board: StationBoardData, id: string, direction: BoardDirection): Promise<BoardRowDetail> {
  const row = board.rows.find(item => item.id === id);
  const plannedAt = row && (direction === "D" ? row.departureAt : row.arrivalAt);
  if (!row || plannedAt === null || plannedAt === undefined) throw new Error("该车次不在所选车站的到发列表中");
  const key = `${board.stationCode}/${board.date}/${direction}/${id}`, cached = details.get(key);
  if (cached && Date.now() - cached.checkedAt < 55000) return cached;
  if (detailPending.has(key)) return detailPending.get(key)!;
  const request = (async () => {
    const detail = emptyBoardDetail(id, direction), today = chinaDateTime().slice(0, 10);
    const operatingKey = `${row.trainNo}/${row.originDate}/${row.train}`, cachedOperating = operating.get(operatingKey);
    let isRunning = cachedOperating && Date.now() - cachedOperating.at < 5 * 60000 ? cachedOperating.value : null;
    if (!cachedOperating || Date.now() - cachedOperating.at >= 5 * 60000) {
      try {
        const response = await fetch(`${MOBILE}/wxxcx/wechat/bigScreen/queryTrainDiagram`, { method: "POST", headers: HEADERS,
          body: new URLSearchParams({ queryDate: row.originDate.replace(/-/g, ""), trainCode: row.train }), signal: AbortSignal.timeout(6000) });
        if (response.ok) isRunning = parseBoardOperating(await response.json(), row.originDate);
      } catch { /* No run-day record does not prove cancellation. */ }
      prune(operating, 500); operating.set(operatingKey, { at: Date.now(), value: isRunning });
    }
    if (isRunning === false) {
      detail.status = "not-running"; detail.warning = "官方逐日计划标记该始发日不开行；这不等于临时取消";
      detail.checkedAt = Date.now(); prune(details, 500); details.set(key, detail); return detail;
    }
    const exitKey = `${board.stationCode}/${board.date}/${row.train}`;
    const exit = exits.get(exitKey);
    if (exit && Date.now() - exit.at < 5 * 60000) Object.assign(detail, exit.data);
    else {
      try {
        const response = await fetch(`${MOBILE}/wxxcx/wechat/bigScreen/getExit`, { method: "POST", headers: HEADERS,
          body: new URLSearchParams({ stationCode: board.stationCode, trainDate: board.date.replace(/-/g, ""), type: direction, stationTrainCode: row.train }), signal: AbortSignal.timeout(6000) });
        if (response.ok) { const data = parseBoardExit(await response.json()); prune(exits, 500); exits.set(exitKey, { at: Date.now(), data }); Object.assign(detail, data); }
      } catch { /* Missing platform/gate data must not hide the train. */ }
    }
    if (board.date === today) {
      const screen = parseBoardRealtime(await realtimeScreen(board, direction), board, row, direction);
      if (screen) Object.assign(detail, screen);
      if (detail.status === "unknown" && plannedAt >= Date.now() - 5 * 60000 && plannedAt <= Date.now() + 3 * 3600000) {
        try {
          const stop: TimetableStop = { station: board.station, telecode: board.stationCode, trainCode: row.train, arrival: row.arrival || row.departure!, departure: row.departure || row.arrival!,
            arrivalAt: row.arrivalAt ?? row.departureAt!, departureAt: row.departureAt ?? row.arrivalAt!, day: 0 };
          const url = new URL("https://hzfw.12306.cn/zgzfw/trainTime/query");
          for (const [name, value] of Object.entries({ train_code: row.train, station_name: board.station, from_to: direction === "D" ? "1" : "0" })) url.searchParams.set(name, value);
          const response = await fetch(url, { headers: { ...HEADERS, Referer: "https://hzfw.12306.cn/zgzfw/resources/web/zwdcx.html" }, signal: AbortSignal.timeout(6000) });
          const delay = response.ok ? parseOfficialDelay(await response.json(), stop, Date.now(), direction === "D") : null;
          if (delay) Object.assign(detail, { status: delay.code.startsWith("ON_TIME") ? "on-time" : delay.code.startsWith("EARLY") ? "early" : "late", minutes: delay.minutes,
            predicted: delay.code.endsWith("_PREDICTION"), sourceAt: Date.now() });
        } catch { /* No report is not proof that a train is on time. */ }
      }
    }
    detail.checkedAt = Date.now();
    if (detail.checkIn === "unknown") detail.warning = board.date === today ? "官方暂未提供检票状态；正晚点仅显示查得的结果" : "非当日仅展示计划到发，实时状态未提供";
    prune(details, 500); details.set(key, detail); return detail;
  })();
  detailPending.set(key, request);
  try { return await request; } finally { detailPending.delete(key); }
}
