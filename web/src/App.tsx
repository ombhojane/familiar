import { useEffect, useState } from "react";
import { Familiar, type CreatureState } from "./Familiar";
import {
  getLoops, getClearance, getOrders, getDossier, getReceipts, getCaptures,
  LEVELS, type Loop, type Clearance, type Order, type Fact, type Receipt, type Capture,
} from "./api";
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
  const [state] = useState<CreatureState>("idle");

  const top = Math.max(0, ...clearance.map((c) => c.level));
  const unprocessed = captures.filter((c) => c.status === "unprocessed").length;

  return (
    <div className="shell">
      <MissionBoard loops={loops} pending={unprocessed} />
      <Stage state={state} clearance={top} loops={loops} receipts={receipts} />
      <Knows clearance={clearance} orders={orders} dossier={dossier} />
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
  state, clearance, loops, receipts,
}: { state: CreatureState; clearance: number; loops: Loop[]; receipts: Receipt[] }) {
  const ready = loops.filter((l) => l.status === "prepared").length;
  return (
    <main className="stage">
      <div className="creature">
        <Familiar state={state} clearance={clearance} size={120} />
        <p className="creature-line">
          {ready > 0 ? `${ready} ready for you.` : "Nothing needs you right now."}
        </p>
      </div>
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
