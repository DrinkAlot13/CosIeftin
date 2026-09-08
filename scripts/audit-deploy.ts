// ── SCOPE: IS THIS PROCESS CONFIGURED THE WAY docs/DEPLOYMENT.md SAYS? READ-ONLY.
//
// A checklist nobody can run is a checklist nobody runs. This checks every MECHANICAL line on
// that page against the environment the process actually has, and stays silent about the ones
// that are judgements — "is this proxy overwriting x-forwarded-for" cannot be answered from
// inside the process, and pretending otherwise is how a green tick comes to mean nothing.
//
// ── IT REPORTS AGAINST A MODE, because the same setting is right locally and wrong in
// production. `--production` asserts what must be true on a hosted deployment; without it the
// script describes the current environment and flags only what is broken in ANY mode.
//
// ── WHAT IT DELIBERATELY CANNOT DO. It cannot see the reverse proxy, the backup schedule, or
// whether a person reviewed the trust flags. Those stay as ☐ boxes on the page, and this script
// prints them as UNCHECKABLE rather than passing them by default. A checklist that silently
// drops its hardest items is worse than one that admits to them.
//
//   npm run audit:deploy
//   npm run audit:deploy -- --production

// Every other script reaches the environment through `lib/db`'s own `import "dotenv/config"`.
// This one touches no database, so it must load `.env` itself — and the first run without it
// reported SITE_URL and DATABASE_URL as UNSET when both were set, which is precisely the shape
// of defect this whole checklist exists to catch. A configuration audit that cannot see the
// configuration is worse than none: it produces confident red crosses about nothing.
import "dotenv/config";
import { emitJson } from "../src/lib/audit-json";

type Verdict = "ok" | "fail" | "warn" | "uncheckable";
type Check = { name: string; verdict: Verdict; detail: string };
const checks: Check[] = [];
const add = (name: string, verdict: Verdict, detail: string) => checks.push({ name, verdict, detail });

/** Placeholder values that are worse than an unset variable: they look configured. */
const PLACEHOLDERS = new Set(["change-me", "changeme", "secret", "password", "admin", "test", "todo", ""]);

function main(): void {
  const argv = process.argv.slice(2);
  let production = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--production") { production = true; continue; }
    if (a === "--json") { i++; continue; }
    if (a.startsWith("--json=")) continue;
    console.error(`audit:deploy — unrecognised argument ${JSON.stringify(a)}. Refusing to run.`);
    process.exit(2);
  }

  const env = process.env;
  const mode = production ? "PRODUCTION" : "current environment";

  // ── SECRETS ─────────────────────────────────────────────────────────────────────────────
  const secret = (env.AUTH_SECRET ?? "").trim();
  if (!secret) add("AUTH_SECRET set", production ? "fail" : "warn", "unset — sessions cannot be signed");
  else if (PLACEHOLDERS.has(secret.toLowerCase())) add("AUTH_SECRET set", "fail", `placeholder value ${JSON.stringify(secret)} — anyone can forge a session`);
  else if (secret.length < 32) add("AUTH_SECRET set", production ? "fail" : "warn", `only ${secret.length} chars; want 32+`);
  else add("AUTH_SECRET set", "ok", `${secret.length} chars, not a placeholder`);

  const reval = (env.REVALIDATE_SECRET ?? "").trim();
  if (!reval) add("REVALIDATE_SECRET set", production ? "fail" : "warn", "unset — the cache-purge route refuses to run, which is safe but broken");
  else if (PLACEHOLDERS.has(reval.toLowerCase())) add("REVALIDATE_SECRET set", "fail", "placeholder value");
  else add("REVALIDATE_SECRET set", "ok", `${reval.length} chars`);

  // ── ORIGIN ──────────────────────────────────────────────────────────────────────────────
  const siteUrl = (env.SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (!siteUrl) {
    add("SITE_URL set", "fail", "unset — the build refuses, and every canonical tag would be a guess");
  } else {
    let origin = "";
    try { origin = new URL(siteUrl).origin; } catch { /* reported next */ }
    if (!origin) add("SITE_URL set", "fail", `not a URL: ${JSON.stringify(siteUrl)}`);
    else if (production && origin.startsWith("http://")) add("SITE_URL set", "fail", `${origin} is not https`);
    else if (production && /localhost|127\.0\.0\.1/.test(origin)) add("SITE_URL set", "fail", `${origin} is a local address`);
    else add("SITE_URL set", "ok", origin);

    // The port SITE_URL claims vs the port this process would listen on. They are separate
    // settings and have disagreed before — :3200 against a server on :3000 — which made the
    // sitemap advertise an origin nothing served.
    const declaredPort = (() => { try { const u = new URL(siteUrl); return u.port || (u.protocol === "https:" ? "443" : "80"); } catch { return ""; } })();
    const listenPort = String(env.PORT ?? 3000);
    if (!production && declaredPort && declaredPort !== listenPort) {
      add("SITE_URL port matches the listening port", "fail",
        `SITE_URL says :${declaredPort}, this process would listen on :${listenPort} — the sitemap would advertise an origin nothing serves`);
    } else if (!production) {
      add("SITE_URL port matches the listening port", "ok", `both :${listenPort}`);
    } else {
      add("SITE_URL port matches the listening port", "uncheckable", "behind a proxy the public port is not this process's port; probe:sitemap answers this from outside");
    }
  }

  // ── DATABASE ────────────────────────────────────────────────────────────────────────────
  const db = (env.DATABASE_URL ?? "").trim();
  if (!db) add("DATABASE_URL set", "fail", "unset");
  else if (production && db.startsWith("file:")) add("DATABASE_URL set", "fail", `SQLite (${db}) — the cutover checklist in docs/DEPLOYMENT.md §4 has not been done`);
  else add("DATABASE_URL set", "ok", db.startsWith("file:") ? "SQLite, correct for local" : "not SQLite");

  // ── RATE LIMITING ───────────────────────────────────────────────────────────────────────
  const trust = env.TRUST_PROXY === "1";
  if (production && !trust) {
    add("TRUST_PROXY", "fail", "unset in production — every caller shares ONE rate-limit bucket, so the limiter bounds a runaway script but not an attacker");
  } else if (production && trust) {
    add("TRUST_PROXY", "warn", "set — CANNOT be verified from inside the process. If nothing in front OVERWRITES x-forwarded-for, this is WORSE than no limiter: an attacker mints a fresh budget per request");
  } else if (trust) {
    add("TRUST_PROXY", "warn", "set locally with no proxy in front — a client-supplied header is being believed");
  } else {
    add("TRUST_PROXY", "ok", "unset, correct locally — forwarded addresses are ignored");
  }

  // ── FEATURE FLAGS ───────────────────────────────────────────────────────────────────────
  const trustFeatures = (env.FEATURE_TRUST ?? "").trim().toLowerCase();
  add("FEATURE_TRUST", trustFeatures === "true" ? "warn" : "ok",
    trustFeatures === "true"
      ? "ON — /shrinkflation and the discount verdict publish factual claims about named companies. Confirm a person read the detections"
      : "off — the safe default");

  const platform = (env.SHOW_DELIVERY_PLATFORM ?? "").trim().toLowerCase();
  add("SHOW_DELIVERY_PLATFORM", ["1", "true", "yes"].includes(platform) ? "warn" : "ok",
    ["1", "true", "yes"].includes(platform)
      ? "ON — delivery-platform prices carry a markup and will sit beside shelf prices"
      : "off — the safe default");

  // ── THE ONES NO PROCESS CAN ANSWER ──────────────────────────────────────────────────────
  add("reverse proxy overwrites x-forwarded-for", "uncheckable", "ask the proxy config; audit:rate-limit against the deployed host is the closest evidence");
  add("AUTH_SECRET rotated for this deployment", "uncheckable", "a strong secret and a FRESH secret look identical from here");
  add("admin password not the one from a chat transcript", "uncheckable", "docs/DEPLOYMENT.md §6");
  add("backups scheduled", "uncheckable", "prisma/dev.db.bak-* are local snapshots and gitignored; production needs a real schedule");
  add("nightly scheduled", "uncheckable", "`npm run nightly`, and someone reads `npm run soak:report`");

  // ── REPORT ──────────────────────────────────────────────────────────────────────────────
  const mark: Record<Verdict, string> = { ok: "✓", fail: "✗", warn: "!", uncheckable: "☐" };
  console.log("═".repeat(100));
  console.log(`DEPLOYMENT CHECKLIST — asserted against the ${mode}`);
  console.log("docs/DEPLOYMENT.md is the page; this is the mechanical half of it.");
  console.log("═".repeat(100));
  for (const c of checks) {
    console.log(`  ${mark[c.verdict]} ${c.name.padEnd(46)} ${c.detail}`);
  }

  const failed = checks.filter((c) => c.verdict === "fail");
  const warned = checks.filter((c) => c.verdict === "warn");
  const unchecked = checks.filter((c) => c.verdict === "uncheckable");

  console.log(`\n${"─".repeat(100)}`);
  console.log(`  ${checks.length - failed.length - warned.length - unchecked.length} ok · ${warned.length} to review · ${failed.length} failing · ${unchecked.length} NOT CHECKABLE from here`);
  if (!production) {
    console.log(`\n  This run asserted the CURRENT environment. Before hosting, run:`);
    console.log(`      npm run audit:deploy -- --production`);
    console.log(`  and expect it to fail on the local values — that is the point of the flag.`);
  }
  console.log(`\n  The ${unchecked.length} ☐ items are not passes. They are the ones a person has to answer,`);
  console.log(`  and they include the two that matter most: whether a proxy is really rewriting`);
  console.log(`  x-forwarded-for, and whether the secrets are fresh.`);

  emitJson({
    mode: production ? "production" : "current",
    checks,
    ok: checks.length - failed.length - warned.length - unchecked.length,
    warn: warned.length, fail: failed.length, uncheckable: unchecked.length,
    pass: failed.length === 0,
  });
  if (failed.length > 0) process.exit(1);
}

main();
