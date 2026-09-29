const { spawn } = require("node:child_process");
const path = require("node:path");

// Windows' Location API chooses available GPS / system sensors. No IP lookup or Google API key.
// Fixed script only: no renderer input is interpolated into a command.
const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Device
  $railWatcher = New-Object System.Device.Location.GeoCoordinateWatcher ([System.Device.Location.GeoPositionAccuracy]::High)
  $railWatcher.MovementThreshold = 5
  $railWatcher.Start($false)
  $railLastTimestamp = 0
  $railStarted = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  try {
    while ($true) {
      if ($railWatcher.Permission -eq [System.Device.Location.GeoPositionPermission]::Denied -or $railWatcher.Status -eq [System.Device.Location.GeoPositionStatus]::Disabled) {
        @{ error = @{ code = 1; message = 'Windows location permission unavailable' } } | ConvertTo-Json -Compress
        break
      }
      $railPosition = $railWatcher.Position
      if (-not $railPosition.Location.IsUnknown) {
        $railCoordinate = $railPosition.Location
        $railTimestamp = $railPosition.Timestamp.ToUnixTimeMilliseconds()
        if ($railTimestamp -gt $railLastTimestamp) {
          $railSpeed = if ([double]::IsNaN($railCoordinate.Speed)) { $null } else { $railCoordinate.Speed }
          $railHeading = if ([double]::IsNaN($railCoordinate.Course)) { $null } else { $railCoordinate.Course }
          @{ fix = @{ longitude = $railCoordinate.Longitude; latitude = $railCoordinate.Latitude; accuracy = $railCoordinate.HorizontalAccuracy; speed = $railSpeed; heading = $railHeading; timestamp = $railTimestamp } } | ConvertTo-Json -Compress -Depth 4
          $railLastTimestamp = $railTimestamp
        }
      }
      if ($railLastTimestamp -eq 0 -and [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $railStarted -gt 45000) {
        @{ error = @{ code = 3; message = 'Windows location timeout' } } | ConvertTo-Json -Compress
        $railStarted = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      }
      Start-Sleep -Milliseconds 2000
    }
  } finally { $railWatcher.Stop(); $railWatcher.Dispose() }
} catch {
  @{ error = @{ code = 2; message = 'Windows location service unavailable' } } | ConvertTo-Json -Compress
}
`;

function createLocationWatcher(emit, launch = spawn) {
  let child = null;
  const stop = () => { const old = child; child = null; if (old) old.kill(); };
  const start = () => {
    stop();
    if (process.platform !== "win32") { emit({ error: { code: 2, message: "Windows location required" } }); return; }
    const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const current = launch(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child = current;
    let buffer = "", received = false;
    current.stdout.setEncoding("utf8");
    current.stdout.on("data", text => {
      if (child !== current) return;
      buffer += text;
      if (buffer.length > 65536) { emit({ error: { code: 2, message: "Invalid location response" } }); stop(); return; }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.fix && [event.fix.longitude, event.fix.latitude, event.fix.accuracy, event.fix.timestamp].every(Number.isFinite)) { received = true; emit({ fix: event.fix }); }
          else if (event.error && [1, 2, 3].includes(event.error.code)) { received = true; emit({ error: event.error }); }
        } catch { /* Never expose native diagnostic text or raw coordinates as logs. */ }
      }
    });
    current.on("error", () => { if (child === current) { emit({ error: { code: 2, message: "Windows location unavailable" } }); stop(); } });
    current.on("exit", () => { if (child === current) { child = null; if (!received) emit({ error: { code: 2, message: "Windows location unavailable" } }); } });
  };
  return { start, stop };
}
module.exports = { createLocationWatcher };
