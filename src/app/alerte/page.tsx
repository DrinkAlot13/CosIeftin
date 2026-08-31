import { AlertsList } from "@/components/AlertsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alertele mele de preț" };

export default function AlertePage() {
  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 26 }}>🔔 Alertele mele de preț</h1>
        <p className="muted">Îți spunem când un produs urmărit scade sub pragul tău (sau sub prețul de când l-ai urmărit).</p>
      </div>
      <AlertsList />
      <div style={{ height: 32 }} />
    </div>
  );
}
