import { describe, expect, it } from "vitest";
import { buildNetwork } from "../../scripts/update-urban-rail.mjs";
const rings = [{ hole: false, points: [[119, 29], [122, 29], [122, 32], [119, 32], [119, 29]] }];
const nodes = [1, 2, 3, 4].map((id, index) => ({ type: "node", id, tags: { name: index % 2 ? "终点站" : "起点站" }, lat: 30, lon: 120 + (index % 2) * .01 }));
const members = [{ type: "node", ref: 1, role: "stop" }, { type: "node", ref: 2, role: "stop" }, { type: "node", ref: 3, role: "platform" }, { type: "node", ref: 4, role: "platform" }];
const relation = (id: number, tags: Record<string, string>, override = members) => ({ type: "relation", id, tags: { type: "route", route: "subway", name: "测试线路", "public_transport:version": "2", ...tags }, members: override });
describe("national urban map ingestion", () => {
  it("uses stop positions or platforms once, never turns bus names into maglev and excludes closed/partial lines", () => {
    const payload = { osm3s: { timestamp_osm_base: "2026-10-03" }, elements: [...nodes,
      relation(1, {}), relation(2, { route: "bus", name: "磁器口公交" }), relation(3, { construction: "yes" }),
      relation(4, {}, [{ type: "node", ref: 1, role: "stop" }, { type: "node", ref: 9999, role: "stop" }]),
      relation(5, { route: "train", passenger: "suburban", network: "粤港澳大湾区城际", name: "穗深城际" })] };
    const network = buildNetwork(payload, rings, [], 1, 2);
    expect(network.lines).toHaveLength(1); expect(network.lines[0].stops).toEqual(["node/1", "node/2"]); expect(network.lines[0].bidirectional).toBe(false);
  });
  it("uses complete platform names when stop_positions are unnamed and preserves magnetic levitation over generic track tagging", () => {
    const unnamed = nodes.map(node => node.id <= 2 ? { ...node, tags: {} } : node);
    const payload = { elements: [...unnamed, { type: "way", id: 9, tags: { railway: "monorail" } },
      relation(1, { route: "train", name: "磁浮线" }, [...members, { type: "way", ref: 9, role: "" }])] };
    const network = buildNetwork(payload, rings, [], 1, 2);
    expect(network.lines[0].stops).toEqual(["node/3", "node/4"]); expect(network.lines[0].mode).toBe("maglev");
  });
  it("fails incomplete national updates instead of replacing the last snapshot with an empty network", () => {
    expect(() => buildNetwork({ elements: [], remark: "timeout" }, rings)).toThrow(/timeout/);
    expect(() => buildNetwork({ elements: [...nodes, relation(1, {})] }, rings)).toThrow(/unexpectedly small/);
  });
});
