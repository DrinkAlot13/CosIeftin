import { ScanClient } from "@/components/ScanClient";

export const metadata = { title: "Scanează un produs" };

export default function ScanarePage() {
  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 26 }}>📷 Scanează un produs</h1>
        <p className="muted">
          Îndreaptă camera spre codul de bare al produsului. Funcționează pentru aproximativ un
          sfert din catalog — pentru restul, caută produsul după nume.
        </p>
      </div>
      <ScanClient />
      <div style={{ height: 32 }} />
    </div>
  );
}
