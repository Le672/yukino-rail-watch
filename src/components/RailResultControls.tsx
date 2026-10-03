import { useMemo, useState } from "react";
import { DEFAULT_TRAIN_FILTERS, SORT_OPTIONS, money, sortTrains, trainPrice } from "../lib/rail-tickets";
import type { Train, TrainFilters } from "../lib/rail-tickets";
import "./rail-transfer.css";
export function useTrainListing(trains: Train[] | undefined, seat: string) {
  const [filters, setFilters] = useState<TrainFilters>(DEFAULT_TRAIN_FILTERS);
  const current = useMemo(() => ({ ...filters, seat }), [filters, seat]);
  const visibleTrains = useMemo(() => sortTrains(trains || [], current), [trains, current]);
  return { filters: current, setFilters, visibleTrains };
}
export function RailResultControls({ filters, onChange, trains, count, multi = false }: { filters: TrainFilters; onChange: (value: TrainFilters) => void; trains: Train[]; count: number; multi?: boolean }) {
  const models = [...new Set(trains.flatMap(t => t.trainsetModel ? [t.trainsetModel] : []))].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  return <div className="rail-result-controls" aria-label="排序与筛选">
    <label>排序<select value={filters.sort} onChange={e => onChange({ ...filters, sort: e.target.value as TrainFilters["sort"] })}>{SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>{multi ? "至少一程车型" : "车型筛选"}<select value={filters.model} onChange={e => onChange({ ...filters, model: e.target.value })}><option value="">全部车型</option>{models.map(model => <option key={model}>{model}</option>)}</select></label>
    <label className="rail-control-checkbox"><input type="checkbox" checked={filters.availableOnly} onChange={e => onChange({ ...filters, availableOnly: e.target.checked })}/>{multi ? "仅看全程有票" : "仅看有票"}</label>
    <span className="rail-control-count">{count} {multi ? "个方案" : "趟车"}</span>
  </div>;
}
export function TrainFare({ train, seat }: { train: Train; seat: string }) {
  const price = trainPrice(train, seat);
  return <span className="rail-train-fare"><strong>{money(price)}</strong>{price != null && <small>{seat === "任意席别" ? "最低适用票价" : seat}{!train.seats.some(s => s.available && (seat === "任意席别" || seat === s.label)) ? " · 当前无票" : ""}</small>}</span>;
}
