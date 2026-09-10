// ── THE PRICE STORY, RENDERED. Server component; no state, no client JS.
//
// Every branch here is a sentence shown to a shopper about whether a price is good, so each one
// says exactly what the data supports and nothing more. The window is the span we actually
// observed for THIS product — never "30 de zile", never "90 de zile", because the history table
// began on 2026-08-06 and holds 35 days.
import {
  aboveLowLabelRo, formatDayRo, spanLabelRo,
  MIN_DAYS_FOR_A_CLAIM, type PriceStory,
} from "@/lib/price-story";
import { formatRON } from "@/lib/format";

/** The retailer's OWN legally-required 30-day figure. Shown as theirs; never used for a claim. */
export type RetailerReference = { bani: number; merchantName: string } | null;

export function PriceStoryPanel({
  story,
  retailerReference,
}: {
  story: PriceStory;
  retailerReference?: RetailerReference;
}) {
  if (story.kind === "no-price") return null;

  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>Prețul în timp</h2>

      {story.kind === "too-new" && (
        // Refusing to answer is an answer. Naming the number of days makes it checkable and makes
        // clear the feature is working rather than broken.
        <p className="muted" style={{ margin: 0 }}>
          Urmărim prețul {spanLabelRo(story.observedDays)}. Avem nevoie de cel puțin{" "}
          {MIN_DAYS_FOR_A_CLAIM} zile ca să spunem dacă e un preț bun.
        </p>
      )}

      {story.kind === "unchanged" && (
        // `PriceHistory` appends on CHANGE, so one observation means the price has not moved.
        // 58% of live grocery products are in this state, and it is a real thing to be told.
        <p style={{ margin: 0 }}>
          <strong>Prețul nu s-a schimbat</strong> de când îl urmărim ({spanLabelRo(story.observedDays)}).
        </p>
      )}

      {story.kind === "story" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Cel mai mic preț observat
              </div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{formatRON(story.lowBani / 100)}</div>
              <div className="muted" style={{ fontSize: 12 }}>{formatDayRo(story.lowAt)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Cel mai mare preț observat
              </div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{formatRON(story.highBani / 100)}</div>
              <div className="muted" style={{ fontSize: 12 }}>{formatDayRo(story.highAt)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Acum</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{formatRON(story.currentBani / 100)}</div>
              <div className="muted" style={{ fontSize: 12 }}>{aboveLowLabelRo(story.pctAboveLow)}</div>
            </div>
          </div>

          {story.goodTime ? (
            // The rule is printed WITH the verdict. A badge nobody can check is a badge nobody
            // should trust, and this one is narrow on purpose: it needs the price to have
            // actually moved, over a fortnight or more, and to be at the bottom of that range.
            <div className="save-note">
              🔥 <strong>Acum e un moment bun.</strong> Prețul e la minimul observat de noi{" "}
              {spanLabelRo(story.observedDays)}, după {story.points} schimbări de preț.
            </div>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Urmărim prețul {spanLabelRo(story.observedDays)}, cu {story.points} observații.
            </p>
          )}
        </>
      )}

      {retailerReference && (
        // THE OMNIBUS FIGURE. It is the retailer's own legally required "lowest in 30 days", and
        // it is shown as theirs and left alone. NO discount is computed from it: that gate is
        // still NO, because a reference price we did not observe cannot support our claim.
        <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
          {retailerReference.merchantName} afișează un preț de referință de{" "}
          <strong>{formatRON(retailerReference.bani / 100)}</strong> — cifra pe care legea îi cere
          să o publice (cel mai mic preț din ultimele 30 de zile la ei). Este declarația lor, nu o
          observație a noastră, și nu calculăm nicio reducere pe baza ei.
        </p>
      )}

      <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
        Toate cifrele de mai sus vin din observațiile noastre, începând cu 6 august 2026. Nu
        completăm perioadele în care nu am observat un preț.
      </p>
    </div>
  );
}
