// Passcode lock, same scheme as the-garden/src/worker.js.
//
// One passcode (Worker secret WORKOUT_PASSCODE). A correct passcode sets a
// signed, HttpOnly cookie good for a year. The passcode is part of the
// signing key, so changing it signs out every device.
//
// Guessing: each wrong try is recorded in D1. 5 misses from one IP in 15
// minutes locks that IP out; 30 misses from anywhere in an hour locks login
// for everyone until the hour passes (devices already signed in keep working).

const COOKIE = "workout_session";
const SESSION_DAYS = 365;
const IP_LIMIT = 5, IP_WINDOW_MIN = 15;
const GLOBAL_LIMIT = 30, GLOBAL_WINDOW_MIN = 60;
const MIN_PASSCODE = 12;

export function configured(env) {
  return typeof env.WORKOUT_PASSCODE === "string" && env.WORKOUT_PASSCODE.length >= MIN_PASSCODE &&
    typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32;
}

export async function login(request, env, json, readBody) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const now = Date.now();
  const ipSince = new Date(now - IP_WINDOW_MIN * 60_000).toISOString();
  const allSince = new Date(now - GLOBAL_WINDOW_MIN * 60_000).toISOString();
  const counts = await env.DB.prepare(
    "SELECT (SELECT count(*) FROM login_failures WHERE ip = ? AND at > ?) AS ip_n, " +
    "(SELECT count(*) FROM login_failures WHERE at > ?) AS all_n"
  ).bind(ip, ipSince, allSince).first();
  if (counts.ip_n >= IP_LIMIT || counts.all_n >= GLOBAL_LIMIT) {
    return json({ error: "locked", message: "Too many wrong tries. Wait 15 minutes, then try again." }, 429);
  }

  const body = await readBody(request);
  const given = body && typeof body.passcode === "string" ? body.passcode : "";
  if (!(await sameSecret(given, env.WORKOUT_PASSCODE))) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, new Date(now).toISOString()),
      env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(new Date(now - 86_400_000).toISOString()),
    ]);
    const left = IP_LIMIT - counts.ip_n - 1;
    return json({ error: "wrong", message: left > 0 ? "Wrong passcode." : "Wrong passcode. Locked for 15 minutes." }, 401);
  }

  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const token = exp + "." + (await sign(String(exp), env));
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      "Cache-Control": "no-store",
    },
  });
}

export function logout() {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict` },
  });
}

export async function validSession(request, env) {
  const raw = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!/^\d+$/.test(exp || "") || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return sameSecret(sig, await sign(exp, env));
}

// HMAC key = session secret + passcode, so a new passcode voids old cookies.
async function sign(message, env) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET + "\u0000" + env.WORKOUT_PASSCODE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Compares hashes of both strings so timing reveals nothing about the secret.
export async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
