import type { UrbanNetwork } from "../src/lib/urban-rail-types";
export function buildNetwork(payload: unknown, regionPolygons: { hole: boolean; points: number[][] }[], extraElements?: unknown[], minimumLines?: number, minimumStops?: number): UrbanNetwork;
