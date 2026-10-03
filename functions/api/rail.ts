type Station = { name: string; code: string; pinyin: string };
type Seat = { label: string; value: string; available: boolean };
import { officialDelayReport, officialDelayTargets, parseOfficialDelay, parseOfficialJourney } from "../../src/lib/rail-official";
import type { OfficialTimetable } from "../../src/lib/rail-official";
import type { TrainJourney } from "../../src/lib/train-position";

const ORIGIN = "https://kyfw.12306.cn";
const STATIONS_URL = `${ORIGIN}/otn/resources/js/framework/station_name.js`;
const REQUEST_HEADERS = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  Referer: `${ORIGIN}/otn/leftTicket/init`,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
};

let stationCache: { at: number; stations: Station[] } | undefined;
let sessionCache: { at: number; cookie: string } | undefined;
type TrainRoute = { from: string; to: string; trainNo: string };
const trainRouteCache = new Map<string, { at: number; route: TrainRoute }>();
const TRAIN_CODE = /^(?:[GDCZTKYS]\d{1,4}[A-Z]?|\d{4})$/;
const timetableCache = new Map<string, { at: number; payload: OfficialTimetable; journey: TrainJourney }>();
const timetablePending = new Map<string, Promise<{ at: number; payload: OfficialTimetable; journey: TrainJourney }>>();
const delayCache = new Map<string, { at: number; report: ReturnType<typeof officialDelayReport> }>();
const delayPending = new Map<string, Promise<ReturnType<typeof officialDelayReport>>>();

class QueryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function parseStations(text: string): Station[] {
  const stations = new Map<string, Station>();
  for (const match of text.matchAll(/@[^|@]*\|([^|@]+)\|([A-Z]{3})\|([^|@]*)\|/g)) {
    stations.set(match[2], { name: match[1], code: match[2], pinyin: match[3] });
  }
  return [...stations.values()];
}

export function seatsFromFields(fields: string[]): Seat[] {
  const definitions: [string, number][] = [
    ["商务座", 32], ["特等座", 25], ["一等座", 31], ["二等座", 30],
    ["高级软卧", 21], ["软卧", 23], ["动卧", 33], ["硬卧", 28],
    ["软座", 24], ["硬座", 29], ["无座", 26],
  ];
  return definitions.map(([label, index]) => {
    const value = fields[index] || "--";
    return { label, value, available: value === "有" || /^[1-9]\d*$/.test(value) };
  });
}

export function parseTrains(result: string[], names: Record<string, string>, trainCode?: string, trainNo?: string) {
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
}

async function getTrainRoute(date: string, trainCode: string): Promise<TrainRoute> {
  const key = `${date}/${trainCode}`;
  const cached = trainRouteCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.route;
  const search = new URL("https://search.12306.cn/search/v1/train/search");
  search.searchParams.set("keyword", trainCode);
  search.searchParams.set("date", date.replace(/-/g, ""));
  const response = await fetch(search, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`12306 车次搜索返回 ${response.status}`);
  const payload = await response.json() as {
    status?: boolean; errorMsg?: string;
    data?: { date?: string; station_train_code?: string; from_station?: string; to_station?: string; train_no?: string }[];
  };
  if (payload.status !== true || !Array.isArray(payload.data)) throw new Error(payload.errorMsg || "12306 暂未返回可识别的车次资料");
  const matches = payload.data.filter((row) => row?.station_train_code === trainCode && row.date === date.replace(/-/g, ""));
  if (!matches.length) throw new QueryError(`12306 未找到 ${date} 的 ${trainCode}，请检查日期和车次`, 404);
  const routes = new Map<string, TrainRoute>();
  for (const row of matches) {
    if (typeof row.from_station !== "string" || typeof row.to_station !== "string" || typeof row.train_no !== "string" ||
        !row.from_station.trim() || !row.to_station.trim() || !/^[A-Za-z0-9]{1,32}$/.test(row.train_no)) {
      throw new Error("12306 车次线路资料不完整，请稍后重试");
    }
    const route = { from: row.from_station.trim(), to: row.to_station.trim(), trainNo: row.train_no };
    routes.set(`${route.trainNo}/${route.from}/${route.to}`, route);
  }
  if (routes.size !== 1) throw new QueryError("该车次对应多条线路，请改用区间查询", 400);
  const route = [...routes.values()][0];
  if (trainRouteCache.size >= 200) trainRouteCache.delete(trainRouteCache.keys().next().value!);
  trainRouteCache.set(key, { at: Date.now(), route });
  return route;
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
    const value = { at, payload: { ...payload, source: "12306", train, date, checkedAt: at }, journey };
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

export async function onRequestGet(context: { request: Request }) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("mode") || "query";
  if (!["stations", "query", "journey", "delays"].includes(mode)) return json({ error: "未知查询类型" }, 400);

  try {
    const stations = await getStations();
    if (mode === "stations") return json({ stations }, 200, 86400);

    const date = url.searchParams.get("date") || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let from = (url.searchParams.get("from") || "").trim();
    let to = (url.searchParams.get("to") || "").trim();
    const trainCode = (url.searchParams.get("train") || "").trim().toUpperCase();
    if (mode === "journey" || mode === "delays") {
      if (!isValidDate(date) || !TRAIN_CODE.test(trainCode)) return json({ error: "请填写有效车次和始发日期" }, 400);
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

    const query = new URL(`${ORIGIN}/otn/leftTicket/queryA`);
    query.searchParams.set("leftTicketDTO.train_date", date);
    query.searchParams.set("leftTicketDTO.from_station", fromCode);
    query.searchParams.set("leftTicketDTO.to_station", toCode);
    query.searchParams.set("purpose_codes", "ADULT");
    const cookie = await getSessionCookie();
    let payload = await fetchTicketPayload(query, cookie);
    if (payload.data?.c_url && !payload.data.result) {
      const endpoint = payload.data.c_url;
      if (!/^leftTicket\/query[A-Z]?$/.test(endpoint)) throw new Error("12306 返回了未知查询地址");
      query.pathname = `/otn/${endpoint}`;
      payload = await fetchTicketPayload(query, cookie);
    }
    if (!Array.isArray(payload.data?.result)) throw new Error(payload.messages?.join("；") || "12306 返回了无法识别的余票数据");
    return json({
      source: "12306",
      checkedAt: new Date().toISOString(),
      date, from, to, fromCode, toCode, trainCode, queryMode: search,
      trains: parseTrains(payload.data.result, payload.data.map || {}, trainCode, trainNo),
    }, 200, 30);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "查询 12306 失败" }, error instanceof QueryError ? error.status : 502);
  }
}
