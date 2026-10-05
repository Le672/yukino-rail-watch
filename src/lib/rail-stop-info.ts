import { railApiUrl } from "./rail-api";
import { emptyBoardDetail } from "./rail-board";
import type { BoardRowDetail, JourneyBoardData } from "./rail-board";
import type { TrainJourney } from "./train-position";

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
export function visibleStopDetail(detail: BoardRowDetail | undefined, now: number, realtime: boolean): BoardRowDetail | undefined {
  if (!detail) return undefined;
  const fresh = realtime && now >= detail.checkedAt - 5000 && now - detail.checkedAt <= 120000 &&
    (detail.sourceAt === null || now >= detail.sourceAt - 5000 && now - detail.sourceAt <= 120000);
  if (fresh) return detail;
  return { ...emptyBoardDetail(detail.id, detail.direction, detail.checkedAt), platform: detail.platform, wicket: detail.wicket };
}
