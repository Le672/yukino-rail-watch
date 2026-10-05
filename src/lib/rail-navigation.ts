import { isJourneyDate, TRAIN_CODE } from "./train-position";

export type RailFeature = "tickets" | "transfer" | "position" | "board";
export type RailPositionSelection = { train: string; date?: string; autoQuery?: boolean };
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
export function railPositionFromLocation(location: Pick<Location, "pathname" | "search"> = window.location): RailPositionSelection {
  if (railFeatureFromLocation(location) !== "position") return { train: "" };
  const query = new URLSearchParams(location.search);
  const train = (query.get("train") || "").trim().toUpperCase(), date = query.get("date") || "";
  return TRAIN_CODE.test(train) && isJourneyDate(date) ? { train, date, autoQuery: true } : { train: "" };
}
export function railFeatureUrl(feature: RailFeature, location = window.location, position?: RailPositionSelection) {
  const query = new URLSearchParams(location.search);
  query.delete("view");
  if (feature === "position" && position) {
    query.set("train", position.train); if (position.date) query.set("date", position.date);
  } else if (feature !== "position" && railFeatureFromLocation(location) === "position" && query.has("train")) {
    query.delete("train"); query.delete("date");
  }
  const pathname = isRailHost(location.hostname) ? RAIL_FEATURE_PATHS[feature] : "/cr";
  if (!isRailHost(location.hostname) && feature !== "tickets") query.set("view", feature);
  return `${pathname}${query.size ? `?${query}` : ""}${location.hash}`;
}
