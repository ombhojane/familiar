const { app, globalShortcut, Tray, BrowserWindow, screen, nativeImage, shell } = require("electron");
const { join } = require("node:path");
const { capture } = require("./capture.js");

const SERVER = process.env.FAMILIAR_SERVER ?? "http://localhost:3333";
const HOTKEY = process.env.HOLD_HOTKEY ?? "CommandOrControl+Shift+Space";

let tray = null;
let hud = null;

/** A small, borderless toast. It must confirm instantly — the user is already leaving. */
function showHud(text, tone = "ok") {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  if (!hud) {
    hud = new BrowserWindow({
      width: 260, height: 64, x: Math.round(width / 2 - 130), y: 48,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false, focusable: false, hasShadow: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    hud.setIgnoreMouseEvents(true);
    hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  const color = tone === "ok" ? "#18181B" : "#B42318";
  hud.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`
    <style>
      :root { color-scheme: light; }
      body { margin:0; font:500 14px/1.3 Inter,-apple-system,system-ui,sans-serif;
             display:flex; align-items:center; gap:10px; height:64px; padding:0 18px;
             background:#FFFFFF; border:1px solid #E4E4E7; border-radius:10px;
             box-shadow:0 8px 24px rgba(0,0,0,.10); color:${color}; }
      .dot { width:8px; height:8px; border-radius:999px; background:${tone === "ok" ? "#155BD0" : "#B42318"}; flex:0 0 auto; }
      .t { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    </style>
    <div class="dot"></div><div class="t">${text}</div>`));
  hud.showInactive();
  clearTimeout(showHud._t);
  showHud._t = setTimeout(() => hud && hud.hide(), 1800);
}

async function hold() {
  try {
    showHud("holding your place…");
    const payload = await capture();
    const res = await fetch(`${SERVER}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    const { captureId } = await res.json();
    showHud(`held · ${payload.app || "screen"}`);
    console.log("captured", captureId, payload.app, payload.url ?? "");
  } catch (err) {
    showHud("couldn't hold that", "err");
    console.error(err);
  }
}

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.hide();

  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAWklEQVR4Ae3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvwZBQAABt+9pAgAAAABJRU5ErkJggg=="
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(`Familiar — ${HOTKEY} to hold your place`);
  tray.on("click", () => shell.openExternal("http://localhost:5173"));

  if (!globalShortcut.register(HOTKEY, hold)) {
    console.error(`Could not register ${HOTKEY} — another app may own it.`);
  } else {
    console.log(`HOLD ready. ${HOTKEY} captures the active window → ${SERVER}/capture`);
  }
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {});
