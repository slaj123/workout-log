// Workout log API. Static files (public/) are served by Workers Assets and
// hold no personal data; only /api/* reaches this code (run_worker_first in
// wrangler.jsonc). Every /api route needs a signed session except:
//   POST /api/login, /api/logout  - the passcode lock (src/auth.js)
//   POST /api/ingest              - the Apple Watch Shortcut and the voice
//                                   Worker, which send X-Ingest-Secret instead
// If the secrets are missing, every call is refused (503).
import { configured, login, logout, validSession, sameSecret } from "./auth.js";
import { cleanSession, watchToSession, memoToSession, buildCatalog, TAPE_COLORS, GRADES, configure, cleanSettings, currentSettings } from "../public/model.js";
import SETUP from "../public/setup.js";

const ID_RE = /^[a-z0-9]{6,40}$/;
const MAX_BODY = 200_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (!configured(env)) return json({ error: "lock not configured" }, 503);
      if (url.pathname === "/api/login" && request.method === "POST") return await login(request, env, json, readBody);
      if (url.pathname === "/api/logout" && request.method === "POST") return logout();
      if (url.pathname === "/api/ingest" && request.method === "POST") { await applySettings(env); return await ingest(request, env, url); }
      if (!(await validSession(request, env))) return json({ error: "signed out" }, 401);
      await applySettings(env);
      return await route(request, env, url);
    } catch (e) {
      if (e && /^bad /.test(e.message)) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: "server error" }, 500);
    }
  },
};

async function route(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", collection, id?]
  const [, collection, rawId] = parts;
  const id = rawId ? decodeURIComponent(rawId) : null;
  if (parts.length > 3 || (id !== null && !ID_RE.test(id))) return json({ error: "not found" }, 404);
  const m = request.method;

  if (collection === "state" && !id && m === "GET") return json(await loadState(env));

  // Settings tab: what shows up and how days are counted. Saved over public/setup.js.
  if (collection === "settings" && !id) {
    if (m === "GET") return json(currentSettings());
    if (m === "PUT") {
      // Only the fields sent change; the rest of your saved settings stay.
      const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'app'").first();
      const s = { ...(row ? JSON.parse(row.value) : {}), ...cleanSettings(await mustBody(request)) };
      await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('app', ?)").bind(JSON.stringify(s)).run();
      return json(configure({ ...SETUP, ...s }));
    }
  }

  if (collection === "sessions") {
    if (!id && m === "POST") {
      const s = cleanSession(await mustBody(request));
      const newId = await insertSession(env, s, "form");
      await updateProjects(env, s);
      return json({ id: newId }, 201);
    }
    if (id && m === "PUT") {
      const row = await env.DB.prepare("SELECT source FROM sessions WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "not found" }, 404);
      const s = cleanSession(await mustBody(request));
      await env.DB.prepare("UPDATE sessions SET date = ?, type = ?, data = ?, updated_at = ? WHERE id = ?")
        .bind(s.date, s.type, JSON.stringify(s), new Date().toISOString(), id).run();
      await updateProjects(env, s);
      return new Response(null, { status: 204 });
    }
    if (id && m === "DELETE") {
      await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
      return new Response(null, { status: 204 });
    }
  }

  if (collection === "projects") {
    if (!id && m === "POST") {
      const p = cleanProject(await mustBody(request));
      const newId = newIdent();
      await env.DB.prepare("INSERT INTO projects (id, data, updated_at) VALUES (?, ?, ?)")
        .bind(newId, JSON.stringify(p), new Date().toISOString()).run();
      return json({ id: newId, ...p }, 201);
    }
    if (id && m === "PATCH") {
      const row = await env.DB.prepare("SELECT data FROM projects WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "not found" }, 404);
      const patch = await mustBody(request);
      const merged = cleanProject({ ...JSON.parse(row.data), ...patch });
      await env.DB.prepare("UPDATE projects SET data = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(merged), new Date().toISOString(), id).run();
      return json({ id, ...merged });
    }
    if (id && m === "DELETE") {
      await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
      return new Response(null, { status: 204 });
    }
  }

  return json({ error: "not found" }, 404);
}

// Everything the page needs in one round trip: sessions newest first,
// climbing projects, and the dropdown catalog built from history.
async function loadState(env) {
  const [{ results: rows }, { results: prows }] = await Promise.all([
    env.DB.prepare("SELECT id, source, data, created_at FROM sessions ORDER BY date DESC, created_at DESC").all(),
    env.DB.prepare("SELECT id, data FROM projects").all(),
  ]);
  const sessions = rows.map((r) => ({ ...JSON.parse(r.data), id: r.id, source: r.source }));
  const projects = prows.map((r) => ({ ...JSON.parse(r.data), id: r.id }));
  return { sessions, projects, catalog: buildCatalog(sessions), settings: currentSettings() };
}

// Your setup file, with anything saved from the Settings tab on top.
async function applySettings(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'app'").first();
  configure({ ...SETUP, ...(row ? JSON.parse(row.value) : {}) });
}

async function insertSession(env, s, source) {
  const id = newIdent();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, date, type, source, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, s.date, s.type, source, JSON.stringify(s), now, now).run();
  return id;
}

// A session that names projects marks them worked or sent on its date.
async function updateProjects(env, s) {
  if (s.type !== "climbing") return;
  const touched = [...s.projectsWorked.map((id) => [id, "worked"]), ...s.projectsSent.map((id) => [id, "sent"])];
  for (const [id, what] of touched) {
    if (!ID_RE.test(id)) continue;
    const row = await env.DB.prepare("SELECT data FROM projects WHERE id = ?").bind(id).first();
    if (!row) continue;
    const p = JSON.parse(row.data);
    p.lastWorked = p.lastWorked && p.lastWorked > s.date ? p.lastWorked : s.date;
    if (what === "sent") { p.status = "sent"; p.sentOn = p.sentOn || s.date; }
    await env.DB.prepare("UPDATE projects SET data = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(cleanProject(p)), new Date().toISOString(), id).run();
  }
}

function cleanProject(p) {
  const day = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const name = typeof p.name === "string" ? p.name.trim().slice(0, 60) : "";
  const color = TAPE_COLORS.includes(p.color) ? p.color : "";
  if (!name && !color) throw new Error("bad project");
  return {
    name,
    color,
    grade: GRADES.includes(p.grade) ? p.grade : "",
    wall: typeof p.wall === "string" ? p.wall.trim().slice(0, 60) : "",
    status: p.status === "sent" ? "sent" : "open",
    firstSeen: day(p.firstSeen) || new Date().toISOString().slice(0, 10),
    lastWorked: day(p.lastWorked),
    sentOn: p.status === "sent" ? day(p.sentOn) : null,
  };
}

// ---------- ingest (Watch Shortcut + voice Worker) ----------

async function ingest(request, env, url) {
  if (typeof env.INGEST_SECRET !== "string" || env.INGEST_SECRET.length < 24) return json({ error: "ingest not configured" }, 503);
  if (!(await sameSecret(request.headers.get("X-Ingest-Secret") || "", env.INGEST_SECRET))) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await mustBody(request);

  if (body.source === "voice") {
    const s = memoToSession(body.memo || {});
    const id = await insertSession(env, s, "voice");
    return json({ id, url: `${url.origin}/#session/${id}` }, 201);
  }

  // Watch: if a session of the same type on the same day has no Watch data
  // yet (logged in the app first), attach to it instead of making a twin.
  const s = watchToSession(body);
  const { results } = await env.DB.prepare("SELECT id, data FROM sessions WHERE date = ? AND type = ? ORDER BY created_at DESC")
    .bind(s.date, s.type).all();
  const twin = results.map((r) => ({ id: r.id, data: JSON.parse(r.data) })).find((r) => !r.data.watch);
  if (twin) {
    const merged = cleanSession({ ...twin.data, watch: s.watch, durationMin: twin.data.durationMin ?? s.durationMin });
    await env.DB.prepare("UPDATE sessions SET data = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(merged), new Date().toISOString(), twin.id).run();
    return json({ id: twin.id, attached: true, url: `${url.origin}/#session/${twin.id}` });
  }
  const id = await insertSession(env, s, "watch");
  return json({ id, attached: false, url: `${url.origin}/#session/${id}` }, 201);
}

// ---------- helpers ----------

function newIdent() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function readBody(request) {
  const text = await request.text();
  if (!text || text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function mustBody(request) {
  const b = await readBody(request);
  if (!b) throw new Error("bad body");
  return b;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
