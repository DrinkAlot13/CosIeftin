// ── ONE NAMED CONCEPT, ONE IMPLEMENTATION. Enforced, because three sessions proved it is not.
//
// THE PATTERN THIS EXISTS TO STOP. A rule stated in two places drifts, and the copy goes stale
// silently — nothing fails, and the stale copy keeps answering:
//
//   · `audit:sitemap` kept its own copy of the sitemap's predicate. The sitemap was fixed; the
//     copy was not, and the audit went on reporting 246 dead URLs that no longer existed.
//   · `audit:rate-limit` RECOMPUTED the limiter's budget instead of importing it, missed the
//     50x shared multiplier, sent 65 requests at a threshold of 3,000, and reported
//     "NO LIMIT FIRED" about a limiter that was working.
//   · "head noun" has THREE implementations. `scrape-util.headNoun` was made brand-aware after
//     measuring that 27.2% of branded grocery rows lead with their brand; `queries.headNounOf`
//     was left behind and returned **"aro"** for `aro Ulei Floarea Soarelui`, so a shopper
//     looking at sunflower oil was offered LEMONADE with a one-click "+ adaugă".
//
// ── WHY THIS IS A REGISTER AND NOT A GENERAL RULE, which was measured before being written.
//
// The obvious version — flag any top-level name defined in more than one file — was built and
// run first. Across 413 files it reported **395 duplicates**, almost all of them local `products`
// and `offers` variables inside audit scripts. That is the failure CLAUDE.md already names about
// `audit:discriminator`: a rule that fires almost always detects nothing, and automating a
// judgement produced a worse instrument than the one it replaced.
//
// So the register is hand-written. A concept lands here when someone decides it is load-bearing,
// which is the property the general version cannot supply.
//
// ── KNOWN RESTATEMENTS ARE LISTED, NOT HIDDEN. Same shape as `check:parsepricelei`, which
// reports "confined to 14 allowlisted call sites". An entry here is a decision with a reason
// and a way out, not an exemption — and anything NOT listed fails the build.
//
//   npm run check:concepts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

type Concept = {
  /** what the concept is called in conversation */
  name: string;
  /** the ONE module that may define it */
  canonical: string;
  /** how a definition of it looks — matched against source, per file */
  pattern: RegExp;
  /** why one implementation matters here, in one line */
  why: string;
  /**
   * Files that define it anyway, each with the reason it still does and what would settle it.
   * A known restatement is a decision on the record; a new one is a build failure.
   */
  known: { file: string; note: string }[];
};

const CONCEPTS: Concept[] = [
  {
    name: "head noun",
    canonical: "src/lib/scrape-util.ts",
    // THE RETURN TYPE IS PART OF THE CONCEPT, and leaving it out cost this check its first run:
    // `headNoun\w*` also matched `search.ts`'s `headNounFrequency`, which returns a Map OF head
    // nouns and reimplements nothing. Widening the allowlist to absorb that would have been the
    // wrong repair — an allowlist that collects false positives is one nobody reads.
    pattern: /^\s*(?:export\s+)?function\s+headNoun\w*\s*\([^)]*\)\s*:\s*string\b/m,
    why: "the anchor noun decides both what matches and what is offered as similar; a stale copy offered lemonade for sunflower oil",
    known: [
      {
        file: "src/lib/queries.ts",
        note: "headNounOf — brand-aware since the lemonade fix, but on its OWN stopword list (ALT_STOP) and token rule (len>=3). Collapsing it into scrape-util.headNoun changes which alternatives render, so `audit:alternatives` is the referee and must be run before and after.",
      },
      {
        file: "src/lib/text/normalizeRo.ts",
        note: "headNounRo — NOT brand-aware; it is still the pre-fix version and returns the brand for a brand-first name. Used by search for a frequency heuristic (headNounFrequency, catalogBrands), not as a matching gate, so the blast radius is unmeasured. `audit:search-quality` is the referee.",
      },
    ],
  },
  {
    name: "the current-offer predicate",
    canonical: "src/lib/queries.ts",
    pattern: /^\s*(?:export\s+)?(?:function|const)\s+currentOfferWhere\b/m,
    why: "the SQL and JS halves of 'is this offer live' must move together, or a page counts rows a query will not return",
    known: [],
  },
  {
    name: "the rate-limit budget",
    canonical: "src/lib/rate-limit.ts",
    pattern: /^\s*(?:export\s+)?(?:function|const)\s+effectiveMax\b/m,
    why: "audit:rate-limit recomputed it, missed the shared multiplier, and reported NO LIMIT FIRED about a working limiter",
    known: [],
  },
  {
    // ADDED AFTER THE REGISTER CAUGHT ITS AUTHOR. `probe:omnibus` was written the same day as
    // this check and copied `probe:live-prices`' robots.txt reader wholesale, because the
    // concept was not registered. A stale copy here answers "yes, fetch it" about a path a
    // merchant asked us not to touch.
    name: "the robots.txt permission check",
    canonical: "src/lib/net/robots.ts",
    pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+(?:allowedByRobots|disallowedPrefixes)\b/m,
    why: "a second copy decides politeness on its own, and drifts toward fetching what we were asked not to",
    known: [],
  },
  {
    // Two audits ask opposite questions of the same figure — is our unit-price MATHS right
    // (`audit:unit-oracle`), and is our stored PRICE secretly a unit price
    // (`audit:price-figures`) — so the reader had to leave the first one.
    name: "the merchant's own per-unit price",
    canonical: "src/lib/price/merchant-unit-price.ts",
    pattern: /^\s*(?:export\s+)?function\s+readMerchantUnitPrice\b/m,
    why: "Mega Image's unitPrice is the PACK price echoed back; a second reader that trusts the field name adopts it and reports thousands of false defects",
    known: [],
  },
  {
    name: "the unit-price refusal bounds",
    canonical: "src/lib/price/unit-price-bounds.ts",
    pattern: /^\s*(?:export\s+)?(?:function|const)\s+unitPriceRefusal\b/m,
    why: "the write path, the audit and the audit:db invariant must refuse the same values, or one of them is lying about the other two",
    known: [],
  },
];

const ROOTS = ["src", "scripts", "tests"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(full, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

function main(): void {
  const files: string[] = [];
  for (const r of ROOTS) {
    try { if (statSync(r).isDirectory()) walk(r, files); } catch { /* root absent */ }
  }
  const rel = (f: string) => relative(process.cwd(), f).split(sep).join("/");

  const failures: string[] = [];
  let knownCount = 0;

  for (const c of CONCEPTS) {
    const definers = files.filter((f) => c.pattern.test(readFileSync(f, "utf8"))).map(rel);

    // A concept whose canonical module does not define it is a register gone stale — the exact
    // decay this check exists to prevent, so it fails rather than passing quietly.
    if (!definers.includes(c.canonical)) {
      failures.push(
        `"${c.name}" — the register names ${c.canonical} as canonical, but nothing there matches ` +
        `${c.pattern}. Either it moved, or this entry is stale. A register nobody maintains is the ` +
        `restatement problem wearing a checklist.`,
      );
      continue;
    }

    for (const f of definers) {
      if (f === c.canonical) continue;
      const entry = c.known.find((k) => k.file === f);
      if (entry) { knownCount++; continue; }
      failures.push(
        `"${c.name}" is defined in ${f}, and ${c.canonical} is the one place it may live.\n` +
        `    ${c.why}\n` +
        `    Import it, or add ${f} to this concept's \`known\` list in scripts/check-concepts.ts ` +
        `with the reason it must stay and what would settle it.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`\n✗ named concepts implemented in more than one place:\n`);
    for (const f of failures) console.error(`  • ${f}\n`);
    process.exit(1);
  }

  console.log(
    `✓ ${CONCEPTS.length} named concepts, each with one implementation` +
    (knownCount > 0 ? ` (+ ${knownCount} restatements on the record, with reasons)` : "") + ".",
  );

  for (const c of CONCEPTS) {
    for (const k of c.known) {
      console.log(`    "${c.name}" also in ${k.file}`);
      console.log(`      ${k.note}`);
    }
  }
}

main();
