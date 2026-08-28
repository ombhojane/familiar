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
});

// ---- Read models for the web UI ----
app.get("/api/loops", (_q, r) => r.json(db.prepare(`SELECT * FROM loops ORDER BY created_at DESC`).all()));
app.get("/api/clearance", (_q, r) => r.json(db.prepare(`SELECT * FROM clearance ORDER BY action_class`).all()));
app.get("/api/orders", (_q, r) => r.json(db.prepare(`SELECT * FROM standing_orders ORDER BY proposed_at DESC`).all()));
app.get("/api/dossier", (_q, r) => r.json(db.prepare(`SELECT * FROM dossier ORDER BY learned_at DESC`).all()));
app.get("/api/receipts", (_q, r) => r.json(db.prepare(`SELECT * FROM receipts ORDER BY id DESC LIMIT 100`).all()));
app.get("/api/captures", (_q, r) => r.json(db.prepare(`SELECT id,at,app,window_title,url,status FROM captures ORDER BY at DESC`).all()));
app.get("/health", (_q, r) => r.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`familiar-mcp  →  http://localhost:${PORT}/mcp`);
  console.log(`captures      →  ${CAPTURE_DIR}`);
});
