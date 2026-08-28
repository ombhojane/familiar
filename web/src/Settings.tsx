import { useEffect, useState } from "react";

type Config = {
  demoMode: string; trueforge: string;
  connected: { name: string; description: string; auth: string; authorizeUrl: string }[];
  available: { name: string; description: string }[];
};

/** Connectors live in TrueForge; we present them and hand off to its own flows.
 *  "Connect" for a catalog server opens TrueForge's UI (auth setup is its job);
 *  an OAuth-pending configured server deep-links straight into authorize. */
export function Settings({ hotkey = "⌃⌥⌘H" }: { hotkey?: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  useEffect(() => { fetch("/api/config").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);

  if (!cfg) return <p className="empty">Loading configuration…</p>;

  return (
    <div className="settings">
      <section>
        <h3 className="drawer-h3">This Familiar</h3>
        <div className="kv"><span>Hold hotkey</span><span className="mono">{hotkey}</span></div>
        <div className="kv"><span>Mode</span>
          <span className={cfg.demoMode === "live" ? "mode live" : "mode"}>
            {cfg.demoMode === "live" ? "live — real actions" : "safe — dry runs only"}
          </span>
        </div>
      </section>

      <section>
        <h3 className="drawer-h3">Connected</h3>
        {cfg.connected.map((c) => (
          <div className="conn" key={c.name}>
            <span className="dot ok" />
            <div className="conn-body">
              <span className="mono">{c.name}</span>
              <span className="muted small">{c.description.slice(0, 90)}</span>
            </div>
            {c.auth === "pending" && (
              <a href={c.authorizeUrl} target="_blank" rel="noreferrer"><button>Authorize</button></a>
            )}
          </div>
        ))}
      </section>

      <section>
        <h3 className="drawer-h3">Available to connect</h3>
        {cfg.available.map((c) => (
          <div className="conn" key={c.name}>
            <span className="dot" />
            <div className="conn-body">
              <span className="mono">{c.name}</span>
              <span className="muted small">{c.description.slice(0, 90)}</span>
            </div>
            <a href={cfg.trueforge} target="_blank" rel="noreferrer"><button>Connect</button></a>
          </div>
        ))}
      </section>
    </div>
  );
}
