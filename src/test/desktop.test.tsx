import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import DesktopRail from "../DesktopRail";
import type { DesktopState, Result, RailDesktop } from "../hooks/useRailMonitor";

vi.mock("../components/RailPosition", () => ({ RailPosition: ({ initialTrain, initialDate, autoQuery }: { initialTrain: string; initialDate?: string; autoQuery?: boolean }) => <div data-auto-query={autoQuery}>位置查询 {initialTrain} {initialDate}</div> }));
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-30T02:00:00Z")); });
afterEach(() => { cleanup(); localStorage.clear(); delete window.railDesktop; vi.restoreAllMocks(); vi.useRealTimers(); });
const result: Result = { checkedAt: "2026-09-30T02:00:00Z", date: "2026-09-30", from: "广州南", to: "香港西九龙", queryMode: "train", modelCheckedAt: "2026-09-30T02:00:00Z", trains: [{ code: "G6581", from: "广州南", to: "香港西九龙", departure: "11:00", arrival: "12:00", duration: "01:00", saleStatus: "Y", trainsetModel: "CRH380A(港铁动感号)", seats: [{ label: "二等座", value: "有", available: true }] }] };
function bridge() {
  let listener: (state: DesktopState) => void = () => {};
  const settings = { queryMode: "train" as const, date: result.date, train: "G6581", from: "", to: "", seat: "二等座", intervalMinutes: 5, enabled: false };
  const state: DesktopState = { settings, result: null, error: null, checking: false, version: "1.10.13" };
  const api: RailDesktop = {
    stations: vi.fn(async () => ({ stations: [] })), getState: vi.fn(async () => state),
    configure: vi.fn(async (next) => ({ ...state, settings: next })),
    checkNow: vi.fn(async () => result), onUpdate: vi.fn((next) => { listener = next; return () => {}; })
  };
  window.railDesktop = api;
  return { api, state, emit: (next: DesktopState) => listener(next) };
}
it("uses native query and monitor services and renders the result table", async () => {
  const { api } = bridge();
  await act(async () => { render(<DesktopRail />); });
  fireEvent.click(screen.getByRole("button", { name: "立即查询" }));
  const table = await screen.findByRole("table");
  expect(within(table).getByText("G6581")).toBeInTheDocument();
  expect(within(table).getByRole("img")).toHaveAttribute("alt", expect.stringContaining("港铁"));
  expect(api.checkNow).toHaveBeenCalledWith(expect.objectContaining({ train: "G6581", seat: "二等座" }));
  fireEvent.click(screen.getByRole("button", { name: "开启监控" }));
  await screen.findByRole("button", { name: "停止监控" });
  expect(api.configure).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, intervalMinutes: 5 }));
  fireEvent.click(screen.getByRole("button", { name: "停止监控" }));
  await screen.findByRole("button", { name: "开启监控" });
  expect(api.configure).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  expect(screen.queryByText("返回主页")).not.toBeInTheDocument();
  expect(screen.queryByText("慢慢写，慢慢长。")).not.toBeInTheDocument();
  expect(screen.getByText("v1.10.13")).toBeVisible();
});
it("receives background updates and passes the selected train and date to position", async () => {
  const { state, emit } = bridge();
  await act(async () => { render(<DesktopRail />); });
  await act(async () => { emit({ ...state, result, settings: { ...state.settings, enabled: true } }); });
  expect(screen.getByText("监控运行中")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "位置 / 下一站" }));
  expect(screen.getByText("位置查询 G6581 2026-09-30")).toBeInTheDocument();
  expect(screen.getByText("位置查询 G6581 2026-09-30")).toHaveAttribute("data-auto-query", "true");
  fireEvent.click(screen.getByRole("button", { name: "余票监控" }));
  expect(screen.getByRole("table")).toBeVisible();
});
it("packages the dedicated desktop HTML rather than the website entry", () => {
  const electron = fs.readFileSync("electron/rail-main.cjs", "utf8");
  expect(electron).toContain('window.loadFile(path.join(__dirname, "../dist/desktop.html"))');
  expect(electron).not.toContain('../dist/index.html');
  expect(fs.readFileSync("desktop.html", "utf8")).toContain('/src/desktop.tsx');
  const entry = fs.readFileSync("src/desktop.tsx", "utf8");
  expect(entry).not.toMatch(/\.\/Rail["']|style\.css|index\.css/);
});
