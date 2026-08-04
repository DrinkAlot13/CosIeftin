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
