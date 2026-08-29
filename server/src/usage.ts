import { db, now } from "./db.js";

/**
 * Token and cost accounting. TrueForge reports usage per model call and per turn;
 * total_cost_in_usd is only populated when the upstream returns it (i.e. through a
 * gateway), so with direct provider keys we price it ourselves from a small table.
 *
 * The interesting number is not the dollar figure — it is the input breakdown:
 * how much context went to the harness vs instructions vs tool definitions vs messages.
 */
const PRICE: Record<string, { in: number; out: number }> = {
  // USD per 1M tokens
  "gpt-5.6-terra": { in: 2.0, out: 12.0 },
  "gpt-5.6-luna": { in: 0.2, out: 1.2 },
  "gpt-5.6-sol": { in: 5.0, out: 30.0 },
};
const priceOf = (model: string) => {
  const key = Object.keys(PRICE).find((k) => model.includes(k.replace("gpt-5.6-", "")));
  return key ? PRICE[key] : { in: 2.0, out: 12.0 };
};

db.exec(`CREATE TABLE IF NOT EXISTS usage_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  source   TEXT NOT NULL,            -- perception | cognition
  model    TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read    INTEGER NOT NULL DEFAULT 0,
  usd      REAL NOT NULL DEFAULT 0,
  breakdown TEXT                     -- harness/skills/instructions/tool_definitions/messages
)`);

export function recordUsage(a: {
  source: "perception" | "cognition"; model: string;
  input: number; output: number; cacheRead?: number;
  breakdown?: Record<string, number> | null;
}) {
  const p = priceOf(a.model);
  const usd = (a.input / 1e6) * p.in + (a.output / 1e6) * p.out;
  db.prepare(
    `INSERT INTO usage_log (at,source,model,input_tokens,output_tokens,cache_read,usd,breakdown)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(now(), a.source, a.model, a.input, a.output, a.cacheRead ?? 0, usd,
        a.breakdown ? JSON.stringify(a.breakdown) : null);
}

/** Pull usage out of a turn's SSE stream. Fields are snake_case on the wire. */
export function harvestTurn(raw: string, model: string) {
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let e: any;
    try { e = JSON.parse(line.slice(5).trim()); } catch { continue; }

    if (e.type === "model.message" && e.usage) {
      recordUsage({
        source: "cognition", model,
        input: e.usage.input_tokens ?? 0,
        output: e.usage.output_tokens ?? 0,
        cacheRead: e.usage.cache_read_tokens ?? 0,
        breakdown: e.usage.input_tokens_breakdown ?? null,
      });
    }
  }
}

export function summary() {
  const rows = db.prepare(
    `SELECT source, model, SUM(input_tokens) i, SUM(output_tokens) o,
            SUM(cache_read) c, SUM(usd) usd, COUNT(*) calls
     FROM usage_log GROUP BY source, model`
  ).all() as any[];

  // Where did the context actually go? Averaged across cognition calls.
  const breakdowns = (db.prepare(`SELECT breakdown FROM usage_log WHERE breakdown IS NOT NULL`).all() as any[])
    .map((r) => { try { return JSON.parse(r.breakdown); } catch { return null; } })
    .filter(Boolean);
  const context: Record<string, number> = {};
  for (const b of breakdowns)
    for (const [k, v] of Object.entries(b)) context[k] = (context[k] ?? 0) + (v as number);

  const totals = rows.reduce((t, r) => ({
    tokens: t.tokens + r.i + r.o, usd: t.usd + r.usd, calls: t.calls + r.calls,
  }), { tokens: 0, usd: 0, calls: 0 });

  return { totals, bySource: rows, context };
}
