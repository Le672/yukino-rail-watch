import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RailMap } from "../components/RailMap";
describe("full map layer controls", () => {
  it("switches 2D to satellite with visible provider credits and keeps map controls", () => {
    render(<RailMap journey={null} route={null} position={null} fix={null} match={null} gpsEnabled={false} />);
    expect(screen.getByRole("button", { name: "2D 地图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "OpenStreetMap contributors" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "卫星图" }));
    expect(screen.getByRole("link", { name: "Sentinel-2 cloudless" })).toBeInTheDocument();
    expect(screen.getByText(/10 米分辨率/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放大一级" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2D 地图" }));
    expect(screen.getByRole("link", { name: "OpenStreetMap contributors" })).toBeInTheDocument();
  });
});
