// Workout Log front end. One page, three tabs (Log, History, Lifts), hash
// routes, no framework. State comes from GET /api/state in one call; the
// form edits a plain session object ("draft") shaped like public/model.js
// expects, and Save sends it whole. A new, unsaved entry is kept in
// localStorage so a dropped connection mid-gym loses nothing.
import { TYPES, LIFT_DAYS, CONDITIONS, GRADES, TAPE_COLORS, describe, pacificDay, suggestNext } from "/model.js";

const TYPE_INFO = {
  lifting: { label: "Lift", mark: "LF" },
  surfing: { label: "Surf", mark: "SF" },
  climbing: { label: "Climb", mark: "CL" },
  tennis: { label: "Tennis", mark: "TN" },
  "flag-football": { label: "Flag", mark: "FF" },
  basketball: { label: "Hoops", mark: "BB" },
  other: { label: "Other", mark: "··" },
};
const TAPE_HEX = { pink: "#F28DB2", red: "#D8423A", orange: "#EE8A3A", yellow: "#F2CF3B", green: "#4FA36B",
  blue: "#3D7DD8", purple: "#8A5CC7", black: "#232323", white: "#FFFFFF" };
const DRAFT_KEY = "workout-draft-v1";
const PLATES = [45, 35, 25, 10, 5, 2.5];

let state = null; // { sessions, projects, catalog }
let draft = null; // the session being edited
let editingId = null; // null = new entry
let ui = { active: null, plates: false, adding: null };

// ---------- tiny DOM helper ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") value = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  if (value !== undefined) el.value = value;
  return el;
}

const $app = () => document.getElementById("app");
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 1800);
}

function fmtDay(day, opts = { weekday: "short", month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(day + "T12:00:00Z"));
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmtNum = (n) => (n === null || n === undefined ? "" : String(n));

// ---------- API ----------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401 && path !== "/api/login") {
    showLogin();
    throw new Error("signed out");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error((data && (data.message || data.error)) || "error"), { status: res.status });
  return data;
}

async function load() {
  state = await api("GET", "/api/state");
}

// ---------- drafts ----------

function typeDefaults(type) {
  const c = state.catalog;
  switch (type) {
    case "lifting": return { day: "Push", exercises: [] };
    case "surfing": return { spot: c.spots[0] || "", board: c.boards[0] || "", waveFt: null, waves: null, conditions: [], quality: null, experience: null };
    case "climbing": return { sends: [], projectsWorked: [], projectsSent: [] };
    case "tennis": return { matches: [{ opponent: "", format: "singles", me: null, them: null }] };
    case "flag-football":
    case "basketball": return { us: null, them: null, position: "", highlights: "" };
    default: return { activity: c.activities[0] || "Yoga", distance: null, distanceUnit: "mi", rounds: null };
  }
}

function newDraft(type = "lifting", keep = {}) {
  return {
    date: keep.date || pacificDay(), type, effort: keep.effort ?? null, durationMin: keep.durationMin ?? null,
    partners: keep.partners || [], notes: keep.notes || "", watch: null, voice: null, needsDetails: false,
    ...typeDefaults(type),
  };
}

function saveDraft() {
  if (editingId) return;
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return d && TYPES.includes(d.type) ? d : null;
  } catch { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

// Mutate the draft and persist; structural changes also re-render.
function change(fn, rerender = true) {
  fn(draft);
  saveDraft();
  if (rerender) render();
}

// ---------- lift history (client side, so editing excludes itself) ----------

function liftHistory(name) {
  const out = [];
  for (const s of state.sessions) {
    if (s.type !== "lifting" || s.id === editingId) continue;
    const e = s.exercises.find((x) => x.name === name);
    if (e && e.sets.length) out.push({ date: s.date, sets: e.sets });
  }
  return out; // newest first
}
function bestOf(history) {
  let best = null;
  for (const h of history) for (const x of h.sets) if (x.weight !== null && (!best || x.weight > best.weight)) best = { ...x, date: h.date };
  return best;
}

// ---------- reusable controls ----------

function stepper(get, set, { step = 1, min = 0, max = 9999, placeholder = "0", label }) {
  const input = h("input", {
    type: "text", inputmode: step % 1 ? "decimal" : "numeric", value: fmtNum(get()), placeholder,
    "aria-label": label,
    onInput: (e) => { const v = e.target.value.trim(); set(v === "" || isNaN(Number(v)) ? null : Number(v)); saveDraft(); },
    onChange: () => render(),
    onFocus: (e) => e.target.select(),
  });
  const bump = (dir) => {
    const cur = get() ?? (Number(placeholder) || 0);
    const next = Math.min(max, Math.max(min, Math.round((cur + dir * step) / step) * step));
    set(Number(next.toFixed(2)));
    saveDraft();
    render();
  };
  return h("div", { class: "stepper" },
    h("button", { type: "button", "aria-label": `${label} down`, onClick: () => bump(-1) }, "−"),
    input,
    h("button", { type: "button", "aria-label": `${label} up`, onClick: () => bump(1) }, "+"));
}

function field(label, control) {
  return h("label", { class: "field" }, h("span", {}, label), control);
}

function slider(label, get, set, { max = 10, step = 0.1 } = {}) {
  const v = get();
  const out = h("output", { class: v === null ? "unset" : "" }, v === null ? "–" : v.toFixed(step < 1 ? 1 : 0));
  const range = h("input", {
    type: "range", min: 0, max, step, value: v === null ? max / 2 : v, "aria-label": label,
    onInput: (e) => {
      const n = Number(e.target.value);
      set(n);
      out.textContent = n.toFixed(step < 1 ? 1 : 0);
      out.className = "";
      saveDraft();
    },
  });
  return field(label, h("div", { class: "slider" }, range, out));
}

function seg(options, current, onPick, labels = {}) {
  return h("div", { class: "seg", role: "group" },
    options.map((o) => h("button", { type: "button", "aria-pressed": String(o === current), onClick: () => onPick(o) }, labels[o] || o)));
}

// A native <select> (the phone's wheel picker) over known values, with
// "+ New…" swapping in a text box.
function combo(list, value, onPick, { placeholder = "Choose", label, groups } = {}) {
  const key = label + "|" + (value || "");
  if (ui.adding === key) {
    return h("input", {
      type: "text", placeholder: `New ${label.toLowerCase()}`, "aria-label": label, autofocus: true,
      onChange: (e) => { ui.adding = null; const v = e.target.value.trim(); if (v) onPick(v); else render(); },
      onKeydown: (e) => { if (e.key === "Enter") e.target.blur(); },
    });
  }
  const opts = [];
  if (!value) opts.push(h("option", { value: "", disabled: true }, placeholder));
  const seen = new Set();
  const optList = (items) => items.filter((v) => !seen.has(v) && seen.add(v)).map((v) => h("option", { value: v }, v));
  if (value && !list.includes(value) && !(groups || []).some((g) => g.items.includes(value))) opts.push(...optList([value]));
  opts.push(...optList(list));
  for (const g of groups || []) {
    const items = optList(g.items);
    if (items.length) opts.push(h("optgroup", { label: g.label }, items));
  }
  opts.push(h("option", { value: "__new" }, "+ New…"));
  return h("select", {
    "aria-label": label, value: value || "",
    onChange: (e) => {
      if (e.target.value === "__new") { ui.adding = key; render(); setTimeout(() => document.querySelector("input[autofocus]")?.focus(), 0); }
      else onPick(e.target.value);
    },
  }, opts);
}

function partnerChips() {
  const known = [...new Set([...draft.partners, ...state.catalog.partners])].slice(0, 16);
  const toggle = (p) => change((d) => { d.partners = d.partners.includes(p) ? d.partners.filter((x) => x !== p) : [...d.partners, p]; });
  if (ui.adding === "partner") {
    return h("div", { class: "row" }, h("input", {
      type: "text", placeholder: "Name", "aria-label": "New partner", autofocus: true,
      onChange: (e) => { ui.adding = null; const v = e.target.value.trim(); if (v) toggle(v); else render(); },
      onKeydown: (e) => { if (e.key === "Enter") e.target.blur(); },
    }));
  }
  return h("div", { class: "row" },
    known.map((p) => h("button", { type: "button", class: "chip", "aria-pressed": String(draft.partners.includes(p)), onClick: () => toggle(p) }, p)),
    h("button", { type: "button", class: "chip add", onClick: () => { ui.adding = "partner"; render(); setTimeout(() => document.querySelector("input[autofocus]")?.focus(), 0); } }, "+ Add"));
}

// ---------- Log view ----------

function viewLog() {
  const isNew = !editingId;
  const top = h("div", { class: "top" },
    h("h1", {}, isNew ? "Log" : "Edit"),
    h("input", { type: "date", value: draft.date, "aria-label": "Date", max: pacificDay(),
      onChange: (e) => change((d) => { if (e.target.value) d.date = e.target.value; }) }));

  const types = h("div", { class: "row scroll types", role: "tablist" },
    TYPES.map((t) => h("button", {
      type: "button", class: "chip", role: "tab", "aria-pressed": String(draft.type === t),
      onClick: () => {
        if (draft.type === t) return;
        ui.active = null;
        if (isNew) { draft = newDraft(t, draft); saveDraft(); render(); }
        else change((d) => Object.assign(d, typeDefaults(t), { type: t }));
      },
    }, TYPE_INFO[t].label)));

  const body = { lifting: liftForm, surfing: surfForm, climbing: climbForm, tennis: tennisForm,
    "flag-football": gameForm, basketball: gameForm, other: otherForm }[draft.type]();

  const details = [
    h("h2", {}, "Details"),
    h("div", { class: "pair" },
      field("Minutes", stepper(() => draft.durationMin, (v) => (draft.durationMin = v), { step: 5, label: "Minutes", max: 1440 })),
      h("div")),
    // Copied off the Apple Watch summary (Shortcuts can't read workouts).
    h("div", { class: "pair", style: "margin-top:10px" },
      field("Active cal", stepper(() => watchVal("kcal"), (v) => setWatch("kcal", v), { step: 10, label: "Active calories", max: 20000 })),
      field("Avg heart rate", stepper(() => watchVal("avgHr"), (v) => setWatch("avgHr", v), { step: 1, label: "Average heart rate", max: 250 }))),
    h("div", { style: "height:14px" }),
    slider("Effort", () => draft.effort, (v) => (draft.effort = v), { step: 0.5 }),
    h("h2", {}, "With"),
    partnerChips(),
    h("h2", {}, "Notes"),
    h("textarea", { "aria-label": "Notes", placeholder: "Anything worth remembering", value: draft.notes,
      onInput: (e) => { draft.notes = e.target.value; saveDraft(); } }),
  ];

  const save = h("div", { class: "savebar" }, h("div", { class: "in" },
    !isNew && h("button", { type: "button", class: "btn danger", onClick: onDelete }, "Delete"),
    isNew && h("button", { type: "button", class: "btn", onClick: () => { if (confirm("Clear this entry?")) { draft = newDraft(draft.type, { date: draft.date }); saveDraft(); render(); } } }, "Clear"),
    h("button", { type: "button", class: "btn primary", onClick: onSave }, isNew ? "Save" : "Save changes")));

  return [top, isNew && isEmptyDraft(draft) ? nextCard() : null, types, voiceCard(), body, details, save];
}

// "Today" / "Tomorrow" suggestion from recent history (suggestNext in
// model.js). Shown only on a blank new entry, so it never crowds a log in
// progress. Hidden per day with the x.
function nextCard() {
  const next = suggestNext(state.sessions, state.projects, pacificDay());
  if (!next || !next.picks.length) return null;
  const hideKey = "workout-next-hidden";
  try { if (localStorage.getItem(hideKey) === next.date) return null; } catch {}
  const start = (p) => {
    draft = newDraft(p.type, { date: draft.date });
    if (p.day) draft.day = p.day;
    if (p.activity) draft.activity = p.activity;
    saveDraft();
    render();
  };
  return h("div", { class: "card next" },
    h("div", { class: "next-head" },
      h("span", { class: "label" }, `${next.when} · ${fmtDay(next.date)}`),
      h("button", { type: "button", class: "x", "aria-label": "Hide suggestion", onClick: () => {
        try { localStorage.setItem(hideKey, next.date); } catch {}
        render();
      } }, "×")),
    next.picks.map((p, i) => h("div", { class: "pick" },
      h("div", {},
        h("div", { class: i ? "pick-title alt" : "pick-title" }, i ? `or ${p.label}` : p.label),
        h("div", { class: "pick-why" }, p.reason)),
      next.when === "Today" && p.label !== "Recovery day"
        ? h("button", { type: "button", class: "btn small", onClick: () => start(p) }, "Start")
        : null)),
    next.avoid && h("div", { class: "pick-avoid" }, next.avoid),
    next.note && h("div", { class: "pick-why" }, next.note));
}

const watchVal = (k) => (draft.watch ? draft.watch[k] ?? null : null);
function setWatch(k, v) {
  draft.watch = { ...(draft.watch || {}), [k]: v };
}

function voiceCard() {
  const v = draft.voice;
  if (!v) return null;
  return h("div", { class: "card" },
    h("div", { class: "label" }, "From voice memo"),
    v.headline && h("div", { style: "font-weight:600;margin-top:4px" }, v.headline),
    v.summary && h("div", { class: "muted", style: "font-size:15px;margin-top:2px" }, v.summary),
    v.transcript && h("details", {}, h("summary", {}, "Transcript"), h("p", { class: "transcript" }, v.transcript)));
}

// ----- lifting -----

function liftForm() {
  const c = state.catalog;
  const out = [h("h2", {}, "Day"), seg(LIFT_DAYS, draft.day, (d) => change((x) => { x.day = d; }))];
  const last = lastDay(draft.day);
  if (!draft.exercises.length && last) {
    out.push(h("button", { type: "button", class: "btn ghost wide", style: "margin-top:12px", onClick: () => change((d) => {
      d.exercises = clone(last.exercises).map((e) => ({ name: e.name, sets: e.sets.map((x) => ({ ...x, drop: !!x.drop, perSide: !!x.perSide })) }));
    }) }, `Repeat last ${draft.day} · ${fmtDay(last.date)} · ${last.exercises.length} lifts`));
  }
  out.push(h("h2", {}, "Lifts"));
  draft.exercises.forEach((e, i) => out.push(exerciseBlock(e, i, c)));
  out.push(h("button", { type: "button", class: "btn ghost wide", onClick: addExercise }, "+ Exercise"));
  return out;
}

function lastDay(day) {
  return state.sessions.find((s) => s.type === "lifting" && s.day === day && s.id !== editingId && s.exercises.length) || null;
}

function addExercise() {
  // Suggest the next lift from the last same-day session that isn't logged yet.
  const last = lastDay(draft.day);
  const have = new Set(draft.exercises.map((e) => e.name));
  const next = last && last.exercises.find((e) => !have.has(e.name));
  change((d) => {
    const name = next ? next.name : "";
    d.exercises.push({ name, sets: name ? prefillSets(name) : [] });
    ui.active = null;
  });
}

function prefillSets(name) {
  const hist = liftHistory(name);
  if (hist.length) return hist[0].sets.map((x) => ({ reps: x.reps, weight: x.weight, unit: x.unit, perSide: !!x.perSide, drop: !!x.drop, secs: x.secs ?? null }));
  return [{ reps: null, weight: null, unit: "lb", perSide: false, drop: false, secs: null }];
}

function exerciseBlock(e, i, c) {
  const others = LIFT_DAYS.filter((d) => d !== draft.day).map((d) => ({ label: d, items: c.exercises[d] || [] }));
  const hist = e.name ? liftHistory(e.name) : [];
  const prev = hist[0];
  const best = bestOf(hist);
  const head = h("div", { class: "ex-head" },
    combo(c.exercises[draft.day] || [], e.name, (name) => change((d) => {
      const ex = d.exercises[i];
      ex.name = name;
      if (!ex.sets.length || ex.sets.every((x) => x.reps === null && x.weight === null)) ex.sets = prefillSets(name);
    }), { placeholder: "Choose lift", label: "Lift", groups: others }),
    h("button", { type: "button", class: "x", "aria-label": "Remove lift", onClick: () => change((d) => { d.exercises.splice(i, 1); ui.active = null; }) }, "×"));

  const meta = e.name && h("div", { class: "ex-meta" },
    prev ? ["Last ", h("b", {}, fmtDay(prev.date, { month: "short", day: "numeric" })), " · ", prev.sets.map(setText).join("  ")] : "First time logging this",
    best ? ["   Best ", h("b", {}, `${best.weight}`)] : null);

  const rows = [];
  e.sets.forEach((x, j) => {
    const p = prev && prev.sets[j];
    const isActive = ui.active && ui.active.i === i && ui.active.j === j;
    const pr = best && x.weight !== null && x.weight > best.weight;
    const up = p && x.weight !== null && p.weight !== null && (x.weight > p.weight || (x.weight === p.weight && x.reps > p.reps));
    rows.push(h("button", {
      type: "button", class: "set", "aria-expanded": String(isActive),
      onClick: () => { ui.active = isActive ? null : { i, j }; ui.plates = false; render(); },
    },
      h("span", { class: "n" }, j + 1),
      h("span", { class: "val" },
        fmtNum(x.reps) || "–", h("small", {}, " × "), x.weight === null ? h("small", {}, "BW") : fmtNum(x.weight), x.weight !== null ? h("small", {}, ` ${x.unit}`) : null,
        x.secs ? h("small", {}, ` ${x.secs}s`) : null,
        x.drop ? h("span", { class: "tag" }, "drop") : null,
        x.perSide ? h("span", { class: "tag" }, "/side") : null,
        pr ? h("span", { class: "tag", style: "color:var(--signal)" }, "best") : null),
      h("span", { class: `prev${up ? " up" : ""}` }, p ? setText(p) : "")));
    if (isActive) rows.push(setEditor(e, i, j));
  });

  const foot = e.name && h("div", { class: "ex-foot" },
    h("button", { type: "button", class: "btn small ghost", onClick: () => change((d) => {
      const sets = d.exercises[i].sets;
      const lastSet = sets[sets.length - 1] || { reps: null, weight: null, unit: "lb", perSide: false, drop: false, secs: null };
      sets.push({ ...lastSet, drop: false });
      ui.active = { i, j: sets.length - 1 };
    }) }, "+ Set"));

  return h("div", { class: "exercise" }, head, meta, rows.length ? h("div", { class: "ledger" }, rows) : null, foot);
}

function setText(x) {
  const w = x.weight === null ? "BW" : x.weight;
  return `${x.reps ?? "?"}×${w}${x.drop ? "↓" : ""}`;
}

function setEditor(e, i, j) {
  const x = e.sets[j];
  const t = (key, label) => h("button", { type: "button", class: "chip", "aria-pressed": String(!!x[key]),
    onClick: () => change(() => { x[key] = !x[key]; }) }, label);
  const tools = h("div", { class: "tools" },
    t("drop", "Drop set"), t("perSide", "Per side"),
    h("button", { type: "button", class: "chip", onClick: () => change(() => { x.unit = x.unit === "lb" ? "kg" : "lb"; }) }, x.unit === "lb" ? "lb → kg" : "kg → lb"),
    h("button", { type: "button", class: "chip", "aria-pressed": String(ui.plates), onClick: () => { ui.plates = !ui.plates; render(); } }, "Plates"),
    h("button", { type: "button", class: "chip", "aria-pressed": String(x.weight === null), onClick: () => change(() => { x.weight = x.weight === null ? 0 : null; }) }, "Bodyweight"),
    h("button", { type: "button", class: "chip", style: "color:var(--signal)", onClick: () => change((d) => { d.exercises[i].sets.splice(j, 1); ui.active = null; }) }, "Delete set"));
  // Plates: tap a plate to add a pair (one each side), the way you count them.
  const plates = ui.plates && h("div", { class: "tools" },
    h("button", { type: "button", class: "chip", onClick: () => change(() => { x.weight = (x.weight || 0) + 45; }) }, "Bar +45"),
    PLATES.map((p) => h("button", { type: "button", class: "chip", onClick: () => change(() => { x.weight = (x.weight || 0) + p * 2; }) }, `${p}s`)),
    h("button", { type: "button", class: "chip", onClick: () => change(() => { x.weight = 0; }) }, "0"));
  return h("div", { class: "set-edit" },
    h("div", { class: "pair" },
      field("Reps", stepper(() => x.reps, (v) => (x.reps = v), { step: 1, label: "Reps", max: 1000 })),
      field(`Weight (${x.unit})`, stepper(() => x.weight, (v) => (x.weight = v), { step: x.unit === "kg" ? 2.5 : 5, label: "Weight", max: 2000 }))),
    tools, plates);
}

// ----- surfing -----

function surfForm() {
  const c = state.catalog;
  return [
    h("h2", {}, "Session"),
    h("div", { style: "display:grid;gap:10px" },
      field("Spot", combo(c.spots, draft.spot, (v) => change((d) => { d.spot = v; }), { label: "Spot" })),
      field("Board", combo(c.boards, draft.board, (v) => change((d) => { d.board = v; }), { label: "Board", placeholder: "Which board" })),
      h("div", { class: "pair" },
        field("Waves caught", stepper(() => draft.waves, (v) => (draft.waves = v), { step: 1, label: "Waves" })),
        field("Size (ft)", stepper(() => draft.waveFt, (v) => (draft.waveFt = v), { step: 0.5, label: "Wave size" })))),
    h("h2", {}, "Conditions"),
    h("div", { class: "row" }, CONDITIONS.map((k) => h("button", { type: "button", class: "chip", "aria-pressed": String(draft.conditions.includes(k)),
      onClick: () => change((d) => { d.conditions = d.conditions.includes(k) ? d.conditions.filter((x) => x !== k) : [...d.conditions, k]; }) }, k))),
    h("h2", {}, "Scores"),
    h("div", { style: "display:grid;gap:14px" },
      slider("Wave quality", () => draft.quality, (v) => (draft.quality = v)),
      slider("Experience", () => draft.experience, (v) => (draft.experience = v))),
  ];
}

// ----- climbing -----

function climbForm() {
  const open = state.projects.filter((p) => p.status === "open").sort((a, b) => (b.lastWorked || b.firstSeen).localeCompare(a.lastWorked || a.firstSeen));
  const sentRecently = state.projects.filter((p) => p.status === "sent" && draft.projectsSent.includes(p.id));
  const out = [
    h("h2", {}, "Sends · tap a grade"),
    h("div", { class: "row" }, GRADES.map((g) => h("button", { type: "button", class: "chip mono",
      onClick: () => change((d) => { d.sends.push({ grade: g, color: "", name: "" }); ui.send = d.sends.length - 1; }) }, g))),
  ];
  // Only the active send shows the tape-color picker; the rest stay one line.
  if (draft.sends.length) {
    out.push(h("div", { style: "margin-top:8px" }, draft.sends.map((s, k) => {
      const open = ui.send === k;
      return h("div", { class: "send" },
        h("span", { class: "g" }, s.grade || "?"),
        open
          ? h("div", { class: "dots" }, TAPE_COLORS.map((col) => h("button", { type: "button", "aria-label": col, "aria-pressed": String(s.color === col),
              style: `background:${TAPE_HEX[col]}`, onClick: () => change(() => { s.color = s.color === col ? "" : col; ui.send = null; }) })))
          : h("button", { type: "button", class: "chip", style: "justify-self:start", onClick: () => { ui.send = k; render(); } },
              s.color ? [h("span", { class: "dot", style: `background:${TAPE_HEX[s.color]}` }), s.color] : "+ color"),
        h("button", { type: "button", class: "x", "aria-label": "Remove send", onClick: () => change((d) => { d.sends.splice(k, 1); ui.send = null; }) }, "×"));
    })));
  }

  out.push(h("h2", {}, "Projects"));
  if (!open.length && !sentRecently.length) out.push(h("p", { class: "muted", style: "margin:0 0 8px" }, "No open projects."));
  for (const p of [...open, ...sentRecently]) {
    const worked = draft.projectsWorked.includes(p.id);
    const sent = draft.projectsSent.includes(p.id);
    const mark = (what) => change((d) => {
      d.projectsWorked = d.projectsWorked.filter((x) => x !== p.id);
      d.projectsSent = d.projectsSent.filter((x) => x !== p.id);
      if (what === "worked" && !worked) d.projectsWorked.push(p.id);
      if (what === "sent" && !sent) d.projectsSent.push(p.id);
    });
    out.push(h("div", { class: "project" },
      h("div", {},
        p.color ? h("span", { class: "dot", style: `background:${TAPE_HEX[p.color]}` }) : null,
        h("b", {}, p.name || `${p.color} one`), p.grade ? h("span", { class: "mono muted" }, ` ${p.grade}`) : null,
        h("div", { class: "muted", style: "font-size:13px" }, p.wall ? `${p.wall} · ` : "", p.lastWorked ? `worked ${fmtDay(p.lastWorked, { month: "short", day: "numeric" })}` : `since ${fmtDay(p.firstSeen, { month: "short", day: "numeric" })}`)),
      h("div", { class: "row" },
        h("button", { type: "button", class: "chip", "aria-pressed": String(worked), onClick: () => mark("worked") }, "Worked"),
        h("button", { type: "button", class: "chip", "aria-pressed": String(sent), onClick: () => mark("sent") }, "Sent"))));
  }
  out.push(newProjectForm());
  return out;
}

function newProjectForm() {
  if (ui.adding !== "project") {
    return h("button", { type: "button", class: "btn ghost wide", style: "margin-top:10px", onClick: () => { ui.adding = "project"; ui.newProject = { name: "", color: "", grade: "", wall: "" }; render(); } }, "+ New project");
  }
  const np = ui.newProject;
  return h("div", { class: "card", style: "margin-top:10px;display:grid;gap:10px" },
    h("input", { type: "text", placeholder: "Name, e.g. Underhang crimps", value: np.name, "aria-label": "Project name", onInput: (e) => (np.name = e.target.value) }),
    h("div", { class: "dots" }, TAPE_COLORS.map((col) => h("button", { type: "button", "aria-label": col, "aria-pressed": String(np.color === col),
      style: `background:${TAPE_HEX[col]}`, onClick: () => { np.color = np.color === col ? "" : col; render(); } }))),
    h("div", { class: "row" }, GRADES.map((g) => h("button", { type: "button", class: "chip mono", "aria-pressed": String(np.grade === g), onClick: () => { np.grade = np.grade === g ? "" : g; render(); } }, g))),
    h("input", { type: "text", placeholder: "Wall (optional)", value: np.wall, "aria-label": "Wall", onInput: (e) => (np.wall = e.target.value) }),
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn", onClick: () => { ui.adding = null; render(); } }, "Cancel"),
      h("button", { type: "button", class: "btn primary", onClick: async () => {
        if (!np.name.trim() && !np.color) return toast("Give it a name or a color");
        try {
          const p = await api("POST", "/api/projects", { ...np, firstSeen: draft.date });
          state.projects.push(p);
          ui.adding = null;
          change((d) => d.projectsWorked.push(p.id));
        } catch (e) { toast(e.message); }
      } }, "Add project")));
}

// ----- tennis -----

function tennisForm() {
  const c = state.catalog;
  return [
    h("h2", {}, "Matches"),
    draft.matches.map((m, k) => {
      const res = m.me !== null && m.them !== null ? (m.me > m.them ? "w" : m.me < m.them ? "l" : "") : "";
      return h("div", { class: "match" },
        h("div", { style: "display:grid;grid-template-columns:1fr auto;gap:8px" },
          combo(c.opponents, m.opponent, (v) => change(() => { m.opponent = v; }), { label: "Opponent", placeholder: "Opponent" }),
          h("button", { type: "button", class: "x", "aria-label": "Remove match", onClick: () => change((d) => { d.matches.splice(k, 1); }) }, "×")),
        seg(["singles", "doubles"], m.format, (f) => change(() => { m.format = f; }), { singles: "Singles", doubles: "Doubles" }),
        h("div", { class: "score" },
          field("Me", stepper(() => m.me, (v) => (m.me = v), { step: 1, label: "My games", max: 99 })),
          h("span", { class: `vs ${res}` }, res ? res.toUpperCase() : "vs"),
          field("Them", stepper(() => m.them, (v) => (m.them = v), { step: 1, label: "Their games", max: 99 }))));
    }),
    h("button", { type: "button", class: "btn ghost wide", style: "margin-top:12px", onClick: () => change((d) => {
      const lastFormat = d.matches.length ? d.matches[d.matches.length - 1].format : "singles";
      d.matches.push({ opponent: "", format: lastFormat, me: null, them: null });
    }) }, "+ Match"),
  ];
}

// ----- flag football / basketball -----

function gameForm() {
  return [
    h("h2", {}, "Score"),
    h("div", { class: "score" },
      field("Us", stepper(() => draft.us, (v) => (draft.us = v), { step: 1, label: "Our score", max: 500 })),
      h("span", { class: "vs" }, "–"),
      field("Them", stepper(() => draft.them, (v) => (draft.them = v), { step: 1, label: "Their score", max: 500 }))),
    h("h2", {}, "Played"),
    h("input", { type: "text", placeholder: draft.type === "basketball" ? "Guard, wing…" : "DB, QB, receiver…", value: draft.position, "aria-label": "Position",
      onInput: (e) => { draft.position = e.target.value; saveDraft(); } }),
    h("h2", {}, "Highlights"),
    h("textarea", { placeholder: "Pick on the goal line…", value: draft.highlights, "aria-label": "Highlights",
      onInput: (e) => { draft.highlights = e.target.value; saveDraft(); } }),
  ];
}

// ----- other -----

function otherForm() {
  return [
    h("h2", {}, "Activity"),
    combo(state.catalog.activities, draft.activity, (v) => change((d) => { d.activity = v; }), { label: "Activity" }),
    h("div", { class: "pair", style: "margin-top:12px" },
      field(`Distance (${draft.distanceUnit})`, stepper(() => draft.distance, (v) => (draft.distance = v), { step: 0.5, label: "Distance", max: 1000 })),
      field("Rounds", stepper(() => draft.rounds, (v) => (draft.rounds = v), { step: 1, label: "Rounds", max: 100 }))),
    h("div", { style: "margin-top:10px" }, seg(["mi", "km"], draft.distanceUnit, (u) => change((d) => { d.distanceUnit = u; }))),
  ];
}

// ----- save / delete -----

async function onSave() {
  if (draft.type === "lifting" && draft.exercises.some((e) => !e.name)) return toast("Pick a lift for every block");
  const body = { ...draft, needsDetails: false };
  try {
    if (editingId) await api("PUT", `/api/sessions/${editingId}`, body);
    else await api("POST", "/api/sessions", body);
  } catch (e) {
    if (e.message !== "signed out") toast(editingId ? "Couldn't save. Try again." : "Couldn't save. Draft kept on this phone.");
    return;
  }
  if (!editingId) clearDraft();
  toast("Saved");
  await load();
  location.hash = "#history";
}

async function onDelete() {
  if (!confirm("Delete this workout? This can't be undone.")) return;
  try {
    await api("DELETE", `/api/sessions/${editingId}`);
  } catch (e) { return toast("Couldn't delete"); }
  toast("Deleted");
  await load();
  location.hash = "#history";
}

// ---------- History ----------

function weekStart(day) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function viewHistory() {
  const out = [h("div", { class: "top" }, h("h1", {}, "History"), h("span", { class: "muted mono" }, `${state.sessions.length} sessions`))];
  if (!state.sessions.length) return [...out, h("p", { class: "empty" }, "Nothing logged yet.")];
  const weeks = new Map();
  for (const s of state.sessions) {
    const w = weekStart(s.date);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(s);
  }
  for (const [w, list] of weeks) {
    const end = new Date(w + "T12:00:00Z"); end.setUTCDate(end.getUTCDate() + 6);
    out.push(h("div", { class: "week" },
      h("span", {}, `${fmtDay(w, { month: "short", day: "numeric" })} – ${fmtDay(end.toISOString().slice(0, 10), { month: "short", day: "numeric" })}`),
      h("span", {}, `${list.length}`)));
    for (const s of list) {
      const info = TYPE_INFO[s.type];
      const mark = s.type === "other" ? (s.activity || "··").slice(0, 2).toUpperCase() : info.mark;
      out.push(h("a", { class: "item", href: `#session/${s.id}` },
        h("span", { class: "mark" }, mark),
        h("span", { style: "min-width:0" },
          h("div", { class: "title" }, s.type === "other" ? s.activity : info.label,
            s.needsDetails ? h("span", { class: "flag need" }, "add details") : null,
            s.voice ? h("span", { class: "flag src" }, "voice") : null),
          h("div", { class: "sub" }, [describe(s) || (s.voice && s.voice.headline) || "", s.watch && s.watch.kcal ? `${s.watch.kcal} cal` : "", s.watch && s.watch.avgHr ? `${s.watch.avgHr} bpm` : ""].filter(Boolean).join(" · "))),
        h("span", { class: "when" }, fmtDay(s.date, { weekday: "short" }), h("br"), fmtDay(s.date, { month: "short", day: "numeric" }))));
    }
  }
  return out;
}

// ---------- Lifts (per-exercise last + best) ----------

function viewLifts() {
  const out = [h("div", { class: "top" }, h("h1", {}, "Lifts"))];
  let any = false;
  for (const day of LIFT_DAYS) {
    const names = new Set();
    for (const s of state.sessions) if (s.type === "lifting" && s.day === day) s.exercises.forEach((e) => e.sets.length && names.add(e.name));
    if (!names.size) continue;
    any = true;
    out.push(h("h2", {}, day));
    for (const name of names) {
      const hist = [];
      for (const s of state.sessions) {
        if (s.type !== "lifting") continue;
        const e = s.exercises.find((x) => x.name === name);
        if (e && e.sets.length) hist.push({ date: s.date, sets: e.sets });
      }
      const best = bestOf(hist);
      out.push(h("details", { class: "card" },
        h("summary", { style: "list-style:none;color:inherit;margin:0" },
          h("div", { style: "display:flex;justify-content:space-between;gap:8px" },
            h("b", {}, name),
            best ? h("span", { class: "mono", style: "color:var(--signal)" }, `${best.weight} ${best.unit}`) : null),
          h("div", { class: "mono muted", style: "font-size:14px;margin-top:2px" },
            `${fmtDay(hist[0].date, { month: "short", day: "numeric" })} · ${hist[0].sets.map(setText).join("  ")}`)),
        hist.slice(1).map((x) => h("div", { class: "mono muted", style: "font-size:14px;margin-top:6px" },
          `${fmtDay(x.date, { month: "short", day: "numeric" })} · ${x.sets.map(setText).join("  ")}`))));
    }
  }
  if (!any) out.push(h("p", { class: "empty" }, "Log a lift and it shows up here."));
  return out;
}

// ---------- Login ----------

function showLogin(message) {
  document.querySelector("nav.tabs")?.remove();
  const input = h("input", { type: "password", autocomplete: "current-password", placeholder: "Passcode", "aria-label": "Passcode" });
  const msg = h("p", { class: "muted", style: "margin:0" }, message || "Enter your passcode.");
  const go = async (e) => {
    e.preventDefault();
    try {
      await api("POST", "/api/login", { passcode: input.value });
      await start();
    } catch (err) {
      msg.textContent = err.message === "wrong" ? "Wrong passcode." : err.message;
      msg.style.color = "var(--signal)";
    }
  };
  $app().replaceChildren(h("form", { class: "login", onSubmit: go }, h("h1", {}, "Workouts"), msg, input, h("button", { class: "btn primary", type: "submit" }, "Open")));
  input.focus();
}

// ---------- routing ----------

function route() {
  const hash = location.hash || "#log";
  if (hash.startsWith("#session/")) return { tab: "log", id: hash.slice(9) };
  if (hash === "#history") return { tab: "history" };
  if (hash === "#lifts") return { tab: "lifts" };
  return { tab: "log" };
}

let lastRouteKey = null;
async function onRoute() {
  const r = route();
  const key = r.tab + (r.id || "");
  if (key !== lastRouteKey) {
    ui = { active: null, plates: false, adding: null };
    lastRouteKey = key;
    if (r.tab === "log") {
      if (r.id) {
        let s = state.sessions.find((x) => x.id === r.id);
        if (!s) { await load(); s = state.sessions.find((x) => x.id === r.id); }
        if (!s) { toast("That workout is gone"); location.hash = "#history"; return; }
        editingId = s.id;
        const { id, source, ...rest } = clone(s);
        draft = rest;
      } else {
        editingId = null;
        draft = loadDraft() || suggestedDraft();
        if (draft.date < pacificDay() && isEmptyDraft(draft)) draft.date = pacificDay();
      }
    }
    window.scrollTo(0, 0);
  }
  render();
}

// A blank entry opens on today's top suggestion (or a lift day).
function suggestedDraft() {
  const next = suggestNext(state.sessions, state.projects, pacificDay());
  const p = next && next.when === "Today" && next.picks[0];
  const d = newDraft(p ? p.type : "lifting");
  if (p && p.day) d.day = p.day;
  if (p && p.activity) d.activity = p.activity;
  return d;
}

function isEmptyDraft(d) {
  return !d.notes && !d.partners.length && (d.type !== "lifting" || !d.exercises.length);
}

function render() {
  const r = route();
  const y = window.scrollY;
  const view = r.tab === "history" ? viewHistory() : r.tab === "lifts" ? viewLifts() : viewLog();
  $app().replaceChildren(...view.flat(Infinity).filter(Boolean));
  renderTabs(r.tab);
  window.scrollTo(0, y);
  // Keep the selected type tab visible without scrolling the page itself.
  const tabRow = document.querySelector(".types"), sel = tabRow && tabRow.querySelector("[aria-pressed=true]");
  if (sel && (sel.offsetLeft + sel.offsetWidth > tabRow.scrollLeft + tabRow.clientWidth || sel.offsetLeft < tabRow.scrollLeft)) {
    tabRow.scrollLeft = sel.offsetLeft - 16;
  }
}

function renderTabs(tab) {
  let nav = document.querySelector("nav.tabs");
  if (!nav) {
    nav = h("nav", { class: "tabs", "aria-label": "Sections" });
    document.body.append(nav);
  }
  const link = (href, label, t) => h("a", { href, "aria-current": tab === t ? "page" : null,
    onClick: (e) => { if (t === "log" && tab === "log" && editingId) { e.preventDefault(); location.hash = "#log"; } } }, label);
  nav.replaceChildren(link("#log", "Log", "log"), link("#history", "History", "history"), link("#lifts", "Lifts", "lifts"));
}

async function start() {
  try {
    await load();
  } catch (e) {
    if (e.message === "signed out") return;
    if (e.status === 503) return $app().replaceChildren(h("p", { class: "empty" }, "Locked: the passcode isn't set up yet."));
    return $app().replaceChildren(h("p", { class: "empty" }, "Can't reach the server. Check your connection and reopen."));
  }
  lastRouteKey = null;
  await onRoute();
}

window.addEventListener("hashchange", onRoute);
start();
