import { config } from "dotenv";
import { resolve as _rs } from "node:path";
// In development the repo .env is authoritative. Inside the packaged app there is no
// .env: the desktop app passes OPENAI_API_KEY and the data paths through the environment.
if (!process.env.OPENAI_API_KEY) {
  config({ path: _rs(process.env.FAMILIAR_ENV ?? "../.env") });
}
import express from "express";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./mcp.js";
import { db, now, id } from "./db.js";
import { recordDecision, evaluatePromotion, patchSessionPolicy, gatedTools, syncAgentPolicy } from "./control.js";
import { startIngest, drain, isIngesting } from "./ingest.js";
import { startSweep, lanes, isSweeping } from "./sweep.js";
import { triage } from "./triage.js";
import { summary as usageSummary, harvestTurn } from "./usage.js";
import { startScheduler, schedulerStatus } from "./scheduler.js";
import { execFile } from "node:child_process";

const PORT = Number(process.env.PORT ?? 3333);
// Captures are full screenshots of whatever the user was looking at. Bind to loopback
// only: this is a local app, and there is no reason for a network peer to reach it.
const HOST = process.env.HOST ?? "127.0.0.1";
const CAPTURE_DIR = resolve(process.env.CAPTURE_DIR ?? "./captures");
mkdirSync(CAPTURE_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "50mb" }));

// ---- MCP endpoint (streamable HTTP, stateless). TrueForge dials this directly. ----
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_q, r) => r.status(405).end());
app.delete("/mcp", (_q, r) => r.status(405).end());

// ---- HOLD client posts here. Must return fast; extraction happens later. ----
app.post("/capture", (req, res) => {
  const { image, app: appName, windowTitle, url } = req.body ?? {};
  if (!image) return res.status(400).json({ error: "image (base64 png) required" });

  const cid = id("cap");
  const imagePath = join(CAPTURE_DIR, `${cid}.png`);
  writeFileSync(imagePath, Buffer.from(image, "base64"));

  db.prepare(
    `INSERT INTO captures (id, at, app, window_title, url, image_path) VALUES (?,?,?,?,?,?)`
  ).run(cid, now(), appName ?? null, windowTitle ?? null, url ?? null, imagePath);

  res.json({ ok: true, captureId: cid });
  void drain();   // pick it up immediately rather than waiting for the next tick
});

/**
 * The control plane sits IN the approval path. The UI sends its decision here, not
 * straight to TrueForge, so every approve/deny is recorded, clearance is recomputed,
 * and promotion rewrites the agent's own policy before the decision is forwarded.
 */
app.post("/api/decision", async (req, res) => {
  const { sessionId, toolCallId, toolName, decision, reason, args, threadId } = req.body ?? {};
  if (!sessionId || !toolCallId || !decision) {
    return res.status(400).json({ error: "sessionId, toolCallId and decision are required" });
  }

  const cls = recordDecision(toolName, decision, reason ?? null, args);
  const promotion = cls && decision === "approved" ? evaluatePromotion(cls) : null;

  let patched = null;
  if (promotion?.promoted) patched = await patchSessionPolicy(sessionId);

  // Forward the decision to TrueForge to resume the halted turn.
  const tf = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";
  const approval = decision === "approved"
    ? { status: "allow" }
    : { status: "deny", reason: reason ?? "denied" };
  const upstream = await fetch(`${tf}/api/v1/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: [{ type: "user.tool_approval",
      thread_id: threadId ?? "main", tool_call_id: toolCallId, approval }] }),
  });
  // Drain the resumed turn's stream so the caller knows it actually finished.
  // Without this the session is still running and the next turn is rejected 422.
  const resumed = await upstream.text();
  harvestTurn(resumed, "gpt-5.6-terra");

  res.json({
    recorded: cls ?? toolName,
    promotion,
    patched,
    gatedNow: gatedTools(),
    upstream: upstream.status,
    resumed,   // raw SSE of the resumed turn; the UI digests it to find the next gate
  });
});

app.post("/api/seed_order", (req, res) => {
  const { rule, rationale, scope } = req.body ?? {};
  const oid = id("order");
  db.prepare(`INSERT INTO standing_orders (id,rule,rationale,scope,proposed_at,ratified_at,enforced_by)
              VALUES (?,?,?,?,?,?,'familiar')`).run(oid, rule, rationale, scope, now(), now());
  res.json({ orderId: oid });
});

app.post("/api/sweep", async (_req, res) => {
  try {
    const out = await startSweep();
    res.json({ loops: out.loops, sessionId: out.sessionId, lanes: lanes(out.raw) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/gated", (_q, r) => r.json({ gated: gatedTools() }));

// ---- Read models for the web UI ----
app.get("/api/loops", (_q, r) => {
  const rows = db.prepare(`SELECT * FROM loops WHERE status NOT IN ('done','dismissed') ORDER BY created_at DESC`).all() as any[];
  const scored = rows.map((l) => ({ ...l, triage: triage(l) }));
  scored.sort((a, b) => b.triage.score - a.triage.score);
  r.json(scored);
});

// The screenshot is the evidence. Serving it is what makes "here's what I saw" real.
app.get("/api/captures/:id/image", (req, res) => {
  const c = db.prepare(`SELECT image_path FROM captures WHERE id=?`).get(req.params.id) as any;
  if (!c) return res.status(404).end();
  res.sendFile(c.image_path);
});

// Resume: reopen exactly where the user left off. The whole point of having captured it.
app.post("/api/loops/:id/resume", (req, res) => {
  const l = db.prepare(`SELECT capture_id FROM loops WHERE id=?`).get(req.params.id) as any;
  const c = l?.capture_id ? db.prepare(`SELECT url, app FROM captures WHERE id=?`).get(l.capture_id) as any : null;
  const target = c?.url ?? c?.app;
  if (!target) return res.status(404).json({ error: "nothing to reopen for this loop" });

  // Wait for `open` to actually succeed. Reporting ok:true for a missing app or a bad
  // URL tells the user they are back where they left off when they are not.
  execFile("open", c?.url ? [c.url] : ["-a", c.app], (err) => {
    if (err) return res.status(502).json({ error: `could not reopen: ${err.message}`, target });
    res.json({ ok: true, opened: target });
  });
});

app.post("/api/loops/:id/status", (req, res) => {
  const { status } = req.body ?? {};
  if (!["done", "dismissed", "open"].includes(status)) return res.status(400).json({ error: "bad status" });

  // Only write a receipt for a transition that actually happened. The ledger is presented
  // as an audit trail, so a repeated call or an unknown id must not forge an entry.
  const before = db.prepare(`SELECT status FROM loops WHERE id=?`).get(req.params.id) as any;
  if (!before) return res.status(404).json({ error: "no such loop" });

  const changed = before.status !== status;
  if (changed) db.prepare(`UPDATE loops SET status=? WHERE id=?`).run(status, req.params.id);
  if (changed && status === "done")
    db.prepare(`INSERT INTO receipts (at,action,args,decision,loop_id) VALUES (?,?,?,?,?)`)
      .run(now(), "loop.closed", JSON.stringify({ from: before.status }), "approved", req.params.id);

  res.json({ ok: true, changed });
});
app.get("/api/clearance", (_q, r) => r.json(db.prepare(`SELECT * FROM clearance ORDER BY action_class`).all()));
app.get("/api/orders", (_q, r) => r.json(db.prepare(`SELECT * FROM standing_orders ORDER BY proposed_at DESC`).all()));
app.get("/api/dossier", (_q, r) => r.json(db.prepare(`SELECT * FROM dossier ORDER BY learned_at DESC`).all()));
app.get("/api/receipts", (_q, r) => r.json(db.prepare(`SELECT * FROM receipts ORDER BY id DESC LIMIT 100`).all()));
app.get("/api/captures", (_q, r) => r.json(db.prepare(`SELECT id,at,app,window_title,url,status FROM captures ORDER BY at DESC`).all()));
/**
 * Config surface. TrueForge already owns connector state and OAuth; we present it
 * and deep-link into its authorize flow rather than rebuilding any of it.
 */
app.get("/api/config", async (_q, res) => {
  const tf = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";
  try {
    const [configured, catalog] = await Promise.all([
      fetch(`${tf}/api/v1/settings/mcp-servers`).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch(`${tf}/api/v1/catalogs/mcp-servers`).then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    const have = new Set((configured.data ?? []).map((c: any) => c.name));
    res.json({
      demoMode: process.env.DEMO_MODE === "live" ? "live" : "safe",
      schedule: schedulerStatus(),
      usage: usageSummary().totals,
      trueforge: tf,
      connected: (configured.data ?? []).map((c: any) => ({
        name: c.name,
        description: c.manifest?.description ?? "",
        auth: c.auth_status?.status ?? "unknown",
        authorizeUrl: `${tf}/api/v1/mcp-servers/${c.name}/authorize`,
      })),
      available: (catalog.data ?? [])
        .filter((c: any) => !have.has(c.name ?? c.manifest?.name))
        .map((c: any) => ({
          name: c.name ?? c.manifest?.name,
          description: c.description ?? c.manifest?.description ?? "",
        })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** What Familiar is doing right now — the creature reads this so it is alive
 *  even when nobody is clicking. Never invents activity it isn't doing. */
app.get("/api/activity", (_q, r) => {
  const unread = (db.prepare(`SELECT COUNT(*) n FROM captures WHERE status='unprocessed'`).get() as any).n;
  const prepared = (db.prepare(`SELECT COUNT(*) n FROM loops WHERE status='prepared'`).get() as any).n;
  r.json({
    state: isSweeping() ? "sweeping" : isIngesting() ? "preparing" : "idle",
    unread, prepared,
  });
});

app.get("/api/usage", (_q, r) => r.json(usageSummary()));

// Packaged, the dashboard is served from here (there is no vite in the .app).
// WEB_DIST is set by the desktop app; in dev this simply does not exist.
const webDist = process.env.WEB_DIST;
if (webDist) {
  app.use("/app", express.static(webDist));
  app.get("/app/*splat", (_q, r) => r.sendFile(join(webDist, "index.html")));
}

app.get("/health", (_q, r) => r.json({ ok: true }));

app.listen(PORT, HOST, async () => {
  console.log(`familiar-mcp  →  http://${HOST}:${PORT}/mcp  (loopback only)`);
  console.log(`captures      →  ${CAPTURE_DIR}`);
  const sync = await syncAgentPolicy();
  console.log(`policy sync   →  ${JSON.stringify(sync)}`);
  startIngest();
  startScheduler();
});
