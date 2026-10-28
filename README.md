# Workout Log

A tap-to-log workout tracker that lives on your phone's home screen. You can log lifts (day, then exercise, then sets), surf sessions, climbs (sends and projects), tennis, flag football, basketball and anything else. It also suggests what to train today.

- **Fast logging.** "Repeat last Pull" copies your previous Pull day so you only change what moved. Last time's numbers show in grey next to each set.
- **Suggestions, no AI.** The top of the Log screen shows a pick for today (or tomorrow, once you've logged today), a second option and a "skip" warning. Each session tires muscle groups, scaled by effort, and the fatigue halves every day. Lifting rotates Push, Pull, Legs, and things you haven't done in a while move up. A recovery day comes only after 6 active days in a row.
- **Watch numbers.** Every entry has fields for active calories and average heart rate, which you copy off your Apple Watch summary.
- **API for automations.** `POST /api/ingest` lets an iOS Shortcut or another app add sessions using a secret header.
- **Private by default.** The whole app sits behind a passcode. Five wrong tries from one IP locks that IP out for 15 minutes.

Built as one Cloudflare Worker that serves the page plus a small API, with a D1 (SQLite) database. It runs on Cloudflare's free plan.

## What you need

- [Node.js](https://nodejs.org) 20 or newer
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account

## 1. Install

```bash
git clone https://github.com/<your-username>/workout-log.git
cd workout-log
npm install
npm test
```

`npm test` runs the logic and API tests. They need no account.

## 2. Make it yours

Open `public/model.js`:

- `SEED_EXERCISES`: the lifts that appear in the dropdowns for Push, Pull and Legs days.
- `SEED_SPOTS`: your surf spots.
- `SEED_ACTIVITIES`: anything else you do.
- `pacificDay()`: the day rolls over at 3 a.m. Pacific time. Change `America/Los_Angeles` to your time zone.

Anything new you type while logging is remembered, so the seeds only need to be a starting point.

## 3. Run it locally

Create a file named `.dev.vars` in the project folder (it is git-ignored):

```
WORKOUT_PASSCODE=local-test-passcode
SESSION_SECRET=any-random-string-at-least-32-characters-long
INGEST_SECRET=another-random-string-24-plus
```

Then create the local database and start the app:

```bash
npx wrangler d1 migrations apply workout-log --local
npm run dev
```

Open http://localhost:8787 and log in with your local passcode.

## 4. Put it online

1. Log in to Cloudflare from the terminal:
   ```bash
   npx wrangler login
   ```
2. Create the database:
   ```bash
   npx wrangler d1 create workout-log
   ```
   Copy the `database_id` it prints into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
3. Create the tables:
   ```bash
   npx wrangler d1 migrations apply workout-log --remote
   ```
4. Set the three secrets. Each command asks you to paste a value:
   ```bash
   npx wrangler secret put WORKOUT_PASSCODE
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put INGEST_SECRET
   ```
   The passcode must be at least 12 characters. `SESSION_SECRET` must be 32 or more random characters, and `INGEST_SECRET` 24 or more. To generate a random value:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
5. Deploy:
   ```bash
   npm run deploy
   ```
   It prints your URL, something like `https://workout-log.<your-subdomain>.workers.dev`.

If a secret is missing, the app refuses every request with a 503 error instead of running unlocked.

## 5. Add it to your phone

On iPhone, open the URL in Safari, tap **Share**, then **Add to Home Screen**. Log in once. The login lasts a year on that device.

## Optional: send workouts from a Shortcut

`POST /api/ingest` accepts JSON with the header `X-Ingest-Secret: <your INGEST_SECRET>`.

**From a workout summary** (for example, an iOS Shortcut that reads a Watch workout):

```json
{ "workoutType": "Surfing", "start": "2026-10-12 07:10", "duration": "1:05:00", "energy": "420 kcal", "avgHeartRate": 128 }
```

If you already logged that kind of session that day in the app, the numbers are attached to it instead of creating a duplicate.

**From a voice memo or other app:**

```json
{ "source": "voice", "memo": { "category": "Surfing", "date": "2026-10-12T15:10:00Z", "transcript": "..." } }
```

Entries that arrive this way are marked *add details* until you fill them in.

## Changing things later

- **Suggestions:** tune the weights in `LOAD` and the scores in `suggestNext()` in `public/model.js`. `npm test` covers the main cases.
- **Database changes:** add a new file in `migrations/`, then run `npx wrangler d1 migrations apply workout-log --remote`.
- **Redeploy:** `npm run deploy`.
- **Change the passcode:** run `npx wrangler secret put WORKOUT_PASSCODE` again.

## License

MIT. See `LICENSE`.
