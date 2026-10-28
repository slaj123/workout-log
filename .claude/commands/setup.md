---
description: Personalize and deploy Workout Log, step by step
---

Walk the person through setting up their own Workout Log. Go one step at a time, say what each step does in one plain sentence, and wait for them before moving on. Define any technical word the first time you use it.

1. **Check tools.** Run `node --version` (needs 20 or newer). If `node_modules/` is missing, run `npm install`.

2. **Interview them** (one question at a time, offer the defaults from `public/setup.js`):
   - Their time zone (turn a city into an IANA name like `America/Chicago` for them).
   - Which activities they do, from: lifting, surfing, climbing, tennis, flag-football, basketball. "Other" is always on.
   - If they lift: their usual Push, Pull and Legs day lifts.
   - If they surf: the spots they go to.
   - Anything else they do regularly (yoga, runs, swims...).
   - Whether to set up local testing too.

3. **Write `setup.json`** with: `timeZone`, `types` (array of the ids above), `exercises` (`{ "Push": [], "Pull": [], "Legs": [], "Other": [] }`), `spots`, `activities`, `localDev` (true/false). Show it to them in a short summary and confirm.

4. **Apply it:** `npm run setup -- --apply`. This writes `public/setup.js`, and if `localDev` is true, makes `.dev.vars` with a random local passcode and a local database. Tell them the local passcode is in `.dev.vars`; don't paste it into chat.

5. **Try it locally:** `npm run dev`, then have them open http://localhost:8787 and log in. Point out the Settings tab: they can change any of this later without redeploying.

6. **Put it online** (only when they say go). Follow README.md "Put it online": `npx wrangler login`, `npx wrangler d1 create workout-log` (you paste the id into `wrangler.jsonc`), `npx wrangler d1 migrations apply workout-log --remote`, then the three `npx wrangler secret put` commands. They type the secret values themselves; offer the one-line generator for random ones. Finish with `npm run deploy`.

7. **Phone:** tell them to open the URL in Safari, then Share → Add to Home Screen.

End with three lines: what's set up, where their choices live (Settings tab, `public/setup.js`), and how to redeploy (`npm run deploy`).
