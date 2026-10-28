// npm run setup: pick your activities, lifts, spots and time zone.
// Writes setup.json (your answers, git-ignored) and public/setup.js (what the app reads).
// `npm run setup -- --apply` skips the questions and applies setup.json as-is.
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { APPLY_ONLY, loadSetup, saveSetup, ask, askList, askPick, askTimeZone, askYesNo, done, wrangler } from "./lib/setup-kit.mjs";
import { TYPES } from "../public/model.js";
import CURRENT from "../public/setup.js";

const LABELS = { lifting: "Lifting (push / pull / legs)", surfing: "Surfing", climbing: "Climbing", tennis: "Tennis",
  "flag-football": "Flag football", basketball: "Basketball", other: "Other (yoga, runs, anything else)" };

const s = loadSetup("setup.json", { ...CURRENT, localDev: true });

if (!APPLY_ONLY) {
  console.log("Workout Log setup. Press Enter to keep the value in [brackets].\n");
  s.timeZone = await askTimeZone(s.timeZone);
  const picked = await askPick("Which activities do you do?", TYPES.map((t) => LABELS[t]), s.types.map((t) => LABELS[t]));
  s.types = TYPES.filter((t) => picked.includes(LABELS[t]));
  if (s.types.includes("lifting")) {
    for (const day of ["Push", "Pull", "Legs"]) s.exercises[day] = await askList(`Your ${day} day lifts`, s.exercises[day]);
  }
  if (s.types.includes("surfing")) s.spots = await askList("Surf spots you go to", s.spots);
  s.activities = await askList("Other activities you do", s.activities);
  s.localDev = await askYesNo("Set up local testing too (random local passcode + local database)?", s.localDev);
  saveSetup("setup.json", s);
}
done();

const { localDev, ...appSetup } = s;
writeFileSync("public/setup.js",
  "// Your starting setup. Written by `npm run setup` (or Claude Code's /setup) from setup.json.\n" +
  "// Anything you change later in the app's Settings tab is saved in the database and wins over this file.\n" +
  `export default ${JSON.stringify(appSetup, null, 2)};\n`);
console.log("Wrote public/setup.js.");

if (localDev) {
  if (!existsSync(".dev.vars")) {
    const r = (n) => randomBytes(n).toString("base64url");
    const passcode = r(12);
    writeFileSync(".dev.vars", `WORKOUT_PASSCODE=${passcode}\nSESSION_SECRET=${r(32)}\nINGEST_SECRET=${r(24)}\n`);
    console.log(`Wrote .dev.vars (git-ignored). Your LOCAL passcode is: ${passcode}`);
  }
  wrangler("d1", "migrations", "apply", "workout-log", "--local");
  console.log("\nLocal database ready. Run `npm run dev` and open http://localhost:8787.");
}
console.log("To put it online, follow \"Put it online\" in README.md (or ask Claude Code: /setup).");
