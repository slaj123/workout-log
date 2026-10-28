import assert from "node:assert";
import "./fixed-setup.mjs";
import { cleanSession, watchToSession, memoToSession, buildCatalog, describe, leadingNumber, canonicalExercise, suggestNext } from "../public/model.js";

// --- cleanSession: normal lifting session ---
const lift = cleanSession({
  date: "2026-10-06", type: "lifting", day: "Pull", effort: "7.5", partners: ["Sam", "Sam", " "],
  exercises: [{ name: "Lat Pulldown", sets: [{ reps: 12, weight: 70 }, { reps: "10", weight: "70", drop: 1 }] }],
  junk: "dropped",
});
assert.strictEqual(lift.effort, 7.5);
assert.deepStrictEqual(lift.partners, ["Sam"]);
assert.strictEqual(lift.exercises[0].sets[1].reps, 10);
assert.strictEqual(lift.exercises[0].sets[1].drop, true);
assert.strictEqual(lift.exercises[0].sets[0].unit, "lb");
assert.strictEqual(lift.junk, undefined);

// Weird: a set with no weight (bodyweight / timed kettlebell) stays null, not 0.
const kb = cleanSession({ date: "2026-09-24", type: "lifting", day: "Legs",
  exercises: [{ name: "Kettlebell Swing", sets: [{ reps: null, weight: "", secs: 40 }] }] });
assert.strictEqual(kb.exercises[0].sets[0].weight, null);
assert.strictEqual(kb.exercises[0].sets[0].secs, 40);

// Float noise is stripped; out-of-range clamps.
const surf = cleanSession({ date: "2026-09-25", type: "surfing", quality: 5.4, experience: 12, conditions: ["clean", "nonsense"] });
assert.strictEqual(surf.quality, 5.4);
assert.strictEqual(surf.experience, 10);
assert.deepStrictEqual(surf.conditions, ["clean"]);

// Watch numbers typed in by hand: kept when set, dropped when all empty.
assert.deepStrictEqual(
  [cleanSession({ date: "2026-10-12", type: "surfing", watch: { kcal: "412", avgHr: 121 } }).watch].map((w) => [w.kcal, w.avgHr]),
  [[412, 121]]
);
assert.strictEqual(cleanSession({ date: "2026-10-12", type: "surfing", watch: { kcal: null, avgHr: null } }).watch, null);
assert.strictEqual(cleanSession({ date: "2026-10-12", type: "surfing", watch: { avgHr: 999 } }).watch.avgHr, 250); // clamped

// Required fields.
assert.throws(() => cleanSession({ date: "2026-13-40", type: "lifting" }), /bad date/);
assert.throws(() => cleanSession({ date: "2026-10-01", type: "jousting" }), /bad type/);
assert.throws(() => cleanSession(null), /bad session/);

// --- Watch payloads ---
const w = watchToSession({
  workoutType: "Traditional Strength Training", start: "Oct 6, 2026 at 2:05 PM", end: "Oct 6, 2026 at 3:01 PM",
  duration: "56 min", energy: "412 kcal", avgHeartRate: "121 BPM", maxHeartRate: 164,
});
assert.strictEqual(w.type, "lifting");
assert.strictEqual(w.date, "2026-10-06");
assert.strictEqual(w.needsDetails, true);
assert.strictEqual(w.watch.kcal, 412);
assert.strictEqual(w.watch.avgHr, 121);
assert.strictEqual(w.durationMin, 56);

// Weird: no heart rate, duration as h:mm:ss, unknown activity, no start.
const w2 = watchToSession({ workoutType: "Pickleball", duration: "1:05:00" }, "2026-10-12");
assert.strictEqual(w2.type, "other");
assert.strictEqual(w2.activity, "Pickleball");
assert.strictEqual(w2.date, "2026-10-12");
assert.strictEqual(w2.watch.avgHr, null);
assert.strictEqual(w2.durationMin, 65);
assert.strictEqual(watchToSession({ workoutType: "Surfing Sports", duration: "3600 sec" }, "2026-10-12").durationMin, 60);
assert.strictEqual(watchToSession({ workoutType: "Climbing" }, "2026-10-12").type, "climbing");
assert.strictEqual(leadingNumber("1,204 kcal"), 1204);
assert.strictEqual(leadingNumber("none"), null);

// --- Voice memos ---
const v = memoToSession({
  date: "2026-10-08T06:32:21.346Z", recordedOn: "2026-10-06", category: "Lifting (Pull)", subcategory: "(none yet)",
  headline: "Pull Day", summary: "s", transcript: "t", ratings: [{ label: "Overall Effort", score: 7.5 }],
  exercises: [{ name: "Face Pull", sets: [{ reps: 15, weight: 25, unit: "lb" }] }],
});
assert.strictEqual(v.date, "2026-10-06");
assert.strictEqual(v.day, "Pull");
assert.strictEqual(v.effort, 7.5);
assert.strictEqual(v.exercises[0].sets[0].weight, 25);
assert.strictEqual(v.voice.transcript, "t");
// No recordedOn: falls back to the upload time's Pacific day (06:32Z = previous evening).
assert.strictEqual(memoToSession({ date: "2026-10-08T06:32:56.678Z", category: "Flag Football", transcript: "x" }).date, "2026-10-07");
assert.strictEqual(memoToSession({ date: "2026-10-08T06:32:56.678Z", category: "Kitesurfing", transcript: "x" }).activity, "Kitesurfing");

// --- Lift names from voice match the seed spelling ---
assert.strictEqual(canonicalExercise("Dumbbell Flies"), "Dumbbell Fly");
assert.strictEqual(canonicalExercise("Lateral Raises"), "Lateral Raise");
assert.strictEqual(canonicalExercise("Tricep Push Downs"), "Tricep Pushdown");
assert.strictEqual(canonicalExercise("Curls (Rope Machine)"), "Rope Curl");
assert.strictEqual(canonicalExercise("Overhead Press"), "Overhead Press");
assert.strictEqual(canonicalExercise("Kettlebell Rows"), "Kettlebell Rows"); // unknown: unchanged

// --- Catalog + describe ---
const cat = buildCatalog([lift, kb, surf]);
assert.strictEqual(cat.exercises.Pull[0], "Lat Pulldown"); // history first
assert.ok(cat.exercises.Pull.includes("Face Pull")); // seeds after
assert.strictEqual(cat.lifts["Lat Pulldown"].best.weight, 70);
assert.strictEqual(cat.lifts["Kettlebell Swing"].best, null); // no weights logged
assert.strictEqual(cat.lastByDay.Pull.date, "2026-10-06");
assert.strictEqual(describe(lift), "Pull · 1 lifts · 2 sets");
assert.strictEqual(describe(cleanSession({ date: "2026-09-26", type: "tennis", matches: [{ opponent: "Ronan", me: 3, them: 2 }] })), "3–2 Ronan");

// --- Suggestions ---
const S = (date, type, extra = {}) => cleanSession({ date, type, ...extra });
const T = "2026-10-14"; // a Wednesday
assert.strictEqual(suggestNext([], [], T), null);
// Nothing logged today: suggests for today. Something logged: tomorrow.
assert.strictEqual(suggestNext([S("2026-10-13", "surfing")], [], T).when, "Today");
const tmr = suggestNext([S(T, "surfing")], [], T);
assert.strictEqual(tmr.when, "Tomorrow");
assert.strictEqual(tmr.date, "2026-10-15");
// Hard Push yesterday: suggests the next day in the split, warns off Push.
let r = suggestNext([S("2026-10-13", "lifting", { day: "Push", effort: 8 }), S("2026-10-11", "lifting", { day: "Legs" })], [], T);
assert.strictEqual(r.picks[0].day, "Pull");
assert.match(r.avoid, /^Skip Push: push day yesterday/);
// Climbed yesterday: Pull is off the table even if it's next.
r = suggestNext([S("2026-10-13", "climbing", { effort: 7 }), S("2026-10-12", "lifting", { day: "Push" })], [], T);
assert.notStrictEqual(r.picks[0].day, "Pull");
assert.match(r.avoid, /Skip Pull: climb yesterday/);
// Weekly habit: flag football the last two Wednesdays is suggested again.
r = suggestNext([S("2026-10-07", "flag-football"), S("2026-09-30", "flag-football"), S("2026-10-13", "lifting", { day: "Pull" })], [], T);
assert.ok(r.picks.some((p) => p.type === "flag-football" && /Wednesdays/.test(p.reason)));
// Six days straight: recovery first.
r = suggestNext([8, 9, 10, 11, 12, 13].map((d) => S(`2026-10-${String(d).padStart(2, "0")}`, "surfing")), [], T);
assert.strictEqual(r.picks[0].label, "Recovery day");
// Open climbing project shows up in the climb reason.
r = suggestNext([S("2026-09-30", "lifting", { day: "Push" })], [{ status: "open", name: "Pink underhang", grade: "V4" }], T);
const climb = suggestNext([S("2026-10-12", "lifting", { day: "Legs" }), S("2026-10-13", "lifting", { day: "Push" })], [{ status: "open", name: "Pink underhang", grade: "V4" }], T);
assert.ok([...r.picks, ...climb.picks].some((p) => p.type === "climbing" && /Pink underhang \(V4\)/.test(p.reason)));

console.log("model.test.mjs: all assertions passed");
