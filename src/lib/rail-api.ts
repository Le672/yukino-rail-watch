/** Native clients bundle their UI locally; public rail data remains on the same official gateway. */
export function railApiUrl(params: URLSearchParams) {
  const query = new URLSearchParams(params);
  // Older clients cached station lists without city metadata for a day. Version the schema, not every request.
  if (query.get("mode") === "stations") query.set("schema", "city-v1");
  const host = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  const native = window.location.protocol === "file:" || host.Capacitor?.isNativePlatform?.();
  return `${native ? "https://www.yukino.bond" : ""}/api/rail?${query}`;
}

/** Gateway errors may be HTML when an upstream or the edge is unavailable. */
export class RailGatewayError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs = 0) {
    super(message); this.name = "RailGatewayError";
  }
}
function gatewayError(response: Response, message: string) {
  const header = response.headers.get("retry-after")?.trim();
  const delay = !header ? 0 : /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return new RailGatewayError(message, response.status, Number.isFinite(delay) ? Math.max(0, delay) : 0);
}
export async function readRailResponse<T>(response: Response): Promise<T> {
  let value: unknown;
  try { value = await response.json(); }
  catch { throw gatewayError(response, `铁路查询服务暂时不可用${response.ok ? "" : `（HTTP ${response.status}）`}，请稍后重试`); }
  if (!value || typeof value !== "object") throw new Error("铁路查询返回的资料不完整，请稍后重试");
  const error = (value as { error?: unknown }).error;
  if (!response.ok || error) throw gatewayError(response, typeof error === "string" ? error : `铁路查询失败（HTTP ${response.status}），请稍后重试`);
  return value as T;
}

function waitForRetry(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason || new DOMException("查询已取消", "AbortError")); };
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Recover transient gateway/network failures at most twice; validation errors are never retried. */
export type RailRetry = { attempt: number; delayMs: number; status?: number };
export async function requestRailData<T>(params: URLSearchParams, signal?: AbortSignal, onRetry?: (retry: RailRetry) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(railApiUrl(params), { headers: { Accept: "application/json" }, cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
      return await readRailResponse<T>(response);
    } catch (error) {
      signal?.throwIfAborted();
      const transient = error instanceof RailGatewayError ? [429, 502, 503, 504, 521, 522, 523, 524].includes(error.status) :
        error instanceof TypeError || !!error && typeof error === "object" && "name" in error && error.name === "TimeoutError";
      const requestedDelay = error instanceof RailGatewayError ? error.retryAfterMs : 0;
      if (!transient || attempt >= 2 || requestedDelay > 120000) throw error;
      const delayMs = Math.max(1250 * 2 ** attempt, requestedDelay);
      onRetry?.({ attempt: attempt + 1, delayMs, status: error instanceof RailGatewayError ? error.status : undefined });
      await waitForRetry(delayMs, signal);
    }
  }
}
