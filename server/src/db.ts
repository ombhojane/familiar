import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const path = process.env.SQLITE_PATH ?? "./data/familiar.db";
mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);

db.exec(`
PRAGMA journal_mode = WAL;

-- Raw captures from the HOLD client. The screenshot is evidence, kept on disk.
CREATE TABLE IF NOT EXISTS captures (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  app         TEXT,
  window_title TEXT,
  url         TEXT,
  image_path  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'unprocessed',  -- unprocessed | extracted | linked
  extraction  TEXT,                                  -- JSON from the perception model
  loop_id     TEXT
);

-- WHO YOU ARE. Read freely; every write is approval-gated.
CREATE TABLE IF NOT EXISTS dossier (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  source      TEXT,                 -- provenance. Always shown in the UI.
  learned_at  TEXT NOT NULL,
  approved_at TEXT
);

-- WHAT YOU DROPPED. Note: no 'overdue' column, by design.
CREATE TABLE IF NOT EXISTS loops (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL,        -- form | reply | intention | renewal | promise
  status      TEXT NOT NULL,        -- open | sweeping | prepared | awaiting_approval | done | held
  summary     TEXT,
  missing     TEXT,                 -- JSON array: what still needs answering
  deadline    TEXT,                 -- read off the screen when present
  evidence    TEXT,                 -- JSON: where we saw it
  capture_id  TEXT,
  created_at  TEXT NOT NULL,
  prepared_at TEXT
);

-- HOW TO TREAT YOU. The rules the agent authors and you ratify.
CREATE TABLE IF NOT EXISTS standing_orders (
  id           TEXT PRIMARY KEY,
  rule         TEXT NOT NULL,
  rationale    TEXT NOT NULL,
  scope        TEXT NOT NULL,       -- action class: payment.* | email.send | dns.*
  learned_from TEXT,                -- JSON array of receipt ids
  proposed_at  TEXT NOT NULL,
  ratified_at  TEXT,
  enforced_by  TEXT                 -- familiar | external (e.g. a provider-side policy)
);

-- EARNED AUTONOMY, per action class. reversible=0 means capped at L2 forever.
CREATE TABLE IF NOT EXISTS clearance (
  action_class  TEXT PRIMARY KEY,
  level         INTEGER NOT NULL DEFAULT 0,
  reversible    INTEGER NOT NULL DEFAULT 1,
  approvals     INTEGER NOT NULL DEFAULT 0,
  denials       INTEGER NOT NULL DEFAULT 0,
  promoted_at   TEXT,
  demoted_at    TEXT,
  demote_reason TEXT
);

-- APPEND-ONLY AUDIT. The collateral that makes the character legitimate.
CREATE TABLE IF NOT EXISTS receipts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  action   TEXT NOT NULL,
  args     TEXT NOT NULL,
  decision TEXT NOT NULL,          -- approved | denied | auto_l3
  reason   TEXT,                    -- the denial reason: our highest-value training signal
  outcome  TEXT,
  loop_id  TEXT
);
`);

// Action classes. reversible=0 => permanently capped at L2 (the ceiling rule).
const SEED: [string, number][] = [
  ["repo.describe", 1],    // reversible -> can reach L3
  ["memory.write", 1],     // reversible -> can reach L3
  ["release.publish", 0],  // IRREVERSIBLE -> capped at L2 forever
  ["email.send", 0],       // IRREVERSIBLE -> capped at L2 forever
  ["npm.publish", 0],      // IRREVERSIBLE -> capped at L2 forever
];
for (const [cls, rev] of SEED) {
  db.prepare(
    `INSERT INTO clearance (action_class, level, reversible)
     VALUES (?, 0, ?) ON CONFLICT(action_class) DO NOTHING`
  ).run(cls, rev);
}

export const now = () => new Date().toISOString();
export const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
