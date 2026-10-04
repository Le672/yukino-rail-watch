import { railApiUrl } from "./rail-api";
import { applyFares } from "./rail-fares";
import type { Fare } from "./rail-fares";
import { equipmentFields, loadTrainEquipment } from "./rail-equipment";
import { mtrLiveryModel } from "./mtr-vibrant";
import { trainIdentity } from "./rail-tickets";
import type { Train } from "./rail-tickets";
const fares = new Map<string, { at: number; value: Record<string, Fare> | null }>();
const pending = new Map<string, Promise<Record<string, Fare> | null>>();
async function ticketFares(train: Train, date: string) {
  const key = trainIdentity(train, date), cached = fares.get(key);
  if (cached && Date.now() - cached.at < (cached.value ? 5 * 60000 : 60000)) return cached.value;
  if (pending.has(key)) return pending.get(key)!;
  const request = (async () => {
    let value: Record<string, Fare> | null = null;
    try {
      const params = new URLSearchParams({ mode: "fare", date: train.date || date, train: train.code, from: train.fromCode || train.from, to: train.toCode || train.to });
      const response = await fetch(railApiUrl(params), { signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || data.source !== "12306" || data.train !== train.code || data.date !== (train.date || date) || !data.prices || typeof data.prices !== "object") throw new Error("Official fare unavailable");
      value = data.prices;
    } catch { /* Unknown fares remain unknown and sort after complete totals. */ }
    if (fares.size >= 500) fares.delete(fares.keys().next().value!);
    fares.set(key, { at: Date.now(), value });
    return value;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
export async function enrichTrainDetails(train: Train, date: string): Promise<Train> {
  const [equipment, prices] = await Promise.all([
    train.trainsetModel && train.trainsetSource !== "RailGo" ? Promise.resolve(train) : loadTrainEquipment(train.code, train.originDate || train.date || date).then(item => {
      const next = { ...train, ...equipmentFields(item) };
      return { ...next, trainsetSource: item.model ? item.source : null, trainsetScope: item.model ? item.scope : "reference" as const,
        trainsetModel: mtrLiveryModel(next, { date: item.date, fromCode: train.fromCode, toCode: train.toCode }) };
    }),
    train.seats.some(s => s.value !== "--" && s.price == null) ? ticketFares(train, date) : Promise.resolve(null),
  ]);
  return { ...equipment, seats: prices ? applyFares(train.seats, prices) : train.seats,
    fareStatus: prices || !train.seats.some(s => s.value !== "--" && s.price == null) ? "available" : "error" };
}
export async function enrichTrainList(trains: Train[], date: string, onBatch: (updates: Train[], completed: number) => void, signal?: AbortSignal) {
  const unique = [...new Map(trains.map(t => [trainIdentity(t, date), t])).values()];
  for (let i = 0; i < unique.length; i += 3) {
    if (signal?.aborted) return;
    const batch = await Promise.all(unique.slice(i, i + 3).map(t => enrichTrainDetails(t, date)));
    if (signal?.aborted) return;
    onBatch(batch, Math.min(i + 3, unique.length));
  }
}
export function mergeTrainDetails<T extends Train>(train: T, updated: Train | undefined): T {
  return updated ? { ...train, trainsetModel: updated.trainsetModel, trainsetOwner: updated.trainsetOwner, trainOperator: updated.trainOperator,
    trainsetSource: updated.trainsetSource, trainsetScope: updated.trainsetScope, trainsetDate: updated.trainsetDate,
    trainsetNumber: updated.trainsetNumber, trainsetCheckedAt: updated.trainsetCheckedAt, seats: updated.seats, fareStatus: updated.fareStatus } : train;
}
