const TIME_ZONE = "Australia/Sydney";

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far Sydney's clock is ahead of UTC at an instant, in ms (10 or 11 hours, with daylight saving). */
function offsetMs(at: number): number {
  const p = Object.fromEntries(parts.formatToParts(at).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}

/** A wall-clock time in Sydney. */
export type SydneyDateTime = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm, 24-hour */
  time: string;
};

/** The Sydney wall-clock date and time at an instant. */
export function toSydney(at: Date): SydneyDateTime {
  const iso = new Date(at.getTime() + offsetMs(at.getTime())).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** The Sydney calendar date at an instant, as YYYY-MM-DD. */
export function sydneyDate(at: Date): string {
  return toSydney(at).date;
}

/**
 * The instant a Sydney wall-clock time happens. Times in the hour skipped or repeated by a
 * daylight saving change (around 2–3am) may be an hour off.
 */
export function fromSydney({ date, time }: SydneyDateTime): Date {
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  // The offset depends on the instant, so check it again at the first guess in case daylight saving changes between.
  const guess = asUtc - offsetMs(asUtc);
  return new Date(asUtc - offsetMs(guess));
}

/** The instant a Sydney calendar date (YYYY-MM-DD) starts. */
export function startOfSydneyDay(date: string): Date {
  return fromSydney({ date, time: "00:00" });
}

/** The calendar date `days` after a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

const dayFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** e.g. "Tue, 13 Oct". */
export function dayLabel(at: Date): string {
  return dayFormat.format(at);
}

const longDate = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** e.g. "Monday 12 October 2026 at 16:58". */
export function sydneyNow(at: Date): string {
  return longDate.format(at);
}
