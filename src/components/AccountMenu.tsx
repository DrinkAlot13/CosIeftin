"use client";

// The account corner of the header.
//
// This is a client component for one reason: reading the session cookie on the server made
// every page in the site uncacheable (see app/api/me/route.ts). Rendering it here costs one
// small request after paint and buys static generation for the entire site.
//
// It renders "Cont" while it does not yet know — which is also what it renders for the
// signed-out majority, so the common case never flickers. A signed-in visitor sees their email
// swap in a moment later. It never renders a placeholder that could be mistaken for a fact:
// no fake email, no skeleton pretending to be a name.

import Link from "next/link";
import { useEffect, useState } from "react";
import { logout } from "@/app/actions";

type Me = { email: string | null };

export function AccountMenu() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { email: null }))
      .then((d: Me) => { if (!cancelled) setMe(d); })
      // A failed session check is not a logged-in state. Fall back to the signed-out view.
      .catch(() => { if (!cancelled) setMe({ email: null }); });
    return () => { cancelled = true; };
  }, []);

  if (!me?.email) return <Link href="/login">Cont</Link>;

  return (
    <>
      <Link href="/cont">{me.email}</Link>
      {" · "}
      <form action={logout} style={{ display: "inline" }}>
        <button type="submit" className="linklike">Ieși</button>
      </form>
    </>
  );
}
