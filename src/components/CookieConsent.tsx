"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function CookieConsent() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("pm_cookie_ok")) setShow(true);
    } catch {
      /* ignore */
    }
  }, []);
  if (!show) return null;

  const accept = () => {
    try {
      localStorage.setItem("pm_cookie_ok", "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="cookie-banner" role="dialog" aria-label="Consimțământ cookie">
      <span>
        Folosim cookie-uri esențiale pentru funcționarea site-ului.{" "}
        {/* /cookies has never existed. Next prefetches every visible Link, so this banner —
            which renders on every page — fired a 404 on every page load. The cookie section
            lives in the privacy policy. */}
        <Link href="/confidentialitate" style={{ color: "var(--primary)" }}>Detalii</Link>.
      </span>
      <button className="btn btn-primary" onClick={accept}>Accept</button>
    </div>
  );
}
