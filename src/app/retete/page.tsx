import Link from "next/link";
import { RecipeAdd } from "@/components/RecipeAdd";
import { RECIPES } from "@/data/recipes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rețete — coș automat" };

export default function RetetePage() {
  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Rețete</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>🍳 Rețete — coș automat</h1>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        Alege o rețetă și îți adăugăm ingredientele în coș, apoi găsim cel mai ieftin magazin.
      </p>
      <div className="grid-products" style={{ marginTop: 16 }}>
        {RECIPES.map((r) => (
          <div key={r.slug} className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 30 }}>{r.emoji}</div>
            <h3 style={{ margin: "6px 0 4px" }}>{r.name}</h3>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{r.ingredients.join(", ")}</p>
            <div style={{ marginTop: 10 }}>
              <RecipeAdd name={r.name} ingredients={r.ingredients} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 32 }} />
    </div>
  );
}
