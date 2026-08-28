const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { readFile, unlink } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const run = promisify(execFile);

const osa = (script) => run("osascript", ["-e", script], { timeout: 5000 }).then((r) => r.stdout.trim());

/** Frontmost app, its window title, and its bounds — so we crop to the window, not the whole screen. */
async function frontmost() {
  const script = `tell application "System Events"
  set p to first application process whose frontmost is true
  set appName to name of p
  set winTitle to ""
  set b to {0, 0, 0, 0}
  try
    set w to front window of p
    set winTitle to name of w
    set pos to position of w
    set sz to size of w
    set b to {item 1 of pos, item 2 of pos, item 1 of sz, item 2 of sz}
  end try
end tell
return appName & "|" & winTitle & "|" & (item 1 of b) & "," & (item 2 of b) & "," & (item 3 of b) & "," & (item 4 of b)`;
  const [app = "", title = "", bounds = ""] = (await osa(script)).split("|");
  const [x, y, w, h] = bounds.split(",").map(Number);
  return { app, title, rect: w > 40 && h > 40 ? { x, y, w, h } : null };
}

/** The URL, if the frontmost app is a browser. Best-effort across the common ones. */
async function browserUrl(app) {
  const chromium = ["Google Chrome", "Arc", "Brave Browser", "Microsoft Edge", "Dia"];
  try {
    if (chromium.includes(app)) return await osa(`tell application "${app}" to get URL of active tab of front window`);
    if (app === "Safari") return await osa(`tell application "Safari" to get URL of front document`);
  } catch {}
  return null;
}

/** One keystroke -> one frame -> one loop. Explicit and manual; never passive. */
async function capture() {
  const { app, title, rect } = await frontmost();
  const url = await browserUrl(app);
  const path = join(tmpdir(), `hold_${Date.now()}.png`);

  // Crop to the active window when we know it — smaller payload, faster extraction,
  // and it avoids capturing whatever else happens to be on screen.
  const args = rect
    ? ["-x", "-o", "-R", `${rect.x},${rect.y},${rect.w},${rect.h}`, path]
    : ["-x", path];
  await run("screencapture", args);

  const image = (await readFile(path)).toString("base64");
  await unlink(path).catch(() => {});
  return { image, app, windowTitle: title, url };
}

module.exports = { capture };
