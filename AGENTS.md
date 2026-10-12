<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Environment variables in worktrees

`.env.local` is gitignored, so a fresh git worktree won't have it and `/api/chat` fails with `LLM_API_KEY is not set`. Claude Code copies it into new worktrees via `.worktreeinclude`. If a worktree is still missing it (e.g. created with plain `git worktree add`), link it from the main checkout before running `npm run dev`:

```bash
ln -s "$(git rev-parse --path-format=absolute --git-common-dir)/../.env.local" .env.local
```
