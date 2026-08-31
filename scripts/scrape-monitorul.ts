// Monitorul Prețurilor (Consiliul Concurenței) — the cleanest data source available.
//
// WHY IT MATTERS: it is the public-sector price platform that Romanian retailers are
// REQUIRED to report to. That means real shelf prices, per store LOCATION, for the chains
// we otherwise can't reach (Kaufland, Lidl, Penny, Profi, Selgros, Cora) — with none of the
// ToS/database-right exposure that scraping carries. It also unlocks geo pricing:
// "cel mai ieftin coș la 5 km de mine" instead of "cheapest chain nationally".
//
// STATUS: the endpoint shape below is a best-effort reconstruction — the host did not
// resolve from the machine this was written on (DNS failure on every variant tried:
// monitorulpreturilor.info / .ro, with and without www). Nothing here has been verified
// against a live response, so it is wired to be SAFE rather than optimistic:
//   • it probes several candidate hosts/paths and reports what it finds
//   • it NEVER writes to the database unless it parses a plausible product list
//   • --probe prints the discovered shape so the field mapping can be finished quickly
//
// Run:  npm run scrape:monitorul -- --probe     (discovery; writes nothing)
//       npm run scrape:monitorul                (ingest, once the mapping is confirmed)

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { parsePriceLei } from "../src/lib/price/parsePrice";
import { parseEan } from "../src/lib/product/ean";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Candidate hosts, tried in order. Add the real one here once it responds.
const HOSTS = [
  "https://www.monitorulpreturilor.info",
  "https://monitorulpreturilor.info",
  "https://www.monitorulpreturilor.ro",
  "https://api.monitorulpreturilor.info",
];

// Candidate API paths, tried against each host.
const PATHS = ["/api/v1/products", "/api/products", "/api/v1/preturi", "/rest/products"];

type Probe = { url: string; status: number; kind: string; sample: string };

async function tryFetch(url: string, timeoutMs = 12000): Promise<{ status: number; body: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json, text/html", "Accept-Language": "ro-RO,ro;q=0.9" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { status: res.status, body: await res.text() };
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function probe(): Promise<Probe[]> {
  const found: Probe[] = [];
  for (const host of HOSTS) {
    const root = await tryFetch(host);
    if (!root) { console.log(`  ${host.padEnd(42)} DNS/connect failed`); continue; }
    console.log(`  ${host.padEnd(42)} HTTP ${root.status} (${root.body.length}b)`);
    for (const p of PATHS) {
      const r = await tryFetch(host + p);
      if (!r) continue;
      let kind = "html";
      let sample = r.body.slice(0, 160).replace(/\s+/g, " ");
      try {
        const j = JSON.parse(r.body);
        kind = Array.isArray(j) ? `array(${j.length})` : `object{${Object.keys(j).slice(0, 8).join(",")}}`;
        sample = JSON.stringify(j).slice(0, 240);
      } catch { /* not JSON */ }
      console.log(`    ${p.padEnd(20)} HTTP ${r.status}  ${kind}`);
      if (r.status === 200) found.push({ url: host + p, status: r.status, kind, sample });
    }
  }
  return found;
}

/** Map a Monitorul record onto our StoreProduct. Field names are best-effort; adjust once
 *  a live payload is captured (the probe prints one). */
function toStoreProduct(rec: Record<string, unknown>): StoreProduct | null {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = rec[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };
  const name = pick("denumire", "nume", "name", "productName", "denumireProdus");
  if (!name) return null;
  const priceText = pick("pret", "price", "pretVanzare", "pretFinal");
  const price = parsePriceLei(priceText);
  if (price == null) return null;
  const url = pick("url", "link");
  return {
    name,
    brand: pick("brand", "marca", "producator"),
    price,
    available: true,
    url: url || HOSTS[0],
    productUrl: url || null,
    // The exact source string, so a future parser change can be checked against history.
    rawPriceText: priceText,
    image: null,
    ean: parseEan(pick("ean", "cod", "codBare", "gtin")) || null,
    // Monitorul reports what the shelf actually charges — the cleanest price source we have
    priceSource: "shelf",
  };
}

async function main() {
  const probing = process.argv.includes("--probe");
  console.log("\nMonitorul Prețurilor — probing endpoints…\n");
  const found = await probe();

  if (found.length === 0) {
    console.log(
      [
        "",
        "No reachable endpoint.",
        "",
        "This is expected if the host is geo-restricted or the domain has moved.",
        "To finish this integration:",
        "  1. Open the Monitorul Prețurilor web app or mobile app with devtools/proxy on.",
        "  2. Note the host + path its product search calls, and one sample response.",
        "  3. Add the host to HOSTS / the path to PATHS above, and adjust toStoreProduct()",
        "     to the real field names (the probe prints a sample when it connects).",
        "",
        "Nothing was written to the database.",
      ].join("\n"),
    );
    await prisma.$disconnect();
    return;
  }

  console.log("\nReachable endpoints:");
  for (const f of found) console.log(`  ${f.url}\n    ${f.kind}\n    ${f.sample}\n`);
  if (probing) { await prisma.$disconnect(); return; }

  // ── ingest (only runs when a payload actually parses into products) ─────────────
  const best = found[0];
  const res = await tryFetch(best.url);
  if (!res) { console.error("endpoint went away between probe and fetch"); await prisma.$disconnect(); return; }
  let data: unknown;
  try { data = JSON.parse(res.body); } catch { console.error("response is not JSON — nothing written."); await prisma.$disconnect(); return; }

  const arr = Array.isArray(data)
    ? data
    : (Object.values(data as Record<string, unknown>).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [];
  const pool = arr.map((r) => toStoreProduct(r as Record<string, unknown>)).filter(Boolean) as StoreProduct[];
  console.log(`\nParsed ${pool.length} products from ${arr.length} records.`);
  if (pool.length < 20) {
    console.error("Too few products parsed — the field mapping is probably wrong. Nothing written.");
    await prisma.$disconnect();
    return;
  }

  const merchant = await prisma.merchant.upsert({
    where: { slug: "monitorul" },
    update: { active: true, name: "Monitorul Prețurilor", websiteUrl: HOSTS[0], storeType: "physical", priceSource: "shelf" },
    create: { slug: "monitorul", name: "Monitorul Prețurilor", websiteUrl: HOSTS[0], storeType: "physical", priceSource: "shelf" },
  });
  const r = await matchPoolToCatalog(merchant.id, pool, { section: "grocery", addNew: true, label: "monitorul" });
  console.log(r.aborted ? `ABORTED — ${r.reason}` : `\nMonitorul: ${r.offers} offers (${r.created} new, ${r.flagged} flagged).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
