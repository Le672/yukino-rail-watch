import { railApiUrl } from "./rail-api";
import { getRailGoEquipment } from "./railgo";
import { isJourneyDate, TRAIN_CODE } from "./train-position";
import { readEquipmentHistory } from "./rail-equipment-history";
import type { EquipmentHistory } from "./rail-equipment-history";

export type TrainEquipment = {
  model: string | null; owner: string | null; operator: string | null; number: string | null;
  source: "12306" | "RailGo" | "rail.re" | null; scope: "dated" | "reference" | "inferred"; date: string; checkedAt: number;
  history?: EquipmentHistory;
};
export type EquipmentFields = {
  trainsetModel: string | null; trainsetOwner?: string | null; trainOperator?: string | null;
  trainsetSource?: TrainEquipment["source"]; trainsetScope?: TrainEquipment["scope"];
  trainsetNumber?: string | null; trainsetDate?: string; trainsetCheckedAt?: number;
  trainsetHistory?: EquipmentHistory;
};
const detail = (value: unknown): string | null => typeof value === "string" &&
  !["", "-", "--", "未知", "暂无", "null"].includes(value.trim()) && !/[<>\r\n]/.test(value) && value.length <= 100 ? value.trim() : null;
function officialData(payload: unknown): Record<string, unknown> | null {
  const root = payload as { status?: unknown; httpCode?: unknown; content?: { status?: unknown; data?: unknown } } | null;
  return root?.status === 0 && root.httpCode === 200 && root.content?.status === 0 &&
    root.content.data && typeof root.content.data === "object" && !Array.isArray(root.content.data)
    ? root.content.data as Record<string, unknown> : null;
}
/** A dated carriage query is preferred; the undated duty record is explicitly a reference. */
export function parseOfficialEquipment(carPayload: unknown, dutyPayload: unknown, date: string, checkedAt: number): TrainEquipment {
  const car = officialData(carPayload), duty = officialData(dutyPayload);
  const dutyCar = duty?.carInfo && typeof duty.carInfo === "object" && !Array.isArray(duty.carInfo) ? duty.carInfo as Record<string, unknown> : null;
  const datedModel = detail(car?.trainStyle), referenceModel = detail(dutyCar?.trainStyle);
  const operator = [...new Set([detail(duty?.bureauName), detail(duty?.deptName)].filter(Boolean))].join(" · ") || null;
  return { model: datedModel || referenceModel, owner: null, operator,
    number: datedModel ? detail(car?.carCode) : null, source: "12306", scope: datedModel ? "dated" : "reference", date, checkedAt };
}

const cache = new Map<string, { until: number; value: TrainEquipment | null }>();
const pending = new Map<string, Promise<TrainEquipment | null>>();
export async function getOfficialEquipment(train: string, date: string): Promise<TrainEquipment | null> {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) return null;
  const key = `${date}/${train}`, cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  if (pending.has(key)) return pending.get(key)!;
  const request = (async () => {
    let value: TrainEquipment | null = null;
    try {
      const response = await fetch(railApiUrl(new URLSearchParams({ mode: "equipment", train, date })), { signal: AbortSignal.timeout(30000) });
      const raw = await response.json();
      if (!response.ok || !["12306", "rail.re"].includes(raw?.source) || raw.train !== train || raw.date !== date ||
          !["dated", "reference", "inferred"].includes(raw.scope) || !Number.isFinite(raw.checkedAt)) throw new Error("Equipment unavailable");
      const history = raw.scope === "inferred" ? readEquipmentHistory(raw.history, train, date) : null;
      if (raw.scope === "inferred" ? !history || history.source !== raw.source || !history.recentModels.includes(raw.model) : raw.source !== "12306") throw new Error("Unverifiable equipment evidence");
      value = { model: detail(raw.model), owner: null, operator: detail(raw.operator), number: detail(raw.number),
        source: raw.source, scope: raw.scope, date, checkedAt: raw.checkedAt,
        ...(history ? { history, number: null } : {}) };
    } catch { /* Equipment does not block the official ticket/timetable result. */ }
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + (value?.model ? 10 * 60000 : 60000), value });
    return value;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
export async function loadTrainEquipment(train: string, date: string): Promise<TrainEquipment> {
  const official = await getOfficialEquipment(train, date);
  if (official?.model) return official; // Missing vehicle ownership never triggers a third-party request.
  const fallback = await getRailGoEquipment(train, date);
  return { model: fallback?.model ?? null, owner: fallback?.owner ?? null, operator: official?.operator ?? null,
    number: null, source: fallback?.model ? "RailGo" : official?.source ?? null, scope: "reference", date,
    checkedAt: fallback?.checkedAt ?? official?.checkedAt ?? Date.now() };
}
export function equipmentFields(equipment: TrainEquipment): EquipmentFields {
  return { trainsetModel: equipment.model, trainsetOwner: equipment.owner, trainOperator: equipment.operator,
    trainsetSource: equipment.source, trainsetScope: equipment.scope, trainsetNumber: equipment.number,
    trainsetDate: equipment.date, trainsetCheckedAt: equipment.checkedAt, trainsetHistory: equipment.history };
}
export function equipmentLabel(train: EquipmentFields) {
  return `${train.trainsetScope === "inferred" ? "历史推断车型" : train.trainsetScope === "reference" && train.trainsetModel ? "参考车型" : "车型"}：${train.trainsetModel || "暂无可核实资料"}` +
    (train.trainsetScope === "inferred" && train.trainsetHistory ? ` · 最近记录 ${train.trainsetHistory.lastSeen}${train.trainsetHistory.changed ? " · 近期有换型" : ""}` : "") +
    (train.trainOperator ? ` · 担当 ${train.trainOperator}` : "") + (train.trainsetOwner ? ` · 配属 ${train.trainsetOwner}` : "");
}
export function equipmentTitle(train: EquipmentFields) {
  if (!train.trainsetSource) return undefined;
  if (train.trainsetScope === "inferred" && train.trainsetHistory) {
    const h = train.trainsetHistory;
    return `历史推断，非 ${train.trainsetDate || "当天"} 已确认配车。依据 ${h.source} ${h.firstSeen} 至 ${h.lastSeen} 的 ${h.samples} 个开行日${h.source === "12306" ? "计划车型记录（同始终站和内部车次号）" : "车组交路记录（按同车次匹配，无法核验历史始终站）"}，按最近开行车型推断。` +
      (h.changed ? `近 30 天记录出现 ${h.recentModels.join("、")}，近期有换型。` : "") +
      (h.confidence === "limited" ? "样本有限或记录较旧，仅供参考。" : "") + "实际编组可能调整。";
  }
  return `${train.trainsetSource} ${train.trainsetScope === "dated" ? `按 ${train.trainsetDate} 始发日请求的计划车型资料` : "参考车型资料（未绑定指定日期）"}` +
    (train.trainsetNumber ? ` · 车组 ${train.trainsetNumber}` : "") + "；具体编组可能调整。担当为客运运营单位，配属为车辆单位。";
}
