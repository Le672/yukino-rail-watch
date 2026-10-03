import { TramFront } from "lucide-react";
import { URBAN_MODES } from "../lib/urban-rail-types";
import type { UrbanRoute } from "../lib/urban-rail-types";
import { money } from "../lib/rail-tickets";
export function UrbanRailRoute({ route, title = "城市轨道接驳（备选）" }: { route: UrbanRoute; title?: string }) {
  return <section className="rail-urban-route" aria-label={title}>
    <header><b><TramFront size={16}/>{title}</b><span>预估 {route.minutes} 分钟 · {route.rides.length - 1} 次换线</span></header>
    <ol>{route.rides.map((ride, index) => <li key={`${ride.lineId}/${index}`}>
      <div className="rail-urban-line"><i style={{ backgroundColor: ride.colour || "var(--rt-ink)" }}/><strong>{ride.line}</strong><small>{URBAN_MODES[ride.mode]}</small></div>
      <p><b>{ride.from}</b><span> → </span><b>{ride.to}</b> · {ride.stops.length - 1} 站 · 乘车预估 {ride.minutes} 分钟</p>
      <details><summary>途经站点与运营资料</summary><p>{ride.stops.join(" → ")}</p><p>{ride.operator || "运营方资料暂缺"} · {ride.hours ? `来源标注时段：${ride.hours}（未核实所选日期）` : "首末班时间暂未核实"}</p></details>
      <small>车型／票价：暂无可核实资料 · 班次／余票：未提供实时数据</small>
    </li>)}</ol>
    <footer><span>步行／出入站约 {route.walkingMinutes} 分钟 · 候车约 {route.waitingMinutes} 分钟 · 换线预留 {route.transferMinutes} 分钟</span><span>{money(route.fare)}，不按零元计算</span><small>{route.note}</small></footer>
  </section>;
}
