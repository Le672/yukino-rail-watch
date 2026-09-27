import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Rail from "../Rail";
import { parseStations, parseTrains, seatsFromFields } from "../../functions/api/rail";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

  it("renders the standalone rail monitor", async () => {
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    render(<Rail />);
    expect(screen.getByRole("heading", { name: /余票提醒/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开启监控" })).toBeInTheDocument();
  });
});
