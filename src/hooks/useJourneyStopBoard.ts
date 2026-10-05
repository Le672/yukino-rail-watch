import { useEffect, useState } from "react";
import type { JourneyStopBoard } from "../lib/rail-board";
import { loadJourneyBoardStops } from "../lib/rail-stop-info";
import type { TrainJourney } from "../lib/train-position";

export function useJourneyStopBoard(journey: TrainJourney | null, realtime: boolean) {
  const [rows, setRows] = useState<Record<number, JourneyStopBoard>>({});
  const [warning, setWarning] = useState<string | null>(null);
  const signature = journey ? `${journey.train}/${journey.date}/${journey.stops.map(stop => `${stop.telecode}:${stop.arrivalAt}:${stop.departureAt}`).join(",")}` : "";
  useEffect(() => {
    setRows({}); setWarning(null);
    if (!journey) return;
    const controller = new AbortController();
    let loading = false, initialized = false;
    const refresh = async () => {
      if (loading || document.hidden || controller.signal.aborted) return;
      loading = true;
      const now = Date.now();
      // Fill all station platforms once; refresh only the useful realtime window thereafter.
      const queue = journey.stops.map((stop, index) => ({ stop, index }))
        .filter(({ stop }) => !initialized || realtime && stop.departureAt >= now - 5 * 60000 && stop.arrivalAt <= now + 3 * 3600000)
        .sort((a, b) => Math.abs(a.stop.arrivalAt - now) - Math.abs(b.stop.arrivalAt - now)).map(item => item.index);
      let failed = false;
      const worker = async () => {
        while (queue.length && !controller.signal.aborted) {
          const indices = queue.splice(0, 6);
          try {
            const result = await loadJourneyBoardStops(journey, indices, realtime, controller.signal);
            if (!controller.signal.aborted) setRows(previous => ({ ...previous, ...Object.fromEntries(result.rows.map(row => [row.index, row])) }));
          } catch { if (!controller.signal.aborted) failed = true; }
        }
      };
      await Promise.all([worker(), worker()]);
      if (!controller.signal.aborted) { initialized = !failed; setWarning(failed ? "部分停站详情暂不可用，稍后自动重试；已取得的站台与检票口仍保留。" : null); }
      loading = false;
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [signature, realtime]);
  return { rows, warning };
}
