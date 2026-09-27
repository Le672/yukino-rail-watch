type Station = { name: string; code: string; pinyin: string };
type Seat = { label: string; value: string; available: boolean };

const ORIGIN = "https://kyfw.12306.cn";
const STATIONS_URL = `${ORIGIN}/otn/resources/js/framework/station_name.js`;
const REQUEST_HEADERS = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  Referer: `${ORIGIN}/otn/leftTicket/init`,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
};

let stationCache: { at: number; stations: Station[] } | undefined;
let sessionCache: { at: number; cookie: string } | undefined;

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

export function parseTrains(result: string[], names: Record<string, string>, trainCode?: string) {
  return result.map((row) => {
    const fields = row.split("|");
    const code = fields[3] || "";
    if (!/^[GDCZTKYS]\d+[A-Z]?$/.test(code)) return null;
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
  }).filter((train) => train && (!trainCode || train.code === trainCode));
}

function json(data: unknown, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store",
      "X-Content-Type-Options": "nosniff",
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
  if (mode !== "stations" && mode !== "query") return json({ error: "未知查询类型" }, 400);

  try {
    const stations = await getStations();
    if (mode === "stations") return json({ stations }, 200, 86400);

    const date = url.searchParams.get("date") || "";
    const from = (url.searchParams.get("from") || "").trim();
    const to = (url.searchParams.get("to") || "").trim();
    const trainCode = (url.searchParams.get("train") || "").trim().toUpperCase();
    if (!isValidDate(date) || !from || !to || (trainCode && !/^[GDCZTKYS]\d{1,4}[A-Z]?$/.test(trainCode))) {
      return json({ error: "请填写有效的日期、出发站、到达站和车次" }, 400);
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
      date, from, to, trainCode,
      trains: parseTrains(payload.data.result, payload.data.map || {}, trainCode),
    }, 200, 30);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "查询 12306 失败" }, 502);
  }
}
