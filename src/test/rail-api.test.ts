import { afterEach, describe, expect, it, vi } from "vitest";
import { railApiUrl, readRailResponse } from "../lib/rail-api";
import { railQueryError } from "../../functions/api/rail";
afterEach(() => vi.unstubAllGlobals());
describe("official gateway URLs", () => {
  it("refreshes previously cached station responses without removing daily caching or mutating callers", () => {
    const params = new URLSearchParams({ mode: "stations" });
    expect(railApiUrl(params)).toBe("/api/rail?mode=stations&schema=city-v1");
    expect(params.toString()).toBe("mode=stations");
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    expect(railApiUrl(params)).toBe("https://www.yukino.bond/api/rail?mode=stations&schema=city-v1");
  });
  it("uses the local website gateway in browsers and the public gateway in both native platforms", () => {
    const params = new URLSearchParams({ mode: "journey", train: "G101", date: "2026-10-03" });
    expect(railApiUrl(params)).toBe(`/api/rail?${params}`);
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    expect(railApiUrl(params)).toBe(`https://www.yukino.bond/api/rail?${params}`);
  });
});

describe("rail gateway error feedback", () => {
  it.each([200, 502, 522])("handles an HTML response with HTTP %s without leaking a JSON parser error", async status => {
    await expect(readRailResponse(new Response("<!DOCTYPE html><h1>Unavailable</h1>", { status }))).rejects.toThrow("铁路查询服务暂时不可用");
  });
  it("preserves actual query errors and valid data, and rejects missing payloads", async () => {
    await expect(readRailResponse(new Response(JSON.stringify({ error: "请选择有效车站" }), { status: 400 }))).rejects.toThrow("请选择有效车站");
    await expect(readRailResponse(new Response("null"))).rejects.toThrow("资料不完整");
    await expect(readRailResponse(new Response(JSON.stringify({ source: "12306", rows: [] })))).resolves.toEqual({ source: "12306", rows: [] });
  });
  it("translates upstream parsing and timeout failures while keeping useful query validation", () => {
    expect(railQueryError(new SyntaxError("Unexpected token '<'"))).toBe("12306 暂未返回可用资料，请稍后重试或前往官网查询");
    expect(railQueryError(new DOMException("aborted", "TimeoutError"))).toBe("12306 查询超时，请稍后重试");
    expect(railQueryError(new Error("请选择两个不同的 12306 车站"))).toBe("请选择两个不同的 12306 车站");
  });
});
