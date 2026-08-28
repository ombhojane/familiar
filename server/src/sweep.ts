import { db } from "./db.js";

const TF = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";

/**
 * The sweep: one subagent per open loop, working in parallel, each preparing its
 * loop as far as it can go without doing anything irreversible. Subagents share the
 * sandbox and tool set but get no conversation history, so each instruction has to
 * be self-contained.
 */
export async function startSweep(): Promise<{ sessionId: string; loops: number; raw: string }> {
  const open = db
    .prepare(`SELECT id, title, summary, missing FROM loops WHERE status IN ('open','sweeping') ORDER BY created_at DESC LIMIT 5`)
    .all() as { id: string; title: string; summary: string | null; missing: string }[];

  if (open.length === 0) return { sessionId: "", loops: 0, raw: "" };

  const brief = open
    .map((l, i) => {
      const missing: string[] = JSON.parse(l.missing || "[]");
      return `${i + 1}. loopId=${l.id} — "${l.title}"${l.summary ? `\n   context: ${l.summary}` : ""}${
        missing.length ? `\n   still missing: ${missing.join(", ")}` : ""
      }`;
    })
    .join("\n");

  const r = await fetch(`${TF}/api/v1/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: { name: "familiar" } }),
  });
  const sessionId = (await r.json()).data.id as string;

  const turn = await fetch(`${TF}/api/v1/sessions/${sessionId}/turns`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: [{
        type: "user.message",
        content:
`Sweep the board. There are ${open.length} open loops:

${brief}

Delegate ONE sub-agent per loop, all at once, using create_sub_agent. Each sub-agent
has no history of this conversation, so give it the loopId, the title, what is missing,
and tell it exactly what to do:

  - work out precisely what closing that loop would take
  - do any safe preparation in the sandbox (drafting, filling, assembling)
  - do NOT send, submit, publish, or spend anything
  - finish by calling loop_upsert with status "prepared", a sharper list of what is
    still missing, and — most importantly — put the FULL draft/checklist you produced
    into preparedNote. The user reads preparedNote verbatim; work not written there
    is lost.

When they are all back, tell me in one line how many are prepared.`,
      }],
    }),
  });

  db.prepare(`UPDATE loops SET status='sweeping' WHERE status='open'`).run();
  const raw = await turn.text();
  return { sessionId, loops: open.length, raw };
}

/** Subagent threads, pulled out of a turn stream, for the swimlanes. */
export function lanes(raw: string) {
  const evs = raw
    .split("\n")
    .filter((l) => l.startsWith("data:") && l.slice(5).trim())
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    .filter(Boolean) as any[];

  const out = new Map<string, { name: string; done: boolean; output: string | null }>();
  for (const e of evs) {
    if (e.type === "thread.created" && e.thread_id && e.thread_id !== "main") {
      out.set(e.thread_id, {
        name: e.agent_info?.name ?? e.agentInfo?.name ?? "field agent",
        done: false, output: null,
      });
    }
    if (e.type === "thread.done" && e.thread_id) {
      const cur = out.get(e.thread_id);
      if (cur) { cur.done = true; cur.output = e.state?.output?.content ?? null; }
    }
  }
  return [...out.entries()].map(([threadId, v]) => ({ threadId, ...v }));
}
