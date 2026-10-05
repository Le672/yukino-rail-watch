import { chinaDateTime, isJourneyDate, TRAIN_CODE } from "./train-position";

export type BoardDirection = "D" | "A";
export type BoardStatus = "unknown" | "on-time" | "early" | "late" | "cancelled" | "not-running" | "arrived";
export type CheckInStatus = "unknown" | "waiting" | "checking" | "closed";
export type BoardRow = {
  id: string; train: string; trainNo: string; originDate: string;
  from: string; to: string; fromCode: string; toCode: string;
  arrival: string | null; departure: string | null; arrivalAt: number | null; departureAt: number | null;
  dwellMinutes: number | null; model: string | null;
};
export type StationBoardData = {
  source: "12306"; station: string; stationCode: string; date: string; checkedAt: number; rows: BoardRow[];
};
export type BoardRowDetail = {
  id: string; direction: BoardDirection; checkedAt: number; sourceAt: number | null;
  platform: string | null; wicket: string | null; status: BoardStatus; minutes: number | null;
  predicted: boolean; checkIn: CheckInStatus; warning?: string;
};
export const BOARD_STATUS_TEXT: Record<BoardStatus, string> = {
  unknown: "未提供", "on-time": "正点", early: "早点", late: "晚点", cancelled: "取消", "not-running": "当日不开行", arrived: "已到站",
};
export const CHECK_IN_TEXT: Record<CheckInStatus, string> = { unknown: "未提供", waiting: "候车", checking: "检票中", closed: "停检" };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 100) => typeof value === "string" && value.trim() && !/^(?:-+|null|undefined)$/.test(value.trim()) ? value.trim().slice(0, max) : null;
export function boardClock(value: unknown): string | null {
  const raw = text(value, 5);
  const clock = raw && /^\d{4}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
  return clock && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : null;
}
const dateFromCompact = (value: unknown) => typeof value === "string" && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : null;

/** The query date is the day at this station, not the train's origin date. */
export function parseStationBoard(payload: unknown, station: { name: string; code: string }, date: string, checkedAt = Date.now()): StationBoardData {
  const root = record(payload);
  if (!isJourneyDate(date) || root.status !== true || !Array.isArray(root.data) || root.data.length > 3000) throw new Error("12306 暂未提供有效车站到发数据");
  const rows = new Map<string, BoardRow>();
  for (const value of root.data) {
    const row = record(value), train = text(row.station_train_code), trainNo = text(row.train_no, 32);
    const stationDate = dateFromCompact(row.station_train_date), originDate = dateFromCompact(row.start_train_date);
    if (row.station_telecode !== station.code || stationDate !== date || !originDate || !isJourneyDate(originDate) ||
        !train || !TRAIN_CODE.test(train) || !trainNo || !/^[A-Za-z0-9]{1,32}$/.test(trainNo)) continue;
    const fromCode = text(row.start_station_telecode, 3), toCode = text(row.end_station_telecode, 3);
    const from = text(row.start_station_name), to = text(row.end_station_name);
    if (!from || !to || !fromCode || !toCode || !/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) continue;
    const arrival = fromCode === station.code ? null : boardClock(row.arrive_time);
    // Terminal stations sometimes repeat the arrival in start_time; it is not a departure.
    const departure = toCode === station.code ? null : boardClock(row.start_time);
    if (!arrival && !departure) continue;
    const originAt = Date.parse(`${originDate}T00:00:00+08:00`), stationAt = Date.parse(`${date}T00:00:00+08:00`);
    const arriveDay = Number(row.arrive_day_diff), departDay = Number(row.start_day_diff);
    const arrivalAt = arrival ? stationAt + (Number(arrival.slice(0, 2)) * 60 + Number(arrival.slice(3))) * 60000 : null;
    let departureAt = departure ? stationAt + (Number(departure.slice(0, 2)) * 60 + Number(departure.slice(3))) * 60000 : null;
    if (arrivalAt !== null && departureAt !== null && departureAt < arrivalAt) departureAt += 86400000;
    // Refuse conflicting run-day fields; never attach yesterday's train to today's screen.
    if (arrivalAt !== null && Number.isInteger(arriveDay) && originAt + arriveDay * 86400000 !== stationAt) continue;
    if (departureAt !== null && Number.isInteger(departDay) && originAt + departDay * 86400000 !== Date.parse(`${chinaDateTime(departureAt).slice(0, 10)}T00:00:00+08:00`)) continue;
    const dwellMinutes = arrivalAt !== null && departureAt !== null ? (departureAt - arrivalAt) / 60000 : null;
    const id = `${trainNo}/${originDate}/${train}`;
    rows.set(id, { id, train, trainNo, originDate, from, to, fromCode, toCode, arrival, departure, arrivalAt, departureAt,
      dwellMinutes: dwellMinutes !== null && dwellMinutes >= 0 && dwellMinutes <= 720 ? dwellMinutes : null,
      model: text(row.jiaolu_train_style, 80) });
  }
  if (root.data.length && !rows.size) throw new Error("12306 返回的车站或日期与查询不符，已停止展示");
  return { source: "12306", station: station.name, stationCode: station.code, date, checkedAt, rows: [...rows.values()] };
}

export function emptyBoardDetail(id: string, direction: BoardDirection, checkedAt = Date.now()): BoardRowDetail {
  return { id, direction, checkedAt, sourceAt: null, platform: null, wicket: null, status: "unknown", minutes: null, predicted: false, checkIn: "unknown" };
}
/** Only explicit platform is a platform. platform_no in queryTrainByStation often holds gate names. */
export function parseBoardExit(payload: unknown): { platform: string | null; wicket: string | null } {
  const root = record(payload), data = record(root.data);
  if (root.status !== true) return { platform: null, wicket: null };
  return { platform: text(data.platform, 40), wicket: text(data.wicket, 160) };
}

export function parseBoardOperating(payload: unknown, originDate: string): boolean | null {
  const root = record(payload), data = record(root.data);
  if (root.status !== true || !Array.isArray(data.running_list)) return null;
  const candidates = data.running_list.map(record).filter(item => item.date === originDate.replace(/-/g, ""));
  if (candidates.length !== 1) return null;
  return candidates[0].flag === "1" ? true : candidates[0].flag === "0" ? false : null;
}

/** Official numeric status: 1/2/3 check-in, 4/5/6 service, 7 arrived, 8 cancelled. */
export function parseBoardRealtime(payload: unknown, board: StationBoardData, row: BoardRow, direction: BoardDirection, now = Date.now()): Partial<BoardRowDetail> | null {
  const outer = record(payload), root = outer.content ? record(outer.content) : outer;
  if (root.status !== true && root.status !== 0) return null;
  if (!Array.isArray(root.data)) return null;
  const candidates = root.data.map(record).filter(item => item.currentStationCode === board.stationCode && item.stationTrainCode === row.train);
  if (candidates.length !== 1) return null;
  const item = candidates[0], sourceAt = Number(item.updateTime), serviceAt = Number(direction === "D" ? item.departTime : item.arriveTime);
  const plannedAt = direction === "D" ? row.departureAt : row.arrivalAt;
  if (!Number.isFinite(sourceAt) || Math.abs(now - sourceAt) > 120000 || !Number.isFinite(serviceAt) || !plannedAt ||
      (item.fullTrainCode && item.fullTrainCode !== row.trainNo) || Math.abs(serviceAt - plannedAt) > 12 * 3600000) return null;
  const code = Number(item.status), rawDelay = item.delay;
  const offset = rawDelay === null || rawDelay === undefined || rawDelay === "" ? null : Number(rawDelay);
  const minutes = offset !== null && Number.isFinite(offset) && Math.abs(offset) <= 1440 ? Math.abs(offset) : null;
  const checkIn: CheckInStatus = direction === "D" ? code === 1 ? "waiting" : code === 2 ? "checking" : code === 3 ? "closed" : "unknown" : "unknown";
  const status: BoardStatus = code === 8 ? "cancelled" : minutes !== null && offset! < 0 ? "early" : minutes !== null && offset! > 0 ? "late" : code === 4 ? "on-time" : code === 5 || code === 6 ? "late" : code === 7 ? "arrived" : "unknown";
  return { sourceAt, checkIn, status, minutes, predicted: code === 6 };
}

export function boardStatusText(detail?: BoardRowDetail) {
  if (!detail) return "未提供";
  const value = BOARD_STATUS_TEXT[detail.status];
  return `${detail.predicted ? "预计" : ""}${value}${(detail.status === "early" || detail.status === "late") && detail.minutes !== null ? ` ${detail.minutes} 分钟` : ""}`;
}
export function boardRows(board: StationBoardData, direction: BoardDirection, search: string, upcoming: boolean, now: number): BoardRow[] {
  const query = search.trim().toUpperCase();
  const time = (row: BoardRow) => direction === "D" ? row.departureAt : row.arrivalAt;
  return board.rows.filter(row => time(row) !== null && (!query || `${row.train} ${row.from} ${row.to}`.toUpperCase().includes(query)) &&
    (!upcoming || time(row)! >= now - 5 * 60000))
    .sort((a, b) => time(a)! - time(b)! || a.train.localeCompare(b.train));
}
