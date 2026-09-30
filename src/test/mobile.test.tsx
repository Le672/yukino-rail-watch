import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MobileRail from "../MobileRail";
import type { DesktopState, RailDesktop, Result } from "../hooks/useRailMonitor";

const mobile = vi.hoisted(() => ({ host: { getState: vi.fn(), configure: vi.fn(), checkNow: vi.fn(), stations: vi.fn(), onUpdate: vi.fn() } }));
vi.mock("../mobile/mobile-bridge", () => ({ mobileMonitor: mobile.host, mobilePlatform: "android" }));
vi.mock("../components/RailPosition", () => ({ RailPosition: ({ initialTrain, initialDate }: { initialTrain: string; initialDate?: string }) => <div>位置查询 {initialTrain} {initialDate}</div> }));
const result: Result = { checkedAt: "2026-09-30T02:00:00Z", date: "2026-09-30", from: "广州南", to: "香港西九龙", modelCheckedAt: "2026-09-30T02:00:00Z", trains: [{ code: "G6581", from: "广州南", to: "香港西九龙", departure: "11:00", arrival: "12:00", duration: "01:00", saleStatus: "Y", trainsetModel: "CRH380A(港铁动感号)", seats: [{ label: "二等座", value: "有", available: true }] }] };
const state: DesktopState = { settings: { queryMode: "train", date: result.date, train: "G6581", from: "", to: "", seat: "二等座", intervalMinutes: 1, enabled: false }, result: null, checking: false, error: null };
beforeEach(() => {
  vi.resetAllMocks();
  mobile.host.getState.mockResolvedValue(state); mobile.host.stations.mockResolvedValue({ stations: [] });
  mobile.host.configure.mockImplementation(async settings => ({ ...state, settings }));
  mobile.host.checkNow.mockResolvedValue(result); mobile.host.onUpdate.mockReturnValue(() => {});
});
afterEach(() => { cleanup(); localStorage.clear(); });

it("queries through the native host and opens the chosen train in the mobile position tab", async () => {
  await act(async () => { render(<MobileRail />); });
  fireEvent.click(screen.getByRole("button", { name: "立即查询" }));
  expect(await screen.findByText("G6581")).toBeVisible();
  expect((mobile.host as RailDesktop).checkNow).toHaveBeenCalledWith(expect.objectContaining({ train: "G6581" }));
  expect(screen.getByRole("img")).toHaveAttribute("alt", expect.stringContaining("港铁"));
  fireEvent.click(screen.getByRole("button", { name: "位置 / 下一站" }));
  expect(screen.getByText("位置查询 G6581 2026-09-30")).toBeVisible();
  expect(screen.getByRole("navigation", { name: "手机功能" })).toBeVisible();
});

it("rolls back monitoring and shows a native permission error", async () => {
  mobile.host.configure.mockRejectedValue(new Error("通知权限未开启"));
  await act(async () => { render(<MobileRail />); });
  fireEvent.click(screen.getByRole("button", { name: "开启监控" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("通知权限未开启");
  expect(screen.getByRole("button", { name: "开启监控" })).toBeVisible();
  expect(screen.getByText(/后台最短约 15 分钟/)).toBeVisible();
});

it("stops native monitoring even while a required field is cleared", async () => {
  mobile.host.getState.mockResolvedValue({ ...state, settings: { ...state.settings, enabled: true } });
  await act(async () => { render(<MobileRail />); });
  fireEvent.change(screen.getByLabelText("车次"), { target: { value: "" } });
  expect(mobile.host.configure).toHaveBeenCalledWith(expect.objectContaining({ train: "", enabled: false }));
  expect(screen.getByRole("button", { name: "开启监控" })).toBeVisible();
});
