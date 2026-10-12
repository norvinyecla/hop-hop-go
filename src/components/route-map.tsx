"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { boundsOf } from "@/lib/geo";
import { legColor } from "@/lib/lines";
import type { Journey } from "@/lib/tfnsw/trip";

// MapLibre finds its worker next to its own module, which bundling breaks.
// This makes the bundler ship the worker file and gives MapLibre its URL.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

// OpenFreeMap: free vector tiles, no API key.
const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

type Props = {
  journeys: Journey[];
  selected: number;
};

function routeFeatures(journeys: Journey[], selected: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: journeys.flatMap((journey, i) =>
      journey.legs
        .filter((leg) => leg.path.length >= 2)
        .map((leg) => ({
          type: "Feature" as const,
          properties: { color: legColor(leg), walk: leg.mode === "walk", selected: i === selected },
          geometry: { type: "LineString" as const, coordinates: leg.path },
        })),
    ),
  };
}

/** Where the selected journey starts, changes and ends. */
function stopFeatures(journey: Journey | undefined): GeoJSON.FeatureCollection {
  const points = (journey?.legs ?? []).flatMap((leg, i, legs) => {
    const start = leg.path[0];
    const end = leg.path.at(-1);
    return [
      ...(start ? [{ coord: start, end: i === 0 }] : []),
      ...(end && i === legs.length - 1 ? [{ coord: end, end: true }] : []),
    ];
  });
  return {
    type: "FeatureCollection",
    features: points.map(({ coord, end }) => ({
      type: "Feature" as const,
      properties: { end },
      geometry: { type: "Point" as const, coordinates: coord },
    })),
  };
}

function fit(map: MapLibreMap, journey: Journey | undefined, animate: boolean) {
  const bounds = boundsOf(journey?.legs.flatMap((leg) => leg.path) ?? []);
  // Extra room at the bottom so the attribution doesn't cover the destination.
  if (bounds) map.fitBounds(bounds, { padding: { top: 24, right: 24, bottom: 40, left: 24 }, maxZoom: 15, animate });
}

export default function RouteMap({ journeys, selected }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  // The latest props, for the load handler, which runs once.
  const latest = useRef({ journeys, selected });

  useEffect(() => {
    if (!container.current) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const map = new MapLibreMap({
      container: container.current,
      style: dark ? STYLES.dark : STYLES.light,
      center: [151.2093, -33.8688],
      zoom: 10,
      attributionControl: { compact: true },
      // One finger scrolls the chat; two fingers move the map.
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      const { journeys, selected } = latest.current;
      map.addSource("routes", { type: "geojson", data: routeFeatures(journeys, selected) });
      map.addSource("stops", { type: "geojson", data: stopFeatures(journeys[selected]) });

      map.addLayer({
        id: "routes-other",
        type: "line",
        source: "routes",
        filter: ["!", ["get", "selected"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#9CA3AF", "line-width": 3, "line-opacity": 0.6 },
      });
      map.addLayer({
        id: "routes-casing",
        type: "line",
        source: "routes",
        filter: ["all", ["get", "selected"], ["!", ["get", "walk"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 8 },
      });
      map.addLayer({
        id: "routes-selected",
        type: "line",
        source: "routes",
        filter: ["all", ["get", "selected"], ["!", ["get", "walk"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 5 },
      });
      map.addLayer({
        id: "routes-walk",
        type: "line",
        source: "routes",
        filter: ["all", ["get", "selected"], ["get", "walk"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 4, "line-dasharray": [0.5, 2] },
      });
      map.addLayer({
        id: "stops",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": ["case", ["get", "end"], 6, 4],
          "circle-color": ["case", ["get", "end"], "#111827", "#FFFFFF"],
          "circle-stroke-color": ["case", ["get", "end"], "#FFFFFF", "#111827"],
          "circle-stroke-width": 2,
        },
      });

      loaded.current = true;
      fit(map, journeys[selected], false);

      // The compact attribution starts expanded and covers a small map. Start it collapsed;
      // the ⓘ button still opens it.
      const attribution = container.current?.querySelector("details.maplibregl-ctrl-attrib");
      attribution?.removeAttribute("open");
      attribution?.classList.remove("maplibregl-compact-show");
    });

    // Keep the selected route in view when the map changes size, e.g. on rotation.
    map.on("resize", () => {
      if (!loaded.current) return;
      const { journeys, selected } = latest.current;
      fit(map, journeys[selected], false);
    });

    return () => {
      loaded.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    latest.current = { journeys, selected };
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    map.getSource<GeoJSONSource>("routes")?.setData(routeFeatures(journeys, selected));
    map.getSource<GeoJSONSource>("stops")?.setData(stopFeatures(journeys[selected]));
    fit(map, journeys[selected], true);
  }, [journeys, selected]);

  return <div ref={container} className="h-56 w-full" />;
}
