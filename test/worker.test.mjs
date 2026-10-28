// Drives the real Worker against Node's built-in SQLite (same SQL as D1),
// through a tiny adapter with D1's prepare/bind/first/all/run/batch shape.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())), _db: db };
}

const env = {
  DB: fakeD1(),
  WORKOUT_PASSCODE: "test-passcode-123",
  SESSION_SECRET: "x".repeat(40),
  INGEST_SECRET: "ingest-secret-abcdefghijklmnop",
  ASSETS: { fetch: async () => new Response("asset") },
};
const B = "https://workout.test";
let cookie = "";
async function call(method, path, body, headers = {}) {
  const res = await worker.fetch(new Request(B + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie, "CF-Connecting-IP": "9.9.9.9", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }), env);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

// Fail closed with no secrets.
assert.strictEqual((await worker.fetch(new Request(B + "/api/state"), { ...env, WORKOUT_PASSCODE: "" })).status, 503);
// Static files skip the API entirely.
assert.strictEqual(await (await worker.fetch(new Request(B + "/"), env)).text(), "asset");

// Signed out.
assert.strictEqual((await call("GET", "/api/state")).status, 401);
assert.strictEqual((await call("POST", "/api/login", { passcode: "nope" })).status, 401);
const ok = await call("POST", "/api/login", { passcode: env.WORKOUT_PASSCODE });
assert.strictEqual(ok.status, 204);
cookie = ok.headers.get("set-cookie").split(";")[0];

// Log a lift.
const lift = await call("POST", "/api/sessions", {
  date: "2026-10-06", type: "lifting", day: "Pull",
  exercises: [{ name: "Lat Pulldown", sets: [{ reps: 12, weight: 70 }, { reps: 10, weight: 75 }] }],
});
assert.strictEqual(lift.status, 201);
// Bad input is a 400, not a 500.
assert.strictEqual((await call("POST", "/api/sessions", { date: "nope", type: "lifting" })).status, 400);
assert.strictEqual((await call("POST", "/api/sessions", "not json")).status, 400);

// Climbing project lifecycle: create, work it, send it.
const proj = await call("POST", "/api/projects", { name: "Underhang pink", color: "pink", grade: "V4" });
assert.strictEqual(proj.status, 201);
await call("POST", "/api/sessions", { date: "2026-10-07", type: "climbing", sends: [{ grade: "V3" }], projectsWorked: [proj.body.id] });
let state = (await call("GET", "/api/state")).body;
let p = state.projects.find((x) => x.id === proj.body.id);
assert.strictEqual(p.status, "open");
assert.strictEqual(p.lastWorked, "2026-10-07");
await call("POST", "/api/sessions", { date: "2026-10-09", type: "climbing", projectsSent: [proj.body.id] });
state = (await call("GET", "/api/state")).body;
p = state.projects.find((x) => x.id === proj.body.id);
assert.strictEqual(p.status, "sent");
assert.strictEqual(p.sentOn, "2026-10-09");

// State: newest first, catalog has prefill.
assert.deepStrictEqual(state.sessions.map((s) => s.date), ["2026-10-09", "2026-10-07", "2026-10-06"]);
assert.strictEqual(state.catalog.lifts["Lat Pulldown"].best.weight, 75);
assert.strictEqual(state.catalog.lastByDay.Pull.exercises[0].name, "Lat Pulldown");

// Edit + delete.
assert.strictEqual((await call("PUT", `/api/sessions/${lift.body.id}`, { date: "2026-10-06", type: "lifting", day: "Pull", effort: 8, exercises: [] })).status, 204);
state = (await call("GET", "/api/state")).body;
assert.strictEqual(state.sessions.find((s) => s.id === lift.body.id).effort, 8);
assert.strictEqual((await call("PUT", "/api/sessions/doesnotexist1", { date: "2026-10-06", type: "lifting" })).status, 404);

// Ingest: wrong secret is 401 and writes nothing; no session cookie needed.
cookie = "";
const before = env.DB._db.prepare("SELECT count(*) AS n FROM sessions").get().n;
assert.strictEqual((await call("POST", "/api/ingest", { workoutType: "Tennis" }, { "X-Ingest-Secret": "wrong" })).status, 401);
assert.strictEqual(env.DB._db.prepare("SELECT count(*) AS n FROM sessions").get().n, before);
const H = { "X-Ingest-Secret": env.INGEST_SECRET };

// Watch workout on a day with a same-type session already logged: attaches.
const att = await call("POST", "/api/ingest", { workoutType: "Climbing", start: "2026-10-09T15:00:00-07:00", duration: "75 min", energy: "500 kcal" }, H);
assert.strictEqual(att.body.attached, true);
// Weird: no heart rate, unknown day: still creates a session that needs details.
const fresh = await call("POST", "/api/ingest", { workoutType: "Surfing Sports", start: "2026-10-10T07:30:00-07:00", duration: "90 min" }, H);
assert.strictEqual(fresh.status, 201);
assert.strictEqual(fresh.body.attached, false);
assert.ok(fresh.body.url.endsWith(`/#session/${fresh.body.id}`));

// Voice backup: a memo record becomes a voice session.
const voice = await call("POST", "/api/ingest", { source: "voice", memo: {
  date: "2026-10-12T18:00:00Z", category: "Surfing", headline: "h", summary: "s", transcript: "t",
  ratings: [{ label: "surf quality", score: 6.5 }] } }, H);
assert.strictEqual(voice.status, 201);

cookie = ok.headers.get("set-cookie").split(";")[0];
state = (await call("GET", "/api/state")).body;
const climbDay = state.sessions.find((s) => s.date === "2026-10-09");
assert.strictEqual(climbDay.watch.kcal, 500);
assert.strictEqual(climbDay.durationMin, 75);
const surfWatch = state.sessions.find((s) => s.id === fresh.body.id);
assert.strictEqual(surfWatch.source, "watch");
assert.strictEqual(surfWatch.needsDetails, true);
assert.strictEqual(surfWatch.watch.avgHr, null);
const v = state.sessions.find((s) => s.id === voice.body.id);
assert.strictEqual(v.source, "voice");
assert.strictEqual(v.quality, 6.5);

// Lockout: 5 wrong tries from one IP, then even the right passcode is refused.
cookie = "";
for (let i = 0; i < 5; i++) await call("POST", "/api/login", { passcode: "bad" }, { "CF-Connecting-IP": "6.6.6.6" });
assert.strictEqual((await call("POST", "/api/login", { passcode: env.WORKOUT_PASSCODE }, { "CF-Connecting-IP": "6.6.6.6" })).status, 429);

console.log("worker.test.mjs: all assertions passed");
