import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname as _dn, resolve as _rs } from "node:path";
config({ path: _rs(_dn(fileURLToPath(import.meta.url)), "../../.env") });
import express from "express";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./mcp.js";
import { db, now, id } from "./db.js";
import { recordDecision, evaluatePromotion, patchSessionPolicy, gatedTools, syncAgentPolicy } from "./control.js";
import { startIngest, drain } from "./ingest.js";
import { startSweep, lanes } from "./sweep.js";

const PORT = Number(process.env.PORT ?? 3333);
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
app.get("/api/loops", (_q, r) => r.json(db.prepare(`SELECT * FROM loops ORDER BY created_at DESC`).all()));
app.get("/api/clearance", (_q, r) => r.json(db.prepare(`SELECT * FROM clearance ORDER BY action_class`).all()));
app.get("/api/orders", (_q, r) => r.json(db.prepare(`SELECT * FROM standing_orders ORDER BY proposed_at DESC`).all()));
app.get("/api/dossier", (_q, r) => r.json(db.prepare(`SELECT * FROM dossier ORDER BY learned_at DESC`).all()));
app.get("/api/receipts", (_q, r) => r.json(db.prepare(`SELECT * FROM receipts ORDER BY id DESC LIMIT 100`).all()));
app.get("/api/captures", (_q, r) => r.json(db.prepare(`SELECT id,at,app,window_title,url,status FROM captures ORDER BY at DESC`).all()));
app.get("/health", (_q, r) => r.json({ ok: true }));

app.listen(PORT, async () => {
  console.log(`familiar-mcp  →  http://localhost:${PORT}/mcp`);
  console.log(`captures      →  ${CAPTURE_DIR}`);
  const sync = await syncAgentPolicy();
  console.log(`policy sync   →  ${JSON.stringify(sync)}`);
  startIngest();
});
