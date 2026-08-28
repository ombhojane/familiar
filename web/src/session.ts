/** Talks to TrueForge for the conversation, and to the control plane for decisions.
 *  Decisions never go straight to TrueForge — the control plane has to see them. */

export type Pending = {
  kind: "approval" | "question";
  toolCallId: string;
  threadId: string;
  toolName: string | null;
  args: Record<string, unknown> | null;
};

export type TurnResult = {
  said: string;
  toolsCalled: string[];
  pending: Pending | null;
};

const TF = "/tf";

function parseEvents(raw: string) {
  const out: any[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:") && line.slice(5).trim()) {
      try { out.push(JSON.parse(line.slice(5).trim())); } catch {}
    }
  }
  return out;
}

function digest(evs: any[]): TurnResult {
  let said = "";
  const toolsCalled: string[] = [];

  for (const e of evs) {
    if (e.type === "model.message.delta" && typeof e.content === "string") said += e.content;
    if (e.type === "model.message") {
      for (const tc of e.toolCalls ?? []) {
        const n = tc.toolInfo?.name;
        if (n) toolsCalled.push(n);
      }
    }
  }

  /** Find the tool call by id anywhere in the turn. source_event_id is not always
   *  resolvable once deltas have been merged, so scan every message instead. */
  /** Tool calls stream in fragments: the first delta carries the id and name, later
   *  deltas carry only `index` plus the next slice of the JSON arguments. Accumulate
   *  by index, then look up by id. */
  // `index` restarts at 0 for every assistant message, so scope it by the message id
  // the delta patches — otherwise fragments from different calls merge together.
  const calls = new Map<string, { id?: string; name?: string; args: string }>();
  for (const e of evs) {
    for (const c of e.toolCalls ?? e.tool_calls ?? []) {
      const idx = `${e.id}:${c.index ?? 0}`;
      const slot = calls.get(idx) ?? { args: "" };
      if (c.id) slot.id = c.id;
      const name = c.toolInfo?.name ?? c.tool_info?.name ?? c.function?.name;
      if (name) slot.name = name;
      const frag = c.function?.arguments;
      if (typeof frag === "string") slot.args += frag;
      else if (frag && typeof frag === "object") slot.args = JSON.stringify(frag);
      calls.set(idx, slot);
    }
  }
  const findCall = (id: string) => [...calls.values()].find((c) => c.id === id) ?? null;

  const resolve = (e: any, kind: Pending["kind"]): Pending => {
    const ref = e.tool_calls[0];
    const c = findCall(ref.id);
    let args: Record<string, unknown> | null = null;
    try { args = c?.args ? JSON.parse(c.args) : null; } catch { args = null; }
    return {
      kind,
      toolCallId: ref.id,
      threadId: e.thread_id ?? "main",
      toolName: c?.name ?? null,
      args,
    };
  };

  for (const e of evs) {
    if (e.type === "tool.approval_required") return { said, toolsCalled, pending: resolve(e, "approval") };
    if (e.type === "tool.response_required") return { said, toolsCalled, pending: resolve(e, "question") };
  }
  return { said, toolsCalled, pending: null };
}

export const digestRaw = (raw: string) => digest(parseEvents(raw));

export async function newSession(): Promise<string> {
  const r = await fetch(`${TF}/api/v1/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: { name: "familiar" } }),
  });
  return (await r.json()).data.id;
}

async function postTurn(sessionId: string, input: unknown[]): Promise<TurnResult> {
  const r = await fetch(`${TF}/api/v1/sessions/${sessionId}/turns`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!r.ok) throw new Error(`turn failed: ${r.status}`);
  return digest(parseEvents(await r.text()));
}

export const say = (sessionId: string, content: string) =>
  postTurn(sessionId, [{ type: "user.message", content }]);

export const answer = (sessionId: string, p: Pending, content: string) =>
  postTurn(sessionId, [{ type: "user.tool_response", thread_id: p.threadId, tool_call_id: p.toolCallId, content }]);

/** Approvals and denials go through the control plane so the receipt is written,
 *  clearance recomputed, and policy rewritten before TrueForge ever sees the answer. */
export async function decide(
  sessionId: string, p: Pending, decision: "approved" | "denied", reason?: string
) {
  const r = await fetch("/api/decision", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId, toolCallId: p.toolCallId, threadId: p.threadId,
      toolName: p.toolName, decision, reason, args: p.args,
    }),
  });
  return r.json() as Promise<{
    recorded: string;
    promotion: { promoted: boolean; why: string } | null;
    patched: { gated: string[] } | null;
    gatedNow: string[];
    resumed: string;
  }>;
}
