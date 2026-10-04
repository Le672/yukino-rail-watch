import { parseRailwayMap, TRAIN_CODE, isJourneyDate } from "./train-position";
import type { DelayReport, TrainJourney, RailwayMapData } from "./train-position";
import { parseOfficialJourney } from "./rail-official";
import type { OfficialTimetable } from "./rail-official";
import { railApiUrl } from "./rail-api";
import { loadTrainEquipment } from "./rail-equipment";
import { mtrLiveryModel } from "./mtr-vibrant";

const BASE = "https://rg-api.zenglingkun.cn/api/v2/";
type FetchedPayload = { payload: unknown; checkedAt: number };
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<FetchedPayload>>();
async function request(url: string, ttl: number, official = false): Promise<FetchedPayload> {
  const key = url, cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value as FetchedPayload;
  if (pending.has(key)) return pending.get(key)!;
  const promise = (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const value = await response.json();
    if (!response.ok || (official ? value?.source !== "12306" : value?.success !== true)) throw new Error(value?.error || (official ? "12306 暂未返回可用资料，请稍后重试或前往官网查询" : "铁路坐标资料暂不可用"));
    if (cache.size >= 80) cache.delete(cache.keys().next().value!);
    const fetched = { payload: value, checkedAt: official && typeof value.checkedAt === "number" ? value.checkedAt : Date.now() };
    cache.set(key, { until: fetched.checkedAt + ttl, value: fetched });
    return fetched;
  })();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}
export async function loadJourney(train: string, date: string): Promise<TrainJourney> {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) throw new Error("请填写有效车次和始发日期");
  const fetched = await request(railApiUrl(new URLSearchParams({ mode: "journey", train, date })), 15 * 60000, true);
  return parseOfficialJourney(fetched.payload as OfficialTimetable, train, date, fetched.checkedAt);
}
export async function loadDelays(train: string, date: string): Promise<DelayReport> {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) throw new Error("请填写有效车次和始发日期");
  // Cached timestamps are retained; reading cache does not make an old report fresh.
  const fetched = await request(railApiUrl(new URLSearchParams({ mode: "delays", train, date })), 55000, true);
  const report = fetched.payload as DelayReport;
  if (!Array.isArray(report.rows)) throw new Error("12306 正晚点资料暂不可用");
  return { ...report, checkedAt: fetched.checkedAt };
}
export async function loadJourneyEquipment(journey: TrainJourney) {
  const equipment = await loadTrainEquipment(journey.train, journey.date);
  const trainsetModel = mtrLiveryModel({ code: journey.train, trainsetModel: equipment?.model ?? journey.model, trainsetOwner: equipment?.owner ?? journey.owner, trainsetNumber: equipment.number },
    { date: journey.date, fromCode: journey.stops[0].telecode, toCode: journey.stops.at(-1)?.telecode });
  return { model: trainsetModel, owner: equipment.owner, operator: equipment.operator, modelSource: equipment.model ? equipment.source : null,
    modelScope: equipment.model ? equipment.scope : "reference" as const, modelDate: equipment.date, modelNumber: equipment.number, modelCheckedAt: equipment.checkedAt };
}
export async function loadRailway(journey: TrainJourney): Promise<RailwayMapData> {
  const url = new URL("mapLine", BASE);
  url.searchParams.set("train", journey.train);
  const fetched = await request(url.href, 12 * 60 * 60000);
  return parseRailwayMap(fetched.payload, journey);
}
