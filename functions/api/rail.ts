import type { Station, Seat } from "../../src/lib/rail-tickets";
import { applyFares, intercityFares, parseEncodedFares, parsePriceResponse } from "../../src/lib/rail-fares";
import { officialDelayReport, officialDelayTargets, parseOfficialDelay, parseOfficialJourney, parseOfficialTrainNames } from "../../src/lib/rail-official";
import type { OfficialTimetable, OfficialTrainRoute } from "../../src/lib/rail-official";
import { parseOfficialEquipment } from "../../src/lib/rail-equipment";
import type { TrainEquipment } from "../../src/lib/rail-equipment";
import type { TrainJourney } from "../../src/lib/train-position";
import { ticketDateError, ticketDateRange } from "../../src/lib/rail-ticket-date";
import { getJourneyBoardStops, getStationBoard, getStationBoardRow } from "../../src/lib/rail-board-service";

const ORIGIN = "https://kyfw.12306.cn";
const STATIONS_URL = `${ORIGIN}/otn/resources/js/framework/station_name.js`;
const REQUEST_HEADERS = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  Referer: `${ORIGIN}/otn/leftTicket/init`,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
};

let stationCache: { at: number; stations: Station[] } | undefined;
let sessionCache: { at: number; cookie: string } | undefined;
let sessionPending: Promise<string> | undefined;
let nextTicketRequestAt = 0;
let nextEquipmentRequestAt = 0;
type TrainRoute = OfficialTrainRoute;
const trainRouteCache = new Map<string, { at: number; route: TrainRoute }>();
const trainNamesCache = new Map<string, { at: number; routes: Map<string, TrainRoute[]> }>();
const trainNamesPending = new Map<string, Promise<Map<string, TrainRoute[]>>>();
const trainRoutePending = new Map<string, Promise<TrainRoute>>();
const equipmentCache = new Map<string, { at: number; value: TrainEquipment }>();
const equipmentPending = new Map<string, Promise<TrainEquipment>>();
const TRAIN_CODE = /^(?:[GDCZTKYS]\d{1,4}[A-Z]?|\d{4})$/;
const timetableCache = new Map<string, { at: number; payload: OfficialTimetable; journey: TrainJourney; trainNo: string }>();
const timetablePending = new Map<string, Promise<{ at: number; payload: OfficialTimetable; journey: TrainJourney; trainNo: string }>>();
const delayCache = new Map<string, { at: number; report: ReturnType<typeof officialDelayReport> }>();
const delayPending = new Map<string, Promise<ReturnType<typeof officialDelayReport>>>();
type TicketData = { result: string[]; map: Record<string, string> };
const ticketCache = new Map<string, { at: number; data: TicketData }>();
const ticketPending = new Map<string, Promise<TicketData>>();
const fareCache = new Map<string, { at: number; prices: ReturnType<typeof parseEncodedFares> }>();
const farePending = new Map<string, Promise<ReturnType<typeof parseEncodedFares>>>();
const hubCache = new Map<string, { at: number; hubs: Station[] }>();

class QueryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function parseStations(text: string): Station[] {
  const stations = new Map<string, Station>();
  for (const row of text.split("@")) {
    const fields = row.split("|");
    if (!fields[1] || !/^[A-Z]{3}$/.test(fields[2] || "") || fields.length < 5) continue;
    stations.set(fields[2], { name: fields[1], code: fields[2], pinyin: fields[3],
      ...(fields[7] ? { city: fields[7], cityCode: fields[6] } : {}) });
  }
  return [...stations.values()];
}

export function seatsFromFields(fields: string[]): Seat[] {
  const definitions: [string, number][] = [
    ["商务座", 32], ["特等座", 25], ["一等座", 31], ["二等座", 30],
    ["高级软卧", 21], ["软卧", 23], ["动卧", 33], ["硬卧", 28],
    ["软座", 24], ["硬座", 29], ["无座", 26],
  ];
  const seats = definitions.map(([label, index]) => {
    const value = fields[index] || "--";
    return { label: label === "一等座" && fields[35]?.includes("D") && !fields[35]?.includes("M") ? "优选一等座" : label,
      value, available: value === "有" || /^[1-9]\d*$/.test(value) };
  });
  return applyFares(seats, intercityFares(seats, parseEncodedFares(fields[39]), fields[3] || "", fields[35] || ""));
}

export function parseTrains(result: string[], names: Record<string, string>, trainCode?: string, trainNo?: string, date?: string) {
  return result.map((row) => {
    const fields = row.split("|");
    const code = fields[3] || "";
    if (!TRAIN_CODE.test(code) || (trainCode && code !== trainCode && (!trainNo || fields[2] !== trainNo))) return null;
    return {
      code,
      from: names[fields[6]] || fields[6],
      to: names[fields[7]] || fields[7],
      departure: fields[8] || "--",
      arrival: fields[9] || "--",
      duration: fields[10] || "--",
      saleStatus: fields[11] || "",
      seats: seatsFromFields(fields),
      fromCode: fields[6], toCode: fields[7], trainNo: fields[2], date,
      originDate: /^\d{8}$/.test(fields[13] || "") ? `${fields[13].slice(0, 4)}-${fields[13].slice(4, 6)}-${fields[13].slice(6)}` : date,
      fareStatus: Object.keys(parseEncodedFares(fields[39])).length ? "available" as const : "missing" as const,
      // The left-ticket response does not identify the physical trainset.
      trainsetModel: null,
    };
  }).filter((train) => train !== null);
}

function json(data: unknown, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store",
      "X-Content-Type-Options": "nosniff",
      // Public, unauthenticated rail queries are also used by the locally bundled native clients.
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function getStations(): Promise<Station[]> {
  if (stationCache && Date.now() - stationCache.at < 24 * 60 * 60 * 1000) return stationCache.stations;
  const response = await fetch(STATIONS_URL, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`12306 车站列表返回 ${response.status}`);
  const stations = parseStations(await response.text());
  if (stations.length < 100) throw new Error("12306 车站列表格式异常");
  stationCache = { at: Date.now(), stations };
  return stations;
}

async function getSessionCookie(): Promise<string> {
  if (sessionCache && Date.now() - sessionCache.at < 20 * 60 * 1000) return sessionCache.cookie;
  if (sessionPending) return sessionPending;
  const request = (async () => {
    const response = await fetch(`${ORIGIN}/otn/leftTicket/init`, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`12306 初始化会话失败：${response.status}`);
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
    const cookies = new Map<string, string>();
    for (const raw of setCookies) {
      for (const match of raw.matchAll(/(?:^|,\s*)([A-Za-z0-9_-]+)=([^;,\s]*)/g)) {
        cookies.set(match[1], match[2]);
      }
    }
    if (cookies.size === 0) throw new Error("12306 未返回查询会话");
    const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    sessionCache = { at: Date.now(), cookie };
    return cookie;
  })();
  sessionPending = request;
  try { return await request; } finally { sessionPending = undefined; }
}

async function getTrainNames(date: string) {
  const cached = trainNamesCache.get(date);
  if (cached && Date.now() - cached.at < 15 * 60000) return cached.routes;
  if (trainNamesPending.has(date)) return trainNamesPending.get(date)!;
  const request = (async () => {
    const url = new URL(`${ORIGIN}/otn/queryTrainInfo/getTrainName`);
    url.searchParams.set("date", date);
    const response = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`12306 按日期车次表返回 ${response.status}`);
    const routes = parseOfficialTrainNames(await response.json());
    if (trainNamesCache.size >= 3) trainNamesCache.delete(trainNamesCache.keys().next().value!);
    trainNamesCache.set(date, { at: Date.now(), routes });
    return routes;
  })();
  trainNamesPending.set(date, request);
  try { return await request; } finally { trainNamesPending.delete(date); }
}
async function searchTrainRoute(date: string, trainCode: string): Promise<TrainRoute> {
  const key = `${date}/${trainCode}`;
  const cached = trainRouteCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.route;
  const search = new URL("https://search.12306.cn/search/v1/train/search");
  search.searchParams.set("keyword", trainCode);
  search.searchParams.set("date", date.replace(/-/g, ""));
  const routes = new Map<string, TrainRoute>();
  try {
    const response = await fetch(search, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(12000) });
    if (response.status === 429) throw new QueryError("12306 车次搜索繁忙，请稍后重试", 503);
    if (!response.ok) throw new Error(`12306 车次搜索返回 ${response.status}`);
    const payload = await response.json() as {
      status?: boolean; errorMsg?: string;
      data?: { date?: string; station_train_code?: string; from_station?: string; to_station?: string; train_no?: string }[];
    };
    if (payload.status !== true || !Array.isArray(payload.data)) throw new Error(payload.errorMsg || "12306 暂未返回可识别的车次资料");
    const matches = payload.data.filter((row) => row?.station_train_code === trainCode && row.date === date.replace(/-/g, ""));
    for (const row of matches) {
      if (typeof row.from_station !== "string" || typeof row.to_station !== "string" || typeof row.train_no !== "string" ||
          !row.from_station.trim() || !row.to_station.trim() || !/^[A-Za-z0-9]{1,32}$/.test(row.train_no)) {
        throw new Error("12306 车次线路资料不完整，请稍后重试");
      }
      const route = { from: row.from_station.trim(), to: row.to_station.trim(), trainNo: row.train_no };
      routes.set(`${route.trainNo}/${route.from}/${route.to}`, route);
    }
  } catch (error) {
    if (error instanceof QueryError) throw error;
    routes.clear();
    // An unavailable keyword index does not imply that the official date-scoped list is empty.
  }
  if (!routes.size) {
    for (const route of (await getTrainNames(date)).get(trainCode) || []) routes.set(`${route.trainNo}/${route.from}/${route.to}`, route);
  }
  if (!routes.size) throw new QueryError(`12306 未找到 ${date} 的 ${trainCode}，请检查日期和车次`, 404);
  if (routes.size !== 1) throw new QueryError("该车次对应多条线路，请改用区间查询", 400);
  const route = [...routes.values()][0];
  if (trainRouteCache.size >= 200) trainRouteCache.delete(trainRouteCache.keys().next().value!);
  trainRouteCache.set(key, { at: Date.now(), route });
  return route;
}
async function getTrainRoute(date: string, trainCode: string) {
  const key = `${date}/${trainCode}`;
  if (trainRoutePending.has(key)) return trainRoutePending.get(key)!;
  const request = searchTrainRoute(date, trainCode);
  trainRoutePending.set(key, request);
  try { return await request; } finally { trainRoutePending.delete(key); }
}

async function getEquipment(date: string, train: string) {
  const key = `${date}/${train}`, cached = equipmentCache.get(key);
  if (cached && Date.now() - cached.at < (cached.value.model ? 10 * 60000 : 60000)) return cached.value;
  if (equipmentPending.has(key)) return equipmentPending.get(key)!;
  const request = (async () => {
    await getTrainRoute(date, train); // Confirm that the service belongs to this origin date.
    const root = `${ORIGIN}/wxxcx/openplatform-inner/miniprogram/wifiapps/appFrontEnd/v2/lounge/open-smooth-common`;
    const car = new URL(`${root}/trainStyleBatch/getCarDetail`);
    for (const [name, value] of Object.entries({ carCode: "", trainCode: train, runningDay: date.replace(/-/g, ""), reqType: "form" })) car.searchParams.set(name, value);
    const duty = new URL(`${root}/qrCode/getDeptByTrainCode`);
    duty.searchParams.set("trainCode", train); duty.searchParams.set("reqType", "form");
    const read = async (url: URL, method: "GET" | "POST") => {
      const now = Date.now(), startAt = Math.max(now, nextEquipmentRequestAt);
      if (startAt - now > 10000) throw new Error("12306 车型查询繁忙，请稍后重试");
      nextEquipmentRequestAt = startAt + 250;
      if (startAt > now) await new Promise<void>(resolve => setTimeout(resolve, startAt - now));
      const response = await fetch(url, { method, headers: { ...REQUEST_HEADERS,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : {}) },
        ...(method === "POST" ? { body: "" } : {}), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`12306 车型接口返回 ${response.status}`);
      return response.json();
    };
    const [carResult, dutyResult] = await Promise.allSettled([read(car, "GET"), read(duty, "POST")]);
    const value = parseOfficialEquipment(carResult.status === "fulfilled" ? carResult.value : null,
      dutyResult.status === "fulfilled" ? dutyResult.value : null, date, Date.now());
    if (equipmentCache.size >= 500) equipmentCache.delete(equipmentCache.keys().next().value!);
    equipmentCache.set(key, { at: Date.now(), value });
    return value;
  })();
  equipmentPending.set(key, request);
  try { return await request; } finally { equipmentPending.delete(key); }
}

async function getTimetable(date: string, train: string, stations: Station[]) {
  const key = `${date}/${train}`, cached = timetableCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60000) return cached;
  if (timetablePending.has(key)) return timetablePending.get(key)!;
  const request = (async () => {
    const route = await getTrainRoute(date, train);
    const url = new URL(`${ORIGIN}/otn/queryTrainInfo/query`);
    url.searchParams.set("leftTicketDTO.train_no", route.trainNo);
    url.searchParams.set("leftTicketDTO.train_date", date);
    url.searchParams.set("rand_code", "");
    const response = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`12306 停站表接口返回 ${response.status}`);
    const payload = await response.json() as OfficialTimetable;
    const names = new Map(stations.map(station => [station.name, station.code]));
    if (Array.isArray(payload.data?.data)) payload.data!.data = payload.data!.data!.map(row => ({ ...row, station_telecode: names.get(row.station_name || "") || "" }));
    const at = Date.now(), journey = parseOfficialJourney(payload, train, date, at);
    if (journey.stops[0].station !== route.from || journey.stops.at(-1)?.station !== route.to) throw new Error("12306 搜索与停站表的始发终到不一致，请稍后重试");
    const value = { at, payload: { ...payload, source: "12306", train, date, checkedAt: at }, journey, trainNo: route.trainNo };
    if (timetableCache.size >= 200) timetableCache.delete(timetableCache.keys().next().value!);
    timetableCache.set(key, value);
    return value;
  })();
  timetablePending.set(key, request);
  try { return await request; } finally { timetablePending.delete(key); }
}

async function getDelays(date: string, train: string, stations: Station[]) {
  const key = `${date}/${train}`, cached = delayCache.get(key);
  if (cached && Date.now() - cached.at < 55000) return cached.report;
  if (delayPending.has(key)) return delayPending.get(key)!;
  const request = (async () => {
    const { journey } = await getTimetable(date, train, stations), now = Date.now();
    const targets = officialDelayTargets(journey, now);
    const responses = await Promise.allSettled(targets.map(async ({ stop, departure }) => {
      const url = new URL("https://hzfw.12306.cn/zgzfw/trainTime/query");
      url.searchParams.set("train_code", stop.trainCode);
      url.searchParams.set("station_name", stop.station);
      url.searchParams.set("from_to", departure ? "1" : "0");
      const response = await fetch(url, { headers: { ...REQUEST_HEADERS, Referer: "https://hzfw.12306.cn/zgzfw/resources/web/zwdcx.html" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`12306 正晚点接口返回 ${response.status}`);
      return parseOfficialDelay(await response.json(), stop, now, departure);
    }));
    const rows = responses.flatMap(response => response.status === "fulfilled" && response.value ? [response.value] : []);
    const report = officialDelayReport(rows, Date.now());
    if (delayCache.size >= 200) delayCache.delete(delayCache.keys().next().value!);
    delayCache.set(key, { at: report.checkedAt, report });
    return report;
  })();
  delayPending.set(key, request);
  try { return await request; } finally { delayPending.delete(key); }
}

async function fetchTicketPayload(url: URL, cookie: string) {
  // Space outbound queries in this service instance; identical routes already share ticketPending.
  const now = Date.now(), startAt = Math.max(now, nextTicketRequestAt);
  if (startAt - now > 10000) throw new QueryError("余票查询繁忙，请稍后重试", 503);
  nextTicketRequestAt = startAt + 250;
  if (startAt > now) await new Promise<void>(resolve => setTimeout(resolve, startAt - now));
  const response = await fetch(url, {
    headers: { ...REQUEST_HEADERS, Cookie: cookie },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`12306 余票接口返回 ${response.status}`);
  if (!response.headers.get("content-type")?.includes("json")) {
    sessionCache = undefined;
    throw new Error("12306 暂时未返回余票数据，请稍后重试或前往官网查询");
  }
  return await response.json() as {
    httpstatus?: number;
    data?: { result?: string[]; map?: Record<string, string>; c_url?: string };
    messages?: string[];
  };
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function getTicketData(date: string, fromCode: string, toCode: string): Promise<TicketData> {
  const key = `${date}/${fromCode}/${toCode}`, cached = ticketCache.get(key);
  if (cached && Date.now() - cached.at < 30000) return cached.data;
  if (ticketPending.has(key)) return ticketPending.get(key)!;
  const request = (async () => {
    const query = new URL(`${ORIGIN}/otn/leftTicket/queryA`);
    query.searchParams.set("leftTicketDTO.train_date", date);
    query.searchParams.set("leftTicketDTO.from_station", fromCode);
    query.searchParams.set("leftTicketDTO.to_station", toCode);
    query.searchParams.set("purpose_codes", "ADULT");
    const cookie = await getSessionCookie();
    let payload = await fetchTicketPayload(query, cookie);
    if (payload.data?.c_url && !payload.data.result) {
      if (!/^leftTicket\/query[A-Z]?$/.test(payload.data.c_url)) throw new Error("12306 返回了未知查询地址");
      query.pathname = `/otn/${payload.data.c_url}`;
      payload = await fetchTicketPayload(query, cookie);
    }
    if (!Array.isArray(payload.data?.result)) throw new Error(payload.messages?.join("；") || "12306 返回了无法识别的余票数据");
    // queryA may return neighbouring city stations too. Never substitute their departure station.
    const data = { result: payload.data.result.filter(row => {
      const fields = row.split("|"); return fields[6] === fromCode && fields[7] === toCode;
    }), map: payload.data.map || {} };
    if (ticketCache.size >= 250) ticketCache.delete(ticketCache.keys().next().value!);
    ticketCache.set(key, { at: Date.now(), data });
    return data;
  })();
  ticketPending.set(key, request);
  try { return await request; } finally { ticketPending.delete(key); }
}

async function getFare(date: string, fromCode: string, toCode: string, train: string) {
  const key = `${date}/${fromCode}/${toCode}/${train}`, cached = fareCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60000) return cached.prices;
  if (farePending.has(key)) return farePending.get(key)!;
  const request = (async () => {
    const rows = (await getTicketData(date, fromCode, toCode)).result.map(row => row.split("|"))
      .filter(fields => fields[3] === train && fields[6] === fromCode && fields[7] === toCode);
    if (rows.length !== 1) throw new QueryError("12306 未返回该车次在所选区间的唯一票价资料", 404);
    const fields = rows[0];
    let prices = parseEncodedFares(fields[39]);
    if (!Object.keys(prices).length) {
      if (!/^[A-Za-z0-9]{1,32}$/.test(fields[2]) || !/^\d{1,3}$/.test(fields[16]) || !/^\d{1,3}$/.test(fields[17]) || !/^[A-Za-z0-9]{1,32}$/.test(fields[35])) throw new Error("12306 票价查询参数不完整");
      const url = new URL(`${ORIGIN}/otn/leftTicket/queryTicketPrice`);
      for (const [name, value] of Object.entries({ train_no: fields[2], from_station_no: fields[16], to_station_no: fields[17], seat_types: fields[35], train_date: date })) url.searchParams.set(name, value);
      const response = await fetch(url, { headers: { ...REQUEST_HEADERS, Cookie: await getSessionCookie() }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`12306 票价接口返回 ${response.status}`);
      const payload = await response.json() as { status?: boolean; data?: unknown };
      if (payload.status !== true) throw new Error("12306 票价查询暂不可用");
      prices = parsePriceResponse(payload.data);
    }
    if (!Object.keys(prices).length) throw new Error("12306 暂未返回可核实票价");
    prices = intercityFares(seatsFromFields(fields), prices, fields[3], fields[35]);
    if (fareCache.size >= 400) fareCache.delete(fareCache.keys().next().value!);
    fareCache.set(key, { at: Date.now(), prices });
    return prices;
  })();
  farePending.set(key, request);
  try { return await request; } finally { farePending.delete(key); }
}

async function getHubs(date: string, from: Station, to: Station, stations: Station[]) {
  const key = `${date}/${from.code}/${to.code}`, cached = hubCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60000) return cached.hubs;
  const url = new URL(`${ORIGIN}/otn/zzzcx/query`);
  for (const [name, value] of Object.entries({ queryDate: date, from_station: from.code, to_station: to.code,
    from_station_name: from.name, to_station_name: to.name, randCode: "", changeStationText: "" })) url.searchParams.set(name, value);
  const response = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`12306 中转节点查询返回 ${response.status}`);
  const payload = await response.json() as { status?: boolean; data?: { flag?: boolean; middleStations?: { station_telecode?: string }[]; isThrough?: string; message?: string } };
  if (payload.status !== true || payload.data?.flag !== true) throw new Error(payload.data?.message || "12306 暂未返回中转节点");
  if (!Array.isArray(payload.data.middleStations) && !["Y", "S"].includes(payload.data.isThrough || "")) throw new Error("12306 中转节点格式变化");
  const byCode = new Map(stations.map(s => [s.code, s]));
  const hubs = [...new Set((payload.data.middleStations || []).map(row => row.station_telecode))].flatMap(code => byCode.has(code || "") ? [byCode.get(code!)!] : []);
  if (hubCache.size >= 100) hubCache.delete(hubCache.keys().next().value!);
  hubCache.set(key, { at: Date.now(), hubs });
  return hubs;
}

export async function onRequestGet(context: { request: Request }) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("mode") || "query";
  if (!["stations", "query", "journey", "delays", "fare", "hubs", "equipment", "board", "board-row", "journey-board"].includes(mode)) return json({ error: "未知查询类型" }, 400);

  try {
    const date = url.searchParams.get("date") || ticketDateRange().min;
    if (["query", "fare", "hubs"].includes(mode)) {
      const error = ticketDateError(date);
      // Reject expired/out-of-sale dates before station/session/upstream requests.
      if (error) return json({ error, code: "INVALID_TICKET_DATE", dateRange: ticketDateRange() }, 400);
    }
    if (mode === "equipment") {
      const date = url.searchParams.get("date") || "", train = (url.searchParams.get("train") || "").trim().toUpperCase();
      if (!isValidDate(date) || !TRAIN_CODE.test(train)) return json({ error: "请填写有效车次和始发日期" }, 400);
      const equipment = await getEquipment(date, train);
      return json({ ...equipment, train }, 200, equipment.model ? 60 : 0);
    }
    const stations = await getStations();
    if (mode === "stations") return json({ stations }, 200, 86400);

    let from = (url.searchParams.get("from") || "").trim();
    let to = (url.searchParams.get("to") || "").trim();
    const trainCode = (url.searchParams.get("train") || "").trim().toUpperCase();
    if (mode === "board" || mode === "board-row") {
      const stationValue = (url.searchParams.get("station") || "").trim();
      const station = stations.find(item => item.code === stationValue || item.name === stationValue);
      const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      const distance = (Date.parse(`${date}T00:00:00+08:00`) - Date.parse(`${today}T00:00:00+08:00`)) / 86400000;
      if (!isValidDate(date) || !station || distance < -13 || distance > 14) return json({ error: "请选择有效 12306 车站及前 13 天至后 14 天内的日期" }, 400);
      const direction = url.searchParams.get("direction") || "D", id = url.searchParams.get("id") || "";
      if (mode === "board-row" && (!["D", "A"].includes(direction) || !/^[A-Za-z0-9]{1,32}\/\d{4}-\d{2}-\d{2}\/(?:[GDCZTKYS]\d{1,4}[A-Z]?|\d{4})$/.test(id))) return json({ error: "请提供有效的大屏车次及到发方向" }, 400);
      const board = await getStationBoard(station, date);
      if (mode === "board") return json(board, 200, 15);
      if (!board.rows.some(row => row.id === id && (direction === "D" ? row.departureAt : row.arrivalAt) !== null)) return json({ error: "该车次不在所选车站的到发列表中" }, 404);
      return json(await getStationBoardRow(board, id, direction as "D" | "A"), 200, 15);
    }
    if (mode === "fare" || mode === "hubs") {
      const fromStation = stations.find(s => s.name === from || s.code === from), toStation = stations.find(s => s.name === to || s.code === to);
      if (!isValidDate(date) || !fromStation || !toStation || fromStation.code === toStation.code || (mode === "fare" && !TRAIN_CODE.test(trainCode))) return json({ error: "请填写有效日期、区间和车次" }, 400);
      if (mode === "hubs") return json({ source: "12306", hubs: await getHubs(date, fromStation, toStation, stations) }, 200, 60);
      return json({ source: "12306", date, train: trainCode, fromCode: fromStation.code, toCode: toStation.code, checkedAt: new Date().toISOString(), prices: await getFare(date, fromStation.code, toStation.code, trainCode) }, 200, 60);
    }
    if (mode === "journey" || mode === "delays" || mode === "journey-board") {
      if (!isValidDate(date) || !TRAIN_CODE.test(trainCode)) return json({ error: "请填写有效车次和始发日期" }, 400);
      if (mode === "journey-board") {
        const requested = url.searchParams.get("stops") || "", realtime = url.searchParams.get("realtime") || "1";
        if (!/^\d{1,3}(?:,\d{1,3}){0,5}$/.test(requested) || !["0", "1"].includes(realtime)) return json({ error: "每次查询需指定 1 至 6 个停站序号" }, 400);
        const indices = requested.split(",").map(Number);
        const { journey, trainNo } = await getTimetable(date, trainCode, stations);
        if (new Set(indices).size !== indices.length || indices.some(index => index >= journey.stops.length || !/^[A-Z]{3}$/.test(journey.stops[index].telecode))) return json({ error: "停站序号不在该车次的官方时刻表中" }, 400);
        return json(await getJourneyBoardStops(journey, trainNo, indices, realtime === "1"), 200, 15);
      }
      if (mode === "journey") return json((await getTimetable(date, trainCode, stations)).payload, 200, 60);
      return json(await getDelays(date, trainCode, stations), 200, 30);
    }
    const search = url.searchParams.get("search") || (from || to ? "route" : trainCode ? "train" : "route");
    if (!isValidDate(date) || !["train", "route"].includes(search) || (trainCode && !TRAIN_CODE.test(trainCode))) {
      return json({ error: "请填写有效的日期、查询方式和车次" }, 400);
    }
    let trainNo: string | undefined;
    if (search === "train") {
      if (!trainCode) return json({ error: "按车次查询时请填写车次，无需填写车站" }, 400);
      const route = await getTrainRoute(date, trainCode);
      from = route.from;
      to = route.to;
      trainNo = route.trainNo;
    } else if (!from || !to) {
      return json({ error: "按区间查询时请填写出发站和到达站，无需填写车次" }, 400);
    }
    const byName = new Map(stations.map((station) => [station.name, station.code]));
    const fromCode = byName.get(from) || (stations.some((s) => s.code === from) ? from : "");
    const toCode = byName.get(to) || (stations.some((s) => s.code === to) ? to : "");
    if (!fromCode || !toCode || fromCode === toCode) return json({ error: "请选择两个不同的 12306 车站" }, 400);

    const data = await getTicketData(date, fromCode, toCode);
    const names = Object.fromEntries(stations.map(s => [s.code, s.name]));
    return json({
      source: "12306",
      checkedAt: new Date().toISOString(),
      date, from, to, fromCode, toCode, trainCode, queryMode: search,
      trains: parseTrains(data.result, { ...names, ...data.map }, trainCode, trainNo, date),
    }, 200, 30);
  } catch (error) {
    return json({ error: railQueryError(error) }, error instanceof QueryError ? error.status : 502);
  }
}

export function railQueryError(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "SyntaxError") return "12306 暂未返回可用资料，请稍后重试或前往官网查询";
  if (name === "AbortError" || name === "TimeoutError") return "12306 查询超时，请稍后重试";
  return error instanceof Error ? error.message : "查询 12306 失败，请稍后重试";
}
