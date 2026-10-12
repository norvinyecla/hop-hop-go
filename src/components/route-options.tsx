"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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
  const delay = journey.delayMin ?? 0;
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
          {leg.delayMin ? (
            <span className="text-amber-600 dark:text-amber-400"> · departs {leg.delayMin} min late</span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

/** Where cards snap to: the track's scroll position plus its scroll padding. */
function snapPoint(track: HTMLElement): number {
  return track.scrollLeft + parseFloat(getComputedStyle(track).scrollPaddingLeft || "0");
}

/** A card's left edge in the track's scroll coordinates. (offsetLeft is relative to the page, not the track.) */
function cardLeft(track: HTMLElement, card: Element): number {
  return card.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
}

/** The card whose left edge is nearest the track's snap point. */
function cardInView(track: HTMLElement): number {
  const snap = snapPoint(track);
  const distances = Array.from(track.children).map((card) => Math.abs(cardLeft(track, card) - snap));
  return distances.indexOf(Math.min(...distances));
}

function scrollToCard(track: HTMLElement, i: number, behavior: ScrollBehavior) {
  const card = track.children[i];
  if (!card) return;
  const padding = snapPoint(track) - track.scrollLeft;
  track.scrollTo({ left: cardLeft(track, card) - padding, behavior });
}

export function RouteOptions({ journeys }: { journeys: Journey[] }) {
  const [selected, setSelected] = useState(0);
  const track = useRef<HTMLOListElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const selectedRef = useRef(0);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => () => clearTimeout(settle.current), []);

  // Card widths change with the screen (e.g. on rotation), which leaves the track between cards.
  // Line it back up with the selected card.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(() => scrollToCard(el, selectedRef.current, "instant"));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Select a card once swiping settles, so the map doesn't redraw for every card passed on the way.
  function onScroll() {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (track.current) setSelected(cardInView(track.current));
    }, 100);
  }

  function select(i: number) {
    setSelected(i);
    if (track.current) scrollToCard(track.current, i, "smooth");
  }

  const journey = journeys[selected];

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/15">
      <RouteMap journeys={journeys} selected={selected} />

      <ol
        ref={track}
        onScroll={onScroll}
        aria-label="Journey options"
        className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {journeys.map((journey, i) => {
          const isSelected = i === selected;
          return (
            <li key={i} className={`shrink-0 snap-start ${journeys.length > 1 ? "w-[85%]" : "w-full"}`}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`Option ${i + 1} of ${journeys.length}`}
                onClick={() => select(i)}
                className={`block h-full w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? "border-blue-600 bg-blue-600/5 dark:border-blue-400 dark:bg-blue-400/10"
                    : "border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                }`}
              >
                {i === 0 && (
                  <span className="mb-1 inline-block rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Best
                  </span>
                )}
                <Summary journey={journey} />
              </button>
            </li>
          );
        })}
      </ol>

      {journeys.length > 1 && (
        <div className="flex justify-center gap-1.5 pb-2">
          {journeys.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show option ${i + 1}`}
              onClick={() => select(i)}
              className={`h-1.5 rounded-full transition-all ${i === selected ? "w-4 bg-blue-600 dark:bg-blue-400" : "w-1.5 bg-black/20 dark:bg-white/25"}`}
            />
          ))}
        </div>
      )}

      {journey && (
        <ol className="space-y-2 border-t border-black/10 px-4 py-3 dark:border-white/15" aria-label="Journey details">
          {journey.legs.map((leg, j) => (
            <LegDetail key={j} leg={leg} />
          ))}
        </ol>
      )}
    </div>
  );
}
