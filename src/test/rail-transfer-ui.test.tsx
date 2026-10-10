import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RailTransfer } from "../components/RailTransfer";
import type { Train, Station } from "../lib/rail-tickets";
const stations: Station[] = [{ name: "深圳北", code: "IOQ", pinyin: "", city: "深圳" }, { name: "广州南", code: "IZQ", pinyin: "", city: "广州" }, { name: "番禺", code: "PYA", pinyin: "", city: "广州" }, { name: "西平西", code: "EGQ", pinyin: "", city: "东莞" }];
const make = (code: string, fromCode: string, toCode: string, departure: string, arrival: string, duration: string, price: number, model: string, value = "有"): Train => ({ code, trainNo: `TRAIN${code}`, fromCode, toCode, from: stations.find(s => s.code === fromCode)!.name, to: stations.find(s => s.code === toCode)!.name, departure, arrival, duration, saleStatus: "Y", trainsetModel: model, date: "2026-10-04", originDate: code === "G2" ? "2026-10-03" : "2026-10-04", seats: [{ label: "二等座", value, available: value === "有", price }] });
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-04T08:00:00+08:00")); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("updates an expired saved date while preserving stations and transfer choices", () => {
  localStorage.setItem("yukino-rail-transfer-v1", JSON.stringify({ date: "2026-10-02", from: "深圳北", to: "西平西", via: "广州南", minimum: 35 }));
  render(<RailTransfer stations={stations} onPosition={vi.fn()}/>);
  expect(screen.getByLabelText("首程乘车日期")).toHaveValue("2026-10-04");
  expect(screen.getByLabelText("出发站")).toHaveValue("深圳北");
  expect(screen.getByLabelText("中转站 1（可选）")).toHaveValue("广州南");
  expect(screen.getByLabelText("同站最短预留（分钟）")).toHaveValue(35);
  expect(screen.getByRole("status")).toHaveTextContent("2026-10-02 已过期，已更新为今天 2026-10-04");
  expect(screen.getByLabelText("首程乘车日期")).toHaveAttribute("min", "2026-10-04");
  expect(screen.getByLabelText("首程乘车日期")).toHaveAttribute("max", "2026-10-18");
});

it("retains a saved future travel date", () => {
  localStorage.setItem("yukino-rail-transfer-v1", JSON.stringify({ date: "2026-10-08", from: "深圳北" }));
  render(<RailTransfer stations={stations} onPosition={vi.fn()}/>);
  expect(screen.getByLabelText("首程乘车日期")).toHaveValue("2026-10-08");
  expect(screen.queryByText(/已更新为今天/)).not.toBeInTheDocument();
});

it("makes the metro bridge discoverable and labels Panyu intercity alternatives which omit via2", async () => {
  vi.setSystemTime(new Date("2026-10-09T08:00:00+08:00"));
  const { officialStationCatalog } = await import("../lib/rail-official-stations");
  const all = officialStationCatalog([...stations, { name: "广州新塘", code: "XWQ", pinyin: "", city: "广州" }, { name: "惠州北", code: "HUA", pinyin: "", city: "惠州" }]);
  const raw = (code: string, fromCode: string, toCode: string, departure: string, arrival: string, duration: string): Train => ({ code, trainNo: code, fromCode, toCode, from: all.find(s => s.code === fromCode)!.name, to: all.find(s => s.code === toCode)!.name,
    departure, arrival, duration, saleStatus: "Y", trainsetModel: "CRH6A", date: "2026-10-09", originDate: "2026-10-09", seats: [{ label: "二等座", value: "有", available: true, price: 50 }] });
  const services = [raw("G9101", "IOQ", "IZQ", "09:00", "10:00", "01:00"), raw("G9103", "XWQ", "HUA", "14:00", "15:00", "01:00"), raw("C9105", "PYA", "KBA", "10:30", "13:30", "03:00")];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const q = new URL(String(input), "https://cr.yukino.bond").searchParams;
    return Response.json({ source: "12306", checkedAt: new Date().toISOString(), trains: services.filter(t => t.fromCode === q.get("from") && t.toCode === q.get("to") && t.date === q.get("date")) });
  }));
  const { container } = render(<RailTransfer stations={all} onPosition={vi.fn()}/>);
  for (const [label, value] of [["出发站", "深圳北"], ["到达站", "惠州北"], ["中转站 1（可选）", "广州南"], ["最多中转", "2"], ["中转站 2（可选）", "广州新塘"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText("城市轨道交通（可选，默认关闭）"));
  await waitFor(() => expect(screen.getByRole("button", { name: "查询中转" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "查询中转" }));
  await screen.findByRole("button", { name: /^含地铁／城市轨道（[1-9]/ });
  fireEvent.click(screen.getByRole("button", { name: /^含地铁／城市轨道/ }));
  await waitFor(() => expect(container.querySelectorAll(".rail-trip")).toHaveLength(1));
  let trip = container.querySelector(".rail-trip") as HTMLElement;
  expect(within(trip).getByText(/地铁 7号线/)).toBeVisible();
  expect(within(trip).getByText(/地铁 13号线/)).toBeVisible();
  expect(within(trip).getByText("G9103")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^减少中转备选/ }));
  expect(screen.getByText(/以下备选经过 广州南.*不限定第二中转站 广州新塘/)).toBeVisible();
  trip = container.querySelector(".rail-trip") as HTMLElement;
  expect(within(trip).getByText("C9105")).toBeVisible();
  expect(within(trip).getByText("惠州北（城际）")).toBeVisible();
  expect(screen.getByLabelText("中转站 2（可选）")).toHaveValue("广州新塘");
});
it("shows the requested walking connection before slow city alternatives and retains it on cancellation", async () => {
  vi.setSystemTime(new Date("2026-10-05T08:00:00+08:00"));
  const extra: Station = { name: "广州东", code: "GGQ", pinyin: "", city: "广州" };
  const fetchMock = vi.fn(async (input: string | URL, options?: RequestInit) => {
    const url = new URL(String(input), "https://cr.yukino.bond"), key = `${url.searchParams.get("from")}/${url.searchParams.get("to")}`;
    if (url.searchParams.get("mode") === "equipment") return Response.json({ source: "12306", train: url.searchParams.get("train"), date: "2026-10-05", scope: "dated", checkedAt: Date.now(), model: url.searchParams.get("train") === "G91" ? "CR400AF" : "CRH6A" });
    if (url.searchParams.get("from") === "GGQ") return await new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    });
    const trains = url.searchParams.get("date") !== "2026-10-05" ? [] : key === "IOQ/IZQ" ? [make("G91", "IOQ", "IZQ", "09:00", "10:00", "01:00", 80, "CR400AF")] : key === "PYA/EGQ" ? [make("C92", "PYA", "EGQ", "10:30", "11:00", "00:30", 30, "CRH6A")] : [];
    return Response.json({ source: "12306", trains: trains.map(t => ({ ...t, trainsetModel: null, date: "2026-10-05", originDate: "2026-10-05" })), checkedAt: new Date().toISOString() });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { container } = render(<RailTransfer stations={[...stations, extra]} onPosition={vi.fn()}/>);
  for (const [label, value] of [["出发站", "深圳北"], ["到达站", "西平西"], ["中转站 1（可选）", "广州南"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "查询中转" }));
  await screen.findByText("已确认的方案先行展示，其余区间及车型票价资料仍在查询中。");
  expect(container.querySelectorAll(".rail-trip")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "取消查询" })).toBeVisible();
  expect(await screen.findByText("车型：CR400AF")).toBeVisible();
  expect(await screen.findByText("车型：CRH6A")).toBeVisible();
  const calls = fetchMock.mock.calls.map(([input]) => new URL(String(input), "https://cr.yukino.bond").searchParams);
  expect(calls.findIndex(query => query.get("from") === "PYA" && query.get("to") === "EGQ")).toBeLessThan(calls.findIndex(query => query.get("from") === "GGQ"));
  fireEvent.click(screen.getByRole("button", { name: "取消查询" }));
  expect(screen.getByText("查询已停止，以下保留已确认的部分方案；其余区间与缺失资料尚未完成。")).toBeVisible();
  expect(screen.getByText("G91")).toBeVisible(); expect(screen.getByText("C92")).toBeVisible();
});
it("shows each leg and physical walk transfer, sorts the summed price and filters whole-trip availability and exact models", async () => {
  localStorage.clear(); const onPosition = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), "https://cr.yukino.bond"), key = `${url.searchParams.get("from")}/${url.searchParams.get("to")}`;
    const trains = url.searchParams.get("date") !== "2026-10-04" ? [] : key === "IOQ/IZQ" ? [make("G1", "IOQ", "IZQ", "09:00", "10:00", "01:00", 80, "CR400AF"), make("G2", "IOQ", "IZQ", "10:00", "11:00", "01:00", 60, "CRH380A")] : key === "PYA/EGQ" ? [make("C10", "PYA", "EGQ", "10:30", "11:00", "00:30", 30, "CRH6A"), make("C20", "PYA", "EGQ", "12:00", "12:30", "00:30", 20, "CRH6A", "无")] : [];
    return Response.json({ source: "12306", checkedAt: new Date().toISOString(), trains });
  }));
  const { container } = render(<RailTransfer stations={stations} onPosition={onPosition}/>);
  for (const [label, value] of [["首程乘车日期", "2026-10-04"], ["出发站", "深圳北"], ["到达站", "西平西"], ["中转站 1（可选）", "广州南"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "查询中转" }));
  await waitFor(() => expect(container.querySelectorAll(".rail-trip")).toHaveLength(3));
  let first = container.querySelector(".rail-trip") as HTMLElement;
  expect(within(first).getByText("G1")).toBeVisible();
  expect(within(first).getByText("C10")).toBeVisible();
  expect(within(first).getByText(/相邻站群换乘：广州南 → 番禺/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("排序"), { target: { value: "price" } });
  first = container.querySelector(".rail-trip") as HTMLElement;
  expect(within(first).getByText("G2")).toBeVisible(); expect(first.querySelector(".rail-trip-total strong")?.textContent).toBe("¥80");
  fireEvent.click(within(first).getAllByRole("button", { name: "位置 / 下一站" })[0]);
  expect(onPosition).toHaveBeenCalledWith("G2", "2026-10-03");
  fireEvent.click(screen.getByLabelText("仅看全程有票"));
  expect(container.querySelectorAll(".rail-trip")).toHaveLength(1);
  fireEvent.click(screen.getByLabelText("仅看全程有票"));
  fireEvent.change(screen.getByLabelText("至少一程车型"), { target: { value: "CRH380A" } });
  expect(container.querySelectorAll(".rail-trip")).toHaveLength(1);
  fireEvent.click(screen.getByLabelText("车型筛选要求每程均匹配"));
  expect(screen.getByText("没有符合当前行程类型、车型或余票筛选的方案。")).toBeVisible();
});

it("exposes nationwide city transfers and expands the automatic station search when requested", async () => {
  const endpoints: Station[] = [{ name: "南京", code: "NJH", city: "南京", cityCode: "0711", pinyin: "" }, { name: "银川", code: "YIJ", city: "银川", cityCode: "2301", pinyin: "" }];
  const extra: Station[] = Array.from({ length: 70 }, (_, i) => ({ name: `测试城${i}`, code: `N${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`, city: `测试城${i}`, cityCode: `测试${i}`, pinyin: "" }));
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => new URL(String(input), "https://cr.yukino.bond").searchParams.get("mode") === "hubs" ? Response.json({ source: "12306", hubs: [] }) : Response.json({ source: "12306", trains: [], checkedAt: new Date().toISOString() })));
  render(<RailTransfer stations={[...endpoints, ...extra]} onPosition={vi.fn()}/>);
  expect(screen.getByLabelText("允许全国同城异站换乘（需站外交通）")).toBeChecked();
  for (const [label, value] of [["首程乘车日期", "2026-10-09"], ["出发站", "南京"], ["到达站", "银川"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "查询中转" }));
  await screen.findByRole("button", { name: "扩大范围重新查询" });
  expect(screen.getByText(/^本次选取 64 \/ 70 个全国候选站/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "扩大范围重新查询" }));
  await waitFor(() => expect(screen.getByText(/已请求 .*70 \/ 70 个全国候选站/)).toBeVisible());
  expect(screen.getByLabelText("搜索范围")).toHaveValue("128");
  expect(screen.queryByRole("button", { name: "扩大范围重新查询" })).toBeNull();
});
