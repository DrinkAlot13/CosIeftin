"use client";
// A blast radius of one card.
//
// Written after the DCNeu category page threw "Application error: a client-side exception has
// occurred" and blanked the ENTIRE page. That particular crash was a stale-build ChunkLoadError,
// not a bad row — but the reason it took the whole page down is that nothing stood between one
// failing component and the root, and that is true of every row on every listing.
//
// This is the seatbelt, not the fix. It does not make bad data good: it stops one unparseable
// price from costing a shopper the other 47 products on the page, and it says which product
// failed so the row can be found instead of guessed at.
import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

export class CardBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Named, so the failing row is identifiable in a browser console or an error reporter.
    // Silent recovery is how a data bug survives for months.
    console.error(`[card] ${this.props.label ?? "unknown product"} failed to render:`, error);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card card-error" role="status">
        <div className="card-error-mark" aria-hidden="true">⚠️</div>
        <div>
          <b>Produs indisponibil</b>
          <p className="muted">Nu am putut afișa acest produs. Restul listei este în regulă.</p>
        </div>
      </div>
    );
  }
}
