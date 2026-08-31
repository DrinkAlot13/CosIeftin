// Save a raw store response to tests/fixtures/<slug>/ so scraper PARSERS can be tested
// offline. Without fixtures a scraper can only be tested by hitting the network, which
// means in practice it is never tested — and a silent parse regression ships.
//
// Run: npm run fixture:save -- kaufland
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SOURCES: Record<string, { url: string; file: string; slice?: (html: string) => string }> = {
  kaufland: {
    url: "https://www.kaufland.ro/oferte/oferte-saptamanale/saptamana-curenta.html",
    file: "weekly-offers.html",
    // keep only the SSR blob that holds the offers — the full page is 1.4 MB of chrome
    slice: (html) => {
      const at = html.indexOf('"offerId"');
      if (at < 0) return html.slice(0, 400_000);
      const start = html.lastIndexOf("window.SSR", at);
      const open = html.indexOf("{", start);
      let depth = 0, inStr = false, esc = false;
      for (let i = open; i < html.length; i++) {
        const c = html[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) return html.slice(start, i + 1); }
      }
      return html.slice(start, start + 400_000);
    },
  },
};

async function main() {
  const name = process.argv[2];
  const src = SOURCES[name];
  if (!src) {
    console.error(`Usage: npm run fixture:save -- <${Object.keys(SOURCES).join("|")}>`);
    process.exit(1);
  }
  const res = await fetch(src.url, { headers: { "User-Agent": UA, "Accept-Language": "ro-RO,ro;q=0.9" } });
  if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1); }
  const html = await res.text();
  const body = src.slice ? src.slice(html) : html;
  const dir = join(process.cwd(), "tests", "fixtures", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, src.file), body, "utf8");
  console.log(`Saved tests/fixtures/${name}/${src.file} (${body.length} bytes)`);
}

main();
