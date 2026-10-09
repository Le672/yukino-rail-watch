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
export async function readRailResponse<T>(response: Response): Promise<T> {
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new Error(`铁路查询服务暂时不可用${response.ok ? "" : `（HTTP ${response.status}）`}，请稍后重试`); }
  if (!value || typeof value !== "object") throw new Error("铁路查询返回的资料不完整，请稍后重试");
  const error = (value as { error?: unknown }).error;
  if (!response.ok || error) throw new Error(typeof error === "string" ? error : `铁路查询失败（HTTP ${response.status}），请稍后重试`);
  return value as T;
}
