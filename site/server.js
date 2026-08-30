import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const PORT = process.env.PORT || 8080;

createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  const file = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  try {
    const body = await readFile(join(process.cwd(), file));
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => console.log(`familiar site on :${PORT}`));
