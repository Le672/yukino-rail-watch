import { railApiUrl } from "./rail-api";
import { emptyBoardDetail } from "./rail-board";
import type { BoardRowDetail, JourneyBoardData } from "./rail-board";
import type { DelayReport, TimetableStop, TrainJourney } from "./train-position";

export async function loadJourneyBoardStops(journey: TrainJourney, indices: number[], realtime: boolean, signal: AbortSignal): Promise<JourneyBoardData> {
  const response = await fetch(railApiUrl(new URLSearchParams({ mode: "journey-board", train: journey.train, date: journey.date,
    stops: indices.join(","), realtime: realtime ? "1" : "0" })), { signal });
  const data = await response.json() as JourneyBoardData & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error || "停站详情暂不可用");
  if (data.source !== "12306" || data.train !== journey.train || data.date !== journey.date || !Array.isArray(data.rows) ||
    data.rows.length !== indices.length || new Set(data.rows.map(row => row.index)).size !== indices.length || data.rows.some(row => {
      const stop = journey.stops[row.index];
      return !indices.includes(row.index) || !stop || row.station !== stop.station || row.stationCode !== stop.telecode || row.train !== stop.trainCode || !row.detail;
    })) throw new Error("停站详情与所选车次或始发日不符");
  return data;
}
/** Planned gates/platforms remain visible; old realtime states and custom-time observations stay unknown. */
export function visibleStopDetail(detail: BoardRowDetail | undefined, now: number, realtime: boolean, report?: DelayReport | null, stop?: TimetableStop): BoardRowDetail | undefined {
  const fresh = detail && realtime && now >= detail.checkedAt - 5000 && now - detail.checkedAt <= 120000 &&
    (detail.sourceAt === null || now >= detail.sourceAt - 5000 && now - detail.sourceAt <= 120000);
  const visible = !detail || fresh ? detail : { ...emptyBoardDetail(detail.id, detail.direction, detail.checkedAt), platform: detail.platform, wicket: detail.wicket };
  if (!realtime || visible && visible.status !== "unknown" || !stop || report?.source !== "12306" ||
    now < report.checkedAt - 5000 || now - report.checkedAt > 120000) return visible;
  // Position already queried the official arrival service. Reuse it even when a delayed stop's planned time has passed.
  const matches = report.rows.filter(row => row.station === stop.station && row.telecode === stop.telecode);
  if (matches.length !== 1 || !/^(?:ON_TIME|DELAY|EARLY)(?:_PREDICTION)?$/.test(matches[0].code) ||
    !Number.isFinite(matches[0].minutes) || matches[0].minutes < 0 || matches[0].minutes > 1440) return visible;
  const row = matches[0];
  return { ...(visible || emptyBoardDetail("", row.kind === "departure" ? "D" : "A", report.checkedAt)), sourceAt: report.checkedAt,
    status: row.code.startsWith("DELAY") ? "late" : row.code.startsWith("EARLY") ? "early" : "on-time",
    minutes: row.minutes, predicted: row.code.endsWith("_PREDICTION") };
}
