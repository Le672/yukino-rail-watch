import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RailSpeed } from "../components/RailSpeed";
import type { SpeedReading } from "../lib/rail-speed";
import type { RailMotionEstimate } from "../lib/rail-motion";

const reading: SpeedReading = { kmh: 248.6, source: "position", timestamp: 20000, sampleSeconds: 6,
  uncertaintyKmh: 5.4, reason: null };
const estimate: RailMotionEstimate = { kmh: 86.4, stage: "线性加速", reason: null, peakKmh: 290, detail: "铁路距离与车型推算",
  position: { phase: "running", currentIndex: null, previousIndex: 0, nextIndex: 1, progress: .1, arrivalAt: 100000, departureAt: null, delayUsed: false, warning: null } };
describe("speed source and freshness presentation", () => {
  it("labels short-window estimation and its error", () => {
    render(<RailSpeed reading={reading} enabled live matched now={22000} error={null} />);
    const card = within(screen.getByRole("group", { name: "实时速度" }));
    expect(card.getByText("249")).toBeInTheDocument();
    expect(card.getByText("GPS 短时测速")).toBeInTheDocument();
    expect(card.getByText(/6.0 秒.*误差参考 ±6 km\/h/)).toBeInTheDocument();
    expect(card.getByText("2 秒前更新")).toBeInTheDocument();
  });
  it("clears a formerly valid number during errors, custom time, or disabled location", () => {
    const { rerender } = render(<RailSpeed reading={reading} enabled live matched now={22000} error="信号失效" />);
    expect(screen.queryByText("249")).toBeNull();
    expect(screen.getByText("信号失效")).toBeInTheDocument();
    rerender(<RailSpeed reading={reading} enabled live={false} matched now={22000} error={null} />);
    expect(screen.queryByText("249")).toBeNull();
    expect(screen.getByText(/观察时间预估速度/)).toBeInTheDocument();
    rerender(<RailSpeed reading={reading} enabled={false} live matched now={22000} error={null} />);
    expect(screen.queryByText("249")).toBeNull();
  });
  it("identifies an unmatched device reading rather than claiming it belongs to the chosen train", () => {
    render(<RailSpeed reading={reading} enabled live matched={false} now={22000} error={null} />);
    expect(screen.getByText(/尚未匹配所选车次，仅表示设备速度/)).toBeInTheDocument();
  });
  it("shows a labeled timetable estimate without GPS permission and during location errors", () => {
    const { rerender } = render(<RailSpeed reading={reading} estimate={estimate} enabled={false} live matched={false} now={22000} error={null} />);
    expect(screen.getByText("86")).toBeInTheDocument();
    expect(screen.getByText("预估速度")).toBeInTheDocument();
    expect(screen.getByText("线路＋时刻表预估 · 线性加速")).toBeInTheDocument();
    expect(screen.getByText(/实际限速可能造成偏差/)).toBeInTheDocument();
    rerender(<RailSpeed reading={reading} estimate={estimate} enabled live matched={false} now={22000} error="权限拒绝" />);
    expect(screen.getByText("86")).toBeInTheDocument();
    expect(screen.queryByText("249")).toBeNull();
    rerender(<RailSpeed reading={reading} estimate={estimate} enabled live={false} matched={false} now={22000} error={null} />);
    expect(screen.getByText("86")).toBeInTheDocument();
    expect(screen.getByText(/按指定观察时刻推算/)).toBeInTheDocument();
  });
  it("prefers an available device speed, preserving measured zero over a moving estimate", () => {
    render(<RailSpeed reading={{ ...reading, source: "device", kmh: 0 }} estimate={estimate} enabled live matched now={22000} error={null} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("GPS／设备瞬时读数")).toBeInTheDocument();
    expect(screen.queryByText("预估速度")).toBeNull();
    expect(screen.queryByText("86")).toBeNull();
  });
});
