export type RailFeature = "tickets" | "transfer" | "position" | "board";
export const RAIL_FEATURE_PATHS: Record<RailFeature, string> = {
  tickets: "/ticket", transfer: "/transfer", position: "/live", board: "/arrivalinfo",
};
export function isRailHost(hostname = window.location.hostname) { return hostname.toLowerCase() === "cr.yukino.bond"; }
export function isRailPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/cr" || isRailHost() && (path === "/" || Object.values(RAIL_FEATURE_PATHS).includes(path));
}
export function railFeatureFromLocation(location: Pick<Location, "pathname" | "search"> = window.location): RailFeature {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const matched = (Object.entries(RAIL_FEATURE_PATHS) as [RailFeature, string][]).find(([, value]) => value === path);
  if (matched) return matched[0];
  const view = new URLSearchParams(location.search).get("view");
  return view === "board" ? "board" : view === "transfer" ? "transfer" : view === "position" || view === "live" ? "position" : "tickets";
}
export function railFeatureUrl(feature: RailFeature, location = window.location) {
  const query = new URLSearchParams(location.search);
  query.delete("view");
  const pathname = isRailHost(location.hostname) ? RAIL_FEATURE_PATHS[feature] : "/cr";
  if (!isRailHost(location.hostname) && feature !== "tickets") query.set("view", feature);
  return `${pathname}${query.size ? `?${query}` : ""}${location.hash}`;
}
