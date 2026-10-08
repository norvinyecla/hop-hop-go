# hop-hop-go: Plan

An AI chat app for Sydney. Users ask how to get from A to B, and the AI picks and explains the most convenient public transport route.

## MVP scope

**In**
- Mobile-first web app. No PWA or install step.
- No logins, accounts or saved history.
- Modes: train (including Sydney Metro), bus, light rail, ferry, and walking legs between them.
- Sydney only, using Transport for NSW (TfNSW) Open Data.

**Out (for now)**
- Bike routes
- Rideshare
- Mixed routes that use anything besides the modes above
- Saved places, preferences that persist between visits, current-location lookup

## How it works

The model never makes up a route. It calls tools that query TfNSW, compares the results and explains its pick.

```
User message
  │
  ▼
LLM (AI SDK streamText, multi-step tool calls)
  ├─ resolveLocation(query)                  → TfNSW /v1/tp/stop_finder
  ├─ planTrip(origin, dest, time, depArr)    → TfNSW /v1/tp/trip
  └─ getServiceAlerts(lines?)                → TfNSW /v1/tp/add_info
  │
  ▼
Streamed answer + route cards (+ map in phase 2)
```

### Ranking ("most convenient")
Ranking is a deterministic score in code, not done by the LLM:
- total journey time (main factor)
- number of transfers
- total walking distance
- wait time at the first stop
- real-time delays and cancellations

The weights can change based on what the user says in the conversation, e.g. "fewest changes" or "least walking". The LLM explains the result and handles vague requests.

### Trip API usage
- Restrict modes to train, metro, bus, light rail, ferry and walking. Exclude coach, school bus and on-demand.
- `depArrMacro=dep|arr` for "leave at" vs "arrive by"
- `TfNSWTR=true` for real-time data, `coordOutputFormat=EPSG:4326` for map coordinates
- Auth header: `Authorization: apikey <TFNSW_API_KEY>`

## Tech stack
- **Next.js (App Router), TypeScript**
- **Vercel AI SDK**: `streamText` + tools + `stopWhen: stepCountIs(n)` on the server, `useChat` on the client. Tool results render as route cards.
- **Model**: provider and model are set by environment variables (see below). Default: Claude Sonnet 5.5 (`claude-sonnet-5-5`) via `@ai-sdk/anthropic`.
- **Zod** for tool input schemas and parsing TfNSW responses
- **Tailwind CSS**, mobile-first layout
- **MapLibre GL** (phase 2)
- **Hosting**: Vercel. API keys stay on the server.

## Environment variables
```
TFNSW_API_KEY=
LLM_PROVIDER=anthropic          # anthropic | openai | google | ...
LLM_MODEL=claude-sonnet-5-5
LLM_API_KEY=
```

The app does not depend on a specific provider. A small `getModel()` helper reads these three variables, builds the matching AI SDK provider and passes `LLM_API_KEY` in directly, instead of relying on each provider's default variable name such as `ANTHROPIC_API_KEY`. Switching providers means changing the variables, not the code.

## Phases

1. **MVP chat**
   - Typed TfNSW client (stop_finder, trip)
   - AI tools + system prompt (Sydney-only, public transport only, ask follow-ups when a place is ambiguous)
   - Ranking function + unit tests
   - Chat UI with streaming and route cards (legs, times, platforms, walking segments)
2. **Map and real-time**
   - Route map per option
   - Live delays, service alerts, "leave now" vs "arrive by"
3. **Later** (not committed): bikes, rideshare, saved places, current location, chat history

## Open questions
- Rate limits on the TfNSW API key: confirm after signing up, and add caching for stop_finder if needed.
- How to handle trips that start or end outside Sydney: refuse, or answer with a warning?
