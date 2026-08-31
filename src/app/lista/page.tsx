import { ListBuilder } from "@/components/ListBuilder";
import { getStoreList } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listele mele de cumpărături" };

export default async function ListaPage() {
  const stores = await getStoreList();
  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 26 }}>🛒 Listele mele de cumpărături</h1>
        <p className="muted">Ține mai multe liste, alege magazinele tale și îți spunem unde e cel mai ieftin — într-un magazin sau împărțit.</p>
      </div>
      <ListBuilder stores={stores} />
      <div style={{ height: 32 }} />
    </div>
  );
}
