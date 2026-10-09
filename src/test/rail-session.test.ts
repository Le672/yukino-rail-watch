import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stations = "@x|广州南|IZQ|guangzhounan|gzn|0@x|广州新塘|XWQ|guangzhouxintang|gzxt|1" +
  Array.from({ length: 105 }, (_, i) => `@x|站${i}|Z${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}|station|s|2`).join("");
const request = () => new Request("https://cr.yukino.bond/api/rail?date=2026-10-09&search=route&from=IZQ&to=XWQ");
function data() {
  const row = Array<string>(56).fill("");
  Object.assign(row, { 2: "TRAIN101", 3: "G101", 6: "IZQ", 7: "XWQ", 8: "10:00", 9: "11:00", 10: "01:00", 11: "Y", 13: "20261009", 30: "有", 39: "O005000001" });
  return Response.json({ httpstatus: 200, status: true, data: { result: [row.join("|")], map: {} } });
}
function mockTicket(query: (url: URL, options?: RequestInit) => Response, queryPath = "leftTicket/queryA") {
  let sessions = 0;
  const fetchMock = vi.fn(async (input: string | URL, options?: RequestInit) => {
    const url = new URL(String(input)); expect(url.hostname).toBe("kyfw.12306.cn");
    if (url.pathname.endsWith("station_name.js")) return new Response(stations);
    if (url.pathname.endsWith("leftTicket/init")) return new Response(`var CLeftTicketUrl = '${queryPath}';`, { headers: { "Set-Cookie": `PUBLIC_SESSION=session${++sessions}; Path=/` } });
    return query(url, options);
  });
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
beforeEach(() => { vi.resetModules(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-09T08:00:00+08:00")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("official ticket session and query address", () => {
  it("uses the active query address from the official initialization page", async () => {
    const fetchMock = mockTicket(url => { expect(url.pathname).toBe("/otn/leftTicket/queryG"); return data(); }, "leftTicket/queryG");
    const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: request() });
    expect(response.status).toBe(200); expect((await response.json()).trains).toMatchObject([{ code: "G101" }]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("queryA"))).toBe(false);
  });
  it.each(["root", "nested"])("follows only an official %s address switch with the existing session", async level => {
    const fetchMock = mockTicket((url, options) => {
      expect(new Headers(options?.headers).get("cookie")).toBe("PUBLIC_SESSION=session1");
      return url.pathname.endsWith("queryA") ? Response.json(level === "root" ? { c_url: "leftTicket/queryG", messages: "", status: false } : { data: { c_url: "leftTicket/queryG" } }) : data();
    });
    const { onRequestPost } = await import("../../functions/api/rail");
    expect((await onRequestPost({ request: request() })).status).toBe(200);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("leftTicket/init"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/leftTicket/query"))).toHaveLength(2);
  });
  it.each(["https://example.com/tickets", "leftTicket/queryA"])("rejects external or looping address %s", async target => {
    const fetchMock = mockTicket(() => Response.json({ c_url: target }));
    const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: request() });
    expect(response.status).toBe(503); expect((await response.json()).error).toContain("查询地址");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/leftTicket/query"))).toHaveLength(1);
  });
  it.each([403, 423])("does not reuse a session rejected with HTTP %s on the next retry", async status => {
    let rejected = false;
    const fetchMock = mockTicket((_url, options) => {
      if (!rejected) { rejected = true; return new Response("session rejected", { status }); }
      expect(new Headers(options?.headers).get("cookie")).toBe("PUBLIC_SESSION=session2"); return data();
    });
    const { onRequestGet } = await import("../../functions/api/rail");
    const rejectedResponse = await onRequestGet({ request: request() });
    expect(rejectedResponse.status).toBe(503); expect(rejectedResponse.headers.get("retry-after")).toBe("60");
    const recovered = await onRequestGet({ request: request() });
    expect(recovered.status).toBe(200); expect((await recovered.json()).trains[0].code).toBe("G101");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("leftTicket/init"))).toHaveLength(2);
  });
  it("preserves official string error messages without asserting no trains", async () => {
    mockTicket(() => Response.json({ status: false, messages: "当次查询会话暂不可用" }));
    const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: request() });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "当次查询会话暂不可用" });
  });
  it("accepts valid official ticket JSON even when its MIME header is generic", async () => {
    mockTicket(() => new Response(JSON.stringify({ data: { result: [] }, status: true }), { headers: { "Content-Type": "text/plain" } }));
    const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: request() });
    expect(response.status).toBe(200); expect((await response.json()).trains).toEqual([]);
  });
  it("rejects an official HTML error page and discards its session", async () => {
    let rejected = false;
    mockTicket((_url, options) => {
      if (!rejected) { rejected = true; return new Response("<!doctype html><title>Network error</title>"); }
      expect(new Headers(options?.headers).get("cookie")).toBe("PUBLIC_SESSION=session2"); return data();
    });
    const { onRequestGet } = await import("../../functions/api/rail");
    const failed = await onRequestGet({ request: request() });
    expect(failed.status).toBe(503); expect(failed.headers.get("retry-after")).toBe("5");
    expect(failed.headers.get("content-type")).toContain("application/json"); expect((await failed.json()).error).toContain("未返回余票数据");
    expect((await onRequestGet({ request: request() })).status).toBe(200);
  });
  it("preserves the official rate limit pause instead of retrying an HTTP 429 immediately", async () => {
    mockTicket(() => new Response("rate limited", { status: 429, headers: { "Retry-After": "90" } }));
    const { onRequestPost } = await import("../../functions/api/rail");
    const response = await onRequestPost({ request: request() });
    expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("90");
    expect((await response.json()).error).toContain("429");
  });
});
