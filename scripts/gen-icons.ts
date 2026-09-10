// ── RASTERISE public/icon.svg INTO THE PNGs BOTH PLATFORMS ACTUALLY USE.
//
// `probe:pwa` asked Chrome and found the manifest carries an SVG and nothing else. Chrome will
// still call that installable — but the LAUNCHER icon, the splash screen and the task switcher
// all want a bitmap, and iOS ignores manifest icons entirely and reads `apple-touch-icon`, which
// must be a PNG. An app whose home-screen icon is a fallback glyph looks broken in the one place
// a person sees it every day.
//
// NO IMAGE LIBRARY IS ADDED. CLAUDE.md says not to add dependencies without asking, and
// Playwright's Chromium is already here — so the SVG is rendered in the same engine that will
// display it and screenshotted. That is one fewer rasteriser to disagree with the browser.
//
//   npm run gen:icons
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const SIZES = [
  { file: "icon-192.png", px: 192, why: "Android launcher / Chrome install" },
  { file: "icon-512.png", px: 512, why: "Android splash screen" },
  { file: "apple-touch-icon.png", px: 180, why: "iOS home screen — iOS ignores the manifest" },
];

async function main(): Promise<void> {
  const svg = readFileSync(join(process.cwd(), "public", "icon.svg"), "utf8");
  const out = join(process.cwd(), "public", "icons");
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    for (const s of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: s.px, height: s.px }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      // The SVG is inlined and sized to the viewport exactly, with no margin: a maskable icon is
      // cropped to a circle by Android, and letterboxing it here would shrink the artwork twice.
      await page.setContent(
        `<!doctype html><meta charset=utf-8>` +
        `<style>html,body{margin:0;padding:0;width:${s.px}px;height:${s.px}px;overflow:hidden}` +
        `svg{display:block;width:${s.px}px;height:${s.px}px}</style>` +
        svg,
        { waitUntil: "load" },
      );
      const buf = await page.screenshot({ omitBackground: false });
      writeFileSync(join(out, s.file), buf);
      console.log(`  ✓ ${s.file}  ${s.px}x${s.px}  ${(buf.length / 1024).toFixed(1)} kB  — ${s.why}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\nWritten to public/icons/. Referenced from the manifest and from layout.tsx.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
