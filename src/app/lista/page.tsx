import { ListBuilder } from "@/components/ListBuilder";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lista mea de cumpărături" };

export default function ListaPage() {
  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 26 }}>🛒 Lista mea de cumpărături</h1>
        <p className="muted">Adaugă produse și îți spunem unde e cel mai ieftin — într-un singur magazin sau împărțit.</p>
      </div>
      <ListBuilder />
      <div style={{ height: 32 }} />
    </div>
  );
}
