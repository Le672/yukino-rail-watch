import { railApiUrl } from "./rail-api";
import { getRailGoEquipment } from "./railgo";
import { isJourneyDate, TRAIN_CODE } from "./train-position";

export type TrainEquipment = {
  model: string | null; owner: string | null; operator: string | null; number: string | null;
  source: "12306" | "RailGo" | null; scope: "dated" | "reference"; date: string; checkedAt: number;
};
export type EquipmentFields = {
  trainsetModel: string | null; trainsetOwner?: string | null; trainOperator?: string | null;
  trainsetSource?: TrainEquipment["source"]; trainsetScope?: TrainEquipment["scope"];
  trainsetNumber?: string | null; trainsetDate?: string; trainsetCheckedAt?: number;
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
      if (!response.ok || raw?.source !== "12306" || raw.train !== train || raw.date !== date ||
          !["dated", "reference"].includes(raw.scope) || !Number.isFinite(raw.checkedAt)) throw new Error("Official equipment unavailable");
      value = { model: detail(raw.model), owner: null, operator: detail(raw.operator), number: detail(raw.number),
        source: "12306", scope: raw.scope, date, checkedAt: raw.checkedAt };
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
    trainsetDate: equipment.date, trainsetCheckedAt: equipment.checkedAt };
}
export function equipmentLabel(train: EquipmentFields) {
  return `${train.trainsetScope === "reference" && train.trainsetModel ? "参考车型" : "车型"}：${train.trainsetModel || "暂无可核实资料"}` +
    (train.trainOperator ? ` · 担当 ${train.trainOperator}` : "") + (train.trainsetOwner ? ` · 配属 ${train.trainsetOwner}` : "");
}
export function equipmentTitle(train: EquipmentFields) {
  if (!train.trainsetSource) return undefined;
  return `${train.trainsetSource} ${train.trainsetScope === "dated" ? `按 ${train.trainsetDate} 始发日请求的计划车型资料` : "参考车型资料（未绑定指定日期）"}` +
    (train.trainsetNumber ? ` · 车组 ${train.trainsetNumber}` : "") + "；具体编组可能调整。担当为客运运营单位，配属为车辆单位。";
}
