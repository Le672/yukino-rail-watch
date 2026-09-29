import { parseDelays, parseJourney, parseRailwayMap, TRAIN_CODE, isJourneyDate } from "./train-position";
import type { DelayReport, TrainJourney, RailwayMapData } from "./train-position";

const BASE = "https://rg-api.zenglingkun.cn/api/v2/";
type FetchedPayload = { payload: unknown; checkedAt: number };
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<FetchedPayload>>();
async function request(path: string, params: Record<string, string>, ttl: number): Promise<FetchedPayload> {
  const url = new URL(path, BASE);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const key = url.href, cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value as FetchedPayload;
  if (pending.has(key)) return pending.get(key)!;
  const promise = (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const value = await response.json();
    if (!response.ok || value?.success !== true) throw new Error("RailGo 暂未返回可用资料，请检查车次／日期或稍后重试");
    if (cache.size >= 80) cache.delete(cache.keys().next().value!);
    const fetched = { payload: value, checkedAt: Date.now() };
    cache.set(key, { until: fetched.checkedAt + ttl, value: fetched });
    return fetched;
  })();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}
export async function loadJourney(train: string, date: string): Promise<TrainJourney> {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) throw new Error("请填写有效车次和始发日期");
  const params = { trainNum: train, date: date.replace(/-/g, "") };
  const fetched = await request("getTrainMain", params, 15 * 60000);
  return parseJourney(fetched.payload, train, date, fetched.checkedAt);
}
export async function loadDelays(train: string, date: string): Promise<DelayReport> {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) throw new Error("请填写有效车次和始发日期");
  // Cached timestamps are retained; reading cache does not make an old report fresh.
  const fetched = await request("getTrainDelayAll", { trainNum: train, date: date.replace(/-/g, "") }, 55000);
  return parseDelays(fetched.payload, fetched.checkedAt);
}
export async function loadRailway(journey: TrainJourney): Promise<RailwayMapData> {
  const fetched = await request("mapLine", { train: journey.train }, 60 * 60000);
  return parseRailwayMap(fetched.payload, journey);
}
