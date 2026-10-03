/** Native clients bundle their UI locally; public rail data remains on the same official gateway. */
export function railApiUrl(params: URLSearchParams) {
  const query = new URLSearchParams(params);
  // Older clients cached station lists without city metadata for a day. Version the schema, not every request.
  if (query.get("mode") === "stations") query.set("schema", "city-v1");
  const host = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  const native = window.location.protocol === "file:" || host.Capacitor?.isNativePlatform?.();
  return `${native ? "https://www.yukino.bond" : ""}/api/rail?${query}`;
}
