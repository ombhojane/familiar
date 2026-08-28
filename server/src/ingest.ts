import { db, now } from "./db.js";

const TF = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";

/**
 * Captures used to sit unprocessed forever: the pipeline existed but nothing
 * pulled the trigger. This worker drains the queue on its own — one capture at a
 * time, in its own long-lived session, so the user never has to ask.
 */
let workerSession: string | null = null;
let running = false;

const remember = (k: string, v: string) =>
  db.prepare(`INSERT INTO harness_state (key,value,at) VALUES (?,?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, at=excluded.at`).run(k, v, now());
const recall = (k: string) =>
  (db.prepare(`SELECT value FROM harness_state WHERE key=?`).get(k) as { value: string } | undefined)?.value ?? null;

/** Sessions survive restarts, so reuse the one we had rather than starting over.
 *  Verify it still exists first — TrueForge's store may have been reset underneath us. */
async function session(): Promise<string> {
  if (workerSession) return workerSession;

  const saved = recall("worker_session");
  if (saved) {
    const check = await fetch(`${TF}/api/v1/sessions/${saved}`);
    if (check.ok) {
      workerSession = saved;
      console.log(`ingest        →  resumed session ${saved}`);
      return saved;
    }
    console.log(`ingest        →  saved session ${saved} is gone; starting a new one`);
  }

  const r = await fetch(`${TF}/api/v1/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: { name: "familiar" } }),
  });
  workerSession = (await r.json()).data.id as string;
  remember("worker_session", workerSession);
  return workerSession;
}

async function processOne(captureId: string) {
  const sid = await session();
  const res = await fetch(`${TF}/api/v1/sessions/${sid}/turns`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: [{
        type: "user.message",
        content:
          `A capture arrived from HOLD with id ${captureId}. Call capture_extract on it, ` +
          `check loops_list so you do not duplicate anything already open, then call ` +
          `loop_upsert with a precise title, what is still missing, and any deadline that was ` +
          `printed on the page. Do not ask me anything — just file it.`,
      }],
    }),
  });
  const raw = await res.text();

  if (!res.ok) {
    // 422 means the session is mid-turn; leave the capture queued and retry next tick.
    if (res.status === 422) return false;
    // Anything else: start a fresh session next time rather than wedging forever.
    workerSession = null;
    throw new Error(`turn ${res.status}`);
  }

  // If the agent stopped to ask something, don't leave the session stuck.
  if (raw.includes("tool.approval_required") || raw.includes("tool.response_required")) {
    workerSession = null;
  }
  return true;
}

export async function drain() {
  if (running) return;
  running = true;
  try {
    const pending = db
      .prepare(`SELECT id FROM captures WHERE status = 'unprocessed' ORDER BY at ASC LIMIT 3`)
      .all() as { id: string }[];

    for (const { id } of pending) {
      try {
        const ok = await processOne(id);
        if (!ok) break;                     // session busy — try again next tick
      } catch (e) {
        console.error(`ingest ${id}:`, String(e));
        break;
      }
    }
  } finally {
    running = false;
  }
}

export function startIngest(intervalMs = 5000) {
  setInterval(() => void drain(), intervalMs).unref?.();
  void drain();
  console.log(`ingest        →  draining captures every ${intervalMs / 1000}s`);
}
