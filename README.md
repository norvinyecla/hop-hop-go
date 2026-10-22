# hop-hop-go

An AI chat app for planning public transport trips around Sydney. See [PLAN.md](PLAN.md).

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open http://localhost:3000.

## Tracing

Set the `LANGFUSE_*` keys in `.env.local` to send a trace of each chat turn to [Langfuse](https://langfuse.com): the user's message and the reply, every model call with its token usage, and every tool call with its result. Turns in the same conversation share a session. Tracing is off when the keys are unset.

Tools report failures in their results rather than throwing, so each turn that calls a tool also gets scores saying how its tools did:

- `tool_error` (boolean): a tool couldn't do its job. `tool_error_reason` (categorical) says why, keeping the worst when several calls failed: `unavailable` (a TfNSW request failed), `exception` (the input failed the schema or the tool threw) or `bad_input` (the tool turned down what the model asked for, such as a time that has passed).
- `no_journeys_returned` (boolean): `planTrip` worked but found no journeys. Sent on turns where `planTrip` ran without an error; the metadata says whether modes were avoided.
- `no_location_match` (boolean): `resolveLocation` worked but matched nothing. Sent on turns where it ran without an error.

Each is sent only on turns where it could have happened, so its average is a rate. A failure counts even if a later call of the same tool in the turn worked; the metadata marks it `recovered`. The failing tool call is also marked `ERROR` (outages) or `WARNING` in the trace.

## Reply ratings

Each finished reply gets a thumbs up and down. A thumbs-down can add a reason (wrong place, bad route, wrong time, other) and a short comment. They're stored as scores on the reply's trace in Langfuse: `reply_rating` (boolean, with the comment) and `reply_rating_reason` (categorical). Changing or clearing a rating updates those scores rather than adding more.

To turn it on, set the `LANGFUSE_*` keys, then create the score configs and add the IDs it prints to `.env.local`:

```bash
node --env-file=.env.local scripts/create-score-configs.mjs
```

Run it once per Langfuse project. Without the config IDs, the rating controls don't appear. `/api/feedback` is rate limited per IP like `/api/chat`, with its own `FEEDBACK_RATE_LIMIT_*` limits.
