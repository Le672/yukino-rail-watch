import { parseRailwayMap, TRAIN_CODE, isJourneyDate } from "./train-position";
import type { DelayReport, TrainJourney, RailwayMapData } from "./train-position";
import { parseOfficialJourney } from "./rail-official";
import type { OfficialTimetable } from "./rail-official";
import { railApiUrl } from "./rail-api";
import { loadTrainEquipment } from "./rail-equipment";
import { mtrLiveryModel } from "./mtr-vibrant";
import { supplementStationCoordinates } from "./rail-station-coordinates";
import { loadCachedRailway } from "./rail-network";

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
  // The national, versioned network is persisted on our server/CDN. A cache
  // lookup never sends the train or station selection to a third-party API.
  try {
    const cached = await loadCachedRailway(journey);
    if (cached?.route) return cached;
  } catch { /* A source/network failure must not block the official timetable. */ }
  const url = new URL("mapLine", BASE);
  url.searchParams.set("train", journey.train);
  let map: RailwayMapData;
  let payload: unknown;
  try {
    const fetched = await request(url.href, 12 * 60 * 60000);
    payload = fetched.payload;
    map = parseRailwayMap(fetched.payload, journey);
  } catch {
    map = { route: null, stations: journey.stops.map(() => null), warning: "铁路线路暂不可用，按官方时刻表与可核实的车站坐标显示站间模拟位置；GPS 实时位置仍可显示。" };
  }
  if (!map.route) {
    const stations = await supplementStationCoordinates(journey, map.stations);
    // An otherwise usable track may only be missing a newly added station coordinate.
    // Re-run all connection, station-distance and station-order checks after supplementing it.
    if (payload && stations.every(Boolean)) {
      const raw = payload as { data: Record<string, unknown> };
      const repaired = parseRailwayMap({ ...raw, data: { ...raw.data, stations: journey.stops.map((stop, index) => ({ [stop.station]: stations[index] })) } }, journey);
      if (repaired.route) return repaired;
    }
    return { ...map, stations,
      warning: "完整铁路线路暂缺，已保留可核实的停靠站，并按时刻表与加减速过程显示站间模拟位置；该位置未沿铁路径路，GPS 实时位置仍可显示。" };
  }
  return map;
}
