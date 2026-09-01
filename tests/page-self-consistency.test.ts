// A page may never show a merchant count that disagrees with its own visible rows.
//
// The Pepsi page said "1 magazine" above a table listing FOUR rows. Both numbers were
// defensible on their own — one counted in-stock offers under the new rule, the other
// rendered every offer — and the page was nonsense because they sat six inches apart with no
// explanation. Three different counts existed on that page: the summary line, the section
// heading, and the SEO description, each with its own definition.
//
// A page that disagrees with itself is worse than a page with a wrong number, because the
// reader cannot tell which half to trust. So the rule is: state one count, or state the
// "N din M" form that makes the difference explicit.
//
// This is a RENDERED-page check. It fetches real HTML from a running server, because the bug
// was invisible in the source — every individual expression was correct.
import { describe, it, expect } from "./run";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3200";
const REQUIRE = process.env.SMOKE_REQUIRE === "1";

/** Products worth checking: one known-multi-offer page plus the homepage's first few. */
async function pagesToCheck(): Promise<string[]> {
  const res = await fetch(BASE + "/", { signal: AbortSignal.timeout(8000) });
  const html = await res.text();
  const hrefs = [...html.matchAll(/href="(\/p\/[^"]+)"/g)].map((m) => m[1]);
  return [...new Set(hrefs)].slice(0, 12);
}

type Counts = { heading: number | null; ofTotal: number | null; rows: number };

function readCounts(html: string): Counts {
  // "Disponibil azi în N din M magazine" — the explicit form.
  const explicit = html.match(/Disponibil azi în\s*(?:<!--[^>]*-->)?\s*(\d+)[^0-9]{0,40}?(\d+)\s*(?:<!--[^>]*-->)?\s*magazine/);
  // "N magazine" — the plain form, wherever it appears.
  const plain = html.match(/(?:<!--\s*-->)?(\d+)(?:<!--\s*-->)?\s*magazine/);
  // Offer rows: the table gives each row a merchant name cell.
  const rows = (html.match(/class="m-name"/g) ?? []).length;
  return {
    heading: explicit ? Number(explicit[1]) : plain ? Number(plain[1]) : null,
    ofTotal: explicit ? Number(explicit[2]) : null,
    rows,
  };
}

describe("rendered pages do not disagree with themselves", () => {
  it("no product page states a merchant count that contradicts its visible rows", async () => {
    let up = true;
    let urls: string[] = [];
    try {
      urls = await pagesToCheck();
    } catch {
      up = false;
    }
    if (!up) {
      if (REQUIRE) throw new Error(`no server at ${BASE} and SMOKE_REQUIRE=1`);
      console.log(`      (no server at ${BASE} — rendered check skipped)`);
      return;
    }

    const offenders: string[] = [];
    for (const u of urls) {
      const res = await fetch(BASE + u, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const c = readCounts(await res.text());
      if (c.rows === 0 || c.heading === null) continue;
      // Either the stated count equals the rows, or the page uses the explicit "N din M"
      // form and M equals the rows.
      const ok = c.ofTotal !== null ? c.ofTotal === c.rows : c.heading === c.rows;
      if (!ok) {
        offenders.push(
          `${u}: page says ${c.ofTotal !== null ? `${c.heading} din ${c.ofTotal}` : c.heading}` +
          ` but renders ${c.rows} offer row(s)`,
        );
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `A page may not state a merchant count that disagrees with its own rows.\n` +
        `Use the "N din M magazine" form when some offers are out of stock.\n  ` +
        offenders.join("\n  "),
      );
    }
    expect(offenders).toEqual([]);
  });
});
