export type Loop = {
  id: string; title: string; kind: string; status: string;
  summary: string | null; missing: string; deadline: string | null;
  capture_id: string | null; created_at: string;
  prepared_note?: string | null; stakes?: string | null; effort_minutes?: number | null;
  triage?: { score: number; why: string[] };
};
export type Clearance = {
  action_class: string; level: number; reversible: number;
  approvals: number; denials: number; demote_reason: string | null;
};
export type Order = { id: string; rule: string; rationale: string; scope: string; ratified_at: string | null };
export type Fact = { key: string; value: string; source: string | null; learned_at: string };
export type Receipt = { id: number; at: string; action: string; decision: string; reason: string | null };
export type Capture = { id: string; at: string; app: string | null; window_title: string | null; url: string | null; status: string };

const j = <T,>(p: string) => fetch(p).then((r) => r.json() as Promise<T>);

export const getLoops     = () => j<Loop[]>("/api/loops");
export const getClearance = () => j<Clearance[]>("/api/clearance");
export const getOrders    = () => j<Order[]>("/api/orders");
export const getDossier   = () => j<Fact[]>("/api/dossier");
export const getReceipts  = () => j<Receipt[]>("/api/receipts");
export const getCaptures  = () => j<Capture[]>("/api/captures");

export const LEVELS = ["Observe", "Prepare", "Act with approval", "Standing authority"];

export type Lane = { threadId: string; name: string; done: boolean; output: string | null };

/** One subagent per open loop, all at once. Returns when they are all back. */
export const runSweep = () =>
  fetch("/api/sweep", { method: "POST" }).then(
    (r) => r.json() as Promise<{ loops: number; sessionId: string; lanes: Lane[] }>
  );

export const resumeLoop = (id: string) => fetch(`/api/loops/${id}/resume`, { method: "POST" }).then((r) => r.json());
export const setLoopStatus = (id: string, status: "done" | "dismissed") =>
  fetch(`/api/loops/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });

export type Usage = {
  totals: { tokens: number; usd: number; calls: number };
  bySource: { source: string; model: string; i: number; o: number; c: number; usd: number; calls: number }[];
  context: Record<string, number>;
};
export const getUsage = () => j<Usage>("/api/usage");

export type Activity = { state: "sweeping" | "preparing" | "idle"; unread: number; prepared: number };
export const getActivity = () => j<Activity>("/api/activity");
