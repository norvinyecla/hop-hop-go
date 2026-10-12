const TIME_ZONE = "Australia/Sydney";

const parts = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

const dayFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const longDayFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** A wall-clock time in Sydney. */
export type SydneyDateTime = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm, 24-hour */
  time: string;
};

function fields(instant: Date) {
  const f = Object.fromEntries(parts.formatToParts(instant).map((p) => [p.type, p.value]));
  // "GMT+11:00" → minutes east of UTC. Plain "GMT" means no offset.
  const [, sign, hh, mm] = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(f.timeZoneName)!;
  const offsetMin = sign ? (sign === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm)) : 0;
  return { date: `${f.year}-${f.month}-${f.day}`, time: `${f.hour}:${f.minute}`, offsetMin };
}

/** The Sydney wall-clock date and time at an instant. */
export function toSydney(instant: Date): SydneyDateTime {
  const { date, time } = fields(instant);
  return { date, time };
}

/**
 * The instant a Sydney wall-clock time happens. Times in the hour skipped or repeated by a
 * daylight saving change (around 2–3am) may be an hour off.
 */
export function fromSydney({ date, time }: SydneyDateTime): Date {
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  // The offset at the first guess may be wrong if a DST change falls in between, so check it once more.
  let instant = asUtc - fields(new Date(asUtc)).offsetMin * 60_000;
  instant = asUtc - fields(new Date(instant)).offsetMin * 60_000;
  return new Date(instant);
}

/** "Tue, 13 Oct" */
export function dayLabel(instant: Date): string {
  return dayFormat.format(instant);
}

/** "Monday 12 October 2026, 14:05", for telling the model what "now" is. */
export function describeSydneyNow(now: Date): string {
  return `${longDayFormat.format(now)}, ${toSydney(now).time}`;
}
