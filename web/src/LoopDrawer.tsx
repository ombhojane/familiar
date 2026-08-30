import { useState } from "react";
import type { Loop } from "./api";

/** The door. A loop card was a receipt; this is where it becomes actionable:
 *  see what Familiar saw, what remains, what it prepared — then resume, finish, or let go. */
export function LoopDrawer({
  loop, onClose, onResume, onDone, onDismiss, onAsk,
}: {
  loop: Loop & { triage?: { score: number; why: string[] } };
  onClose: () => void;
  onResume: () => void;
  onDone: () => void;
  onDismiss: () => void;
  onAsk: () => void;
}) {
  const missing: string[] = JSON.parse(loop.missing || "[]");
  const l = loop as any;
  const drafts: { field: string; draft: string; needsFromYou?: string }[] =
    (() => { try { return JSON.parse(l.drafts || "[]"); } catch { return []; } })();
  const [copied, setCopied] = useState<number | null>(null);

  const copy = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 1600);
    } catch { /* clipboard blocked — the text is selectable either way */ }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={loop.title}>
        <header className="drawer-head">
          <div>
            <h2>{loop.title}</h2>
            {loop.triage && <p className="muted small">{loop.triage.why.join(" · ")}</p>}
          </div>
          <button onClick={onClose} aria-label="Close">✕</button>
        </header>

        {loop.capture_id && (
          <figure className="evidence">
            <img src={`/api/captures/${loop.capture_id}/image`} alt="What Familiar saw when you held your place" />
            <figcaption className="muted small">What it saw when you pressed hold</figcaption>
          </figure>
        )}

        {loop.summary && <p className="drawer-summary">{loop.summary}</p>}

        {drafts.length > 0 && (
          <section>
            <h3 className="drawer-h3">Written for you — paste these in</h3>
            {drafts.map((d, i) => (
              <div className="draft" key={d.field}>
                <div className="draft-head">
                  <span className="draft-field">{d.field}</span>
                  <button onClick={() => copy(d.draft, i)}>
                    {copied === i ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="draft-body">{d.draft}</pre>
                {d.needsFromYou && (
                  <p className="draft-needs"><span>Only you can supply:</span> {d.needsFromYou}</p>
                )}
              </div>
            ))}
          </section>
        )}

        {drafts.length === 0 && missing.length > 0 && (
          <section>
            <h3 className="drawer-h3">Still needed</h3>
            <ul className="missing">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </section>
        )}

        {l.prepared_note && (
          <section>
            <h3 className="drawer-h3">Notes</h3>
            <pre className="prepared-note">{l.prepared_note}</pre>
          </section>
        )}

        <footer className="drawer-actions">
          <button className="primary" onClick={onResume}>Resume where I left off</button>
          <button onClick={onAsk}>Ask Familiar to finish it</button>
          <span className="spacer" />
          <button onClick={onDone}>Done</button>
          <button className="danger" onClick={onDismiss}>Let it go</button>
        </footer>
      </aside>
    </div>
  );
}
