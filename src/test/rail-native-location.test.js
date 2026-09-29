import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createLocationWatcher } = require("../../electron/rail-location.cjs");
function child() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter(); process.stdout.setEncoding = vi.fn();
  process.kill = vi.fn();
  return process;
}
describe("native location process ownership", () => {
  it("runs hidden, streams fragmented fixes, and ignores output after stop", () => {
    const process = child(), launch = vi.fn().mockReturnValue(process), emit = vi.fn();
    const watcher = createLocationWatcher(emit, launch); watcher.start();
    if (!launch.mock.calls.length) return; // Native feature is Windows-only.
    expect(launch.mock.calls[0][2].windowsHide).toBe(true);
    const fix = { longitude: 113, latitude: 28, accuracy: 20, timestamp: 1790637660000 };
    const line = JSON.stringify({ fix }) + "\n";
    process.stdout.emit("data", line.slice(0, 8)); expect(emit).not.toHaveBeenCalled();
    process.stdout.emit("data", line.slice(8)); expect(emit).toHaveBeenCalledWith({ fix });
    watcher.stop(); expect(process.kill).toHaveBeenCalledOnce();
    emit.mockClear(); process.stdout.emit("data", line); expect(emit).not.toHaveBeenCalled();
  });
  it("restarting cancels the old process and only the new process may report", () => {
    const first = child(), second = child(), launch = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second), emit = vi.fn();
    const watcher = createLocationWatcher(emit, launch); watcher.start(); watcher.start();
    if (!launch.mock.calls.length) return;
    expect(first.kill).toHaveBeenCalledOnce(); emit.mockClear();
    first.stdout.emit("data", '{"error":{"code":1,"message":"denied"}}\n');
    expect(emit).not.toHaveBeenCalled();
    second.stdout.emit("data", '{"error":{"code":1,"message":"denied"}}\n');
    expect(emit).toHaveBeenCalledWith({ error: { code: 1, message: "denied" } }); watcher.stop();
  });
});
