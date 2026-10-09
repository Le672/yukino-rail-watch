import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ticketDateError, ticketDateRange } from "../lib/rail-ticket-date";
import { DEFAULT_TRANSFER, searchTransfers } from "../lib/rail-transfer";
import type { Station, Train } from "../lib/rail-tickets";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-09T08:00:00+08:00")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("ticket date window and expired transfer requests", () => {
  it("uses China midnight and includes today plus fourteen days", () => {
    const midnight = Date.parse("2026-10-08T16:00:00Z");
    expect(ticketDateRange(midnight - 1)).toEqual({ min: "2026-10-08", max: "2026-10-22" });
    expect(ticketDateRange(midnight)).toEqual({ min: "2026-10-09", max: "2026-10-23" });
    expect(ticketDateError("2026-10-23")).toBeNull();
    expect(ticketDateError("2026-10-24")).toContain("超出 12306 预售期");
  });

  it.each(["query", "fare", "hubs"])("rejects invalid dates before upstream calls for %s", async mode => {
    vi.resetModules();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { onRequestGet } = await import("../../functions/api/rail");
    for (const date of ["2026-10-07", "2026-10-24", "2026-02-30"]) {
      const response = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=${mode}&date=${date}&from=FCQ&to=IZQ&train=G101`) });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_TICKET_DATE", dateRange: { min: "2026-10-09", max: "2026-10-23" } });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start a transfer search or load urban data for an expired date", async () => {
    const fetchMock = vi.fn(), progress = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(searchTransfers({ ...DEFAULT_TRANSFER, date: "2026-10-07", from: "肇庆东", to: "惠州北", allowUrban: true }, [], new AbortController().signal, progress)).rejects.toThrow("已过期");
    expect(fetchMock).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });

  it("validates read-only POST queries before upstream calls and never caches their errors", async () => {
    vi.resetModules(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { onRequestPost } = await import("../../functions/api/rail");
    for (const mode of ["query", "fare", "hubs"]) {
      const response = await onRequestPost({ request: new Request(`https://cr.yukino.bond/api/rail?mode=${mode}&date=2026-10-07`, { method: "POST" }) });
      expect(response.status).toBe(400); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ code: "INVALID_TICKET_DATE" });
    }
    const unsupported = await onRequestPost({ request: new Request("https://cr.yukino.bond/api/rail?mode=equipment", { method: "POST" }) });
    expect(unsupported.status).toBe(405); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips next-day legs outside the sale window without claiming an upstream failure", async () => {
    const stations: Station[] = ["甲", "乙", "丙"].map((name, index) => ({ name, code: ["AAA", "BBB", "CCC"][index], pinyin: "" }));
    const first: Train = { code: "G1", trainNo: "TRAIN1", from: "甲", to: "乙", fromCode: "AAA", toCode: "BBB", departure: "23:30", arrival: "00:30", duration: "01:00", saleStatus: "Y", trainsetModel: null, seats: [] };
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), "https://cr.yukino.bond");
      return Response.json({ source: "12306", checkedAt: new Date().toISOString(), trains: url.searchParams.get("from") === "AAA" && url.searchParams.get("to") === "BBB" ? [first] : [] });
    }); vi.stubGlobal("fetch", fetchMock);
    const result = await searchTransfers({ ...DEFAULT_TRANSFER, date: "2026-10-23", from: "甲", to: "丙", via: "乙", allowCity: false, stationGroupEndpoints: false }, stations, new AbortController().signal, vi.fn());
    expect(result.warnings.join(" ")).toContain("2026-10-24 的衔接程超出");
    expect(result.serviceUnavailable).toBe(false);
    expect(fetchMock.mock.calls.every(([url]) => new URL(String(url), "https://cr.yukino.bond").searchParams.get("date") === "2026-10-23")).toBe(true);
  });
});
