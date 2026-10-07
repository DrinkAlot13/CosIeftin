"use client";
// "Activează notificări" — subscribes this browser to push, so a favourite's price drop can
// reach the shopper the moment the nightly job finds it, not only on Monday's digest or the
// next time they open the site.
//
// The service worker only registers in PRODUCTION (ServiceWorker.tsx) — Next's dev rebuilds
// would otherwise leave a stale worker controlling the origin. This component is honest about
// that rather than showing a button that silently does nothing in dev.
import { useEffect, useState } from "react";

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "checking" | "unsupported" | "dev" | "denied" | "off" | "on" | "working";

export function PushSubscribe() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setStatus("unsupported"); return; }
    if (process.env.NODE_ENV !== "production") { setStatus("dev"); return; }
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setStatus(sub ? "on" : "off"))
      .catch(() => setStatus("unsupported"));
  }, []);

  async function subscribe() {
    setStatus("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus("denied"); return; }
      const { publicKey } = await fetch("/api/push/public-key").then((r) => r.json());
      if (!publicKey) { setStatus("off"); return; } // server has no VAPID keys configured
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(publicKey) as BufferSource });
      const json = sub.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setStatus("on");
    } catch {
      setStatus("off");
    }
  }

  async function unsubscribe() {
    setStatus("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      setStatus("on");
    }
  }

  if (status === "checking") return null;
  if (status === "unsupported") return <p className="muted" style={{ fontSize: 13 }}>Browserul tău nu suportă notificări push.</p>;
  if (status === "dev") return <p className="muted" style={{ fontSize: 13 }}>Notificările push funcționează doar pe site-ul publicat, nu în modul de dezvoltare.</p>;
  if (status === "denied") return <p className="muted" style={{ fontSize: 13 }}>Ai blocat notificările pentru acest site din browser — le poți permite din setările browserului.</p>;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Primește o notificare pe acest dispozitiv imediat ce unul dintre produsele favorite se
        ieftinește — mai rapid decât rezumatul săptămânal pe e-mail.
      </p>
      {status === "on" ? (
        <button className="btn btn-outline" type="button" onClick={unsubscribe}>Dezactivează notificările</button>
      ) : (
        <button className="btn btn-outline" type="button" onClick={subscribe} disabled={status === "working"}>
          {status === "working" ? "…" : "Activează notificări"}
        </button>
      )}
    </div>
  );
}
