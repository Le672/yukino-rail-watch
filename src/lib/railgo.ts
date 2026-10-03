import { applyMtrLivery, mtrLiveryModel } from "./mtr-vibrant";
import { isJourneyDate, TRAIN_CODE } from "./train-position";

const RAILGO_ENDPOINT = "https://data.railgo.zenglingkun.cn/api/train/query";
const CACHE_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;

export type TrainWithModel = {
  code: string;
  departure: string;
  trainsetModel: string | null;
  trainsetOwner?: string | null;
};

export type RailResult<T extends TrainWithModel> = {
  date: string;
  fromCode?: string;
  toCode?: string;
  trains: T[];
  modelCheckedAt?: string | null;
};

type RailGoTrain = {
  number?: string;
  numberFull?: string[];
  car?: string;
  carOwner?: string;
  fromDepart?: string;
  fromStationTelecode?: string;
  toStationTelecode?: string;
  rundays?: string[];
};

type Equipment = { codes: string[]; dates: string[]; model: string | null; owner: string | null; checkedAt: number };
const cache = new Map<string, { at: number; equipment: Equipment | null }>();
const pending = new Map<string, Promise<Equipment | null>>();
let activeRequests = 0;
const queue: (() => void)[] = [];
async function limit<T>(operation: () => Promise<T>) {
  if (activeRequests >= 3) await new Promise<void>(resolve => queue.push(resolve));
  else activeRequests++;
  try { return await operation(); } finally {
    const next = queue.shift();
    if (next) next(); else activeRequests--;
  }
}
const detail = (value: unknown) => typeof value === "string" && !["", "-", "--", "未知", "暂无", "null"].includes(value.trim()) ? value.trim().slice(0, 80) : null;

/** Only retain equipment fields. Timetables, diagrams, operators and tickets from this response are ignored. */
export async function getRailGoEquipment(train: string, date: string): Promise<Equipment | null> {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) return null;
  let item = cache.get(train);
  if (!item || Date.now() - item.at >= (item.equipment ? CACHE_MS : RETRY_MS)) {
    if (!pending.has(train)) {
      const request = limit(async () => {
        let equipment: Equipment | null = null;
        try {
          const url = new URL(RAILGO_ENDPOINT);
          url.searchParams.set("train", train);
          const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error("RailGo equipment unavailable");
          const raw = await response.json();
          if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.numberFull) || !Array.isArray(raw.rundays)) throw new Error("RailGo equipment format changed");
          equipment = { codes: raw.numberFull.filter((code: unknown) => typeof code === "string" && TRAIN_CODE.test(code)).slice(0, 20),
            dates: raw.rundays.filter((day: unknown) => typeof day === "string" && /^\d{8}$/.test(day)).slice(0, 400),
            model: detail(raw.car), owner: detail(raw.carOwner), checkedAt: Date.now() };
        } catch { /* Equipment failure never replaces official service data. */ }
        if (cache.size >= 300) cache.delete(cache.keys().next().value!);
        cache.set(train, { at: Date.now(), equipment });
        return equipment;
      });
      pending.set(train, request);
      void request.finally(() => pending.delete(train));
    }
    const equipment = await pending.get(train)!;
    item = cache.get(train) || { at: Date.now(), equipment };
  }
  const equipment = item.equipment;
  return equipment?.codes.includes(train) && equipment.dates.includes(date.replace(/-/g, "")) ? equipment : null;
}

export function matchRailGoModel<R extends RailResult<TrainWithModel>>(
  result: R, rows: RailGoTrain[], checkedAt: string,
): R & { modelCheckedAt?: string | null } {
  const compactDate = result.date.replace(/-/g, "");
  return {
    ...result,
    modelCheckedAt: checkedAt,
    trains: result.trains.map((train) => {
      const matches = rows.filter((row) =>
        row && typeof row === "object" &&
        (row.number === train.code || Array.isArray(row.numberFull) && row.numberFull.includes(train.code)) &&
        row.fromStationTelecode === result.fromCode &&
        row.toStationTelecode === result.toCode &&
        row.fromDepart === train.departure &&
        (!Array.isArray(row.rundays) || !row.rundays.length || row.rundays.includes(compactDate)),
      );
      const models = [...new Set(matches.flatMap(row => typeof row.car === "string" &&
        !["", "-", "--", "未知", "暂无", "null"].includes(row.car.trim()) ? [row.car.trim()] : []))];
      if (models.length > 1) return train;
      const owners = [...new Set(matches.flatMap((row) =>
        typeof row.carOwner === "string" && row.carOwner.trim() ? [row.carOwner.trim()] : [],
      ))];
      const enriched = { ...train, trainsetModel: models.length ? models[0].slice(0, 80) : train.trainsetModel,
        trainsetOwner: owners.length === 1 ? owners[0].slice(0, 80) : train.trainsetOwner ?? null };
      return owners.length > 1 ? enriched : { ...enriched, trainsetModel: mtrLiveryModel(enriched, result) };
    }),
  };
}

export async function enrichWithRailGo<R extends RailResult<TrainWithModel>>(result: R): Promise<R & { modelCheckedAt?: string | null }> {
  if (!isJourneyDate(result.date) || !result.trains.length) return result;
  const equipment = new Map(await Promise.all([...new Set(result.trains.filter(train => !train.trainsetModel).map(train => train.code))]
    .map(async code => [code, await getRailGoEquipment(code, result.date)] as const)));
  let changed = false;
  const trains = result.trains.map(train => {
    const item = equipment.get(train.code);
    if (!item?.model && !item?.owner) return train;
    changed = true;
    const next = { ...train, trainsetModel: train.trainsetModel || item.model,
      trainsetOwner: train.trainsetOwner || item.owner };
    return { ...next, trainsetModel: mtrLiveryModel(next, result) };
  });
  const timestamps = [...equipment.values()].flatMap(item => item ? [item.checkedAt] : []);
  return applyMtrLivery(changed ? { ...result, trains, modelCheckedAt: new Date(Math.min(...timestamps)).toISOString() } : result);
}
