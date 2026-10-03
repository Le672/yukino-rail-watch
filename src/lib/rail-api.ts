/** Native clients bundle their UI locally; public rail data remains on the same official gateway. */
export function railApiUrl(params: URLSearchParams) {
  const host = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  const native = window.location.protocol === "file:" || host.Capacitor?.isNativePlatform?.();
  return `${native ? "https://www.yukino.bond" : ""}/api/rail?${params}`;
}
