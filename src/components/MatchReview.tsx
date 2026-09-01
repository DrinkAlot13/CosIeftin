"use client";
// The review queue, built for the keyboard.
//
// There are thousands of these and the decision takes about two seconds of looking: same
// product or not. Anything that makes each one cost a mouse trip makes the queue unusable, and
// an unusable queue is the same as not having built it. So: J/K to move, Y to confirm, N to
// reject, X to mark for bulk rejection, U to undo, and the whole card is on screen at once —
// both names, both prices, both merchants, both images, the score and the rule that produced it.
//
// The two decisions are not symmetric and the UI says so. Confirming publishes one merchant's
// price on another merchant's product page; rejecting only withholds a comparison. That is why
// bulk applies to rejection alone.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingCandidate } from "@/lib/pending-matches";
import { decideMatch, bulkReject, undoDecision } from "@/app/admin/matches/actions";

const lei = (bani: number | null): string =>
  bani == null ? "—" : `${(bani / 100).toFixed(2).replace(".", ",")} lei`;

type Props = { initial: PendingCandidate[]; totalPending: number };

export function MatchReview({ initial, totalPending }: Props) {
  const [rows, setRows] = useState(initial);
  const [cursor, setCursor] = useState(0);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [lastDecided, setLastDecided] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const current = rows[cursor];

  const move = useCallback((delta: number) => {
    setCursor((c) => Math.max(0, Math.min(rows.length - 1, c + delta)));
  }, [rows.length]);

  useEffect(() => {
    cardRefs.current[cursor]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cursor]);

  const decide = useCallback(async (decision: "confirm" | "reject") => {
    if (!current || busy) return;
    setBusy(true);
    const id = current.id;
    const res = await decideMatch(id, decision);
    setBusy(false);
    if (!res.ok) { setNote(res.error ?? "Failed."); return; }
    setLastDecided(id);
    setNote(`${decision === "confirm" ? "Confirmat" : "Respins"}: ${current.productName.slice(0, 44)}`);
    setRows((r) => r.filter((x) => x.id !== id));
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 2)));
  }, [current, busy, rows.length]);

  const doBulkReject = useCallback(async () => {
    if (marked.size === 0 || busy) return;
    setBusy(true);
    const ids = [...marked];
    const res = await bulkReject(ids);
    setBusy(false);
    if (!res.ok) { setNote(res.error ?? "Failed."); return; }
    setNote(`${res.done} respinse.`);
    setRows((r) => r.filter((x) => !marked.has(x.id)));
    setMarked(new Set());
  }, [marked, busy]);

  const doUndo = useCallback(async () => {
    if (lastDecided == null || busy) return;
    setBusy(true);
    const res = await undoDecision(lastDecided);
    setBusy(false);
    setNote(res.ok ? "Anulat. Reîncarcă pentru a-l vedea din nou." : (res.error ?? "Failed."));
    setLastDecided(null);
  }, [lastDecided, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (k === "k" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (k === "y") { e.preventDefault(); void decide("confirm"); }
      else if (k === "n") { e.preventDefault(); void decide("reject"); }
      else if (k === "u") { e.preventDefault(); void doUndo(); }
      else if (k === "x") {
        e.preventDefault();
        if (!current) return;
        setMarked((m) => { const n = new Set(m); n.has(current.id) ? n.delete(current.id) : n.add(current.id); return n; });
        move(1);
      } else if (k === "r" && e.shiftKey) { e.preventDefault(); void doBulkReject(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, decide, doUndo, doBulkReject, current]);

  if (rows.length === 0) {
    return (
      <div className="mr-empty">
        <h2>Nimic de verificat</h2>
        <p className="muted">Coada e goală. Rulează un scraper ca să apară potriviri noi.</p>
      </div>
    );
  }

  return (
    <div className="mr">
      <div className="mr-bar">
        <div>
          <b>{rows.length}</b> în coadă
          {totalPending > rows.length && <span className="muted"> din {totalPending} în total</span>}
          {marked.size > 0 && <span className="mr-marked"> · {marked.size} marcate</span>}
        </div>
        <div className="mr-keys">
          <kbd>J</kbd>/<kbd>K</kbd> navighează · <kbd>Y</kbd> confirmă · <kbd>N</kbd> respinge ·
          {" "}<kbd>X</kbd> marchează · <kbd>Shift</kbd>+<kbd>R</kbd> respinge marcatele · <kbd>U</kbd> anulează
        </div>
        {marked.size > 0 && (
          <button className="btn btn-outline" onClick={() => void doBulkReject()} disabled={busy}>
            Respinge {marked.size}
          </button>
        )}
      </div>
      {note && <div className="mr-note" role="status">{note}</div>}

      <div className="mr-list">
        {rows.map((r, i) => (
          <div
            key={r.id}
            ref={(el) => { cardRefs.current[i] = el; }}
            className={`mr-card${i === cursor ? " is-current" : ""}${marked.has(r.id) ? " is-marked" : ""}`}
            onClick={() => setCursor(i)}
          >
            <div className="mr-value">
              {r.createsComparison
                ? <span className="mr-badge mr-badge-hot">creează o comparație</span>
                : <span className="mr-badge">{r.merchantsNow} → {r.merchantsNow + 1} magazine</span>}
              {r.spreadBani != null && r.spreadBani > 0 && (
                <span className="mr-badge">diferență {lei(r.spreadBani)}</span>
              )}
              <span className="mr-badge mr-badge-quiet">scor {r.score.toFixed(2)} · {r.reason}</span>
            </div>

            <div className="mr-pair">
              <div className="mr-side">
                <div className="mr-side-label">Produs din catalog</div>
                <div className="mr-side-body">
                  {r.productImage
                    ? <img src={r.productImage} alt="" className="mr-img" loading="lazy" />
                    : <div className="mr-img mr-img-none" aria-hidden="true">?</div>}
                  <div>
                    <a href={`/p/${r.productSlug}`} target="_blank" rel="noreferrer" className="mr-name">{r.productName}</a>
                    <div className="muted mr-meta">
                      {r.productBrand ?? "fără marcă"} · {lei(r.catalogPriceBani)}
                      {r.catalogMerchants.length > 0 && <> · {r.catalogMerchants.join(", ")}</>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mr-side">
                <div className="mr-side-label">Ofertă de la {r.merchantName}</div>
                <div className="mr-side-body">
                  {r.storeImage
                    ? <img src={r.storeImage} alt="" className="mr-img" loading="lazy" />
                    : <div className="mr-img mr-img-none" aria-hidden="true">?</div>}
                  <div>
                    {r.storeUrl
                      ? <a href={r.storeUrl} target="_blank" rel="noreferrer" className="mr-name">{r.storeName}</a>
                      : <span className="mr-name">{r.storeName}</span>}
                    <div className="muted mr-meta">
                      {r.storeBrand ?? "fără marcă"} · {lei(r.storePriceBani)} · {r.merchantName}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {i === cursor && (
              <div className="mr-actions">
                <button className="btn btn-accent" onClick={(e) => { e.stopPropagation(); void decide("confirm"); }} disabled={busy}>
                  Y · Același produs
                </button>
                <button className="btn btn-outline" onClick={(e) => { e.stopPropagation(); void decide("reject"); }} disabled={busy}>
                  N · Produse diferite
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
