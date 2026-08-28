import { db, now } from "./db.js";

const TF = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";

/** Which action class a gated tool belongs to. Clearance is per class, not per tool. */
export const TOOL_CLASS: Record<string, string> = {
  act_release_publish: "release.publish",
  act_repo_describe: "repo.describe",
  dossier_write: "memory.write",
};

/** Tools that are gated when their class is below L3. order_propose is always gated:
 *  ratifying a rule is the user's act, never the agent's. */
const ALWAYS_GATED = ["order_propose"];

/** Promotion needs earned evidence AND a ratified rule that scopes it.
 *  Never time, never usage — the meter reads "earned by N correct actions". */
const REQUIRED_APPROVALS = 3;

export function recordDecision(
  toolName: string, decision: "approved" | "denied", reason: string | null, args: unknown
) {
  const cls = TOOL_CLASS[toolName];
  db.prepare(`INSERT INTO receipts (at,action,args,decision,reason) VALUES (?,?,?,?,?)`)
    .run(now(), cls ?? toolName, JSON.stringify(args ?? {}), decision, reason);

  if (!cls) return null;
  if (decision === "approved") {
    db.prepare(`UPDATE clearance SET approvals = approvals + 1 WHERE action_class = ?`).run(cls);
  } else {
    // A denial resets earned trust and demotes if it had standing authority.
    db.prepare(
      `UPDATE clearance SET denials = denials + 1, approvals = 0,
        level = CASE WHEN level >= 3 THEN 2 ELSE level END,
        demoted_at = CASE WHEN level >= 3 THEN ? ELSE demoted_at END,
        demote_reason = CASE WHEN level >= 3 THEN ? ELSE demote_reason END
       WHERE action_class = ?`
    ).run(now(), reason, cls);
  }
  return cls;
}

/** The ceiling: reversible=0 can never exceed L2, however much trust accumulates. */
export function evaluatePromotion(cls: string): { promoted: boolean; why: string } {
  const c = db.prepare(`SELECT * FROM clearance WHERE action_class=?`).get(cls) as any;
  if (!c) return { promoted: false, why: "unknown class" };
  if (!c.reversible) return { promoted: false, why: "irreversible — capped at L2 forever" };
  if (c.level >= 3) return { promoted: false, why: "already at standing authority" };
  if (c.denials > 0) return { promoted: false, why: `${c.denials} denial(s) on record` };
  if (c.approvals < REQUIRED_APPROVALS)
    return { promoted: false, why: `${c.approvals}/${REQUIRED_APPROVALS} correct actions` };

  const order = db.prepare(
    `SELECT * FROM standing_orders WHERE ratified_at IS NOT NULL AND (scope LIKE ? OR scope LIKE '%all%')`
  ).get(`%${cls.split(".")[0]}%`) as any;
  if (!order) return { promoted: false, why: "no ratified standing order covers this scope" };

  db.prepare(`UPDATE clearance SET level=3, promoted_at=? WHERE action_class=?`).run(now(), cls);
  return { promoted: true, why: `earned by ${c.approvals} correct actions under "${order.rule}"` };
}

/** Which tools should be gated right now, given current clearance. */
export function gatedTools(): string[] {
  const rows = db.prepare(`SELECT * FROM clearance`).all() as any[];
  const byClass = new Map(rows.map((r) => [r.action_class, r]));
  const gated = Object.entries(TOOL_CLASS)
    .filter(([, cls]) => (byClass.get(cls)?.level ?? 0) < 3)
    .map(([tool]) => tool);
  return [...ALWAYS_GATED, ...gated];
}

/**
 * 🏆 The mechanic. Promotion rewrites the agent's OWN approval policy, server-side,
 * via PATCH /api/v1/sessions/{id}. The trust meter is not a UI decoration — it is
 * the governance config being edited live.
 */
export async function patchSessionPolicy(sessionId: string) {
  const agents = (await (await fetch(`${TF}/api/v1/agents`)).json()) as any;
  const agent = agents.data?.[0];
  if (!agent) throw new Error("no agent registered");

  const manifest = structuredClone(agent.manifest);
  manifest.mcp_servers[0].require_approval_for_tools = gatedTools();

  // 1) The live session, so the change takes effect immediately.
  const patch = await fetch(`${TF}/api/v1/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: { spec: manifest } }),
  });

  // 2) The saved agent, so every FUTURE session inherits it.
  //    Clearance is a durable property of the relationship, not of one conversation.
  const put = await fetch(`${TF}/api/v1/agents/${agent.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
  });

  return {
    session: patch.status,
    agent: put.status,
    gated: manifest.mcp_servers[0].require_approval_for_tools,
  };
}

/**
 * The database is the source of truth for clearance. On boot, force the saved agent's
 * approval policy to match it — otherwise a manifest left in a promoted state would
 * keep granting autonomy the ledger no longer justifies.
 */
export async function syncAgentPolicy() {
  try {
    const agents = (await (await fetch(`${TF}/api/v1/agents`)).json()) as any;
    const agent = agents.data?.[0];
    if (!agent) return { synced: false, reason: "no agent registered" };
    const manifest = structuredClone(agent.manifest);
    const want = gatedTools();
    const have = manifest.mcp_servers[0].require_approval_for_tools ?? [];
    if (JSON.stringify([...have].sort()) === JSON.stringify([...want].sort()))
      return { synced: true, changed: false, gated: want };
    manifest.mcp_servers[0].require_approval_for_tools = want;
    await fetch(`${TF}/api/v1/agents/${agent.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest }),
    });
    return { synced: true, changed: true, from: have, gated: want };
  } catch (e) {
    return { synced: false, reason: String(e) };
  }
}
