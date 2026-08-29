import { db, now } from "./db.js";
import { startSweep } from "./sweep.js";

/**
 * The overnight sweep. The pitch has always been "it prepares your loops while you
 * sleep" — this is what makes that true rather than a button someone has to press.
 *
 * Runs once a day at SWEEP_HOUR local time, and only when there is something to do.
 * Never notifies on its own; the hold app decides what is worth surfacing.
 */
const HOUR = Number(process.env.SWEEP_HOUR ?? 6);

const lastRun = () =>
  (db.prepare(`SELECT value FROM harness_state WHERE key='last_sweep'`).get() as any)?.value ?? null;
const markRun = () =>
  db.prepare(`INSERT INTO harness_state (key,value,at) VALUES ('last_sweep',?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, at=excluded.at`)
    .run(new Date().toDateString(), now());

async function maybeSweep() {
  const d = new Date();
  if (d.getHours() !== HOUR) return;
  if (lastRun() === d.toDateString()) return;      // already swept today

  const pending = (db.prepare(
    `SELECT COUNT(*) n FROM loops WHERE status IN ('open','sweeping')`
  ).get() as any).n as number;
  if (pending === 0) { markRun(); return; }

  markRun();
  console.log(`overnight     →  sweeping ${pending} loop(s)`);
  try { await startSweep(); } catch (e) { console.error("overnight sweep:", String(e)); }
}

export function startScheduler() {
  setInterval(() => void maybeSweep(), 5 * 60 * 1000).unref?.();
  void maybeSweep();
  console.log(`overnight     →  daily sweep at ${String(HOUR).padStart(2, "0")}:00 local`);
}

/** Status for the settings screen, so the schedule is visible rather than folklore. */
export function schedulerStatus() {
  const d = new Date();
  const next = new Date(d);
  next.setHours(HOUR, 0, 0, 0);
  if (next <= d) next.setDate(next.getDate() + 1);
  return { hour: HOUR, lastRun: lastRun(), nextRun: next.toISOString() };
}
