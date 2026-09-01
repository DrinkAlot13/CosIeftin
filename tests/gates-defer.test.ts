// Every sanity gate defers. None discards.
//
// THE PRINCIPLE THIS ENFORCES, and why it is a test rather than a paragraph.
//
// CLAUDE.md has required that a price failing the sanity gate be "flagged into a
// PriceAnomaly table for review" since the first session. Exactly one merchant path of
// twelve ever did it. The rule was true, agreed, written down — and enforced by nothing, so
// it held for 8% of the codebase. Documentation is not enforcement.
//
// And the reason the rule matters got sharper, not softer, tonight. A gate anchored on
// stored history can only ever be as right as the data it compares against, and it is most
// likely to fire at the exact moment a wrong value is being corrected. Auchan offer 1905
// held 28,14 from 6 August, moved to 12,00 on 30 August (a 57% drop, past the gate), and
// re-scraped independently today reads 11,69. The anomaly was 28,14 and the CORRECTION was
// 12,00 — a discarding gate would have thrown away the right answer and kept the wrong one,
// with no record that it had done so.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "./run";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const sources = [join(ROOT, "src"), join(ROOT, "scripts")]
  .filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } })
  .flatMap((d) => walk(d))
  .map((f) => ({ rel: relative(ROOT, f).split(sep).join("/"), src: readFileSync(f, "utf8") }));

describe("every gate defers — the recording is structural", () => {
  it("only record-refusal.ts writes PriceAnomaly directly", () => {
    // One writer means one place to add a field, one place to add context, and no path that
    // can quietly stop recording. `scrape-dcneu` used to write these itself, which is why
    // its rows carried no merchant, no store name and no accepted value.
    const offenders = sources
      .filter((f) => !f.rel.endsWith("src/lib/record-refusal.ts"))
      .filter((f) => /prisma\.priceAnomaly\.(create|createMany|upsert)/.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the shared write path records a refusal wherever it flags a price", () => {
    const src = readFileSync(join(ROOT, "src", "lib", "scrape-util.ts"), "utf8");
    // The two value gates: >50% vs the offer's own last price, >70% vs the cross-store median.
    expect(src).toContain("recordRefusal");
    const flagAt = src.indexOf("if (jump || outlier)");
    expect(flagAt > 0).toBe(true);
    // and the refusal must be recorded, not merely flagged
    expect(src.slice(flagAt).includes("recordRefusal")).toBe(true);
  });

  it("a refused value is recorded with what was kept instead", () => {
    const src = readFileSync(join(ROOT, "src", "lib", "record-refusal.ts"), "utf8");
    for (const field of ["rejectedPriceBani", "acceptedPriceBani", "rawPriceText", "reason", "storeName"]) {
      expect(src).toContain(field);
    }
  });

  it("recording a refusal can never abort a scrape", () => {
    // Losing a night's prices because the anomaly insert failed would be a worse outcome
    // than the refusal going unrecorded — but silence about it is worse than both.
    const src = readFileSync(join(ROOT, "src", "lib", "record-refusal.ts"), "utf8");
    expect(src).toContain("catch");
    expect(src).toContain("console.error");
  });

  it("no adapter parser drops an item purely because its price would not parse", () => {
    // `if (price == null) continue;` in the runner is exactly the discard this rule forbids:
    // the item vanishes, and with it the source string a later parser fix could be replayed
    // against. It now travels into the pool at price 0 and is recorded there.
    const src = readFileSync(join(ROOT, "scripts", "adapters", "runner.ts"), "utf8");
    expect(/if \(price == null\) continue;/.test(src)).toBe(false);
  });

  it("PriceAnomaly can hold a refusal that never became an offer", () => {
    // An unparseable price is refused before any Offer row exists. If offerId were required,
    // that whole class of refusal would be unrecordable — which is why it went unrecorded.
    const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
    const model = schema.slice(schema.indexOf("model PriceAnomaly"));
    const body = model.slice(0, model.indexOf("\n}"));
    expect(/offerId\s+Int\?/.test(body)).toBe(true);
    expect(/merchantId\s+Int\?/.test(body)).toBe(true);
  });

  it("the refusals are reachable by a human", () => {
    // A refusal recorded and never read is the same as a refusal discarded, one step later.
    const page = join(ROOT, "src", "app", "admin", "anomalies", "page.tsx");
    const src = readFileSync(page, "utf8");
    expect(src).toContain("priceAnomaly");
    // and the admin index must link to it, because the review queue was unreachable for days
    const index = readFileSync(join(ROOT, "src", "app", "admin", "page.tsx"), "utf8");
    expect(index).toContain("/admin/anomalies");
  });
});
