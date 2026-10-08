import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RailPosition } from "../components/RailPosition";
import { parseJourney, parseRailwayMap } from "../lib/train-position";
import { k123, k123Map } from "./fixtures/conventional-position";
import { coordinateAt, distanceKm } from "../lib/train-position";
import * as detector from "../lib/rail-train-detection";
import { wgs84togcj02 } from "coordtransform";

const loaders = vi.hoisted(() => ({ loadJourney: vi.fn(), loadDelays: vi.fn(), loadRailway: vi.fn(), loadJourneyEquipment: vi.fn() }));
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
  loaders.loadJourneyEquipment.mockImplementation(async journey => ({ model: journey.model, owner: journey.owner }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("position query user workflow", () => {
  it("identifies a sufficiently distinct train and next station with GPS, without a typed train", async () => {
    const now = Date.parse("2026-09-29T10:01:00+08:00");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const journey = parseJourney(payload, "G6003", "2026-09-29", now);
    const points: [number,number][] = [[113.06,28.15],[113.26,22.99],[114.03,22.61]];
    const distances=[0,distanceKm(points[0],points[1]),distanceKm(points[0],points[1])+distanceKm(points[1],points[2])];
    const route={points,distances,stopDistances:distances,stops:points,lengthKm:distances[2],coordinateSystem:"WGS84" as const};
    const item={journey,route,map:{route,stations:points,coordinateSystem:"WGS84" as const,warning:null}};
    const discover=vi.spyOn(detector,"discoverTrainRoutes").mockImplementation(async (_fix,_samples,_now,_signal,onProgress)=>{
      const progress={routes:[item],stations:18,timetables:3,failed:0,truncated:false,complete:true};onProgress(progress);return progress;
    });
    vi.stubGlobal("isSecureContext",true);
    const watchPosition=vi.fn().mockReturnValue(10), clearWatch=vi.fn();
    vi.stubGlobal("navigator",{geolocation:{watchPosition,clearWatch}});
    const view=render(<RailPosition initialDate="2026-09-29"/>);
    expect(screen.getByLabelText("定位车次")).toHaveValue("");
    fireEvent.click(screen.getByRole("button",{name:"开启 GPS 实时定位"}));
    for(const seconds of [-12,-6,0]){
      const [longitude,latitude]=coordinateAt(route,5+seconds*.07);
      await act(async()=>watchPosition.mock.calls[0][0]({coords:{longitude,latitude,accuracy:20,speed:70,heading:180},timestamp:now+seconds*1000}));
    }
    await screen.findByRole("heading",{name:"G6003"});
    expect(screen.getByLabelText("定位车次")).toHaveValue("G6003");
    expect(within(screen.getByLabelText("下一停靠站")).getByText("广州南")).toBeInTheDocument();
    expect(loaders.loadJourney).not.toHaveBeenCalled();
    expect(discover).toHaveBeenCalledTimes(1);
    view.unmount();expect(clearWatch).toHaveBeenCalledWith(10);
  });
  it("automatically loads the selected board train without starting device geolocation", async () => {
    vi.stubGlobal("isSecureContext", true); const watchPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch: vi.fn() } });
    render(<RailPosition initialTrain="G6003" initialDate="2026-09-29" autoQuery/>);
    await screen.findByRole("heading", { name: "G6003" });
    expect(loaders.loadJourney).toHaveBeenCalledWith("G6003", "2026-09-29");
    expect(watchPosition).not.toHaveBeenCalled();
  });
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
    const route = { points, distances, stops: [points[0], points[2], points[3]], stopDistances: [0, distances[2], distances[3]], lengthKm: distances[3] };
    loaders.loadRailway.mockResolvedValue({ route, stations: route.stops, warning: null });
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
    expect(speed.getByText("GPS／设备瞬时读数")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止 GPS 定位" }));
    expect(clearWatch).toHaveBeenCalledWith(8);
    expect(within(screen.getByLabelText("下一停靠站")).getByText("深圳北")).toBeInTheDocument();
    expect(speed.queryByText("234")).toBeNull();
    expect(speed.getByText("预估速度")).toBeInTheDocument();
  });
  it("shows departure acceleration without starting GPS and advances the map by integrated distance", async () => {
    const points = [[113.06, 28.15], [113.26, 22.99], [114.03, 22.61]];
    const route = { points, distances: [0, 600, 740], stops: points, stopDistances: [0, 600, 740], lengthKm: 740 };
    loaders.loadRailway.mockResolvedValue({ route, stations: points, warning: null });
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
  it("keeps a conventional train's next station and GPS speed when track geometry is unavailable", async () => {
    const now = Date.parse("2026-09-30T09:36:00+08:00");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const journey = parseJourney(k123, "K123", "2026-09-29", now);
    loaders.loadJourney.mockResolvedValue(journey);
    loaders.loadRailway.mockResolvedValue(parseRailwayMap(k123Map, journey));
    vi.stubGlobal("isSecureContext", true);
    const watchPosition = vi.fn().mockReturnValue(9), clearWatch = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    render(<RailPosition initialTrain="K123" initialDate="2026-09-29" />);
    fireEvent.click(screen.getByRole("button", { name: "查询位置" }));
    await screen.findByText("谷城 → 十堰");
    await screen.findByText(/GPS 实时位置仍可显示/);
    fireEvent.click(screen.getByRole("button", { name: "开启 GPS 实时定位" }));
    act(() => watchPosition.mock.calls[0][0]({ coords: { longitude: 111.59, latitude: 32.26, accuracy: 20, speed: 20, heading: 270 }, timestamp: now }));
    expect(within(screen.getByLabelText("下一停靠站")).getByText("十堰")).toBeInTheDocument();
    expect(screen.getByText(/地图显示设备 GPS 位置；完整线路暂缺/)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "实时速度" })).getByText("72")).toBeInTheDocument();
    expect(screen.queryByText(/GPS 实时匹配/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "停止 GPS 定位" }));
    expect(clearWatch).toHaveBeenCalledWith(9);
  });
});
