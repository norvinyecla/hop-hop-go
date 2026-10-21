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
