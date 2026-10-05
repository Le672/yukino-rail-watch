import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RailPosition } from "../components/RailPosition";
import { emptyBoardDetail } from "../lib/rail-board";
import { parseJourney } from "../lib/train-position";

const mocks = vi.hoisted(() => ({ loadJourney: vi.fn(), loadDelays: vi.fn(), loadRailway: vi.fn(), loadJourneyEquipment: vi.fn(), loadJourneyBoardStops: vi.fn() }));
vi.mock("../lib/rail-position-data", () => mocks);
vi.mock("../lib/rail-stop-info", async original => ({ ...await original<typeof import("../lib/rail-stop-info")>(), loadJourneyBoardStops: mocks.loadJourneyBoardStops }));
vi.mock("../components/RailMap", () => ({ RailMap: () => <div>地图</div> }));
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("existing light timetable with station-board fields", () => {
  it("shows platform, dwell and official status separately from the original journey progress", async () => {
    const now = Date.parse("2026-10-05T10:01:00+08:00"); vi.spyOn(Date, "now").mockReturnValue(now);
    const journey = parseJourney({ success: true, data: { numberFull: ["G6003"], rundays: ["20261005"], timetable: [
      { station: "长沙南", stationTelecode: "CWQ", trainCode: "G6003", day: 0, arrive: "10:00", depart: "10:00" },
      { station: "广州南", stationTelecode: "IZQ", trainCode: "G6003", day: 0, arrive: "12:02", depart: "12:06" },
      { station: "深圳北", stationTelecode: "IOQ", trainCode: "G6003", day: 0, arrive: "12:35", depart: "12:35" },
    ] } }, "G6003", "2026-10-05", now);
    mocks.loadJourney.mockResolvedValue(journey); mocks.loadRailway.mockRejectedValue(new Error()); mocks.loadDelays.mockRejectedValue(new Error());
    mocks.loadJourneyEquipment.mockResolvedValue({ model: null, owner: null });
    mocks.loadJourneyBoardStops.mockImplementation(async (data, indices: number[], realtime: boolean) => ({ source: "12306", train: data.train, date: data.date, checkedAt: now,
      rows: indices.map(index => ({ index, station: data.stops[index].station, stationCode: data.stops[index].telecode, stationDate: data.date, train: data.train,
        detail: { ...emptyBoardDetail(`${index}`, index === 2 ? "A" : "D", now), platform: "6站台", wicket: "A6,B6", status: realtime ? "late" : "unknown", minutes: realtime ? 3 : null, predicted: realtime, checkIn: "unknown", sourceAt: now } })) }));
    render(<RailPosition initialTrain="G6003" initialDate="2026-10-05" />);
    fireEvent.click(screen.getByRole("button", { name: "查询位置" }));
    const table = within(await screen.findByRole("table", { name: "本车次停站表" }));
    await table.findAllByText("6站台");
    for (const field of ["车次", "始发站", "终到站", "停靠", "站台", "检票口", "列车状态", "检票状态", "行程进度"]) expect(table.getByRole("columnheader", { name: field })).toBeInTheDocument();
    const row = within(table.getByRole("rowheader", { name: /2\s*广州南/ }).closest("tr")!);
    expect(row.getByText("4 分")).toBeInTheDocument(); expect(row.getByText("预计晚点 3 分钟")).toBeInTheDocument();
    expect(row.getByText("未提供")).toBeInTheDocument(); expect(row.getByText("下一停靠站")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("跟随当前时间"));
    expect(table.queryByText("预计晚点 3 分钟")).toBeNull();
  });
});
