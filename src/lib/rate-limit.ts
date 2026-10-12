export type RateLimitWindow = { max: number; ms: number };

export type RateLimitResult = {
  success: boolean;
  /** Max requests in the most restrictive window. Infinity when no limits are set. */
  limit: number;
  remaining: number;
  /** Epoch ms when that window resets. */
  resetAt: number;
};

/**
 * Counts requests per key. The in-memory limiter below is the only implementation today.
 * A shared store such as Upstash Redis can implement the same interface when counts must
 * hold across serverless instances.
 */
export interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>;
}

const SWEEP_EVERY_MS = 60_000;

/**
 * Fixed-window limiter kept in process memory. A request must fit in every window to pass,
 * and rejected requests are not counted. On Vercel each instance has its own counts, which
 * reset on cold starts.
 */
export function createMemoryRateLimiter(
  windows: RateLimitWindow[],
  now: () => number = Date.now,
): RateLimiter {
  const counters = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = now() + SWEEP_EVERY_MS;

  return {
    async limit(key) {
      const t = now();
      if (t >= nextSweep) {
        for (const [k, c] of counters) if (c.resetAt <= t) counters.delete(k);
        nextSweep = t + SWEEP_EVERY_MS;
      }

      if (windows.length === 0) {
        return { success: true, limit: Infinity, remaining: Infinity, resetAt: t };
      }

      const current = windows.map((w, i) => {
        const id = `${i}:${key}`;
        let c = counters.get(id);
        if (!c || c.resetAt <= t) {
          c = { count: 0, resetAt: t + w.ms };
          counters.set(id, c);
        }
        return { w, c };
      });

      const blocked = current.filter(({ w, c }) => c.count >= w.max);
      if (blocked.length > 0) {
        // Report the window that stays closed longest, so Retry-After is enough to get through.
        const { w, c } = blocked.reduce((a, b) => (b.c.resetAt > a.c.resetAt ? b : a));
        return { success: false, limit: w.max, remaining: 0, resetAt: c.resetAt };
      }

      for (const { c } of current) c.count++;
      const { w, c } = current.reduce((a, b) =>
        b.w.max - b.c.count < a.w.max - a.c.count ? b : a,
      );
      return { success: true, limit: w.max, remaining: w.max - c.count, resetAt: c.resetAt };
    },
  };
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Reads RATE_LIMIT_PER_MINUTE and RATE_LIMIT_PER_DAY. 0 turns a limit off. */
export function windowsFromEnv(env: Record<string, string | undefined>): RateLimitWindow[] {
  return [
    { max: parseLimit(env.RATE_LIMIT_PER_MINUTE, 10), ms: 60_000 },
    { max: parseLimit(env.RATE_LIMIT_PER_DAY, 100), ms: 86_400_000 },
  ].filter((w) => w.max > 0);
}

/**
 * The caller's IP. Vercel sets x-forwarded-for itself, so its first entry can be trusted
 * there. Behind other hosts, make sure a proxy overwrites the header.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "anonymous";
}

/** Standard RateLimit-* headers, plus Retry-After when the request was blocked. */
export function rateLimitHeaders(result: RateLimitResult, now = Date.now()): Record<string, string> {
  if (!Number.isFinite(result.limit)) return {};
  const resetSec = Math.max(0, Math.ceil((result.resetAt - now) / 1000));
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(resetSec),
  };
  if (!result.success) headers["Retry-After"] = String(resetSec);
  return headers;
}

/** User-facing message for a blocked request. */
export function rateLimitMessage(retryAfterSec: number): string {
  let wait: string;
  if (retryAfterSec < 60) {
    const s = Math.max(1, retryAfterSec);
    wait = `${s} second${s === 1 ? "" : "s"}`;
  } else if (retryAfterSec < 3600) {
    const m = Math.ceil(retryAfterSec / 60);
    wait = `${m} minute${m === 1 ? "" : "s"}`;
  } else {
    const h = Math.ceil(retryAfterSec / 3600);
    wait = `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `You're sending messages too quickly. Please try again in about ${wait}.`;
}

export const chatRateLimiter: RateLimiter = createMemoryRateLimiter(windowsFromEnv(process.env));
