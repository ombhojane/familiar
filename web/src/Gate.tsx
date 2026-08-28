import { useState } from "react";
import type { Pending } from "./session";

/** Which action class a tool belongs to, and whether that class can ever be undone.
 *  The "Undo:" line is the most important row on this card — it is what makes the
 *  ceiling legible in the interface rather than only in the README. */
const IRREVERSIBLE: Record<string, string> = {
  act_release_publish: "A published release is public the moment it lands, and the tag enters repository history.",
  act_npm_publish: "Once a version number is used it can never be reused — npm's policy, not ours.",
  act_email_send: "A sent message cannot be recalled.",
};
const TITLES: Record<string, string> = {
  act_release_publish: "Publish a release",
  act_repo_describe: "Change the repository description",
  dossier_write: "Remember this about you",
  order_propose: "Make this a standing order",
};

export function Gate({
  pending, onDecide, onAnswer, busy,
}: {
  pending: Pending;
  onDecide: (d: "approved" | "denied", reason?: string) => void;
  onAnswer: (text: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [denying, setDenying] = useState(false);
  const [reply, setReply] = useState("");

  const tool = pending.toolName ?? "";
  const irreversible = IRREVERSIBLE[tool];
  const args = pending.args ?? {};

  return (
    <div className="scrim">
      <div
        className="gate" role="alertdialog" aria-modal="true"
        aria-label={TITLES[tool] ?? "Approval required"}
      >
        {pending.kind === "question" ? (
          <>
            <h2>It needs one thing from you</h2>
            <textarea
              className="reply" rows={3} value={reply} autoFocus
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type your answer…"
            />
            <div className="gate-actions">
              <button className="primary" disabled={busy || !reply.trim()} onClick={() => onAnswer(reply)}>
                Send
              </button>
            </div>
          </>
        ) : (
          <>
            {irreversible && <p className="warn-line">⚠ Cannot be undone</p>}
            <h2>{TITLES[tool] ?? tool}</h2>

            <dl className="args">
              {Object.entries(args).map(([k, v]) => (
                <div key={k}>
                  <dt className="mono">{k}</dt>
                  <dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                </div>
              ))}
            </dl>

            <p className="undo">
              <span className="undo-label">Undo:</span>{" "}
              {irreversible
                ? <span className="no">none — {irreversible}</span>
                : <span className="yes">reversible — this can be changed back at any time</span>}
            </p>

            {denying ? (
              <>
                <label className="reason-label" htmlFor="why">
                  Why not? This becomes a rule it follows.
                </label>
                <textarea
                  id="why" className="reply" rows={2} value={reason} autoFocus
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. I want to review release notes myself first"
                />
                <div className="gate-actions">
                  <button onClick={() => setDenying(false)} disabled={busy}>Back</button>
                  <button className="danger" disabled={busy || !reason.trim()}
                          onClick={() => onDecide("denied", reason)}>
                    Deny
                  </button>
                </div>
              </>
            ) : (
              <div className="gate-actions">
                <button className="danger" onClick={() => setDenying(true)} disabled={busy}>Deny…</button>
                <button className="primary" onClick={() => onDecide("approved")} disabled={busy}>
                  {busy ? "Working…" : "Approve"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
