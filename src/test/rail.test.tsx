import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Rail from "../Rail";
import { parseStations, parseTrains, seatsFromFields } from "../../functions/api/rail";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-27T08:00:00+08:00")); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("12306 result handling", () => {
  it("extracts station names and codes from the official station list format", () => {
    expect(parseStations("var station_names ='@bjb|北京北|VAP|beijingbei|bjb|0@shh|上海虹桥|AOH|shanghaihongqiao|shhq|1';"))
      .toMatchObject([{ name: "北京北", code: "VAP" }, { name: "上海虹桥", code: "AOH" }]);
  });

  it("maps seat positions and only marks real inventory as available", () => {
    const fields = Array(37).fill("");
    fields[30] = "有";
    fields[31] = "2";
    fields[32] = "无";
    fields[26] = "0";
    const seats = seatsFromFields(fields);
    expect(seats.find((seat) => seat.label === "二等座")).toMatchObject({ value: "有", available: true });
    expect(seats.find((seat) => seat.label === "一等座")).toMatchObject({ value: "2", available: true });
    expect(seats.find((seat) => seat.label === "商务座")?.available).toBe(false);
    expect(seats.find((seat) => seat.label === "无座")?.available).toBe(false);
  });

  it("returns only the requested train and leaves unsupported trainset details empty", () => {
    const row = Array(37).fill("");
    row[3] = "G101"; row[6] = "VAP"; row[7] = "AOH";
    row[8] = "08:00"; row[9] = "13:00"; row[10] = "05:00"; row[30] = "1";
    const trains = parseTrains([row.join("|")], { VAP: "北京北", AOH: "上海虹桥" }, "G101");
    expect(trains).toHaveLength(1);
    expect(trains[0]).toMatchObject({ code: "G101", from: "北京北", to: "上海虹桥", trainsetModel: null });
    expect(parseTrains([row.join("|")], {}, "G102")).toHaveLength(0);
  });

  it("rejects an invalid station before making a train query", async () => {
    vi.resetModules();
    const { onRequestGet } = await import("../../functions/api/rail");
    const stations = Array.from({ length: 101 }, (_, index) => `@x|车站${index}|A${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}|station${index}|x|0`).join("");
    const fetchMock = vi.fn().mockResolvedValue(new Response(`var station_names='${stations}';`, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://cr.yukino.bond/api/rail?date=2026-09-27&from=错误站&to=车站1");
    const response = await onRequestGet({ request });
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a 12306 session and parses the live queryA response shape", async () => {
    vi.resetModules();
    const { onRequestGet } = await import("../../functions/api/rail");
    const stations = Array.from({ length: 101 }, (_, index) => `@x|车站${index}|A${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}|station${index}|x|0`).join("");
    const row = Array(37).fill("");
    row[3] = "G101"; row[6] = "AAA"; row[7] = "AAB";
    row[8] = "08:00"; row[9] = "13:00"; row[10] = "05:00"; row[30] = "有";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(`var station_names='${stations}';`))
      .mockResolvedValueOnce(new Response("<html></html>", { headers: { "set-cookie": "JSESSIONID=abc; Path=/" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ httpstatus: 200, data: { result: [row.join("|")], map: { AAA: "车站0", AAB: "车站1" } } }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://cr.yukino.bond/api/rail?date=2026-09-27&from=车站0&to=车站1&train=G101");
    const response = await onRequestGet({ request });
    const body = await response.json() as { trains: { code: string; seats: { label: string; available: boolean }[] }[] };
    expect(response.status).toBe(200);
    expect(body.trains[0].code).toBe("G101");
    expect(body.trains[0].seats.find((seat) => seat.label === "二等座")?.available).toBe(true);
    expect(String(fetchMock.mock.calls[2][0])).toContain("/otn/leftTicket/queryA");
    expect(fetchMock.mock.calls[2][1].headers.Cookie).toContain("JSESSIONID=abc");
  });

  it("renders the rail monitor at the main-site route", async () => {
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    window.history.pushState({}, "", "/cr");
    render(<Rail />);
    expect(screen.getByRole("heading", { name: /余票提醒/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开启监控" })).toBeInTheDocument();
  });
});

const stationFixture = Array.from({ length: 101 }, (_, index) =>
  `@x|车站${index}|A${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}|station${index}|x|0`,
).join("");

function ticketRow(code: string, trainNo = "TEST001") {
  const row = Array(37).fill("");
  row[2] = trainNo; row[3] = code; row[6] = "AAA"; row[7] = "AAB";
  row[8] = "08:00"; row[9] = "13:00"; row[10] = "05:00"; row[30] = "有";
  return row.join("|");
}

function officialFixture(searchRows: unknown[], ticketRows = [ticketRow("G101"), ticketRow("G102", "OTHER002")]) {
  return vi.fn().mockImplementation(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("station_name.js")) return new Response(`var station_names='${stationFixture}';`);
    if (url.hostname === "search.12306.cn") return Response.json({ status: true, data: searchRows });
    if (url.pathname.endsWith("/getTrainName")) return Response.json({ status: true, data: [] });
    if (url.pathname.endsWith("/init")) return new Response("<html></html>", { headers: { "set-cookie": "JSESSIONID=abc; Path=/" } });
    if (url.pathname.endsWith("/queryA")) return Response.json({ data: { result: ticketRows, map: { AAA: "车站0", AAB: "车站1" } } });
    throw new Error(`Unexpected official request: ${url}`);
  });
}

describe("independent train and route searches", () => {
  it("resolves a train without stations and excludes prefix matches", async () => {
    vi.resetModules();
    const { onRequestGet } = await import("../../functions/api/rail");
    const fetchMock = officialFixture([
      { date: "20260929", station_train_code: "G1011", from_station: "错误站", to_station: "车站2", train_no: "OTHER002" },
      { date: "20260929", station_train_code: "G101", from_station: "车站0", to_station: "车站1", train_no: "TEST001" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequestGet({ request: new Request("https://cr.yukino.bond/api/rail?date=2026-09-29&train=g101") });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ queryMode: "train", from: "车站0", to: "车站1", fromCode: "AAA", toCode: "AAB" });
    expect(body.trains.map((train: { code: string }) => train.code)).toEqual(["G101"]);
    const query = fetchMock.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.pathname.endsWith("/queryA"))!;
    expect(query.searchParams.get("leftTicketDTO.from_station")).toBe("AAA");
    expect(query.searchParams.get("leftTicketDTO.to_station")).toBe("AAB");
  });

  it("returns all route trains without requiring a train code or train search", async () => {
    vi.resetModules();
    const { onRequestGet } = await import("../../functions/api/rail");
    const fetchMock = officialFixture([]);
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequestGet({ request: new Request("https://cr.yukino.bond/api/rail?date=2026-09-29&from=车站0&to=车站1") });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.queryMode).toBe("route");
    expect(body.trains.map((train: { code: string }) => train.code)).toEqual(["G101", "G102"]);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("search.12306.cn"))).toBe(false);
  });

  it("recognizes a train's alternate code through the official internal train number", async () => {
    vi.resetModules();
    const { onRequestGet } = await import("../../functions/api/rail");
    vi.stubGlobal("fetch", officialFixture([
      { date: "20260929", station_train_code: "K1233", from_station: "车站0", to_station: "车站1", train_no: "TEST001" },
    ], [ticketRow("K1232"), ticketRow("K1234", "OTHER002")]));
    const response = await onRequestGet({ request: new Request("https://cr.yukino.bond/api/rail?date=2026-09-29&train=K1233") });
    expect(response.status).toBe(200);
    expect((await response.json()).trains.map((train: { code: string }) => train.code)).toEqual(["K1232"]);
  });

  it("does not substitute a different train or a different day's route when lookup fails", async () => {
    vi.resetModules();
    const { onRequestGet } = await import("../../functions/api/rail");
    const fetchMock = officialFixture([
      { date: "20260928", station_train_code: "G101", from_station: "车站0", to_station: "车站1", train_no: "TEST001" },
      { date: "20260929", station_train_code: "G1011", from_station: "车站0", to_station: "车站1", train_no: "TEST001" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequestGet({ request: new Request("https://cr.yukino.bond/api/rail?date=2026-09-29&train=G101") });
    expect(response.status).toBe(404);
    const fallback = fetchMock.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.pathname.endsWith("/getTrainName"));
    expect(fallback?.searchParams.get("date")).toBe("2026-09-29");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("leftTicket/query"))).toBe(false);
  });

  it("allows entering only a train and starting its monitor", async () => {
    localStorage.clear();
    vi.stubGlobal("scrollTo", vi.fn());
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      const url = new URL(input, "https://cr.yukino.bond");
      return url.searchParams.get("mode") === "stations" ? Response.json({ stations: [] }) :
        Response.json({ checkedAt: new Date().toISOString(), date: url.searchParams.get("date"), from: "北京南", to: "上海虹桥", queryMode: "train", trains: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/cr");
    render(<Rail />);
    expect(screen.queryByLabelText("出发站")).toBeNull();
    fireEvent.change(screen.getByLabelText("车次"), { target: { value: "G547" } });
    fireEvent.click(screen.getByRole("button", { name: "开启监控" }));
    await screen.findByRole("heading", { name: "正在监控" });
    await screen.findByText(/北京南 → 上海虹桥 · 全程余票/);
    const query = new URL(fetchMock.mock.calls.find(([url]) => String(url).includes("search=train"))![0], "https://cr.yukino.bond");
    expect(query.searchParams.get("train")).toBe("G547");
    expect(query.searchParams.has("from")).toBe(false);
    expect(query.searchParams.has("to")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "停止监控" }));
  });

  it("switches to route search without carrying over an earlier train filter", async () => {
    localStorage.clear();
    vi.stubGlobal("scrollTo", vi.fn());
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      const url = new URL(input, "https://cr.yukino.bond");
      return url.searchParams.get("mode") === "stations" ? Response.json({ stations: [] }) :
        Response.json({ checkedAt: new Date().toISOString(), date: url.searchParams.get("date"), from: "北京南", to: "上海虹桥", queryMode: "route", trains: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/cr");
    render(<Rail />);
    fireEvent.change(screen.getByLabelText("车次"), { target: { value: "G547" } });
    fireEvent.click(screen.getByRole("button", { name: "按区间查询" }));
    expect(screen.queryByLabelText("车次")).toBeNull();
    fireEvent.change(screen.getByLabelText("出发站"), { target: { value: "北京南" } });
    fireEvent.change(screen.getByLabelText("到达站"), { target: { value: "上海虹桥" } });
    fireEvent.click(screen.getByRole("button", { name: "立即查询" }));
    await screen.findByText(/北京南 → 上海虹桥/);
    const query = new URL(fetchMock.mock.calls.find(([url]) => String(url).includes("search=route"))![0], "https://cr.yukino.bond");
    expect(query.searchParams.get("from")).toBe("北京南");
    expect(query.searchParams.get("to")).toBe("上海虹桥");
    expect(query.searchParams.has("train")).toBe(false);
  });

  it("discards an old query result when the user changes search mode", async () => {
    localStorage.clear();
    vi.stubGlobal("scrollTo", vi.fn());
    let finishQuery: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => String(input).includes("mode=stations") ?
      Promise.resolve(Response.json({ stations: [] })) : new Promise<Response>((resolve) => { finishQuery = resolve; })));
    window.history.pushState({}, "", "/cr");
    render(<Rail />);
    fireEvent.change(screen.getByLabelText("车次"), { target: { value: "G547" } });
    fireEvent.click(screen.getByRole("button", { name: "立即查询" }));
    await waitFor(() => expect(finishQuery).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "按区间查询" }));
    await act(async () => { finishQuery!(Response.json({ checkedAt: new Date().toISOString(), date: "2026-09-29", from: "旧始发", to: "旧终到", trains: [] })); });
    expect(screen.queryByText(/旧始发/)).toBeNull();
    expect(screen.getByLabelText("出发站")).toBeInTheDocument();
  });
});
