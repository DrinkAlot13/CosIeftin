// The site shows REAL scraped prices. It must not say otherwise, in either direction.
//
// Until Phase 1d it carried a banner reading "Prototip cu date demonstrative — prețurile
// afișate sunt fictive" across every page, and a footer repeating it. Both were false: the
// prices are collected from the merchants' own public pages. A visitor who believed the banner
// would dismiss a real price, and a merchant reading it would be told we publish invented
// figures about them. Neither is a claim to leave lying around after it stopped being true.
//
// The opposite failure matters just as much: with the banner gone, the footer MUST still tell
// a shopper that a scraped price can differ from the till.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(full, out); }
    else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(full);
  }
  return out;
}

const SRC = join(process.cwd(), "src");
const FILES = walk(SRC);

describe("no demo-data claims remain in the UI", () => {
  it("finds the source tree", () => expect(FILES.length > 20).toBeTruthy());

  it("no page claims the prices are fictional", () => {
    const banned = [/date\s+demonstrative/i, /pre[țţt]urile\s+afi[șşs]ate\s+sunt\s+fictive/i, /demo-banner/i];
    const hits: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const re of banned) if (re.test(src)) hits.push(`${f.replace(SRC, "src")} → ${re}`);
    }
    if (hits.length) throw new Error("demo-data claims still shipped:\n  " + hits.join("\n  "));
    expect(hits.length).toBe(0);
  });

  it("the footer still warns that a scraped price can differ at the till", () => {
    const footer = readFileSync(join(SRC, "components", "Footer.tsx"), "utf8");
    expect(/pot fi diferite/i.test(footer)).toBeTruthy();
    expect(/verific/i.test(footer)).toBeTruthy();
  });

  it("catalog.ts carries no invented prices", () => {
    const catalog = readFileSync(join(SRC, "data", "catalog.ts"), "utf8");
    expect(catalog.includes("basePrice")).toBeFalsy();
  });
});
