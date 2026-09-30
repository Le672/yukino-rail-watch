import timetable from "../data/mtr-vibrant-services.json";

export const MTR_MODEL = "CRH380A(港铁动感号)";
const normalize = (value: string) => value.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
const isMtrOwner = (owner: string) => /^(?:港[铁鐵](?:公司|有限公司)?|香港[铁鐵]路(?:有限公司|公司)?|MTR(?:CORPORATION(?:LIMITED)?)?|石[岗崗](?:动车所|車廠|车厂|列[车車]停放[处處]))$/.test(normalize(owner));
const conventional380A = (model: string) => /^CRH380A(?:\((?:统型|統型)\))?(?:重联)?$/.test(normalize(model));

export function mtrLiveryModel(train: { code: string; trainsetModel: string | null; trainsetOwner?: string | null },
  context: { date: string; fromCode?: string; toCode?: string }): string | null {
  const model = train.trainsetModel;
  // Live operator evidence takes precedence over the published schedule snapshot.
  if (train.trainsetOwner && isMtrOwner(train.trainsetOwner) && model && conventional380A(model)) {
    return MTR_MODEL + (/重联$/.test(normalize(model)) ? " 重联" : "");
  }
  if (train.trainsetOwner && !isMtrOwner(train.trainsetOwner)) return model;
  if (model && !conventional380A(model)) return model;
  const edition = timetable.editions.find(item => context.date >= item.validFrom && (!item.validThrough || context.date <= item.validThrough));
  if (!edition || !/^\d{4}-\d{2}-\d{2}$/.test(context.date)) return model;
  const service = timetable.groups.find(group => group.trains.includes(train.code));
  if (!service || !context.fromCode || !context.toCode) return model;
  const from = service.corridor.indexOf(context.fromCode), to = service.corridor.indexOf(context.toCode);
  const towardsHongKong = Number(train.code.slice(1)) % 2 === 1;
  if (from < 0 || to < 0 || from === to || (towardsHongKong ? from >= to : from <= to)) return model;
  return MTR_MODEL + (model && /重联$/.test(normalize(model)) ? " 重联" : "");
}

export function applyMtrLivery<R extends { date: string; fromCode?: string; toCode?: string; trains: { code: string; trainsetModel: string | null; trainsetOwner?: string | null }[] }>(result: R): R {
  let changed = false;
  const trains = result.trains.map(train => {
    const model = mtrLiveryModel(train, result);
    if (model === train.trainsetModel) return train;
    changed = true;
    return { ...train, trainsetModel: model };
  });
  return changed ? { ...result, trains } : result;
}
