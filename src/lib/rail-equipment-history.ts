import catalogue from "../data/train-art.json";
import { chinaDateTime, isJourneyDate, TRAIN_CODE } from "./train-position";

export type EquipmentHistory = {
  source: "12306" | "rail.re";
  lastSeen: string; firstSeen: string; samples: number;
  recentModels: string[]; changed: boolean;
  confidence: "recent" | "limited"; evidenceUrl: string;
};
export type EquipmentObservation = {
  train: string; date: string; model: string; source: EquipmentHistory["source"];
};
const DAY = 86400000;
const compact = (value: string) => value.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
// Only explicit catalogue names may be extracted from a unit number. A prefix
// never determines an unrecorded generation, nose, sleeper layout or livery.
const unitModels = catalogue.filter(row => /^[A-Z][A-Z0-9-]*$/.test(row.model))
  .map(row => ({ model: row.model, key: compact(row.model) })).sort((a, b) => b.key.length - a.key.length);
export function modelFromUnit(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 140) return null;
  const units = value.split(/[+＋]/).map(part => compact(part));
  if (!units.length || units.length > 4) return null;
  const models = units.map(unit => {
    const entry = unitModels.find(row => unit.startsWith(row.key) && /^\d{4,5}$/.test(unit.slice(row.key.length)));
    if (!entry) return null;
    if (entry.model === "CRH380A" && /^025[1-9]$/.test(unit.slice(entry.key.length))) return "CRH380A(港铁动感号)";
    return entry.model;
  });
  if (models.some(model => !model)) return null;
  return [...new Set(models)].join("+");
}
export function parseHistoricalUnits(payload: unknown, train: string): EquipmentObservation[] {
  if (!TRAIN_CODE.test(train) || !Array.isArray(payload)) return [];
  return payload.slice(0, 2000).flatMap(row => {
    if (!row || typeof row !== "object" || typeof row.train_no !== "string" ||
      !row.train_no.toUpperCase().split("/").map((code: string) => code.trim()).includes(train) ||
      typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(row.date)) return [];
    const model = modelFromUnit(row.emu_no), date = row.date.slice(0, 10);
    return model && isJourneyDate(date) ? [{ train, date, model, source: "rail.re" as const }] : [];
  });
}

/** Inference uses past runs only; future plans and today's partial records are excluded. */
export function inferHistoricalEquipment(rows: EquipmentObservation[], train: string, date: string, now = Date.now()) {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) return null;
  const today = chinaDateTime(now).slice(0, 10), cutoff = date < today ? date : today;
  const oldest = new Date(Date.parse(`${date}T00:00:00Z`) - 30 * DAY).toISOString().slice(0, 10);
  const past = rows.filter(row => row.train === train && isJourneyDate(row.date) && row.date < cutoff && row.date >= oldest &&
    ["12306", "rail.re"].includes(row.source) && typeof row.model === "string" && row.model.length <= 100 && !/[<>\r\n]/.test(row.model))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!past.length) return null;
  const latest = past[0].date, latestModels = [...new Set(past.filter(row => row.date === latest).map(row => row.model))];
  // Two different assignments on the latest day are ambiguous (e.g. reuse of
  // a service number). Do not hide that conflict by selecting an older day.
  if (latestModels.length !== 1) return null;
  const model = latestModels[0], same = [...new Set(past.filter(row => row.model === model).map(row => row.date))].sort();
  const recentModels = [...new Set(past.map(row => row.model))].slice(0, 8);
  const source = past[0].source;
  const history: EquipmentHistory = { source, lastSeen: latest, firstSeen: same[0], samples: same.length, recentModels,
    changed: recentModels.length > 1,
    confidence: same.length >= 2 && recentModels.length === 1 && Date.parse(`${cutoff}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`) <= 7 * DAY ? "recent" : "limited",
    evidenceUrl: source === "rail.re" ? `https://rail.re/#${train}` : "https://www.12306.cn/" };
  return { model, history };
}

/** Reject malformed or future-dated evidence received across the API boundary. */
export function readEquipmentHistory(raw: unknown, train: string, date: string, now = Date.now()): EquipmentHistory | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as EquipmentHistory, cutoff = [date, chinaDateTime(now).slice(0, 10)].sort()[0];
  if (!["12306", "rail.re"].includes(h.source) || !isJourneyDate(h.firstSeen) || !isJourneyDate(h.lastSeen) ||
    h.firstSeen > h.lastSeen || h.lastSeen >= cutoff || !Number.isInteger(h.samples) || h.samples < 1 || h.samples > 31 ||
    !Array.isArray(h.recentModels) || !h.recentModels.length || h.recentModels.length > 8 ||
    h.recentModels.some(model => typeof model !== "string" || model.length > 100 || /[<>\r\n]/.test(model)) ||
    !["recent", "limited"].includes(h.confidence) || typeof h.changed !== "boolean" ||
    Date.parse(`${date}T00:00:00Z`) - Date.parse(`${h.lastSeen}T00:00:00Z`) > 30 * DAY) return null;
  return { ...h, evidenceUrl: h.source === "rail.re" ? `https://rail.re/#${train}` : "https://www.12306.cn/" };
}
