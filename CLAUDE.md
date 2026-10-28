# Workout Log: notes for Claude Code

A tap-to-log workout tracker: one Cloudflare Worker (`src/worker.js`) serving a no-framework page (`public/`) and a small API, with a D1 database. See README.md for the full picture.

## If the person wants to set it up

Run the `/setup` command (`.claude/commands/setup.md`), or follow the same steps: interview them, write `setup.json`, run `npm run setup -- --apply`, then walk them through deploying. Assume they may never have used a terminal. Explain each step in one line before running it.

## Where personal choices live

- `setup.json`: their answers (git-ignored). `npm run setup -- --apply` turns it into `public/setup.js`.
- `public/setup.js`: the starting activity types, lifts, spots, activities and time zone. It's committed, so keep names of people out of it.
- In-app **Settings** tab: saved in D1 (`settings` table) and wins over `public/setup.js`.
- Secrets (`WORKOUT_PASSCODE`, `SESSION_SECRET`, `INGEST_SECRET`): `wrangler secret put` online, `.dev.vars` locally. Never write them into a committed file or echo them back in chat.

## Code map

- `public/model.js`: data shape, cleaning, the catalog, and `suggestNext()` (rules, not AI). `configure()` applies settings and is shared by page and Worker.
- `public/app.js`: the page (Log, History, Lifts, Settings tabs).
- `src/worker.js` + `src/auth.js`: API and passcode lock.
- `migrations/`: D1 tables. New schema = new numbered file.

## Checks before calling anything done

- `npm test` (no network or account needed).
- `npm run dev`, then log in with the passcode from `.dev.vars` and click through Log and Settings.
