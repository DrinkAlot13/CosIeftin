import Link from "next/link";
import { AddToList } from "@/components/AddToList";
import { ProductImage } from "@/components/ProductImage";
import { formatPerUnit, formatRON } from "@/lib/format";

export type CardProduct = {
  slug: string;
  name: string;
  brand: string | null;
  unit: string;
  image?: string | null;
  summary: { lowest: number; offerCount: number };
  unitLowest: number;
  drop?: number;
  /**
   * Best quantity-discount rung, when this product has a trusted ladder.
   *
   * DCNeu is a discounter and the ladder IS the offer, so a listing that shows only the
   * single-unit price shows the least attractive number on the card. Built by
   * `visibleTiers`, which refuses a ladder hanging off a flagged, stale or out-of-stock
   * price — so a card can never advertise a discount against a price we are withholding.
   */
  bulk?: { bestUnitBani: number; bestFromQty: number; bestDiscountBp: number } | null;
};

export function ProductCard({ p }: { p: CardProduct }) {
  return (
    <div className="card pcard">
      <Link href={`/p/${p.slug}`} className="pcard-link">
        <div className="pimg">
          <ProductImage name={p.name} brand={p.brand} src={p.image} />
        </div>
        <div className="pbody">
          <div className="pbrand">{p.brand ?? " "}</div>
          <div className="pname">{p.name}</div>
          <div className="pprice-label">de la</div>
          <div className="pprice">{formatRON(p.summary.lowest)}</div>
          <div className="punit">{p.unitLowest > 0 ? formatPerUnit(p.unitLowest, p.unit) : " "}</div>
          {/*
            The quantity discount, on the card. `minQuantity` counts PIECES, so the unit word
            here is always "buc" and never the product's measurement unit — rendering the
            latter produced "de la 2 l" on a 100 ml bottle.
          */}
          {p.bulk && (
            <div className="pbulk" style={{ fontSize: 11.5, color: "var(--primary)", marginTop: 2, fontWeight: 600 }}>
              de la {formatRON(p.bulk.bestUnitBani / 100)}/buc la {p.bulk.bestFromQty}+
            </div>
          )}
          <div className="pmeta">
            <span>{p.summary.offerCount} magazine</span>
            {p.drop && p.drop > 2 ? <span className="badge badge-drop">↓ {Math.round(p.drop)}%</span> : null}
          </div>
        </div>
      </Link>
      <div className="pcard-actions">
        <AddToList slug={p.slug} name={p.name} />
      </div>
    </div>
  );
}
