import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RailSpeed } from "../components/RailSpeed";
import type { SpeedReading } from "../lib/rail-speed";

const reading: SpeedReading = { kmh: 248.6, source: "position", timestamp: 20000, sampleSeconds: 6,
  uncertaintyKmh: 5.4, reason: null };
describe("speed source and freshness presentation", () => {
  it("labels short-window estimation and its error instead of ATP", () => {
    render(<RailSpeed reading={reading} enabled live matched now={22000} error={null} />);
    const card = within(screen.getByRole("group", { name: "实时速度" }));
    expect(card.getByText("249")).toBeInTheDocument();
    expect(card.getByText("GPS 短时估算")).toBeInTheDocument();
    expect(card.getByText(/6.0 秒.*误差参考 ±6 km\/h/)).toBeInTheDocument();
    expect(card.getByText("2 秒前更新")).toBeInTheDocument();
  });
  it("clears a formerly valid number during errors, custom time, or disabled location", () => {
    const { rerender } = render(<RailSpeed reading={reading} enabled live matched now={22000} error="信号失效" />);
    expect(screen.queryByText("249")).toBeNull();
    expect(screen.getByText("信号失效")).toBeInTheDocument();
    rerender(<RailSpeed reading={reading} enabled live={false} matched now={22000} error={null} />);
    expect(screen.queryByText("249")).toBeNull();
    expect(screen.getByText(/自定义观察时间/)).toBeInTheDocument();
    rerender(<RailSpeed reading={reading} enabled={false} live matched now={22000} error={null} />);
    expect(screen.queryByText("249")).toBeNull();
  });
  it("identifies an unmatched device reading rather than claiming it belongs to the chosen train", () => {
    render(<RailSpeed reading={reading} enabled live matched={false} now={22000} error={null} />);
    expect(screen.getByText(/尚未匹配所选车次，仅表示设备速度/)).toBeInTheDocument();
  });
});
