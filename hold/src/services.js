/**
 * In development the pieces are started by scripts/dev.sh. Inside the packaged app
 * there is no terminal, so Familiar starts and supervises them itself:
 *   familiar-mcp   — the bundled server (needs system node: it uses node:sqlite, which
 *                    Electron's older bundled Node does not have)
 *   trueforge      — the harness, via npx
 */
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");
const { join } = require("node:path");
const { existsSync } = require("node:fs");
const run = promisify(execFile);

const SERVER_PORT = 3333;
const TF_PORT = 8790;
const children = [];

/** GUI apps do not inherit a login shell's PATH, so node/npx are usually not on it. */
async function loginPath() {
  try {
    const { stdout } = await run(process.env.SHELL || "/bin/zsh", ["-ilc", "echo $PATH"], { timeout: 8000 });
    return stdout.trim();
  } catch { return process.env.PATH || ""; }
}

async function which(bin, PATH) {
  for (const dir of PATH.split(":")) {
    const p = join(dir, bin);
    if (dir && existsSync(p)) return p;
  }
  return null;
}

const alive = (port) =>
  fetch(`http://127.0.0.1:${port}/${port === TF_PORT ? "api/v1/capabilities" : "health"}`, {
    signal: AbortSignal.timeout(1500),
  }).then((r) => r.ok).catch(() => false);

async function waitFor(port, seconds = 120) {
  for (let i = 0; i < seconds; i++) {
    if (await alive(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function start(onStatus) {
  const PATH = await loginPath();
  const node = await which("node", PATH);
  const npx = await which("npx", PATH);
  if (!node || !npx) {
    return { ok: false, error: "Node.js 22 or newer is required. Install it from nodejs.org, then reopen Familiar." };
  }

  const env = {
    ...process.env, PATH,
    OPENAI_API_KEY: process.env.FAMILIAR_OPENAI_KEY || "",
    SQLITE_PATH: join(app.getPath("userData"), "familiar.db"),
    CAPTURE_DIR: join(app.getPath("userData"), "captures"),
    TRUEFORGE_BASE_URL: `http://127.0.0.1:${TF_PORT}`,
    PORT: String(SERVER_PORT),
    WEB_DIST: join(__dirname, "..", "web-dist"),
  };

  if (!(await alive(TF_PORT))) {
    onStatus("Starting the agent harness… (first run downloads it, ~1 min)");
    const tf = spawn(npx, ["-y", "@truefoundry/trueforge@latest"], { env, stdio: "ignore", detached: false });
    children.push(tf);
    if (!(await waitFor(TF_PORT, 240)))
      return { ok: false, error: "The agent harness did not start. Check your connection and reopen Familiar." };
  }

  if (!(await alive(SERVER_PORT))) {
    onStatus("Starting Familiar…");
    const srv = spawn(node, [join(__dirname, "..", "server-bundle", "server.cjs")], { env, stdio: "ignore" });
    children.push(srv);
    if (!(await waitFor(SERVER_PORT, 60)))
      return { ok: false, error: "Familiar's own service did not start." };
  }

  onStatus("Connecting…");
  return { ok: true };
}

const stop = () => children.forEach((c) => { try { c.kill(); } catch {} });

module.exports = { start, stop, SERVER_PORT, TF_PORT };
