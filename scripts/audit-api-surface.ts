// ── SCOPE: SECURITY ───────────────────────────────────────────────────────────
// EVERY API ROUTE AND EVERY ADMIN PAGE, FETCHED WITHOUT A SESSION. READ-ONLY over the network.
//
// The question is not "does the nav hide it" — it is what the SERVER does when an anonymous
// request arrives. Hiding a link is not authorisation, and a page that redirects a browser can
// still hand a JSON payload to `curl`.
//
// For each route this records: the status, whether the body looks like real data or a refusal,
// and — for the mutating verbs — whether an unauthenticated POST is accepted. Nothing here
// creates a user or logs in: every request is anonymous ON PURPOSE, because that is the
// attacker's position.
//
// It sends no destructive payloads. Where a POST could write, it sends a syntactically valid
// but semantically empty body and reports the status, not the effect.
//
//   npm run audit:api

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3000";

type Probe = { path: string; method: "GET" | "POST"; body?: unknown; note: string };

const PROBES: Probe[] = [
  // ── Read endpoints
  { path: "/api/me", method: "GET", note: "who am I — must not leak a user when anonymous" },
  { path: "/api/favorites", method: "GET", note: "another user's favourites?" },
  { path: "/api/suggest?q=lapte", method: "GET", note: "search suggest — public by design" },
  { path: "/api/alternatives?productId=1", method: "GET", note: "public by design" },
  { path: "/api/list-adds", method: "GET", note: "the add counter" },
  // ── Write endpoints, anonymous
  { path: "/api/favorites", method: "POST", body: { productId: 1 }, note: "write a favourite with no session" },
  { path: "/api/list-adds", method: "POST", body: { productId: 1 }, note: "increment the counter anonymously" },
  { path: "/api/basket", method: "POST", body: { items: [] }, note: "optimizer" },
  { path: "/api/basket/v2", method: "POST", body: { items: [] }, note: "optimizer v2" },
  { path: "/api/basket/shop", method: "POST", body: { items: [] }, note: "fill-at-shop" },
  { path: "/api/recipe/resolve", method: "POST", body: { slug: "x" }, note: "recipe resolve" },
  { path: "/api/receipt", method: "POST", body: {}, note: "receipt upload" },
  // ── Privileged
  { path: "/api/admin/review", method: "GET", note: "ADMIN — must refuse" },
  { path: "/api/admin/review", method: "POST", body: {}, note: "ADMIN WRITE — must refuse" },
  { path: "/api/revalidate", method: "POST", body: {}, note: "cache purge — must refuse without the secret" },
  { path: "/api/telegram", method: "POST", body: {}, note: "webhook — must verify its caller" },
];

const ADMIN_PAGES = [
  "/admin", "/admin/stats", "/admin/health", "/admin/matches",
  "/admin/matches/stats", "/admin/anomalies", "/admin/review",
];

const USER_PAGES = ["/cont", "/favorite", "/alerte", "/carduri", "/lista"];

/** Does this body look like real data, or like a refusal? */
function classify(status: number, body: string): string {
  const b = body.slice(0, 400).toLowerCase();
  if (status === 401 || status === 403) return "REFUSED (status)";
  if (status >= 500) return "SERVER ERROR";
  if (/unauthor|forbidden|not allowed|bad secret|autentific|acces restric/.test(b)) return "refused (body)";
  if (status >= 300 && status < 400) return "redirect";
  if (status === 404) return "404";
  if (b.trim() === "" || b === "{}" || b === "[]" || b === "null") return "empty";
  return "RETURNED CONTENT";
}

async function main(): Promise<void> {
  console.log("═".repeat(108));
  console.log(`API SURFACE, ANONYMOUS — ${BASE}`);
  console.log(`No cookies, no session. This is the attacker's position, not the browser's.`);
  console.log("═".repeat(108));
  console.log(`  ${"method".padEnd(6)} ${"route".padEnd(34)} ${"status".padStart(6)}  ${"verdict".padEnd(18)} note`);

  const findings: string[] = [];
  for (const p of PROBES) {
    const res = await fetch(`${BASE}${p.path}`, {
      method: p.method,
      redirect: "manual",
      headers: p.method === "POST" ? { "Content-Type": "application/json" } : {},
      body: p.method === "POST" ? JSON.stringify(p.body ?? {}) : undefined,
      signal: AbortSignal.timeout(25_000),
    }).catch(() => null);
    const body = res ? await res.text().catch(() => "") : "";
    const status = res?.status ?? 0;
    const verdict = classify(status, body);
    console.log(`  ${p.method.padEnd(6)} ${p.path.padEnd(34)} ${String(status).padStart(6)}  ${verdict.padEnd(18)} ${p.note}`);
    if (/ADMIN|secret|webhook/i.test(p.note) && verdict === "RETURNED CONTENT") {
      findings.push(`${p.method} ${p.path} returned content to an anonymous caller — ${p.note}`);
    }
    if (p.method === "POST" && status >= 200 && status < 300 && /favourite|counter|write/i.test(p.note)) {
      findings.push(`${p.method} ${p.path} accepted an anonymous write (HTTP ${status}) — ${p.note}`);
    }
  }

  // ── Pages: is the guard server-side, or is the nav just hiding the link?
  const pageBlock = async (paths: string[], label: string) => {
    console.log(`\n── ${label}, fetched with no session ──`);
    for (const path of paths) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual", signal: AbortSignal.timeout(25_000) }).catch(() => null);
      const status = res?.status ?? 0;
      const loc = res?.headers.get("location") ?? "";
      const body = res ? await res.text().catch(() => "") : "";
      // A 200 that renders the refusal UI is fine. A 200 that renders the DATA is not.
      const refusesInBody = /acces restric|autentificare|intră în cont|login/i.test(body.slice(0, 4000));
      const verdict = status >= 300 && status < 400 ? `redirect -> ${loc}`
        : status === 200 && refusesInBody ? "200, renders a refusal"
        : status === 200 ? "200 — CHECK: does it render real data?"
        : `HTTP ${status}`;
      console.log(`  ${path.padEnd(28)} ${String(status).padStart(4)}  ${verdict}`);
      if (status === 200 && !refusesInBody && label.startsWith("ADMIN")) {
        findings.push(`${path} served 200 with no session and no visible refusal — verify server-side auth`);
      }
    }
  };
  await pageBlock(ADMIN_PAGES, "ADMIN pages");
  await pageBlock(USER_PAGES, "user pages");

  console.log(`\n${"═".repeat(108)}`);
  if (findings.length === 0) console.log(`No anonymous route returned privileged content or accepted a privileged write.`);
  else {
    console.log(`FINDINGS (${findings.length}):`);
    for (const f of findings) console.log(`  ${f}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
