# hop-hop-go

An AI chat app for planning public transport trips around Sydney. You ask how to get somewhere in plain words, and it finds real journeys from Transport for NSW, recommends one and explains why.

## What it does

- **Plans trips** by train (including Sydney Metro), light rail and bus, with walking between them. Ferries, coaches, driving, cycling and rideshare aren't covered, and neither are trips that start or end outside Sydney.
- **Shows the options** as swipeable cards with departure and arrival times, lines, platforms, changes and walking, plus a map of the selected route.
- **Understands when you want to travel**: leave now (the default), "leave tomorrow at 6:30am" or "arrive by 9pm". It asks for a time when you're vague ("tomorrow morning") and says so when a time has already passed.
- **Follows your preferences**: "fastest", "fewest changes" or "least walking" change how journeys are ranked, and "no buses" or "trains only" leave modes out for the rest of the chat.
- **Tells you about disruptions**: alerts on the recommended journey, such as trackwork or a lift outage, and questions like "is there trackwork on the T1 this weekend?" for trains, metro and light rail.
- **Asks when a place is ambiguous** instead of guessing.

Example questions:

> Central to Bondi Junction, no buses
>
> How do I get to the airport from Parramatta for a 10am flight tomorrow?
>
> Any trackwork on the T4 this weekend?

The app has no accounts and keeps no chat history; reloading starts a new chat. See [the privacy note](src/app/privacy/page.tsx) for what is sent where.

## How it works

The model never makes up a route. In [/api/chat](src/app/api/chat/route.ts) it calls tools that query the [TfNSW Open Data](https://opendata.transport.nsw.gov.au) trip planner API, then explains the result:

- `resolveLocation` turns a place name into TfNSW stops or locations (`stop_finder`).
- `planTrip` finds journeys between them (`trip`), with real-time delays. Ranking is done in code, not by the model ([src/lib/rank.ts](src/lib/rank.ts)): a score in minutes made of journey time and the wait before it, plus penalties for changes, walking and delays, weighted by the preference.
- `getServiceAlerts` looks up trackwork and service changes for given lines and dates (`add_info`).

Built with Next.js (App Router), the Vercel AI SDK, Tailwind CSS and MapLibre GL. The model is set by environment variables: Google Gemini 3 Flash by default, or Anthropic ([src/lib/llm.ts](src/lib/llm.ts)). Requests to `/api/chat` are rate limited per IP. [PLAN.md](PLAN.md) has the design and the roadmap.

## Getting started

You need a [TfNSW Open Data](https://opendata.transport.nsw.gov.au) API key and an API key for the model provider.

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open http://localhost:3000. `npm test` runs the unit tests.

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

## Evals

`npm run eval` runs the hand-written chat cases in [evals/cases.ts](evals/cases.ts) through the model set in `.env.local`, with the same prompt, tools and limits as `/api/chat`, and checks what the reply did. The checks are plain code, not an LLM judge: which places it looked up, whether `planTrip` ran and with which `avoid`, `preference` and `when`, whether its location IDs came from `resolveLocation`, whether `getServiceAlerts` got the right lines and dates, whether it asked a follow-up question, and whether the reply finished in plain text.

TfNSW answers from fixtures recorded in `evals/fixtures/`, and each case runs as if it were the time its fixtures were recorded. Timetables can't move the results, so a run only changes when the model or prompt does.

```bash
npm run eval                                 # every case
EVAL_CASES=no-buses,fastest npm run eval     # some cases
EVAL_RECORD=1 EVAL_CASES=no-buses npm run eval   # call TfNSW live and re-record those fixtures
```

A case can set `tfnsw: { trip: "empty" }` or `"error"` (likewise `stop_finder` and `add_info`) to test what the model does when TfNSW finds nothing or is down; those requests aren't recorded. Record a case after adding or changing it. A `fixtures_complete` failure means the model asked TfNSW for something that wasn't recorded, such as a different place name; re-record the case if the new request is reasonable.

With the `LANGFUSE_*` keys set, the cases are synced to the `chat-evals` dataset and each run is an experiment on it. Every case gets a `check_<name>` boolean score per check and a `checks_passed` score, and the run gets a `pass_rate`, so runs with different models or prompts can be compared. Edit cases in `cases.ts`, not in Langfuse: each run overwrites the dataset and archives items whose case is gone.

Good new cases come from replies people rate down: when a `reply_rating` thumbs-down shows a mistake a check could catch, add it as a case.
