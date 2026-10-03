export type UrbanMode = "subway" | "light_rail" | "tram" | "monorail" | "maglev" | "suburban" | "funicular" | "people_mover";
export type UrbanStop = { id: string; name: string; lat: number; lon: number; area: string };
export type UrbanLine = { id: string; name: string; mode: UrbanMode; operator?: string; stops: string[]; bidirectional: boolean; circular?: boolean; duration?: number; hours?: string; interval?: number; colour?: string };
export type RailAnchor = { name: string; lat: number; lon: number; code?: string };
export type UrbanNetwork = { schema: 1; updatedAt: string; sourceDate: string; source: "OpenStreetMap"; stops: UrbanStop[]; lines: UrbanLine[]; anchors: RailAnchor[]; excluded: number };
export type UrbanRide = { lineId: string; line: string; mode: UrbanMode; from: string; to: string; stops: string[]; minutes: number; operator?: string; hours?: string; colour?: string };
export type UrbanRoute = { id: string; rides: UrbanRide[]; minutes: number; walkingMinutes: number; transferMinutes: number; waitingMinutes: number; fare: number | null; estimated: true; operationVerified: false; note: string };
export const URBAN_MODES: Record<UrbanMode, string> = { subway: "地铁", light_rail: "轻轨", tram: "有轨电车", monorail: "单轨", maglev: "磁浮", suburban: "市域轨道", funicular: "轨道缆车", people_mover: "APM／自动导向轨道" };
