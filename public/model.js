// Pure data logic for the workout app: what a session looks like, how to
// clean one coming from the page, the Watch Shortcut or a voice memo, and
// what the catalog (dropdown contents) is built from. No I/O here, so the
// Worker, the import script and the tests all share it.

export const TYPES = ["lifting", "surfing", "climbing", "tennis", "flag-football", "basketball", "other"];
export const LIFT_DAYS = ["Push", "Pull", "Legs", "Other"];
export const CONDITIONS = ["clean", "glassy", "peaky", "mushy", "closeouts", "onshore", "offshore", "choppy", "fog"];
export const GRADES = ["VB", "V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"];
export const TAPE_COLORS = ["pink", "red", "orange", "yellow", "green", "blue", "purple", "black", "white"];

// Seeds so the dropdowns are useful before history fills them. Edit these to
// your own lifts, surf spots and activities; anything you log is added automatically.
export const SEED_EXERCISES = {
  Push: ["Dumbbell Bench Press", "Incline Dumbbell Bench Press", "Seated Bench Press", "Overhead Press", "Cable Fly",
    "Dumbbell Fly", "Lateral Raise", "Tricep Pushdown", "Abdominal Crunch", "Abdominal Twist"],
  Pull: ["Lat Pulldown", "Seated Row", "Dumbbell Row", "Face Pull", "Rope Curl", "Seated Curl"],
  Legs: ["Leg Press", "Bulgarian Split Squat", "Seated Leg Curl", "Calf Raise", "Hip Abduction", "Goblet Squat",
    "Kettlebell Swing"],
  Other: [],
};
export const SEED_SPOTS = ["Home break"];
export const SEED_ACTIVITIES = ["Yoga", "Running", "Kettlebell Circuit", "Kitesurfing", "Swimming", "Golf"];

// ---------- small cleaners ----------

const str = (v, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function num(v, min, max, step) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(max, Math.max(min, n));
  if (!step) return clamped;
  // toFixed strips float noise (5.4 / 0.1 * 0.1 = 5.4000000000000004).
  return Number((Math.round(clamped / step) * step).toFixed(2));
}
const strList = (v, maxItems = 20, max = 60) =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean))].slice(0, maxItems);
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T12:00:00Z"));

// The training day, Pacific time, running to 3 a.m. (after midnight still
// counts as the day before). Change the time zone below if you're elsewhere.
export const DAY_CUTOFF_HOURS = 3;
export function pacificDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" })
    .format(new Date(d.getTime() - DAY_CUTOFF_HOURS * 3600e3));
}

// Leading number out of strings like "45 min", "320 kcal", "3.1 mi".
export function leadingNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// ---------- sessions ----------

// Cleans a session coming from anywhere. Unknown fields are dropped and
// numbers are clamped, so the stored JSON stays predictable. Throws on the
// two things a session can't exist without: a valid day and a known type.
export function cleanSession(input) {
  if (!input || typeof input !== "object") throw new Error("bad session");
  if (!isDay(input.date)) throw new Error("bad date");
  if (!TYPES.includes(input.type)) throw new Error("bad type");
  const s = {
    date: input.date,
    type: input.type,
    effort: num(input.effort, 0, 10, 0.5),
    durationMin: num(input.durationMin, 0, 24 * 60, 1),
    partners: strList(input.partners),
    notes: str(input.notes, 4000),
    needsDetails: input.needsDetails === true,
    watch: cleanWatch(input.watch),
    voice: cleanVoice(input.voice),
  };
  Object.assign(s, TYPE_CLEANERS[s.type](input));
  return s;
}

const TYPE_CLEANERS = {
  lifting: (i) => ({
    day: LIFT_DAYS.includes(i.day) ? i.day : "Other",
    exercises: (Array.isArray(i.exercises) ? i.exercises : []).slice(0, 30).map((e) => ({
      name: str(e && e.name, 80),
      sets: (Array.isArray(e && e.sets) ? e.sets : []).slice(0, 30).map((x) => ({
        reps: num(x && x.reps, 0, 1000, 1),
        weight: num(x && x.weight, 0, 2000, 0.5),
        unit: x && x.unit === "kg" ? "kg" : "lb",
        perSide: !!(x && x.perSide),
        drop: !!(x && x.drop),
        secs: num(x && x.secs, 0, 3600, 1),
      })),
    })).filter((e) => e.name),
  }),
  surfing: (i) => ({
    spot: str(i.spot, 60),
    board: str(i.board, 60),
    waveFt: num(i.waveFt, 0, 40, 0.5),
    waves: num(i.waves, 0, 200, 1),
    conditions: strList(i.conditions, 10, 20).filter((c) => CONDITIONS.includes(c)),
    quality: num(i.quality, 0, 10, 0.1),
    experience: num(i.experience, 0, 10, 0.1),
  }),
  climbing: (i) => ({
    sends: (Array.isArray(i.sends) ? i.sends : []).slice(0, 60).map((x) => ({
      grade: GRADES.includes(x && x.grade) ? x.grade : "",
      color: TAPE_COLORS.includes(x && x.color) ? x.color : "",
      name: str(x && x.name, 60),
    })).filter((x) => x.grade || x.color || x.name),
    projectsWorked: strList(i.projectsWorked, 30, 40),
    projectsSent: strList(i.projectsSent, 30, 40),
  }),
  tennis: (i) => ({
    matches: (Array.isArray(i.matches) ? i.matches : []).slice(0, 20).map((m) => ({
      opponent: str(m && m.opponent, 60),
      format: m && m.format === "doubles" ? "doubles" : "singles",
      me: num(m && m.me, 0, 99, 1),
      them: num(m && m.them, 0, 99, 1),
    })),
  }),
  "flag-football": (i) => game(i),
  basketball: (i) => game(i),
  other: (i) => ({
    activity: str(i.activity, 40) || "Other",
    distance: num(i.distance, 0, 1000, 0.01),
    distanceUnit: i.distanceUnit === "km" ? "km" : "mi",
    rounds: num(i.rounds, 0, 100, 1),
  }),
};

function game(i) {
  return {
    us: num(i.us, 0, 500, 1),
    them: num(i.them, 0, 500, 1),
    position: str(i.position, 40),
    highlights: str(i.highlights, 1000),
  };
}

function cleanWatch(w) {
  if (!w || typeof w !== "object") return null;
  const out = {
    activity: str(w.activity, 60),
    start: str(w.start, 40),
    end: str(w.end, 40),
    durationMin: num(leadingNumber(w.durationMin), 0, 24 * 60, 1),
    kcal: num(leadingNumber(w.kcal), 0, 20000, 1),
    avgHr: num(leadingNumber(w.avgHr), 0, 250, 1),
    maxHr: num(leadingNumber(w.maxHr), 0, 250, 1),
    distance: num(leadingNumber(w.distance), 0, 1000, 0.01),
    distanceUnit: str(w.distanceUnit, 8),
  };
  return Object.values(out).some((v) => v !== null && v !== "") ? out : null;
}

function cleanVoice(v) {
  if (!v || typeof v !== "object") return null;
  const out = {
    headline: str(v.headline, 200),
    summary: str(v.summary, 2000),
    transcript: str(v.transcript, 50000),
    audioKey: str(v.audioKey, 200),
  };
  return out.transcript || out.summary ? out : null;
}

// ---------- Apple Watch (Shortcut) ----------

// Health's workout type names -> our types. Anything unknown becomes
// "other" with the Health name kept as the activity.
const WATCH_TYPE_MAP = [
  [/strength|weight|functional|core training|hiit|high intensity|cross ?training/i, "lifting"],
  [/kite/i, "other"],
  [/surf/i, "surfing"],
  [/climb/i, "climbing"],
  [/tennis/i, "tennis"],
  [/american football|flag/i, "flag-football"],
  [/basketball/i, "basketball"],
];

export function watchToSession(body, today = pacificDay()) {
  const activity = str(body.workoutType || body.activity || body.type, 60);
  const type = (WATCH_TYPE_MAP.find(([re]) => re.test(activity)) || [null, "other"])[1];
  const startDate = new Date(str(body.start, 40).replace(/\s+at\s+/i, " "));
  const date = isNaN(startDate) ? today : pacificDay(startDate);
  let durationMin = leadingNumber(body.duration);
  // Shortcuts sometimes hands duration in seconds or as "1:05:00".
  if (typeof body.duration === "string" && /^\d+:\d{2}(:\d{2})?$/.test(body.duration.trim())) {
    const p = body.duration.trim().split(":").map(Number);
    durationMin = p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p[0] + p[1] / 60;
  } else if (durationMin !== null && /sec|^\d{4,}$/i.test(String(body.duration))) {
    durationMin = durationMin / 60;
  }
  const watch = {
    activity,
    start: str(body.start, 40),
    end: str(body.end, 40),
    durationMin,
    kcal: body.energy ?? body.kcal,
    avgHr: body.avgHeartRate ?? body.avgHr,
    maxHr: body.maxHeartRate ?? body.maxHr,
    distance: body.distance,
    distanceUnit: /km/i.test(String(body.distance)) ? "km" : /mi/i.test(String(body.distance)) ? "mi" : "",
  };
  const base = { date, type, needsDetails: true, watch, durationMin };
  if (type === "other") base.activity = activity || "Other";
  return cleanSession(base);
}

// ---------- exercise names ----------

// Voice memos name the same lift several ways ("Dumbbell Flies", "Tricep
// Push Downs"). Match them to the seed name so history and "best" don't
// split across spellings. Unknown names pass through unchanged.
const ALIASES = { "curls rope machine": "Rope Curl", "rope curls": "Rope Curl", "single leg press": "Leg Press" };
const normName = (n) => n.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim()
  .split(" ").map((w) => w.replace(/ies$/, "y").replace(/s$/, "").replace(/e$/, "")).join("");
const SEED_BY_NORM = new Map(Object.values(SEED_EXERCISES).flat().map((n) => [normName(n), n]));

export function canonicalExercise(name) {
  const clean = str(name, 80);
  if (!clean) return "";
  const alias = ALIASES[clean.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim()];
  return alias || SEED_BY_NORM.get(normName(clean)) || clean;
}

// ---------- voice memos (import + voice backup) ----------

const VOICE_TYPE_MAP = [
  [/^lifting/i, "lifting"], [/kite/i, "other"], [/surf/i, "surfing"], [/climb/i, "climbing"], [/tennis/i, "tennis"],
  [/flag football/i, "flag-football"], [/basketball/i, "basketball"],
];

// Maps a voice memo record (the Worker's JSON shape) to a session. Keeps
// headline/summary/transcript so nothing said is lost; structured fields
// are filled only where the memo states them.
export function memoToSession(memo) {
  const category = str(memo.category, 60);
  const type = (VOICE_TYPE_MAP.find(([re]) => re.test(category)) || [null, "other"])[1];
  const date = isDay(memo.recordedOn) ? memo.recordedOn : pacificDay(new Date(memo.date));
  const ratings = Array.isArray(memo.ratings) ? memo.ratings : [];
  const rating = (re) => (ratings.find((r) => re.test(r.label || "")) || {}).score;
  const s = {
    date,
    type,
    effort: rating(/effort|strenuous|intens/i) ?? null,
    voice: { headline: memo.headline, summary: memo.summary, transcript: memo.transcript, audioKey: memo.audioKey },
    needsDetails: true,
  };
  if (type === "lifting") {
    const day = (category.match(/\((Push|Pull|Legs)\)/) || [])[1];
    s.day = day || "Other";
    s.exercises = (memo.exercises || []).map((e) => ({
      name: canonicalExercise(e.name),
      sets: (e.sets || []).map((x) => ({ reps: x.reps, weight: x.weight, unit: x.unit || "lb" })),
    }));
  }
  if (type === "surfing") {
    s.quality = rating(/quality/i) ?? null;
    s.experience = rating(/experience/i) ?? null;
  }
  if (type === "basketball" || type === "flag-football") {
    // e.g. "Skill Rating 3" has no field of its own; keep it in notes.
    const other = ratings.filter((r) => !/effort|strenuous|intens/i.test(r.label || ""));
    if (other.length) s.notes = other.map((r) => `${r.label}: ${r.score}`).join(", ");
  }
  if (type === "other") s.activity = category || "Other";
  return cleanSession(s);
}

// ---------- catalog ----------

// Builds every dropdown from history (most recent first) merged with seeds,
// plus "last time" and "best" per exercise for prefill. sessions must be
// newest first.
export function buildCatalog(sessions) {
  const exercises = {};
  for (const day of LIFT_DAYS) exercises[day] = [];
  const lifts = {};
  const spots = [], boards = [], partners = [], opponents = [], activities = [];
  const push = (list, v) => v && !list.includes(v) && list.push(v);
  const lastByDay = {};

  for (const s of sessions) {
    s.partners.forEach((p) => push(partners, p));
    if (s.type === "lifting") {
      if (!lastByDay[s.day]) lastByDay[s.day] = { date: s.date, exercises: s.exercises };
      for (const e of s.exercises) {
        push(exercises[s.day] || exercises.Other, e.name);
        const rec = lifts[e.name] || (lifts[e.name] = { last: null, best: null });
        if (!rec.last && e.sets.length) rec.last = { date: s.date, sets: e.sets };
        for (const x of e.sets) {
          if (x.weight !== null && (!rec.best || x.weight > rec.best.weight)) rec.best = { weight: x.weight, unit: x.unit, reps: x.reps, date: s.date };
        }
      }
    }
    if (s.type === "surfing") { push(spots, s.spot); push(boards, s.board); }
    if (s.type === "tennis") s.matches.forEach((m) => push(opponents, m.opponent));
    if (s.type === "other") push(activities, s.activity);
  }
  for (const day of LIFT_DAYS) SEED_EXERCISES[day].forEach((n) => push(exercises[day], n));
  SEED_SPOTS.forEach((v) => push(spots, v));
  SEED_ACTIVITIES.forEach((v) => push(activities, v));
  return { exercises, lifts, lastByDay, spots, boards, partners, opponents, activities };
}

// One-line description of a session, for the History list. Empty when
// nothing structured was logged (the page falls back to the memo headline).
export function describe(s) {
  switch (s.type) {
    case "lifting": {
      const sets = s.exercises.reduce((n, e) => n + e.sets.length, 0);
      return `${s.day} · ${s.exercises.length} lifts · ${sets} sets`;
    }
    case "surfing":
      return [s.spot, s.waves !== null ? `${s.waves} waves` : "", s.quality !== null ? `${s.quality}/10` : ""].filter(Boolean).join(" · ");
    case "climbing": {
      const g = {};
      s.sends.forEach((x) => (g[x.grade || "?"] = (g[x.grade || "?"] || 0) + 1));
      const sent = s.projectsSent.length ? `${s.projectsSent.length} project${s.projectsSent.length > 1 ? "s" : ""} sent` : "";
      return [Object.entries(g).map(([k, n]) => `${k}×${n}`).join(" "), sent].filter(Boolean).join(" · ");
    }
    case "tennis":
      return s.matches.filter((m) => m.me !== null || m.opponent).map((m) => `${m.me ?? "?"}–${m.them ?? "?"} ${m.opponent || ""}`.trim()).join(", ");
    case "flag-football":
    case "basketball":
      return s.us !== null && s.them !== null ? `${s.us}–${s.them}` : s.position;
    default:
      return s.activity;
  }
}

// ---------- what to do next ----------
//
// Rules, not AI: every option gets a score from the last 3 weeks and the
// best two are suggested, each with the reason that won it.
//   - Fatigue: each session loads muscle groups (LOAD below), scaled by its
//     effort (6/10 = normal) and fading by half each day after.
//   - Lifting follows a Push -> Pull -> Legs order, but a tired group
//     is skipped for a fresher one.
//   - Days since each activity push it up the list; weekly habits (same
//     weekday in 2 of the last 3 weeks) are treated as already planned.
//   - Built for training twice a day, so streaks alone don't mean rest: a recovery
//     day needs 6 straight active days or all three groups tired.

const GROUPS = ["push", "pull", "legs"];
const LOAD = {
  "lifting:Push": { push: 1 },
  "lifting:Pull": { pull: 1 },
  "lifting:Legs": { legs: 1 },
  "lifting:Other": { push: 0.4, pull: 0.4, legs: 0.4 },
  surfing: { pull: 0.4, push: 0.2 },
  climbing: { pull: 0.9 },
  tennis: { legs: 0.4, push: 0.2 },
  "flag-football": { legs: 0.6 },
  basketball: { legs: 0.6 },
  "other:Yoga": {},
  "other:Running": { legs: 0.5 },
  other: { legs: 0.2 },
};
const ROTATION = ["Push", "Pull", "Legs"];
const GROUP_OF = { Push: "push", Pull: "pull", Legs: "legs" };
const GAMES = ["flag-football", "basketball", "tennis"];

const addDays = (day, n) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400e3);
// The specific thing done: "lifting:Pull", "surfing", "other:Yoga".
const kindOf = (s) => (s.type === "lifting" ? `lifting:${s.day}` : s.type === "other" ? `other:${s.activity}` : s.type);
const loadOf = (s) => LOAD[kindOf(s)] || LOAD[s.type] || {};

const KIND_LABEL = {
  "lifting:Push": "Push day", "lifting:Pull": "Pull day", "lifting:Legs": "Legs day", "lifting:Other": "Lift",
  surfing: "Surf", climbing: "Climb", tennis: "Tennis", "flag-football": "Flag football", basketball: "Basketball",
};
const labelOf = (kind) => KIND_LABEL[kind] || kind.replace(/^other:/, "");
const NEVER = 99; // not seen in the 3-week window
const ago = (n) => (n === 1 ? "yesterday" : n >= NEVER ? "3+ weeks ago" : `${n} days ago`);
const weekday = (day) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(day + "T12:00:00Z"));

// sessions: any order. Returns null with no recent history, else
// { date, when: "Today" | "Tomorrow", picks: [{ type, day?, activity?, label, reason }], avoid, note }.
// "Today" until something is logged today, then "Tomorrow".
export function suggestNext(sessions, projects = [], today = pacificDay()) {
  const loggedToday = sessions.some((s) => s.date === today);
  const target = loggedToday ? addDays(today, 1) : today;
  const recent = sessions
    .filter((s) => s.date < target && daysBetween(s.date, target) <= 21)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!recent.length) return null;

  // Fatigue per group on the target day, and what caused it.
  const fatigue = { push: 0, pull: 0, legs: 0 };
  const why = { push: [], pull: [], legs: [] };
  for (const s of recent) {
    const n = daysBetween(s.date, target);
    if (n > 3) continue;
    const scale = Math.min(1.6, Math.max(0.5, (s.effort ?? 6) / 6)) * Math.pow(0.5, n - 1);
    for (const [g, v] of Object.entries(loadOf(s))) {
      fatigue[g] += v * scale;
      const what = `${labelOf(kindOf(s)).toLowerCase()} ${ago(n)}`;
      if (v * scale >= 0.35 && !why[g].includes(what)) why[g].push(what);
    }
  }

  const since = {};
  for (const s of recent) {
    const k = kindOf(s), n = daysBetween(s.date, target);
    if (since[k] === undefined || n < since[k]) since[k] = n;
  }
  const lastLift = recent.find((s) => s.type === "lifting" && ROTATION.includes(s.day));
  const nextInRotation = lastLift ? ROTATION[(ROTATION.indexOf(lastLift.day) + 1) % 3] : "Push";

  // Weekly habits: same weekday as the target in 2 of the last 3 weeks.
  const habits = [...new Set(recent.map(kindOf))].filter((k) =>
    [7, 14, 21].filter((w) => recent.some((s) => kindOf(s) === k && s.date === addDays(target, -w))).length >= 2);

  const active = new Set(recent.map((s) => s.date));
  let streak = 0;
  while (active.has(addDays(target, -(streak + 1)))) streak++;
  const allTired = GROUPS.every((g) => fatigue[g] >= 0.8);

  const result = { date: target, when: loggedToday ? "Tomorrow" : "Today", picks: [], avoid: null, note: null };

  if (streak >= 6 || allTired) {
    result.picks.push({ type: "other", activity: "Yoga", label: "Recovery day",
      reason: streak >= 6 ? `${streak} days straight. Yoga, a walk or an easy surf, then go again.` : "Push, pull and legs are all worked. Yoga or an easy surf." });
  }

  // Score every option.
  const options = [];
  for (const day of ROTATION) {
    const g = GROUP_OF[day];
    const d = since[`lifting:${day}`] ?? NEVER;
    let score = 1 + Math.min(d, 14) / 3 - fatigue[g] * 2.2 + (day === nextInRotation ? 1 : 0);
    if (g === "legs" && habits.some((k) => GAMES.includes(k))) score -= 1; // a game is planned
    const reason = day === nextInRotation && lastLift && fatigue[g] < 0.5
      ? `Next in your split (last lift: ${lastLift.day}, ${ago(daysBetween(lastLift.date, target))}).`
      : d >= 7 ? (d >= NEVER ? `No ${day} day in the last 3 weeks.` : `${day} hasn't been trained in ${d} days.`)
      : `${day} muscles are fresh.`;
    options.push({ type: "lifting", day, label: labelOf(`lifting:${day}`), score, reason, family: "lift" });
  }
  const dSurf = since.surfing ?? NEVER;
  options.push({ type: "surfing", label: "Surf", family: "water",
    score: 0.9 + Math.min(dSurf, 5) * 0.45 - fatigue.pull * 0.6,
    reason: dSurf >= 2 ? `Last surf ${ago(dSurf)}.` : "Easy on the body. Go if it's breaking." });
  const dClimb = since.climbing ?? NEVER;
  const open = projects.filter((p) => p.status === "open");
  options.push({ type: "climbing", label: "Climb", family: "climb",
    score: 0.4 + Math.min(dClimb, 10) / 4 + (open.length ? 0.4 : 0) - fatigue.pull * 1.8,
    reason: open.length
      ? `Work the ${open[0].name || open[0].color + " one"}${open[0].grade ? ` (${open[0].grade})` : ""}.`
      : `Last climb ${ago(dClimb)}.` });
  for (const k of habits) {
    const reason = `You usually do this on ${weekday(target)}s.`;
    const existing = options.find((o) => kindOf(o) === k);
    if (existing) Object.assign(existing, { score: existing.score + 2.5, reason });
    else {
      const [type, activity] = k.split(":");
      options.push({ type, activity, label: labelOf(k), score: 3, reason, family: "habit" });
    }
  }

  options.sort((a, b) => b.score - a.score);
  if (!result.picks.length) {
    result.picks.push(options[0]);
    const second = options.find((o) => o !== options[0] && o.family !== options[0].family && o.score > 0.6);
    if (second) result.picks.push(second);
  }

  // Warn off the most fatigued lift day.
  const worst = GROUPS.reduce((a, b) => (fatigue[b] > fatigue[a] ? b : a));
  const worstDay = ROTATION.find((d) => GROUP_OF[d] === worst);
  if (fatigue[worst] >= 0.8 && why[worst].length && !result.picks.some((p) => p.day === worstDay)) {
    result.avoid = `Skip ${worstDay}: ${why[worst].join(", ")}.`;
  }
  const neglected = ROTATION.filter((d) => (since[`lifting:${d}`] ?? NEVER) >= 10 && !result.picks.some((p) => p.day === d) && !(result.avoid && d === worstDay));
  if (neglected.length) result.note = `${neglected.join(" and ")} not trained in 10+ days.`;

  result.picks = result.picks.map(({ score, family, ...p }) => p);
  return result;
}
