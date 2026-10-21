import { describe, expect, it } from "vitest";
import {
  clientKey,
  createMemoryRateLimiter,
  rateLimitHeaders,
  rateLimitMessage,
  windowsFromEnv,
} from "./rate-limit";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createMemoryRateLimiter", () => {
  it("allows up to max requests per window, then blocks", async () => {
    const c = clock();
    const limiter = createMemoryRateLimiter([{ max: 2, ms: 1000 }], c.now);

    expect(await limiter.limit("a")).toEqual({ success: true, limit: 2, remaining: 1, resetAt: 1000 });
    expect(await limiter.limit("a")).toMatchObject({ success: true, remaining: 0 });
    expect(await limiter.limit("a")).toEqual({ success: false, limit: 2, remaining: 0, resetAt: 1000 });
  });

  it("resets after the window ends", async () => {
    const c = clock();
    const limiter = createMemoryRateLimiter([{ max: 1, ms: 1000 }], c.now);

    await limiter.limit("a");
    expect((await limiter.limit("a")).success).toBe(false);
    c.advance(1000);
    expect(await limiter.limit("a")).toMatchObject({ success: true, resetAt: 2000 });
  });

  it("counts each key separately", async () => {
    const limiter = createMemoryRateLimiter([{ max: 1, ms: 1000 }], clock().now);

    expect((await limiter.limit("a")).success).toBe(true);
    expect((await limiter.limit("b")).success).toBe(true);
    expect((await limiter.limit("a")).success).toBe(false);
  });

  it("applies every window and reports the one that blocks longest", async () => {
    const c = clock();
    const limiter = createMemoryRateLimiter(
      [
        { max: 2, ms: 1000 },
        { max: 3, ms: 10_000 },
      ],
      c.now,
    );

    await limiter.limit("a");
    await limiter.limit("a");
    expect(await limiter.limit("a")).toMatchObject({ success: false, limit: 2, resetAt: 1000 });

    c.advance(1000);
    // Third request fits the short window and uses up the long one.
    expect(await limiter.limit("a")).toMatchObject({ success: true, limit: 3, remaining: 0 });
    expect(await limiter.limit("a")).toMatchObject({ success: false, limit: 3, resetAt: 10_000 });
  });

  it("does not count blocked requests", async () => {
    const c = clock();
    const limiter = createMemoryRateLimiter(
      [
        { max: 1, ms: 1000 },
        { max: 2, ms: 10_000 },
      ],
      c.now,
    );

    await limiter.limit("a");
    await limiter.limit("a"); // blocked by the short window
    c.advance(1000);
    expect((await limiter.limit("a")).success).toBe(true);
  });

  it("allows everything when no windows are set", async () => {
    const limiter = createMemoryRateLimiter([], clock().now);
    for (let i = 0; i < 5; i++) {
      expect(await limiter.limit("a")).toMatchObject({ success: true, limit: Infinity });
    }
  });
});

describe("windowsFromEnv", () => {
  it("defaults to 10 per minute and 100 per day", () => {
    expect(windowsFromEnv({})).toEqual([
      { max: 10, ms: 60_000 },
      { max: 100, ms: 86_400_000 },
    ]);
  });

  it("reads overrides, drops limits set to 0 and ignores invalid values", () => {
    expect(windowsFromEnv({ RATE_LIMIT_PER_MINUTE: "0", RATE_LIMIT_PER_DAY: "500" })).toEqual([
      { max: 500, ms: 86_400_000 },
    ]);
    expect(windowsFromEnv({ RATE_LIMIT_PER_MINUTE: "abc", RATE_LIMIT_PER_DAY: "-1" })).toEqual([
      { max: 10, ms: 60_000 },
      { max: 100, ms: 86_400_000 },
    ]);
  });

  it("reads another prefix with its own defaults", () => {
    const defaults = { perMinute: 30, perDay: 300 };
    expect(windowsFromEnv({ RATE_LIMIT_PER_MINUTE: "1" }, "FEEDBACK_RATE_LIMIT", defaults)).toEqual([
      { max: 30, ms: 60_000 },
      { max: 300, ms: 86_400_000 },
    ]);
    expect(windowsFromEnv({ FEEDBACK_RATE_LIMIT_PER_DAY: "0" }, "FEEDBACK_RATE_LIMIT", defaults)).toEqual([
      { max: 30, ms: 60_000 },
    ]);
  });
});

describe("clientKey", () => {
  const req = (headers: Record<string, string>) => new Request("http://x", { headers });

  it("uses the first x-forwarded-for entry", () => {
    expect(clientKey(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then anonymous", () => {
    expect(clientKey(req({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKey(req({}))).toBe("anonymous");
  });
});

describe("rateLimitHeaders", () => {
  it("adds Retry-After only when blocked", () => {
    expect(rateLimitHeaders({ success: true, limit: 10, remaining: 3, resetAt: 30_500 }, 0)).toEqual({
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "3",
      "RateLimit-Reset": "31",
    });
    expect(
      rateLimitHeaders({ success: false, limit: 10, remaining: 0, resetAt: 5000 }, 0)["Retry-After"],
    ).toBe("5");
  });

  it("returns nothing when limits are off", () => {
    expect(rateLimitHeaders({ success: true, limit: Infinity, remaining: Infinity, resetAt: 0 })).toEqual({});
  });
});

describe("rateLimitMessage", () => {
  it("rounds the wait to a friendly unit", () => {
    expect(rateLimitMessage(1)).toContain("about 1 second.");
    expect(rateLimitMessage(42)).toContain("about 42 seconds.");
    expect(rateLimitMessage(90)).toContain("about 2 minutes.");
    expect(rateLimitMessage(5000)).toContain("about 2 hours.");
  });

  it("names what the user was doing", () => {
    expect(rateLimitMessage(1)).toMatch(/^You're sending messages too quickly/);
    expect(rateLimitMessage(1, "rating replies")).toMatch(/^You're rating replies too quickly/);
  });
});
