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

## Reply ratings

Each finished reply gets a thumbs up and down. A thumbs-down can add a reason (wrong place, bad route, wrong time, other) and a short comment. They're stored as scores on the reply's trace in Langfuse: `reply_rating` (boolean, with the comment) and `reply_rating_reason` (categorical). Changing or clearing a rating updates those scores rather than adding more.

To turn it on, set the `LANGFUSE_*` keys, then create the score configs and add the IDs it prints to `.env.local`:

```bash
node --env-file=.env.local scripts/create-score-configs.mjs
```

Run it once per Langfuse project. Without the config IDs, the rating controls don't appear. `/api/feedback` is rate limited per IP like `/api/chat`, with its own `FEEDBACK_RATE_LIMIT_*` limits.
