"use client";
// Camera-based barcode scanning via @zxing/browser (EAN-13/EAN-8/UPC-A, works on every browser
// with camera access — unlike the native BarcodeDetector API, which Safari does not implement).
//
// HONEST ABOUT THE MISS RATE. Only 23.7% of the catalog carries an EAN (measured against the
// live database, not assumed) — "not found" is the common case, not an error, so it always
// offers a name-search fallback rather than reading as "this product doesn't exist".
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Status = "idle" | "requesting" | "scanning" | "found" | "not-found" | "error";

export function ScanClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let reader: import("@zxing/browser").BrowserMultiFormatReader | null = null;
    let controls: { stop: () => void } | null = null;
    let cancelled = false;

    async function start() {
      setStatus("requesting");
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        reader = new BrowserMultiFormatReader();
        if (cancelled || !videoRef.current) return;
        setStatus("scanning");
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err) => {
          if (cancelled) return;
          // zxing calls back on every frame, including failed-to-decode frames (not a real
          // error — just "nothing readable in this frame yet"), so only a successful result
          // or a genuine device error should change anything here.
          if (result) {
            const code = result.getText();
            setLastCode(code);
            setStatus("found"); // optimistic; corrected to not-found below if the lookup misses
            void lookup(code);
          } else if (err && err.name !== "NotFoundException") {
            setErrorMsg(err.message);
          }
        });
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : String(e));
        }
      }
    }

    async function lookup(ean: string) {
      controls?.stop();
      try {
        const res = await fetch(`/api/scan?ean=${encodeURIComponent(ean)}`);
        const j = (await res.json()) as { found: boolean; slug?: string };
        if (j.found && j.slug) {
          router.push(`/p/${j.slug}`);
        } else {
          setStatus("not-found");
        }
      } catch {
        setStatus("not-found");
      }
    }

    void start();
    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function retry() {
    setStatus("idle");
    setLastCode(null);
    setErrorMsg(null);
    // Re-trigger the effect by forcing a fresh mount of the video element's reader — simplest
    // reliable way is a full page reload of just this route's client state.
    window.location.reload();
  }

  return (
    <div>
      <div style={{ position: "relative", maxWidth: 480, margin: "0 auto", borderRadius: 12, overflow: "hidden", background: "#000" }}>
        <video ref={videoRef} style={{ width: "100%", display: status === "not-found" || status === "error" ? "none" : "block" }} muted playsInline />
        {status === "requesting" && (
          <p className="muted" style={{ position: "absolute", top: "50%", left: 0, right: 0, textAlign: "center", color: "#fff" }}>
            Se cere accesul la cameră…
          </p>
        )}
      </div>

      {status === "not-found" && (
        <div className="pill-note" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>
            Codul <code>{lastCode}</code> nu este în catalogul nostru (nu toate produsele au un
            cod de bare înregistrat). Încearcă să cauți produsul după nume.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <Link href="/search" className="btn btn-accent">🔍 Caută după nume</Link>
            <button type="button" className="btn btn-outline" onClick={retry}>Scanează din nou</button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="pill-note" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>
            Nu am putut accesa camera{errorMsg ? ` (${errorMsg})` : ""}. Verifică că ai permis
            accesul la cameră pentru acest site.
          </p>
          <Link href="/search" className="btn btn-accent" style={{ marginTop: 10, display: "inline-block" }}>🔍 Caută după nume</Link>
        </div>
      )}
    </div>
  );
}
