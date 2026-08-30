const { app, globalShortcut, Tray, Menu, BrowserWindow, screen, nativeImage, shell, Notification, ipcMain, safeStorage } = require("electron");
const { readFileSync: rfs, writeFileSync: wfs } = require("node:fs");
const services = require("./services.js");
const { join } = require("node:path");
const { capture } = require("./capture.js");

const PACKAGED = app.isPackaged;
const SERVER = process.env.FAMILIAR_SERVER ?? "http://127.0.0.1:3333";
// Packaged, the dashboard is served by the bundled server; in dev it is the vite server.
const DASHBOARD = process.env.FAMILIAR_DASHBOARD ?? (PACKAGED ? "http://127.0.0.1:3333/app/" : "http://localhost:5173");

/**
 * Hotkey candidates, most-preferred first.
 * ⌘⇧Space is NOT usable: macOS binds it to input-source / Character Viewer, and it
 * swallows the key before Electron sees it — register() still returns true, so the
 * app looks healthy while doing nothing. These are all outside macOS's default map.
 */
const HOTKEYS = [
  process.env.HOLD_HOTKEY,
  "Control+Alt+Command+H",   // ⌃⌥⌘H — "hold"
  "Control+Alt+Command+K",
  "Control+Shift+Alt+H",
  "F13",
].filter(Boolean);

let tray = null, hud = null, win = null, activeKey = null, lastHeld = null;

const pretty = (k) => k
  .replace("CommandOrControl", "⌘").replace("Command", "⌘")
  .replace("Control", "⌃").replace("Alt", "⌥").replace("Shift", "⇧")
  .replace(/\+/g, "");

function showHud(text, tone = "ok") {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  if (!hud) {
    hud = new BrowserWindow({
      width: 280, height: 68, x: Math.round(width / 2 - 140), y: 52,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false, focusable: false, hasShadow: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    hud.setIgnoreMouseEvents(true);
    hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  const accent = tone === "ok" ? "#155BD0" : "#B42318";
  hud.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`
    <style>
      body { margin:0; font:500 14px/1.35 Inter,-apple-system,system-ui,sans-serif;
             display:flex; align-items:center; gap:11px; height:68px; padding:0 18px;
             background:#fff; border:1px solid #E4E4E7; border-radius:12px;
             box-shadow:0 10px 30px rgba(0,0,0,.12); color:#18181B; }
      .d { width:9px; height:9px; border-radius:999px; background:${accent}; flex:0 0 auto; }
      .t { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    </style><div class="d"></div><div class="t">${text}</div>`));
  hud.showInactive();
  clearTimeout(showHud._t);
  showHud._t = setTimeout(() => hud && hud.hide(), 1900);
}

async function hold() {
  try {
    showHud("holding your place…");
    const payload = await capture();
    const res = await fetch(`${SERVER}/capture`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    const { captureId } = await res.json();
    lastHeld = { at: new Date(), app: payload.app, id: captureId };
    showHud(`held · ${payload.app || "screen"}`);
    buildMenu();
    console.log("held", captureId, payload.app, payload.url ?? "");
  } catch (err) {
    showHud(String(err.message || err).includes("fetch") ? "familiar server not running" : "couldn't hold that", "err");
    console.error(err);
  }
}

/** The real window. The dashboard is the desktop app's own surface, not a browser tab. */
function openWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 940, minHeight: 620,
    title: "Familiar",
    titleBarStyle: "hiddenInset",           // native traffic lights, no chrome bar
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#FFFFFF",
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.loadURL(DASHBOARD);
  win.once("ready-to-show", () => { console.log("dashboard window shown"); win.show(); win.focus(); });
  win.on("closed", () => { win = null; });
}

function buildMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: activeKey ? `Hold my place    ${pretty(activeKey)}` : "Hold my place (no hotkey)", click: hold },
    { type: "separator" },
    { label: lastHeld ? `Last held: ${lastHeld.app} · ${lastHeld.at.toLocaleTimeString()}` : "Nothing held yet", enabled: false },
    { label: activeKey ? `Hotkey: ${pretty(activeKey)}` : "⚠ No hotkey could be registered", enabled: false },
    { type: "separator" },
    { label: "Open Familiar", accelerator: "Command+O", click: openWindow },
    { label: "Open in browser", click: () => shell.openExternal(DASHBOARD) },
    { type: "separator" },
    { label: "Quit Familiar", role: "quit" },
  ]));
}

/** The key is stored encrypted with the OS keychain when available. */
const keyPath = () => require("node:path").join(app.getPath("userData"), "key.bin");
function saveKey(k) {
  try {
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(k) : Buffer.from(k, "utf8");
    wfs(keyPath(), buf);
  } catch {}
}
function loadKey() {
  try {
    const buf = rfs(keyPath());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
  } catch { return null; }
}

let onboarding = null;
function openOnboarding() {
  onboarding = new BrowserWindow({
    width: 520, height: 520, resizable: false, titleBarStyle: "hiddenInset",
    backgroundColor: "#FFFFFF", show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  onboarding.loadFile(join(__dirname, "onboarding.html"));
  onboarding.once("ready-to-show", () => { console.log("onboarding window shown"); onboarding.show(); });
  onboarding.on("closed", () => { onboarding = null; });
}

async function boot(key) {
  process.env.FAMILIAR_OPENAI_KEY = key;
  const status = (t) => onboarding && !onboarding.isDestroyed() && onboarding.webContents.send("familiar:status", t);
  const out = await services.start(status);
  if (!out.ok) {
    onboarding && !onboarding.isDestroyed() && onboarding.webContents.send("familiar:error", out.error);
    return false;
  }
  saveKey(key);
  if (onboarding && !onboarding.isDestroyed()) onboarding.close();
  openWindow();
  return true;
}

ipcMain.on("familiar:start", (_e, key) => { void boot(key); });

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.hide();

  const icon = nativeImage.createFromPath(join(__dirname, "..", "assets", "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);

  for (const key of HOTKEYS) {
    // register() can return true for a combo macOS already owns, so prefer combos
    // outside its default map rather than trusting the return value alone.
    if (globalShortcut.register(key, hold) && globalShortcut.isRegistered(key)) { activeKey = key; break; }
  }

  tray.setToolTip(activeKey ? `Familiar — ${pretty(activeKey)} to hold your place` : "Familiar — no hotkey registered");
  buildMenu();
  tray.on("double-click", openWindow);

  if (!PACKAGED) { openWindow(); }              // dev: services already running via dev.sh
  else {
    const saved = loadKey();
    openOnboarding();
    if (saved) {
      onboarding.webContents.once("did-finish-load", () => {
        onboarding.webContents.send("familiar:ready-check");
        void boot(saved);
      });
    }
  }

  if (activeKey) {
    console.log(`HOLD ready.  ${pretty(activeKey)}  (${activeKey})  →  ${SERVER}/capture`);
    new Notification({
      title: "Familiar is listening",
      body: `Press ${pretty(activeKey)} anywhere to hold your place.`,
      silent: true,
    }).show();
  } else {
    console.error("No hotkey could be registered. Use the menu-bar item to hold manually.");
  }
});

/**
 * The proactive layer — with a zero-annoyance budget. Exactly two triggers:
 *   1. a loop BECOMES prepared (work finished on your behalf — worth one ping)
 *   2. a prepared loop's deadline is within 72h (once per loop, ever)
 * Never on staleness. Never repeats. The board shows ready, never late.
 */
const { app: electronApp } = require("electron");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join: pathJoin, dirname: pathDirname } = require("node:path");

// "Once per loop, ever" has to survive a restart. An in-memory Set meant every prepared
// loop with a near deadline warned again the first time HOLD reopened.
const STATE_FILE = pathJoin(electronApp.getPath("userData"), "notified.json");
function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return { prepared: [], deadline: [] }; }
}
function saveState(s) {
  try {
    mkdirSync(pathDirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch {}
}
const persisted = loadState();
const seenPrepared = new Set(persisted.prepared ?? []);
const warnedDeadline = new Set(persisted.deadline ?? []);
const persist = () =>
  saveState({ prepared: [...seenPrepared], deadline: [...warnedDeadline] });

// Only suppress the very first poll of a fresh install, where everything looks new.
let firstPoll = seenPrepared.size === 0;

async function pollLoops() {
  try {
    const res = await fetch(`${SERVER}/api/loops`);
    if (!res.ok) return;
    const loops = await res.json();
    for (const l of loops) {
      if (l.status === "prepared" && !seenPrepared.has(l.id)) {
        seenPrepared.add(l.id);
        persist();
        if (!firstPoll) {
          new Notification({
            title: "Ready for you",
            body: `${l.title} — prepared. One tap to finish.`,
            silent: true,
          }).on("click", openWindow).show();
        }
      }
      if (l.deadline && l.status === "prepared" && !warnedDeadline.has(l.id)) {
        const days = (new Date(l.deadline) - Date.now()) / 86400000;
        if (days >= 0 && days <= 3) {
          warnedDeadline.add(l.id);
          persist();
          new Notification({
            title: `Due in ${Math.max(1, Math.ceil(days))} day${days > 1 ? "s" : ""}`,
            body: `${l.title} is prepared and waiting.`,
            silent: false,
          }).on("click", openWindow).show();
        }
      }
    }
    firstPoll = false;
    persist();
  } catch {}
}
setInterval(pollLoops, 30000);
pollLoops();

app.on("activate", openWindow);
app.on("will-quit", () => { globalShortcut.unregisterAll(); services.stop(); });
// Closing the window must not quit: Familiar keeps listening for the hotkey.
app.on("window-all-closed", () => {});
