import { afterEach, describe, expect, it, vi } from "vitest";
import { indexRailwayGraph, routeRailwayLeg } from "../lib/rail-network";
import { railwayToWgs84 } from "../lib/rail-gps";
import type { RailwayNetworkGraph } from "../lib/rail-network";
import type { TrainJourney } from "../lib/train-position";

const graph: RailwayNetworkGraph = {
  schema: 1, version: "fixture-v1", nodes: [[113,23], [113.01,23], [113.02,23], [113.01,23.01], [113.01,23], [113.01,23.02]],
  edges: [[0,1,1023,200,0],[1,2,1023,200,0],[0,3,1511,350,1],[3,2,1511,350,1],[4,5,2224,120,0]],
  stations: { AAA: { name: "甲站", coordinate: [113,23], candidates: [0] }, BBB: { name: "乙站", coordinate: [113.02,23], candidates: [2] } },
};
const journey: TrainJourney = { train: "G123", codes:["G123"], date:"2026-10-05", checkedAt:1, model:null, owner:null, stops:[
  { station:"甲站", telecode:"AAA", trainCode:"G123", arrival:"10:00", departure:"10:00", arrivalAt:0, departureAt:0, day:0 },
  { station:"乙站", telecode:"BBB", trainCode:"G123", arrival:"10:10", departure:"10:10", arrivalAt:600000, departureAt:600000, day:0 },
] };
afterEach(() => { vi.unstubAllGlobals(); });

describe("cached physical railway graph", () => {
  it("does not join tracks crossing at identical coordinates without a shared OSM node", () => {
    const indexed = indexRailwayGraph(graph);
    expect(routeRailwayLeg(indexed,[0],[5],"K123")).toBeNull();
    expect(routeRailwayLeg(indexed,[0],[2],"K123")?.edges.map(edge=>edge.index)).toEqual([0,1]);
  });
  it("prefers an available high-speed railway for G trains, with a connected real path", () => {
    const leg = routeRailwayLeg(indexRailwayGraph(graph),[0],[2],"G123")!;
    expect(leg.edges.map(edge=>edge.index)).toEqual([2,3]);
    expect(leg.meters).toBe(3022);
  });
  it("does not let normal passenger trains take an industrial or non-standard gauge shortcut", () => {
    const changed = structuredClone(graph); changed.edges[2][4] = 8; changed.edges[3][4] = 4;
    expect(routeRailwayLeg(indexRailwayGraph(changed),[0],[2],"G123")?.edges.map(edge=>edge.index)).toEqual([0,1]);
  });
  it("loads only necessary geometry from our server, coalesces asset reads and keeps WGS84 unchanged", async () => {
    vi.resetModules(); vi.stubGlobal("crypto", {});
    const geometry = { schema:1,version:"fixture-v1",first:0, lines:[
      [graph.nodes[0],graph.nodes[1]], [graph.nodes[1],graph.nodes[2]], [graph.nodes[0],graph.nodes[3]], [graph.nodes[3],graph.nodes[2]], [graph.nodes[4],graph.nodes[5]],
    ] };
    const asset = (file:string,value:unknown) => ({ file, bytes:new TextEncoder().encode(JSON.stringify(value)).length,sha256:"unused-in-fixture" });
    const graphAsset = asset("fixture-v1/graph.json",graph), geometryAsset = { ...asset("fixture-v1/geometry-000.json",geometry), first:0,count:5,bounds:[113,23,113.02,23.02] };
    const manifest = { schema:1,version:"fixture-v1",coordinateSystem:"WGS84",snapshotAt:"2026-10-04T20:20:21Z",graph:graphAsset,overview:asset("fixture-v1/overview.json",{}),
      geometry:[geometryAsset,{ file:"fixture-v1/unused.json",first:5,count:10,bytes:100,sha256:"unused",bounds:[120,40,121,41] }] };
    const fixture = new Map<string, unknown>([ ["/rail-network/manifest.json",manifest],["/rail-network/fixture-v1/graph.json",graph], ["/rail-network/fixture-v1/geometry-000.json",geometry] ]);
    const fetchMock = vi.fn(async (url:string) => { if (!fixture.has(url)) throw new Error("Unexpected source"); return Response.json(fixture.get(url)); });
    vi.stubGlobal("fetch", fetchMock);
    const { loadCachedRailway } = await import("../lib/rail-network");
    const [a,b] = await Promise.all([loadCachedRailway(journey),loadCachedRailway(journey)]);
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(a?.route?.points).toEqual([graph.nodes[0],graph.nodes[3],graph.nodes[2]]);
    expect(a?.route?.source).toBe("server-cache"); expect(a?.route?.inferred).toBe(true); expect(a?.route?.stopDistances[1]).toBeGreaterThan(3);
    expect(b?.route?.lengthKm).toBe(a?.route?.lengthKm); expect(railwayToWgs84(a!.route!).points).toEqual(a?.route?.points);
    const wrongStation = { ...journey,stops:journey.stops.map(stop=>({...stop,station:stop.station+"错"})) };
    expect(await loadCachedRailway(wrongStation)).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
