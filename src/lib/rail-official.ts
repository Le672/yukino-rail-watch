import { isJourneyDate, parseJourney, TRAIN_CODE } from "./train-position";
import type { DelayReport, TimetableStop, TrainDelay, TrainJourney } from "./train-position";

type OfficialStop = {
  station_no?: string; station_name?: string; station_train_code?: string; station_telecode?: string;
  arrive_day_diff?: string; arrive_time?: string; start_time?: string;
};
export type OfficialTimetable = {
  status?: boolean; source?: string; train?: string; date?: string; checkedAt?: number;
  data?: { data?: OfficialStop[] }; messages?: string[];
};

/** Official search identifies the service/date; the timetable supplies the actual ordered stops. */
export function parseOfficialJourney(payload: OfficialTimetable, train: string, date: string, checkedAt = Date.now()): TrainJourney {
  if (!TRAIN_CODE.test(train) || !isJourneyDate(date)) throw new Error("请填写有效车次和始发日期");
  if (payload.source && (payload.source !== "12306" || payload.train !== train || payload.date !== date)) {
    throw new Error("12306 返回的车次或始发日期不符，已停止位置推算");
  }
  const rows = payload.data?.data;
  if (payload.status !== true || !Array.isArray(rows) || rows.length < 2 || rows.length > 400) {
    throw new Error("12306 暂未返回可用停站时刻表，请稍后重试或前往官网查询");
  }
  const ordered = rows.slice().sort((a, b) => Number(a.station_no) - Number(b.station_no));
  if (ordered.some((row, index) => !/^\d{1,3}$/.test(row.station_no || "") || Number(row.station_no) !== index + 1)) {
    throw new Error("12306 停站表站序缺失或重复，无法可靠判断下一站");
  }
  const codes = [...new Set(ordered.map(row => row.station_train_code).filter((code): code is string => typeof code === "string" && TRAIN_CODE.test(code)))];
  if (!codes.includes(train) || Number(ordered[0].arrive_day_diff) !== 0) throw new Error("12306 停站表与所选车次或始发日期不一致");
  const journey = parseJourney({ success: true, data: {
    numberFull: codes, rundays: [date.replace(/-/g, "")],
    timetable: ordered.map(row => ({
      station: row.station_name, stationTelecode: row.station_telecode, trainCode: row.station_train_code,
      day: /^\d{1,2}$/.test(row.arrive_day_diff || "") ? Number(row.arrive_day_diff) : NaN,
      arrive: row.arrive_time, depart: row.start_time,
    })),
  } }, train, date, checkedAt);
  return { ...journey, source: "12306" };
}

/** The official service only publishes the next three hours. Query at most two nearby stops. */
export function officialDelayTargets(journey: TrainJourney, now: number) {
  const first = journey.stops[0];
  if (first.departureAt >= now && first.departureAt <= now + 3 * 3600000) return [{ stop: first, departure: true }];
  return journey.stops.slice(1)
    .filter(stop => stop.arrivalAt >= now - 60 * 60000 && stop.arrivalAt <= now + 3 * 3600000)
    .sort((a, b) => Math.abs(a.arrivalAt - now) - Math.abs(b.arrivalAt - now)).slice(0, 2)
    .map(stop => ({ stop, departure: false }));
}

/** Text clocks are interpreted around the planned stop date, never around the origin date alone. */
export function parseOfficialDelay(payload: unknown, stop: TimetableStop, now: number, departure = false): TrainDelay | null {
  const root = payload as { status?: boolean; data?: unknown } | null;
  if (!root || root.status !== true || typeof root.data !== "string" || root.data.length > 2000) return null;
  const text = root.data.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
  const code = stop.trainCode;
  const service = new RegExp(`(^|[^A-Z0-9])${code}(?![A-Z0-9])`, "i");
  if (!service.test(text) || !text.includes(stop.station)) return null;
  const match = text.match(/时间[为是]([01]\d|2[0-3]):([0-5]\d)/);
  if (!match) return null; // No result, already passed, validation required, etc. are not punctual reports.
  const planned = departure ? stop.departureAt : stop.arrivalAt;
  const plannedDay = Math.floor((planned + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  const clock = Number(match[1]) * 3600000 + Number(match[2]) * 60000;
  const candidates = [-1, 0, 1].map(day => plannedDay + day * 86400000 + clock)
    .filter(time => time >= now - 5 * 60000 && time <= now + 3 * 3600000);
  if (candidates.length !== 1) return null;
  const offset = Math.round((candidates[0] - planned) / 60000);
  if (Math.abs(offset) > 1440) return null;
  return { station: stop.station, telecode: stop.telecode,
    code: `${offset > 0 ? "DELAY" : offset < 0 ? "EARLY" : "ON_TIME"}${/预计/.test(text) ? "_PREDICTION" : ""}`,
    minutes: Math.abs(offset), kind: departure ? "departure" : "arrival" };
}

export const NO_OFFICIAL_DELAY = "12306 仅提供未来 3 小时正晚点；当前暂无可用结果，按官方计划时刻估算。";
export function officialDelayReport(rows: TrainDelay[], checkedAt: number): DelayReport {
  return { source: "12306", rows, checkedAt, warning: rows.length ? undefined : NO_OFFICIAL_DELAY };
}
