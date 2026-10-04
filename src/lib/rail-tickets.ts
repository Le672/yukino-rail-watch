import type { EquipmentFields } from "./rail-equipment";
export type Station = { name: string; code: string; pinyin: string; city?: string; cityCode?: string };
export type Seat = { label: string; value: string; available: boolean; price?: number; priceMax?: number };
export type Train = EquipmentFields & {
  code: string; from: string; to: string; departure: string; arrival: string; duration: string;
  saleStatus: string; seats: Seat[]; trainsetModel: string | null; trainsetOwner?: string | null;
  fromCode?: string; toCode?: string; date?: string; originDate?: string; trainNo?: string;
  fareStatus?: "available" | "missing" | "error";
};
export type TrainSort = "departure" | "arrival" | "duration" | "price" | "seats" | "model";
export type TrainFilters = { sort: TrainSort; model: string; availableOnly: boolean; seat: string };
export const DEFAULT_TRAIN_FILTERS: TrainFilters = { sort: "departure", model: "", availableOnly: false, seat: "任意席别" };
export const SORT_OPTIONS: [TrainSort, string][] = [["departure", "出发时间"], ["arrival", "到达时间"], ["duration", "总耗时"], ["price", "总票价"], ["seats", "余票优先"], ["model", "车型"]];
export function matchingSeats(train: Train, seat: string) {
  return train.seats.filter(item => item.available && (seat === "任意席别" || item.label === seat));
}
/** Unknown quantities stay unknown: '有' sorts above explicit counts, never means an invented count. */
export function seatScore(train: Train, seat: string) {
  const values = matchingSeats(train, seat).map(s => s.value === "有" ? 100000 : Number(s.value));
  return values.length ? Math.max(...values) : 0;
}
export function trainPrice(train: Train, seat: string): number | null {
  const choices = train.seats.filter(s => s.value !== "--" && (seat === "任意席别" || s.label === seat));
  const available = choices.filter(s => s.available);
  const considered = available.length ? available : choices;
  // An unpriced eligible seat may be cheaper; a partial fare is not an exact minimum.
  if (!considered.length || considered.some(s => !Number.isFinite(s.price) || s.price! <= 0)) return null;
  return Math.min(...considered.map(s => s.price!));
}
export function minutes(value: string): number | null {
  if (!/^\d{1,3}:[0-5]\d$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function money(price: number | null | undefined) {
  return price == null || !Number.isFinite(price) ? "票价暂不可用" : `¥${price.toFixed(1).replace(/\.0$/, "")}`;
}
export function durationLabel(value: number) {
  return `${Math.floor(value / 60)}小时${value % 60 ? ` ${value % 60}分` : ""}`;
}
export function compareNullable(a: number | null, b: number | null) {
  return a == null ? b == null ? 0 : 1 : b == null ? -1 : a - b;
}
export function trainIdentity(train: Train, date = "") {
  return `${train.trainNo || train.code}/${train.date || date}/${train.fromCode || train.from}/${train.toCode || train.to}/${train.departure}`;
}
export function sortTrains(trains: Train[], filters: TrainFilters) {
  return trains.filter(t => (!filters.availableOnly || seatScore(t, filters.seat) > 0) && (!filters.model || t.trainsetModel === filters.model))
    .sort((a, b) => {
      let order = 0;
      if (filters.sort === "price") order = compareNullable(trainPrice(a, filters.seat), trainPrice(b, filters.seat));
      else if (filters.sort === "seats") order = seatScore(b, filters.seat) - seatScore(a, filters.seat);
      else if (filters.sort === "model") order = a.trainsetModel ? b.trainsetModel ? a.trainsetModel.localeCompare(b.trainsetModel, "zh-CN", { numeric: true }) : -1 : b.trainsetModel ? 1 : 0;
      else if (filters.sort === "arrival") order = compareNullable(minutes(a.departure) == null || minutes(a.duration) == null ? null : minutes(a.departure)! + minutes(a.duration)!, minutes(b.departure) == null || minutes(b.duration) == null ? null : minutes(b.departure)! + minutes(b.duration)!);
      else order = compareNullable(minutes(filters.sort === "duration" ? a.duration : a.departure), minutes(filters.sort === "duration" ? b.duration : b.departure));
      return order || (minutes(a.departure) ?? Infinity) - (minutes(b.departure) ?? Infinity) || a.code.localeCompare(b.code, "en", { numeric: true });
    });
}
