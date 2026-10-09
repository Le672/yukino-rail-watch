import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RailGatewayError, requestRailData } from "../lib/rail-api";
import { DEFAULT_TRANSFER, searchTransfers, tripFare } from "../lib/rail-transfer";
import type { Station, Train } from "../lib/rail-tickets";

const params = new URLSearchParams({ date: "2026-10-09", search: "route", from: "QAA", to: "QBB" });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T08:00:00+08:00")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const success = () => Response.json({ source: "12306", trains: [] });

describe("transfer gateway recovery", () => {
  it.each([502, 522])("recovers a non-JSON HTTP %s response without replacing it with an empty result", async status => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("error from edge", { status })).mockImplementationOnce(success);
    vi.stubGlobal("fetch", fetchMock);
    const query = requestRailData(params);
    await vi.runAllTimersAsync();
    await expect(query).resolves.toEqual({ source: "12306", trains: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([new TypeError("Failed to fetch"), new DOMException("timeout", "TimeoutError")])("recovers a temporary network failure", async error => {
    const fetchMock = vi.fn().mockRejectedValueOnce(error).mockImplementationOnce(success);
    vi.stubGlobal("fetch", fetchMock);
    const query = requestRailData(params);
    await vi.runAllTimersAsync(); await expect(query).resolves.toMatchObject({ source: "12306" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("honours the server retry interval for rate limits", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "busy" }, { status: 429, headers: { "retry-after": "3" } })).mockImplementationOnce(success);
    vi.stubGlobal("fetch", fetchMock);
    const query = requestRailData(params);
    await vi.advanceTimersByTimeAsync(2999); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await expect(query).resolves.toMatchObject({ source: "12306" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([60, 120])("waits the actual Cloudflare retry interval of %s seconds before recovering", async seconds => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("edge unavailable", { status: 502, headers: { "retry-after": String(seconds) } })).mockImplementationOnce(success);
    vi.stubGlobal("fetch", fetchMock); const onRetry = vi.fn();
    const query = requestRailData(params, undefined, onRetry);
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, delayMs: seconds * 1000, status: 502 });
    await vi.advanceTimersByTimeAsync(1); await expect(query).resolves.toMatchObject({ source: "12306" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { Accept: "application/json" }, cache: "no-store" });
  });
  it("keeps persistent failures after a bounded number of attempts", async () => {
    const fetchMock = vi.fn(() => Response.json({ error: "12306 暂不可用" }, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const rejected = expect(requestRailData(params)).rejects.toMatchObject({ status: 503, message: "12306 暂不可用" });
    await vi.runAllTimersAsync(); await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([400, 404])("never retries a validation or missing-service HTTP %s", async status => {
    const fetchMock = vi.fn(() => Response.json({ error: "请选择有效日期与车站" }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestRailData(params)).rejects.toBeInstanceOf(RailGatewayError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not shorten a long server-requested pause", async () => {
    const fetchMock = vi.fn(() => Response.json({ error: "busy" }, { status: 429, headers: { "retry-after": "300" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestRailData(params)).rejects.toMatchObject({ status: 429, retryAfterMs: 300000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("cancels during backoff without sending another request", async () => {
    const controller = new AbortController(), fetchMock = vi.fn(() => new Response("edge unavailable", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const rejected = expect(requestRailData(params, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await rejected;
    await vi.runAllTimersAsync(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("assembles both actual train legs after a temporary first-leg failure", async () => {
    const stations: Station[] = [{ name: "恢复起点", code: "QAA", pinyin: "" }, { name: "恢复中转", code: "QBB", pinyin: "" }, { name: "恢复终点", code: "QCC", pinyin: "" }];
    const make = (code: string, from: Station, to: Station, departure: string, arrival: string, price: number): Train => ({ code, trainNo: code, date: "2026-10-09", originDate: "2026-10-09", from: from.name, to: to.name, fromCode: from.code, toCode: to.code, departure, arrival, duration: "01:00", saleStatus: "Y", trainsetModel: null, seats: [{ label: "二等座", value: "有", available: true, price }] });
    let firstAttempts = 0;
    const fetchMock = vi.fn((input: string | URL) => {
      const query = new URL(String(input), "https://cr.yukino.bond").searchParams;
      if (query.get("from") === "QAA" && ++firstAttempts === 1) return new Response("edge unavailable", { status: 502 });
      const trains = query.get("from") === "QAA" ? [make("G91", stations[0], stations[1], "09:00", "10:00", 70)] : [make("G92", stations[1], stations[2], "10:30", "11:30", 30)];
      return Response.json({ source: "12306", trains, checkedAt: new Date().toISOString() });
    });
    vi.stubGlobal("fetch", fetchMock);
    const query = searchTransfers({ ...DEFAULT_TRANSFER, date: "2026-10-09", from: stations[0].name, to: stations[2].name, via: stations[1].name, stationGroupEndpoints: false, allowCity: false }, stations, new AbortController().signal, vi.fn());
    await vi.runAllTimersAsync(); const result = await query;
    expect(result.trips).toHaveLength(1); expect(result.trips[0].legs.map(leg => leg.code)).toEqual(["G91", "G92"]);
    expect(tripFare(result.trips[0], "任意席别")).toBe(100);
    expect(result.warnings).toEqual([]); expect(result.serviceUnavailable).toBe(false);
    expect(result.queryCount).toBe(2); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
