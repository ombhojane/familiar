const { app, globalShortcut, Tray, Menu, BrowserWindow, screen, nativeImage, shell, Notification } = require("electron");
const { join } = require("node:path");
const { capture } = require("./capture.js");

const SERVER = process.env.FAMILIAR_SERVER ?? "http://localhost:3333";
const DASHBOARD = process.env.FAMILIAR_DASHBOARD ?? "http://localhost:5173";

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
  win.once("ready-to-show", () => { win.show(); win.focus(); });
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

app.whenReady().then(() => {
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
  openWindow();

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

app.on("activate", openWindow);
app.on("will-quit", () => globalShortcut.unregisterAll());
// Closing the window must not quit: Familiar keeps listening for the hotkey.
app.on("window-all-closed", () => {});
