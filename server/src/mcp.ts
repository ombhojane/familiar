import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db, now, id } from "./db.js";
import { extract } from "./perception.js";
import * as act from "./actions.js";

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

/**
 * 🔴 EVERY tool is annotated. Without `annotations`, TrueForge's @write/@destructive
 * selectors match NOTHING and destructive tools execute silently ungated.
 *   readOnlyHint:true                        -> @read-only
 *   readOnlyHint:false, destructiveHint:false-> @write
 *   destructiveHint:true                     -> @destructive
 */
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true };

export function buildServer() {
  const s = new McpServer({ name: "familiar", version: "0.1.0" });

  // ---------- CAPTURES : perception ----------
  s.registerTool("capture_list", {
    description: "List captures the user saved with the HOLD hotkey that have not yet become loops.",
    inputSchema: {}, annotations: RO,
  }, async () => text(db.prepare(
    `SELECT id, at, app, window_title, url, status FROM captures WHERE status='unprocessed' ORDER BY at DESC`
  ).all()));

  s.registerTool("capture_extract", {
    description:
      "Read one saved screenshot with a cheap multimodal model and return what is literally on it: " +
      "what the thing is, which fields are filled or missing, any deadline PRINTED on the page, and the next step. " +
      "Optionally pass a question to re-read the same image looking for something specific.",
    inputSchema: { captureId: z.string(), question: z.string().optional() },
    annotations: RO,
  }, async ({ captureId, question }) => {
    const c = db.prepare(`SELECT * FROM captures WHERE id=?`).get(captureId) as any;
    if (!c) return text({ error: "no such capture" });
    const out = await extract(c.image_path, { app: c.app, windowTitle: c.window_title, url: c.url }, question);
    db.prepare(`UPDATE captures SET extraction=?, status='extracted' WHERE id=?`).run(JSON.stringify(out), captureId);
    return text(out);
  });

  // ---------- DOSSIER : who you are ----------
  s.registerTool("dossier_read", {
    description: "Read stored long-term facts about the user. Call this before doing anything.",
    inputSchema: { key: z.string().optional() }, annotations: RO,
  }, async ({ key }) => text(key
    ? db.prepare(`SELECT * FROM dossier WHERE key=?`).get(key) ?? null
    : db.prepare(`SELECT * FROM dossier ORDER BY learned_at DESC`).all()));

  s.registerTool("dossier_write", {
    description:
      "Remember a durable fact about the user. Requires their permission — ask plainly, in one line, " +
      "and always record where the fact came from.",
    inputSchema: { key: z.string(), value: z.string(), source: z.string() },
    annotations: WRITE,   // -> approval-gated
  }, async ({ key, value, source }) => {
    db.prepare(`INSERT INTO dossier (key,value,source,learned_at,approved_at) VALUES (?,?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, source=excluded.source, approved_at=excluded.approved_at`)
      .run(key, value, source, now(), now());
    return text(`remembered: ${key}`);
  });

  // ---------- LOOPS : what you dropped ----------
  s.registerTool("loops_list", {
    description: "The mission board: every open loop and its state.",
    inputSchema: { status: z.string().optional() }, annotations: RO,
  }, async ({ status }) => text(status
    ? db.prepare(`SELECT * FROM loops WHERE status=? ORDER BY created_at DESC`).all(status)
    : db.prepare(`SELECT * FROM loops ORDER BY created_at DESC`).all()));

  s.registerTool("loop_upsert", {
    description:
      "Create or update a loop on the mission board. Use after extracting a capture. " +
      "Check loops_list first — never create a duplicate of something already open.",
    inputSchema: {
      loopId: z.string().optional(), title: z.string(), kind: z.string(), status: z.string(),
      summary: z.string().optional(), missing: z.array(z.string()).optional(),
      deadline: z.string().optional(), captureId: z.string().optional(),
    },
    annotations: WRITE,   // deliberately NOT in require_approval_for_tools — board updates must never nag
  }, async (a) => {
    const lid = a.loopId ?? id("loop");
    db.prepare(`INSERT INTO loops (id,title,kind,status,summary,missing,deadline,capture_id,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status,
                  summary=excluded.summary, missing=excluded.missing, deadline=excluded.deadline`)
      .run(lid, a.title, a.kind, a.status, a.summary ?? null,
           JSON.stringify(a.missing ?? []), a.deadline ?? null, a.captureId ?? null, now());
    if (a.captureId) db.prepare(`UPDATE captures SET status='linked', loop_id=? WHERE id=?`).run(lid, a.captureId);
    return text({ loopId: lid });
  });

  // ---------- STANDING ORDERS : how to treat you ----------
  s.registerTool("orders_read", {
    description: "The standing orders: rules the user has ratified that constrain what you may do.",
    inputSchema: {}, annotations: RO,
  }, async () => text(db.prepare(`SELECT * FROM standing_orders ORDER BY proposed_at DESC`).all()));

  s.registerTool("order_propose", {
    description:
      "Propose a new standing order — a durable rule that will constrain you from now on. " +
      "Propose one after the user denies something, citing the denials that taught you. " +
      "The user must ratify it before it takes effect.",
    inputSchema: { rule: z.string(), rationale: z.string(), scope: z.string() },
    annotations: WRITE,   // -> approval-gated. This is the ratification beat.
  }, async ({ rule, rationale, scope }) => {
    const oid = id("order");
    db.prepare(`INSERT INTO standing_orders (id,rule,rationale,scope,proposed_at,ratified_at,enforced_by)
                VALUES (?,?,?,?,?,?,'familiar')`).run(oid, rule, rationale, scope, now(), now());
    return text({ orderId: oid, ratified: true });
  });

  // ---------- CLEARANCE : earned autonomy ----------
  s.registerTool("clearance_read", {
    description:
      "Your own clearance per action class. Level 3 means you may act alone inside a ratified rule. " +
      "Classes marked reversible=0 can NEVER exceed level 2, however much trust you earn.",
    inputSchema: {}, annotations: RO,
  }, async () => text(db.prepare(`SELECT * FROM clearance ORDER BY action_class`).all()));

  // ---------- ACTIONS : real, on systems the user owns ----------
  s.registerTool("act_repo_state", {
    description: "Current state of the user's repository, straight from GitHub. Use to check before and prove after.",
    inputSchema: {}, annotations: RO,
  }, async () => text(await act.repoState()));

  s.registerTool("act_repo_describe", {
    description:
      "Set the repository description. REVERSIBLE — it can be changed back at any time, " +
      "so this action class can earn standing authority.",
    inputSchema: { description: z.string() },
    annotations: WRITE,
  }, async ({ description }) => text(await act.setRepoDescription(description)));

  s.registerTool("act_release_publish", {
    description:
      "Publish a GitHub release. IRREVERSIBLE — it is public the moment it lands and the tag enters " +
      "repository history. This action class is capped at level 2 and can never earn standing authority.",
    inputSchema: { tag: z.string(), title: z.string(), notes: z.string() },
    annotations: DESTRUCTIVE,
  }, async ({ tag, title, notes }) => text(await act.publishRelease(tag, title, notes)));

  s.registerTool("act_release_verify", {
    description: "Confirm a release really exists, read straight from GitHub.",
    inputSchema: { tag: z.string() }, annotations: RO,
  }, async ({ tag }) => text(await act.verifyRelease(tag)));

  return s;
}
