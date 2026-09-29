import { Gauge } from "lucide-react";
import type { SpeedReading } from "../lib/rail-speed";
import type { RailMotionEstimate } from "../lib/rail-motion";

export function RailSpeed({ reading, estimate = null, enabled, live, matched, now, error }: {
  reading: SpeedReading; estimate?: RailMotionEstimate | null; enabled: boolean; live: boolean; matched: boolean; now: number; error: string | null;
}) {
  const measured = enabled && live && !error && reading.kmh !== null;
  const estimated = !measured && estimate?.kmh !== null && estimate?.kmh !== undefined;
  const kmh = measured ? reading.kmh : estimated ? estimate!.kmh : null;
  return <div className={"rail-speed-card" + (kmh !== null ? " is-available" : "")} role="group" aria-label="实时速度">
    <div className="rail-speed-heading"><Gauge size={16} /><span>{estimated ? "预估速度" : "实时速度"}</span><small>km/h</small></div>
    <strong className="rail-speed-value">{kmh !== null ? Math.round(kmh) : "—"}</strong>
    <span className="rail-speed-source">{measured ? reading.source === "device" ? "设备瞬时读数" : "GPS 短时估算" : estimated ? `线路＋时刻表预估 · ${estimate!.stage}` : "等待速度资料"}</span>
    <p>{measured ? reading.source === "device" ? "直接读取设备当前速度。" : <>最近 {reading.sampleSeconds!.toFixed(1)} 秒的定位变化 · 误差参考 ±{Math.ceil(reading.uncertaintyKmh!)} km/h</> : estimated ? estimate!.detail :
      estimate?.reason || (!live ? "查询车次后按观察时间预估速度。" : error || "输入车次并查询；未获得有效测速时按铁路线路与时刻表预估。")}</p>
    {measured && <small className="rail-speed-updated">{Math.max(0, Math.floor((now - reading.timestamp!) / 1000))} 秒前更新{!matched && " · 尚未匹配所选车次，仅表示设备速度"}</small>}
    {estimated && <small className="rail-speed-updated">{live ? "按当前时刻推算" : "按指定观察时刻推算"} · {estimate!.position.phase === "running" ? "分段线性加速、巡航、减速" : "计划停站速度"}<br />临时停车和实际限速可能造成偏差。</small>}
  </div>;
}
