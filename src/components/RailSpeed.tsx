import { Gauge } from "lucide-react";
import type { SpeedReading } from "../lib/rail-speed";

export function RailSpeed({ reading, enabled, live, matched, now, error }: {
  reading: SpeedReading; enabled: boolean; live: boolean; matched: boolean; now: number; error: string | null;
}) {
  const available = enabled && live && !error && reading.kmh !== null;
  return <div className={"rail-speed-card" + (available ? " is-available" : "")} role="group" aria-label="实时速度">
    <div className="rail-speed-heading"><Gauge size={16} /><span>实时速度</span><small>km/h</small></div>
    <strong className="rail-speed-value">{available ? Math.round(reading.kmh!) : "—"}</strong>
    <span className="rail-speed-source">{available ? reading.source === "device" ? "设备瞬时读数" : "GPS 短时估算" : "暂未测速"}</span>
    <p>{available ? reading.source === "device" ? "直接读取设备当前速度，不按区间时刻表计算。" : <>最近 {reading.sampleSeconds!.toFixed(1)} 秒的定位变化 · 误差参考 ±{Math.ceil(reading.uncertaintyKmh!)} km/h</> :
      !live ? "自定义观察时间不提供实时测速。" : !enabled ? "乘车时开启 GPS 后开始测速。" : error || reading.reason}</p>
    {available && <small className="rail-speed-updated">{Math.max(0, Math.floor((now - reading.timestamp!) / 1000))} 秒前更新{!matched && " · 尚未匹配所选车次，仅表示设备速度"}</small>}
    <small className="rail-speed-atp">GPS／系统测速 · 未接入 ATP 车载读数</small>
  </div>;
}
