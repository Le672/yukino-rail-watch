import { applyMtrLivery, mtrLiveryModel } from "./mtr-vibrant";

const RAILGO_ENDPOINT = "https://data.railgo.zenglingkun.cn/api/train/sts_query";
const CACHE_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

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

const cache = new Map<string, { at: number; trains: RailGoTrain[] | null }>();

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
  if (!/^[A-Z]{3}$/.test(result.fromCode || "") || !/^[A-Z]{3}$/.test(result.toCode || "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(result.date) || result.trains.length === 0) return result;
  const key = `${result.date}/${result.fromCode}/${result.toCode}`;
  let item = cache.get(key);
  if (!item || Date.now() - item.at >= (item.trains === null ? RETRY_MS : CACHE_MS)) {
    const url = new URL(RAILGO_ENDPOINT);
    url.searchParams.set("from", result.fromCode!);
    url.searchParams.set("to", result.toCode!);
    url.searchParams.set("date", result.date.replace(/-/g, ""));
    url.searchParams.set("city", "false");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("RailGo request failed");
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error("RailGo response format changed");
      item = { at: Date.now(), trains: rows };
      cache.set(key, item);
    } catch {
      cache.set(key, { at: Date.now(), trains: null });
      return applyMtrLivery(result);
    }
  }
  if (item.trains === null) return applyMtrLivery(result);
  return matchRailGoModel(result, item.trains, new Date(item.at).toISOString());
}
