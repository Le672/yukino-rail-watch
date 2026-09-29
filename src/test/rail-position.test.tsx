import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RailPosition } from "../components/RailPosition";
import { parseJourney } from "../lib/train-position";
import { distanceKm } from "../lib/train-position";
import { wgs84togcj02 } from "coordtransform";

const loaders = vi.hoisted(() => ({ loadJourney: vi.fn(), loadDelays: vi.fn(), loadRailway: vi.fn() }));
vi.mock("../lib/rail-position-data", () => loaders);
vi.mock("../components/RailMap", () => ({ RailMap: () => <div>完整交互地图</div> }));
const payload = { success: true, data: { numberFull: ["G6003"], rundays: ["20260929"], car: "CR400AF-A", timetable: [
  { station: "长沙南", stationTelecode: "CWQ", day: 0, arrive: "10:00", depart: "10:00" },
  { station: "广州南", stationTelecode: "IZQ", day: 0, arrive: "12:02", depart: "12:06" },
  { station: "深圳北", stationTelecode: "IOQ", day: 0, arrive: "12:35", depart: "12:35" },
] } };

beforeEach(() => {
  vi.resetAllMocks();
  loaders.loadJourney.mockResolvedValue(parseJourney(payload, "G6003", "2026-09-29"));
  loaders.loadRailway.mockRejectedValue(new Error("Route unavailable"));
  loaders.loadDelays.mockRejectedValue(new Error("Delay unavailable"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("position query user workflow", () => {
  it("shows Guangzhou South at 10:01 even if map and delay data are unavailable", async () => {
    render(<RailPosition initialTrain="G6003" initialDate="2026-09-29" />);
    fireEvent.click(screen.getByLabelText("跟随当前时间"));
    fireEvent.change(screen.getByLabelText("观察时间（北京时间）"), { target: { value: "2026-09-29T10:01" } });
    fireEvent.click(screen.getByRole("button", { name: "查询位置" }));
    await screen.findByText("长沙南 → 广州南");
    expect(within(screen.getByLabelText("下一停靠站")).getByText("广州南")).toBeInTheDocument();
    expect(within(screen.getByLabelText("下一停靠站")).getByText("计划到达 12:02")).toBeInTheDocument();
    await screen.findByText(/线路资料暂不可用/);
    expect(loaders.loadJourney).toHaveBeenCalledWith("G6003", "2026-09-29");
    expect(loaders.loadDelays).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("观察时间（北京时间）"), { target: { value: "2026-09-29T12:03" } });
    expect(screen.getByText("广州南 · 停站中")).toBeInTheDocument();
    expect(within(screen.getByLabelText("下一停靠站")).getByText("深圳北")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("观察时间（北京时间）"), { target: { value: "2026-09-29T12:35" } });
    expect(screen.getByText("已到达 · 无下一站")).toBeInTheDocument();
  });
  it("discards a late response after the user changes train", async () => {
    let finish: (value: unknown) => void;
    loaders.loadJourney.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<RailPosition initialTrain="G6003" initialDate="2026-09-29" />);
    fireEvent.click(screen.getByRole("button", { name: "查询位置" }));
    await waitFor(() => expect(loaders.loadJourney).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("定位车次"), { target: { value: "G1" } });
    await act(async () => finish!(parseJourney(payload, "G6003", "2026-09-29")));
    expect(screen.queryByRole("heading", { name: "G6003" })).toBeNull();
    expect(loaders.loadRailway).not.toHaveBeenCalled();
  });
  it("GPS corrects next station when a delayed train is still before Guangzhou after planned departure", async () => {
    const now = Date.parse("2026-09-29T12:15:00+08:00");
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubGlobal("isSecureContext", true);
    const watchPosition = vi.fn().mockReturnValue(8), clearWatch = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    const points = [[113.06, 28.15], [113.11, 26], [113.26, 22.99], [114.03, 22.61]].map(point => wgs84togcj02(point[0], point[1]));
    const distances = [0];
    for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + distanceKm(points[i - 1], points[i]));
    loaders.loadRailway.mockResolvedValue({ points, distances, stops: [points[0], points[2], points[3]], stopDistances: [0, distances[2], distances[3]], lengthKm: distances[3] });
    render(<RailPosition initialTrain="G6003" initialDate="2026-09-29" />);
    fireEvent.click(screen.getByRole("button", { name: "查询位置" }));
    await screen.findByText("广州南 → 深圳北");
    expect(watchPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开启 GPS 实时定位" }));
    act(() => watchPosition.mock.calls[0][0]({ coords: { longitude: 113.12, latitude: 25.8, accuracy: 20, speed: 65, heading: 180 }, timestamp: now }));
    await screen.findByText("长沙南 → 广州南");
    expect(within(screen.getByLabelText("下一停靠站")).getByText("广州南")).toBeInTheDocument();
    expect(screen.getByText(/GPS 实时匹配/)).toBeInTheDocument();
    expect(screen.getByText(/距下一站沿铁路约/)).toBeInTheDocument();
    const speed = within(screen.getByRole("group", { name: "实时速度" }));
    expect(speed.getByText("234")).toBeInTheDocument();
    expect(speed.getByText("设备瞬时读数")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止 GPS 定位" }));
    expect(clearWatch).toHaveBeenCalledWith(8);
    expect(within(screen.getByLabelText("下一停靠站")).getByText("深圳北")).toBeInTheDocument();
    expect(speed.queryByText("234")).toBeNull();
    expect(speed.getByText("预估速度")).toBeInTheDocument();
  });
  it("shows departure acceleration without starting GPS and advances the map by integrated distance", async () => {
    const points = [[113.06, 28.15], [113.26, 22.99], [114.03, 22.61]];
    loaders.loadRailway.mockResolvedValue({ points, distances: [0, 600, 740], stops: points, stopDistances: [0, 600, 740], lengthKm: 740 });
    vi.stubGlobal("isSecureContext", true);
    const watchPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch: vi.fn() } });
    render(<RailPosition initialTrain="G6003" initialDate="2026-09-29" />);
    fireEvent.click(screen.getByLabelText("跟随当前时间"));
    fireEvent.change(screen.getByLabelText("观察时间（北京时间）"), { target: { value: "2026-09-29T10:01" } });
    fireEvent.click(screen.getByRole("button", { name: "查询位置" }));
    await screen.findByText("线路＋时刻表预估 · 线性加速");
    const speed = within(screen.getByRole("group", { name: "实时速度" }));
    expect(speed.getByText("86")).toBeInTheDocument();
    expect(within(screen.getByLabelText("下一停靠站")).getByText("广州南")).toBeInTheDocument();
    expect(screen.getByLabelText("当前停站区间运行进度")).toHaveAttribute("value", expect.stringMatching(/^0\.0012/));
    expect(watchPosition).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("观察时间（北京时间）"), { target: { value: "2026-09-29T12:03" } });
    expect(speed.getByText("0")).toBeInTheDocument();
    expect(speed.getByText("线路＋时刻表预估 · 停站中")).toBeInTheDocument();
  });
});
