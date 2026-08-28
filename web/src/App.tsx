import { useEffect, useRef, useState } from "react";
import { Familiar, type CreatureState } from "./Familiar";
import {
  getLoops, getClearance, getOrders, getDossier, getReceipts, getCaptures,
  LEVELS, runSweep, type Loop, type Clearance, type Order, type Fact, type Receipt, type Capture, type Lane,
} from "./api";
import { Gate } from "./Gate";
import { newSession, say, answer, decide, digestRaw, type Pending, type TurnResult } from "./session";
import "./app.css";

const useLive = <T,>(fn: () => Promise<T>, initial: T, ms = 2000) => {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    let alive = true;
    const tick = () => fn().then((d) => alive && setV(d)).catch(() => {});
    tick();
    const t = setInterval(tick, ms);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return v;
};

export function App() {
  const loops = useLive<Loop[]>(getLoops, []);
  const clearance = useLive<Clearance[]>(getClearance, []);
  const orders = useLive<Order[]>(getOrders, []);
  const dossier = useLive<Fact[]>(getDossier, []);
  const receipts = useLive<Receipt[]>(getReceipts, []);
  const captures = useLive<Capture[]>(getCaptures, []);

  const [state, setState] = useState<CreatureState>("idle");
  const [pending, setPending] = useState<Pending | null>(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lanes, setLanes] = useState<Lane[] | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const sid = useRef<string | null>(null);

  const top = Math.max(0, ...clearance.map((c) => c.level));
  const unprocessed = captures.filter((c) => c.status === "unprocessed").length;

  const ensure = async () => (sid.current ??= await newSession());

  const apply = (r: TurnResult) => {
    if (r.said) setSaid(r.said);
    setPending(r.pending);
    setState(r.pending ? "asking" : "idle");
  };

  const run = async (fn: () => Promise<TurnResult>, working: CreatureState = "preparing") => {
    setBusy(true); setState(working);
    try { apply(await fn()); }
    catch (e) { setSaid(String(e)); setState("idle"); }
    finally { setBusy(false); }
  };

  const send = (text: string) => run(async () => say(await ensure(), text), "sweeping");

  const sweep = async () => {
    setSweeping(true); setState("sweeping"); setLanes([]);
    try {
      const out = await runSweep();
      setLanes(out.lanes);
      setSaid(out.loops ? `${out.lanes.length} field agents came back.` : "Nothing open to sweep.");
    } catch (e) { setSaid(String(e)); }
    finally { setSweeping(false); setState("idle"); }
  };

  const onDecide = async (d: "approved" | "denied", reason?: string) => {
    if (!pending) return;
    setBusy(true);
    setState(d === "approved" ? "approved" : "denied");
    try {
      const out = await decide(sid.current!, pending, d, reason);
      if (out.promotion?.promoted) setToast(`Standing authority earned — ${out.promotion.why}`);
      // The resumed turn may itself stop at another gate (e.g. ratifying a new rule).
      // Read it from the stream the control plane already has; do not send a new message.
      apply(digestRaw(out.resumed ?? ""));
    } catch (e) {
      setSaid(String(e));
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 6000);
    }
  };

  const onAnswer = (text: string) =>
    run(async () => answer(sid.current!, pending!, text));

  const desktop = typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);

  return (
    <div className={desktop ? "shell desktop" : "shell"}>
      {desktop && <div className="titlebar" />}
      <MissionBoard loops={loops} pending={unprocessed} />
      <Stage
        state={state} clearance={top} loops={loops} receipts={receipts}
        said={said} busy={busy} onSend={send}
        lanes={lanes} sweeping={sweeping} onSweep={sweep}
        onRead={unprocessed > 0 ? () => send("A capture arrived from HOLD. Read it and put it on the mission board.") : null}
      />
      <Knows clearance={clearance} orders={orders} dossier={dossier} />
      {pending && (
        <Gate key={pending.toolCallId} pending={pending} onDecide={onDecide} onAnswer={onAnswer} busy={busy} />
      )}
      {toast && <div className="toast">🏆 {toast}</div>}
    </div>
  );
}

function MissionBoard({ loops, pending }: { loops: Loop[]; pending: number }) {
  return (
    <aside className="rail">
      <header className="rail-head">
        <h2>Mission board</h2>
        <span className="count num">{loops.length}</span>
      </header>
      {pending > 0 && (
        <div className="pending">{pending} capture{pending > 1 ? "s" : ""} waiting to be read</div>
      )}
      <div className="stack">
        {loops.length === 0 && (
          <p className="empty">Nothing held yet. Press ⌘⇧Space anywhere to hold your place.</p>
        )}
        {loops.map((l) => {
          const missing: string[] = JSON.parse(l.missing || "[]");
          return (
            <article key={l.id} className="loop">
              <div className="loop-top">
                <h3>{l.title}</h3>
                <span className={`chip ${l.status}`}>{l.status}</span>
              </div>
              {l.summary && <p className="muted">{l.summary}</p>}
              {l.deadline && (
                <p className="deadline">
                  <span className="mono">{l.deadline}</span>
                  <span className="muted"> · read off the page</span>
                </p>
              )}
              {missing.length > 0 && (
                <ul className="missing">
                  {missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function Stage({
  state, clearance, loops, receipts, said, busy, onSend, onRead, lanes, sweeping, onSweep,
}: {
  state: CreatureState; clearance: number; loops: Loop[]; receipts: Receipt[];
  said: string; busy: boolean; onSend: (t: string) => void; onRead: (() => void) | null;
  lanes: Lane[] | null; sweeping: boolean; onSweep: () => void;
}) {
  const [draft, setDraft] = useState("");
  const ready = loops.filter((l) => l.status === "prepared").length;

  return (
    <main className="stage">
      <div className="creature">
        <Familiar state={state} clearance={clearance} size={120} />
        <p className="creature-line">
          {said || (ready > 0 ? `${ready} ready for you.` : "Nothing needs you right now.")}
        </p>
        <div className="stage-actions">
          {onRead && !busy && <button className="primary" onClick={onRead}>Read what I held</button>}
          {loops.some((l) => l.status !== "prepared") && (
            <button onClick={onSweep} disabled={sweeping || busy}>
              {sweeping ? "Field agents out…" : "Sweep the board"}
            </button>
          )}
        </div>
      </div>

      <form
        className="composer"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onSend(draft); setDraft(""); } }}
      >
        <input
          value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy}
          placeholder="Ask it to do something…" aria-label="Message your Familiar"
        />
        <button className="primary" type="submit" disabled={busy || !draft.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </form>

      {lanes && lanes.length > 0 && (
        <section className="lanes">
          <header className="rail-head">
            <h2>Field agents</h2>
            <span className="count num">{lanes.filter((l) => l.done).length}/{lanes.length}</span>
          </header>
          {lanes.map((l) => (
            <div key={l.threadId} className={`lane ${l.done ? "done" : "live"}`}>
              <div className="lane-bar"><span /></div>
              <div className="lane-body">
                <span className="mono lane-name">{l.name}</span>
                {l.output && <span className="muted small">{l.output.slice(0, 96)}</span>}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="ledger">
        <header className="rail-head"><h2>Receipts</h2><span className="count num">{receipts.length}</span></header>
        {receipts.length === 0 && <p className="empty">Every decision leaves a receipt.</p>}
        <table className="mono">
          <tbody>
            {receipts.slice(0, 12).map((r) => (
              <tr key={r.id}>
                <td className="t">{r.at.slice(11, 19)}</td>
                <td>{r.action}</td>
                <td className={r.decision === "denied" ? "no" : "yes"}>{r.decision}</td>
                <td className="reason">{r.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Knows({
  clearance, orders, dossier,
}: { clearance: Clearance[]; orders: Order[]; dossier: Fact[] }) {
  return (
    <aside className="rail right">
      <header className="rail-head"><h2>Clearance</h2></header>
      <div className="stack">
        {clearance.map((c) => (
          <div key={c.action_class} className="clr">
            <div className="clr-top">
              <span className="mono">{c.action_class}</span>
              <span className="lvl num">L{c.level}{!c.reversible && <span className="cap" title="Cannot be undone — will always ask"> ⊤</span>}</span>
            </div>
            <div className="clr-meta">
              <span className="muted">{LEVELS[c.level]}</span>
              {c.reversible
                ? <span className="muted">earned by {c.approvals} correct action{c.approvals === 1 ? "" : "s"}</span>
                : <span className="muted">capped at L2 — irreversible</span>}
            </div>
          </div>
        ))}
      </div>

      <header className="rail-head"><h2>Standing orders</h2><span className="count num">{orders.length}</span></header>
      <div className="stack">
        {orders.length === 0 && <p className="empty">Rules you ratify appear here.</p>}
        {orders.map((o) => (
          <div key={o.id} className="order">
            <p className="rule">{o.rule}</p>
            <p className="muted small">{o.rationale}</p>
          </div>
        ))}
      </div>

      <header className="rail-head"><h2>Dossier</h2><span className="count num">{dossier.length}</span></header>
      <div className="stack">
        {dossier.length === 0 && <p className="empty">Facts it asked to keep.</p>}
        {dossier.map((f) => (
          <div key={f.key} className="fact">
            <div className="fact-top"><span className="mono">{f.key}</span><span>{f.value}</span></div>
            {f.source && <p className="muted small">{f.source}</p>}
          </div>
        ))}
      </div>
    </aside>
  );
}
