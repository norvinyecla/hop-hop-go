import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

/** Recorded TfNSW responses for one case, and when they were recorded. Replays run as if it were that time. */
export type CaseFixtures = {
  recordedAt: string;
  responses: Record<string, unknown>;
};

type TfnswGet = (endpoint: string, params: Record<string, string>, signal?: AbortSignal) => Promise<unknown>;

/** Thrown when a replay asks for a request that wasn't recorded. The tools turn it into an "unavailable" error. */
export class FixtureMissError extends Error {}

/** Words a model adds or drops without changing the place, so "Central Station" finds a recording of "central". */
const FILLER = new Set(["the", "station", "stn"]);

/** One key per distinct request. Place queries are loosened so small rewordings still match. */
export function fixtureKey(endpoint: string, params: Record<string, string>): string {
  const entries = Object.entries(params).map(([name, value]) => {
    if (endpoint === "stop_finder" && name === "name_sf") {
      const words = value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/);
      return [name, words.filter((word) => word && !FILLER.has(word)).join(" ")];
    }
    return [name, value];
  });
  entries.sort(([a], [b]) => a.localeCompare(b));
  return `${endpoint}?${new URLSearchParams(entries)}`;
}

/** Answers TfNSW requests from a case's recordings, and notes the ones it couldn't answer. */
export function replay(fixtures: CaseFixtures): { tfnswGet: TfnswGet; misses: string[] } {
  const misses: string[] = [];
  const tfnswGet: TfnswGet = async (endpoint, params) => {
    const key = fixtureKey(endpoint, params);
    if (!(key in fixtures.responses)) {
      misses.push(key);
      throw new FixtureMissError(`No recorded TfNSW response for ${key}`);
    }
    return structuredClone(fixtures.responses[key]);
  };
  return { tfnswGet, misses };
}

/** Passes requests through to TfNSW and keeps each response. */
export function record(live: TfnswGet): { tfnswGet: TfnswGet; fixtures: CaseFixtures } {
  const fixtures: CaseFixtures = { recordedAt: new Date().toISOString(), responses: {} };
  const tfnswGet: TfnswGet = async (endpoint, params, signal) => {
    const response = slim(endpoint, await live(endpoint, params, signal));
    const key = fixtureKey(endpoint, params);
    // add_info is retried when TfNSW cuts it short (see fetchTrainAlerts), so keep the fullest one.
    const kept = fixtures.responses[key];
    if (!kept || JSON.stringify(response).length > JSON.stringify(kept).length) fixtures.responses[key] = response;
    return response;
  };
  return { tfnswGet, fixtures };
}

type Info = {
  timestamps?: { validity?: unknown };
  affected?: { lines?: { id: string; number?: string }[]; stops?: { id: string }[] };
  properties?: { announcementType?: unknown; smsText?: unknown; speechText?: unknown };
};

/**
 * Drops what the app never reads, so each case's file stays small: leg shapes, which only draw the
 * map, and the stop and line details in alerts. Keep in step with infoSchema in src/lib/tfnsw/alerts.ts.
 */
function slim(endpoint: string, response: unknown): unknown {
  const copy = structuredClone(response);
  if (endpoint === "trip") {
    for (const journey of (copy as { journeys?: { legs?: { coords?: unknown }[] }[] }).journeys ?? []) {
      for (const leg of journey.legs ?? []) delete leg.coords;
    }
  }
  if (endpoint === "add_info") {
    const infos = (copy as { infos?: { current?: Info[] } }).infos;
    infos?.current?.forEach((info, i) => {
      const { timestamps, affected, properties } = info;
      infos.current![i] = {
        ...pick(info, ["id", "type", "priority", "subtitle", "content", "url"]),
        timestamps: timestamps && { validity: timestamps.validity },
        affected: affected && {
          lines: affected.lines?.map(({ id, number }) => ({ id, number })),
          stops: affected.stops?.map(({ id }) => ({ id })),
        },
        properties: properties && pick(properties, ["announcementType", "smsText", "speechText"]),
      };
    });
  }
  return copy;
}

function pick<T extends object>(value: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key))) as Partial<T>;
}

function fixturePath(caseId: string): string {
  return path.join(FIXTURES_DIR, `${caseId}.json.gz`);
}

export async function loadFixtures(caseId: string): Promise<CaseFixtures | undefined> {
  try {
    return JSON.parse(gunzipSync(await readFile(fixturePath(caseId))).toString("utf8")) as CaseFixtures;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Gzipped: alert notices are long HTML, and a case's file is several hundred KB as plain JSON. */
export async function saveFixtures(caseId: string, fixtures: CaseFixtures): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });
  await writeFile(fixturePath(caseId), gzipSync(JSON.stringify(fixtures, null, 1)));
}
