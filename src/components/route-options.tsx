"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { avoidLabel, type AvoidableMode } from "@/lib/avoid";
import { legColor } from "@/lib/lines";
import { walkMeters } from "@/lib/rank";
import { dayLabel, fromSydney, toSydney } from "@/lib/sydney-time";
import type { LegAlert } from "@/lib/tfnsw/alerts";
import type { Journey, Leg, TripTime } from "@/lib/tfnsw/trip";

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

/** Every alert on the journey, once each. */
function journeyAlerts(journey: Journey): LegAlert[] {
  const byId = new Map(journey.legs.flatMap((leg) => leg.alerts ?? []).map((alert) => [alert.id, alert]));
  return [...byId.values()];
}

/** "Trackwork", "Service change" or "2 alerts". */
function alertsLabel(alerts: LegAlert[]): string {
  if (alerts.length > 1) return `${alerts.length} alerts`;
  return alerts[0].kind === "trackwork" ? "Trackwork" : "Service change";
}

function LegAlerts({ alerts }: { alerts: LegAlert[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {alerts.map((alert) => (
        <li key={alert.id} className="text-xs text-amber-700 dark:text-amber-300">
          <span aria-hidden>⚠ </span>
          {alert.url ? (
            <a href={alert.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {alert.title}
            </a>
          ) : (
            alert.title
          )}
        </li>
      ))}
    </ul>
  );
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

/** "Arriving by 21:00", "Leaving after 06:30 Tue, 13 Oct". The day is left out for today. */
function searchLabel(when: TripTime): string {
  const at = fromSydney(when);
  const day = when.date === toSydney(new Date()).date ? "" : ` ${dayLabel(at)}`;
  return `${when.type === "arrive" ? "Arriving by" : "Leaving after"} ${when.time}${day}`;
}

function Summary({ journey, leavingNow }: { journey: Journey; leavingNow: boolean }) {
  const walked = walkMeters(journey);
  const delay = journey.delayMin ?? 0;
  const spare = journey.spareMin;
  const alerts = journeyAlerts(journey);
  const facts = [
    journey.changes === 0 ? "No changes" : `${journey.changes} ${journey.changes === 1 ? "change" : "changes"}`,
    walked > 0 ? `${walkLabel(walked)} walk` : null,
    // A leave-at search shows its departure time instead; "leaves in" would count from the requested time.
    leavingNow ? (journey.waitMin ? `leaves in ${minutes(journey.waitMin)}` : "leaves now") : null,
    spare !== undefined && spare >= 0 ? `${minutes(spare)} to spare` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold tabular-nums">
          {journey.day && <span className="font-normal opacity-70">{journey.day} · </span>}
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
        {spare !== undefined && spare < 0 && (
          <span className="text-amber-600 dark:text-amber-400"> · {-spare} min after your arrival time</span>
        )}
        {alerts.length > 0 && (
          <span className="text-amber-600 dark:text-amber-400"> · ⚠ {alertsLabel(alerts)}</span>
        )}
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
        {leg.alerts && <LegAlerts alerts={leg.alerts} />}
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

export function RouteOptions({
  journeys,
  when,
  avoid,
}: {
  journeys: Journey[];
  when?: TripTime;
  avoid?: AvoidableMode[];
}) {
  const [selected, setSelected] = useState(0);
  const track = useRef<HTMLOListElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Mirrors `selected` synchronously, for the resize observer and drag handlers.
  const selectedRef = useRef(0);
  const drag = useRef<{ x: number; left: number; from: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  function choose(i: number) {
    selectedRef.current = i;
    setSelected(i);
  }

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
      if (track.current && !drag.current) choose(cardInView(track.current));
    }, 100);
  }

  function select(i: number) {
    choose(i);
    if (track.current) scrollToCard(track.current, i, "smooth");
  }

  // Touch, trackpads and wheels scroll the track natively; a mouse can't, so drag it by hand.
  function onPointerDown(e: React.PointerEvent<HTMLOListElement>) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, from: selectedRef.current, moved: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      // A small wobble is still a click.
      if (Math.abs(dx) < 5) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      // Snapping fights a hand-driven scroll; turn it off until the drag ends.
      e.currentTarget.style.scrollSnapType = "none";
      e.currentTarget.style.cursor = "grabbing";
    }
    e.currentTarget.scrollLeft = d.left - dx;
  }

  function onPointerUp(e: React.PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const el = e.currentTarget;
    el.style.scrollSnapType = "";
    el.style.cursor = "";
    justDragged.current = true;
    // The trailing click (if any) fires before this, so a later real click isn't swallowed.
    setTimeout(() => (justDragged.current = false));
    // Land on the nearest card, but treat a short flick as a move to the next one.
    const dx = e.clientX - d.x;
    let target = cardInView(el);
    if (target === d.from && Math.abs(dx) > 40) target += dx < 0 ? 1 : -1;
    select(Math.max(0, Math.min(journeys.length - 1, target)));
  }

  const journey = journeys[selected];
  const search = [when && searchLabel(when), avoid && `Avoiding ${avoidLabel(avoid)}`].filter(Boolean);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/15">
      <RouteMap journeys={journeys} selected={selected} />

      {search.length > 0 && <p className="px-4 pt-3 text-xs font-medium opacity-70">{search.join(" · ")}</p>}

      <ol
        ref={track}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // The click that ends a drag shouldn't also select the card under the pointer.
        onClickCapture={(e) => {
          if (justDragged.current) {
            justDragged.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
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
                <Summary journey={journey} leavingNow={!when} />
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
