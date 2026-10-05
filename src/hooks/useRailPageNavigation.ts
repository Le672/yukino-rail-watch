import { useCallback, useEffect } from "react";
import { isRailHost, railFeatureFromLocation, railFeatureUrl, railPositionFromLocation } from "../lib/rail-navigation";
import type { RailFeature, RailPositionSelection } from "../lib/rail-navigation";

type Navigate = (url: string, options?: { replace?: boolean }) => void;
/** Web navigation only; the desktop controller keeps its independent screen state. */
export function useRailPageNavigation(setFeature: (feature: RailFeature) => void, navigate?: Navigate, setPosition?: (position: RailPositionSelection) => void) {
  const go = useCallback((url: string, replace = false) => {
    if (navigate) navigate(url, { replace });
    else window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  }, [navigate]);
  useEffect(() => {
    const update = () => {
      const feature = railFeatureFromLocation();
      if (feature === "position") { const position = railPositionFromLocation(); if (position.train) setPosition?.(position); }
      setFeature(feature);
    };
    update();
    // Migrate old deep links, while the clean subdomain homepage stays at /.
    if (isRailHost() && (window.location.pathname.replace(/\/+$/, "") === "/cr" ||
      window.location.pathname === "/" && new URLSearchParams(window.location.search).has("view"))) {
      go(railFeatureUrl(railFeatureFromLocation()), true);
    }
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [setFeature, setPosition, go]);
  return useCallback((feature: RailFeature, position?: RailPositionSelection) => {
    if (position) setPosition?.(position);
    setFeature(feature); go(railFeatureUrl(feature, window.location, position));
  }, [setFeature, setPosition, go]);
}
