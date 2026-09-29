import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RailPosition } from "../components/RailPosition";
import { parseJourney } from "../lib/train-position";

const loaders = vi.hoisted(() => ({ loadJourney: vi.fn(), loadDelays: vi.fn(), loadRailway: vi.fn() }));
vi.mock("../lib/rail-position-data", () => loaders);
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
});
