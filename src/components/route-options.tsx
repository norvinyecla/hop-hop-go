"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { legColor } from "@/lib/lines";
import { walkMeters } from "@/lib/rank";
import type { Journey, Leg } from "@/lib/tfnsw/trip";

// MapLibre needs the browser (WebGL, window), so skip it during server rendering.
const RouteMap = dynamic(() => import("@/components/route-map"), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse bg-black/5 dark:bg-white/10" />,
});

function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function walkLabel(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function delayOf(journey: Journey): number {
  return journey.legs.reduce((total, leg) => total + (leg.delayMin ?? 0), 0);
}

/** Drops the suburb: "Central Station, Sydney" → "Central Station". */
function shortName(name: string): string {
  return name.split(",")[0];
}

function LineBadge({ leg }: { leg: Leg }) {
  if (leg.mode === "walk") {
    return (
      <span className="text-xs opacity-70" title={`Walk ${leg.durationMin} min`}>
        🚶 {leg.durationMin}
      </span>
    );
  }
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs font-bold text-white"
      style={{ backgroundColor: legColor(leg) }}
    >
      {leg.line ?? leg.mode}
    </span>
  );
}

function Summary({ journey }: { journey: Journey }) {
  const walked = walkMeters(journey);
  const delay = delayOf(journey);
  const facts = [
    journey.changes === 0 ? "No changes" : `${journey.changes} ${journey.changes === 1 ? "change" : "changes"}`,
    walked > 0 ? `${walkLabel(walked)} walk` : null,
    journey.waitMin > 0 ? `leaves in ${minutes(journey.waitMin)}` : "leaves now",
  ].filter(Boolean);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold tabular-nums">
          {journey.departs} → {journey.arrives}
        </span>
        <span className="text-sm tabular-nums opacity-70">{minutes(journey.durationMin)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {journey.legs.map((leg, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-xs opacity-40">›</span>}
            <LineBadge leg={leg} />
          </span>
        ))}
      </div>
      <p className="text-xs opacity-70">
        {facts.join(" · ")}
        {delay > 0 && <span className="text-amber-600 dark:text-amber-400"> · {delay} min late</span>}
      </p>
    </div>
  );
}

function LegDetail({ leg }: { leg: Leg }) {
  if (leg.mode === "walk") {
    return (
      <li className="flex gap-3 text-sm">
        <span className="w-11 shrink-0 tabular-nums opacity-60">{leg.departs}</span>
        <span className="opacity-80">
          Walk {leg.walkMeters ? `${walkLabel(leg.walkMeters)}, ` : ""}
          {leg.durationMin} min to {shortName(leg.to)}
        </span>
      </li>
    );
  }
  return (
    <li className="flex gap-3 text-sm">
      <span className="w-11 shrink-0 tabular-nums opacity-60">{leg.departs}</span>
      <span className="border-l-4 pl-2" style={{ borderColor: legColor(leg) }}>
        <span className="font-medium">
          {leg.line ?? leg.mode}
          {leg.towards && <span className="font-normal opacity-70"> towards {shortName(leg.towards)}</span>}
        </span>
        <br />
        {shortName(leg.from)}
        {leg.platform && <span className="opacity-70">, {leg.platform}</span>}
        <span className="opacity-50"> → </span>
        {shortName(leg.to)}
        {leg.arrivalPlatform && <span className="opacity-70">, {leg.arrivalPlatform}</span>}
        <span className="opacity-70">
          {" "}
          · arrives {leg.arrives}
          {leg.delayMin ? <span className="text-amber-600 dark:text-amber-400"> ({leg.delayMin} min late)</span> : null}
        </span>
      </span>
    </li>
  );
}

export function RouteOptions({ journeys }: { journeys: Journey[] }) {
  const [selected, setSelected] = useState(0);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/15">
      <RouteMap journeys={journeys} selected={selected} />
      <ol className="divide-y divide-black/10 dark:divide-white/15">
        {journeys.map((journey, i) => {
          const isSelected = i === selected;
          return (
            <li key={i}>
              <button
                type="button"
                aria-expanded={isSelected}
                onClick={() => setSelected(i)}
                className={`block w-full px-4 py-3 text-left ${isSelected ? "bg-blue-600/5 dark:bg-blue-400/10" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
              >
                {i === 0 && (
                  <span className="mb-1 inline-block rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Best
                  </span>
                )}
                <Summary journey={journey} />
              </button>
              {isSelected && (
                <ol className="space-y-2 px-4 pb-3">
                  {journey.legs.map((leg, j) => (
                    <LegDetail key={j} leg={leg} />
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
