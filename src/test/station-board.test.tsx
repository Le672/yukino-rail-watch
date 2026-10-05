import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StationBoard } from "../components/StationBoard";
import { emptyBoardDetail } from "../lib/rail-board";

const date = "2026-10-05", now = Date.parse(`${date}T09:00:00+08:00`);
const rows = Array.from({ length: 8 }, (_, index) => ({ id: `NO${index}/${date}/G${index + 1}`, train: `G${index + 1}`, trainNo: `NO${index}`, originDate: date,
  from: "长沙南", to: "深圳北", fromCode: "CWQ", toCode: "IOQ", arrival: "10:00", departure: "10:04", arrivalAt: now + 3600000 + index * 60000,
  departureAt: now + 3840000 + index * 60000, dwellMinutes: 4, model: null }));
const stations = [{ name: "广州南", code: "IZQ", pinyin: "guangzhounan" }];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

it("loads in StrictMode, paginates, filters and separates official service status from check-in", async () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, "https://cr.yukino.bond");
    if (url.searchParams.get("mode") === "board") return Response.json({ source: "12306", station: "广州南", stationCode: "IZQ", date, checkedAt: now, rows });
    const id = url.searchParams.get("id")!, direction = url.searchParams.get("direction") as "D" | "A";
    return Response.json({ ...emptyBoardDetail(id, direction, now), platform: "6站台", wicket: "A6,B6", checkIn: "checking" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { unmount } = render(<StrictMode><StationBoard stations={stations}/></StrictMode>);
  await waitFor(() => expect(screen.getByRole("rowheader", { name: "G1" })).toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByText("检票中").length).toBeGreaterThan(0));
  expect(within(screen.getByRole("rowheader", { name: "G1" }).closest("tr")!).getByText("未提供")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "大屏下一页" }));
  expect(screen.getByRole("rowheader", { name: "G7" })).toBeInTheDocument();
  expect(screen.queryByRole("rowheader", { name: "G1" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "G2" } });
  expect(screen.getByRole("rowheader", { name: "G2" })).toBeInTheDocument();
  expect(screen.queryByRole("rowheader", { name: "G7" })).not.toBeInTheDocument();
  unmount(); vi.restoreAllMocks();
});

it("retains a failed-refresh snapshot but hides its expired real-time statuses", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  let failed = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input, "https://cr.yukino.bond");
    if (url.searchParams.get("mode") === "board") return failed ? Response.json({ error: "官方暂不可用" }, { status: 502 }) : Response.json({ source: "12306", station: "广州南", stationCode: "IZQ", date, checkedAt: now, rows: [rows[0]] });
    return Response.json({ ...emptyBoardDetail(rows[0].id, "D", now), status: "on-time", sourceAt: now });
  }));
  const { unmount } = render(<StationBoard stations={stations}/>);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("正点")).toBeInTheDocument();
  failed = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(181000); });
  expect(screen.getByRole("rowheader", { name: "G1" })).toBeInTheDocument();
  expect(screen.queryByText("正点")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("保留上次查询");
  expect(screen.getByText(/旧快照/)).toBeInTheDocument();
  unmount();
});

it("opens the station-local train number with its actual origin date, including overnight arrivals", async () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const originDate = "2026-10-04", train = "K123";
  const overnight = { ...rows[0], train, originDate, id: `NO0/${originDate}/${train}` };
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input, "https://cr.yukino.bond");
    return Response.json(url.searchParams.get("mode") === "board"
      ? { source: "12306", station: "广州南", stationCode: "IZQ", date, checkedAt: now, rows: [overnight] }
      : emptyBoardDetail(overnight.id, url.searchParams.get("direction") as "D" | "A", now));
  }));
  const open = vi.fn(); render(<StationBoard stations={stations} onPosition={open}/>);
  fireEvent.click(await screen.findByRole("button", { name: "查看 K123 的实时位置" }));
  expect(open).toHaveBeenCalledWith("K123", "2026-10-04");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /到达/ })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "查看 K123 的实时位置" })); });
  expect(open).toHaveBeenCalledTimes(2); vi.restoreAllMocks();
});
