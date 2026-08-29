/**
 * Triage — WSJF-shaped (cost of delay ÷ job size), deterministic, and explainable.
 * Every factor carries its evidence; the UI shows *why* something ranks where it does.
 * Deliberately absent: staleness. The board celebrates READY and never punishes LATE.
 */
export type Triaged = {
  score: number;                 // 0–100
  why: string[];                 // evidence, human-readable, in scoring order
};

const STAKES_W: Record<string, number> = {
  official: 1, money: 1, work: 0.7, social: 0.6, personal: 0.4, none: 0.3,
};

export function triage(loop: {
  deadline: string | null; stakes: string | null;
  status: string; effort_minutes: number | null;
}): Triaged {
  const why: string[] = [];

  let urgency = 0.15;
  if (loop.deadline) {
    // A model-produced or hand-edited date can be unparseable. NaN would poison the score
    // into null and silently destroy the board's ordering, so ignore it rather than trust it.
    const ts = new Date(loop.deadline).getTime();
    if (Number.isFinite(ts)) {
      const days = (ts - Date.now()) / 86400000;
      urgency = Math.min(14, Math.max(0, 14 - days)) / 14;
      why.push(days < 0 ? `deadline ${loop.deadline}` : `due in ${Math.max(0, Math.ceil(days))}d (read off the page)`);
    }
  }

  const sw = STAKES_W[loop.stakes ?? "none"] ?? 0.3;
  if (loop.stakes && loop.stakes !== "none") why.push(loop.stakes);

  const prepared = loop.status === "prepared";
  if (prepared) why.push("prepared — one tap from done");

  // Clamp: a negative estimate makes log2 non-finite and the whole score serialises as null.
  const mins = Math.min(600, Math.max(0, loop.effort_minutes ?? 30));
  const quickwin = 1 / Math.log2(2 + mins / 10);
  if (mins <= 15) why.push(`~${mins} min`);

  const score = Math.round(45 * urgency + 30 * sw + 15 * (prepared ? 1 : 0.5) + 10 * quickwin);
  return { score, why };
}
