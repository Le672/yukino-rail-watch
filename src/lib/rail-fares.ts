import type { Seat } from "./rail-tickets";
export type Fare = { price: number; priceMax?: number };
const CODES: Record<string, string[]> = {
  "商务座": ["9"], "特等座": ["P"], "一等座": ["M"], "优选一等座": ["D"], "二等座": ["O", "S"],
  "高级软卧": ["6", "A"], "软卧": ["4", "I"], "动卧": ["F", "J"], "硬卧": ["3"], "软座": ["2"], "硬座": ["1"], "无座": ["W"],
};
/** Same ten-character encoding as the current 12306 queryLeftTicket_end_js bI renderer. */
export function parseEncodedFares(value: unknown): Record<string, Fare> {
  if (typeof value !== "string" || !value.length || value.length > 3000 || value.length % 10 || !/^(?:[A-Z0-9]\d{9})+$/.test(value)) return {};
  const byCode = new Map<string, number[]>();
  for (let i = 0; i < value.length; i += 10) {
    const block = value.slice(i, i + 10), code = block[6] === "3" ? "W" : block[0], price = Number(block.slice(1, 6)) / 10;
    if (price <= 0) continue;
    byCode.set(code, [...(byCode.get(code) || []), price]);
  }
  return labelledFares(Object.fromEntries([...byCode].map(([code, values]) => [code, { price: Math.min(...values), priceMax: Math.max(...values) }])));
}
function labelledFares(values: Record<string, Fare>) {
  const result: Record<string, Fare> = {};
  for (const [label, codes] of Object.entries(CODES)) {
    const fare = codes.map(code => values[code]).find(Boolean);
    if (fare) result[label] = fare;
  }
  return result;
}
export function parsePriceResponse(data: unknown): Record<string, Fare> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const prices: Record<string, Fare> = {};
  for (const [code, value] of Object.entries(data)) {
    if (typeof value !== "string" || !/^(?:¥|￥|&yen;)\s*\d+(?:\.\d{1,2})?$/.test(value)) continue;
    const price = Number(value.replace(/^(?:¥|￥|&yen;)\s*/, ""));
    if (price > 0 && price < 100000) prices[code === "WZ" ? "W" : code.startsWith("A") ? code.slice(1) : code] = { price };
  }
  return labelledFares(prices);
}
export function applyFares(seats: Seat[], fares: Record<string, Fare>): Seat[] {
  return seats.map(seat => fares[seat.label] ? { ...seat, ...fares[seat.label] } : seat);
}
/** 12306 non-reserved C/S services expose availability in wz_num but fare in the O class. */
export function intercityFares(seats: Seat[], fares: Record<string, Fare>, train: string, seatTypes: string) {
  if (/^[CS]\d/.test(train) && seatTypes === "O" && fares["二等座"] && !fares["无座"] &&
      seats.some(s => s.label === "无座" && s.value !== "--") && seats.every(s => s.label === "无座" || s.value === "--")) {
    return { ...fares, "无座": fares["二等座"] };
  }
  return fares;
}
