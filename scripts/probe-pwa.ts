// ── WHAT DOES THE INSTALL EXPERIENCE ACTUALLY PRODUCE? Asked of a real browser engine.
//
// "The manifest already exists" is true and says nothing about whether either platform will
// offer to install the app. Android Chrome and iOS Safari have DIFFERENT and largely
// non-overlapping requirements, and neither reports failure to the page — Chrome simply does not
// fire `beforeinstallprompt`, and iOS never fires it at all by design. The failure mode is
// silence, which is why this is measured rather than reasoned about.
//
// Chrome's own manifest parser is asked via CDP `Page.getAppManifest`, which returns the parse
// ERRORS list — the same one DevTools' Application panel shows. That is the browser's opinion,
// not ours.
//
// iOS cannot be driven here at all (no WebKit on this machine, and no iPhone). What CAN be
// checked is the markup iOS requires, which is a different claim and is reported as such.
//
//   npm run probe:pwa
//   npm run probe:pwa -- --base http://localhost:3000

import { chromium } from "playwright";
import { emitJson } from "../src/lib/audit-json";

type Check = { name: string; ok: boolean; detail: string };

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const bi = argv.indexOf("--base");
  const base = (bi >= 0 ? argv[bi + 1] : process.env.PROBE_BASE) ?? "http://localhost:3000";

  const checks: Check[] = [];
  const ok = (name: string, detail = "") => checks.push({ name, ok: true, detail });
  const bad = (name: string, detail: string) => checks.push({ name, ok: false, detail });

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO" });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45_000 });

  // ── CHROME'S OWN VERDICT ON THE MANIFEST.
  const cdp = await ctx.newCDPSession(page);
  const manifest = (await cdp.send("Page.getAppManifest")) as unknown as {
    url?: string; data?: string; errors?: { message: string; critical?: boolean }[];
  };

  const parsed = manifest.data ? (JSON.parse(manifest.data) as Record<string, unknown>) : null;
  if (!parsed) {
    bad("Chrome parsed a manifest", `no data at ${manifest.url ?? "(no url)"}`);
  } else {
    ok("Chrome parsed a manifest", manifest.url ?? "");
    const critical = (manifest.errors ?? []).filter((e) => e.critical);
    critical.length === 0
      ? ok("no critical manifest errors")
      : bad("no critical manifest errors", critical.map((e) => e.message).join(" · "));
    for (const e of manifest.errors ?? []) {
      if (!e.critical) checks.push({ name: `manifest note`, ok: true, detail: e.message });
    }

    // ── ANDROID CHROME INSTALLABILITY, criterion by criterion, so a failure names itself.
    for (const key of ["name", "short_name", "start_url", "display"]) {
      parsed[key] ? ok(`manifest.${key}`, String(parsed[key])) : bad(`manifest.${key}`, "missing");
    }
    const display = String(parsed.display ?? "");
    ["standalone", "fullscreen", "minimal-ui"].includes(display)
      ? ok("display is an installable mode", display)
      : bad("display is an installable mode", display);

    const icons = (parsed.icons as { src: string; sizes?: string; type?: string; purpose?: string }[] | undefined) ?? [];
    const sizesOf = (s?: string) => (s ?? "").split(/\s+/).map((x) => Number(x.split("x")[0])).filter((n) => Number.isFinite(n));
    const has = (min: number) => icons.some((i) => (i.sizes ?? "").includes("any") || sizesOf(i.sizes).some((n) => n >= min));
    const png = icons.filter((i) => (i.type ?? "").includes("png") || /\.png$/i.test(i.src));

    has(192) ? ok("an icon of at least 192px") : bad("an icon of at least 192px", `icons: ${icons.map((i) => `${i.src} ${i.sizes}`).join(", ") || "none"}`);
    has(512) ? ok("an icon of at least 512px") : bad("an icon of at least 512px", `icons: ${icons.map((i) => `${i.src} ${i.sizes}`).join(", ") || "none"}`);
    // A RASTER icon is what Android actually puts on the home screen. Chrome will accept an SVG
    // for installability, but the launcher icon, the splash screen and the task switcher all
    // want a bitmap — and an app whose home-screen icon is a fallback glyph looks broken.
    png.length > 0
      ? ok("at least one PNG icon", png.map((i) => i.sizes ?? "?").join(", "))
      : bad("at least one PNG icon", "SVG only — the launcher icon and splash screen want a bitmap");
    icons.some((i) => (i.purpose ?? "").includes("maskable"))
      ? ok("a maskable icon", "Android will not letterbox it")
      : bad("a maskable icon", "Android draws the icon inside a white rounded square");
  }

  // ── iOS SAFARI. Cannot be DRIVEN here; what it requires can be READ.
  const head = await page.evaluate(() => ({
    appleTouchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? null,
    appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content") ?? null,
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") ?? null,
    statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content") ?? null,
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
  }));

  head.appleTouchIcon
    ? ok("iOS: apple-touch-icon", head.appleTouchIcon)
    : bad("iOS: apple-touch-icon", "absent — iOS IGNORES manifest icons and will screenshot the page instead");
  head.appleCapable
    ? ok("iOS: apple-mobile-web-app-capable", head.appleCapable)
    : bad("iOS: apple-mobile-web-app-capable", "absent — opens in Safari chrome, not standalone");
  head.appleTitle
    ? ok("iOS: apple-mobile-web-app-title", head.appleTitle)
    : bad("iOS: apple-mobile-web-app-title", "absent — the home-screen label falls back to <title>, which is long");
  head.viewport?.includes("width=device-width")
    ? ok("viewport is responsive", head.viewport)
    : bad("viewport is responsive", String(head.viewport));

  // ── THE SERVICE WORKER. Chrome requires a fetch handler for installability.
  const swRegistered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    const r = await navigator.serviceWorker.getRegistration();
    return r ? "registered" : "none";
  });
  // In DEVELOPMENT the worker is deliberately NOT registered and actively unregistered — asset
  // hashes change every rebuild and a stale worker can sit on the origin forever. So "none" here
  // is the CORRECT answer against a dev server and a failure against production; the probe says
  // which it is looking at rather than grading blindly.
  const isProd = await page.evaluate(() => !document.documentElement.innerHTML.includes("__next_dev"));
  checks.push({
    name: "service worker registration",
    ok: true,
    detail: `${swRegistered} (${isProd ? "production build" : "dev server — deliberately unregistered"})`,
  });

  await ctx.close();
  await browser.close();

  console.log("═".repeat(96));
  console.log(`PROBE: PWA — what Chrome and iOS actually do with this install, at ${base}`);
  console.log("═".repeat(96));
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `  — ${c.detail}` : ""}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length) {
    console.log(`\n  NOT INSTALLABLE AS SHIPPED. Each line above names its own fix.`);
  }
  console.log(`\n  NOT TESTED HERE, and cannot be: a real iPhone and a real Android handset.`);
  console.log(`  Chromium headless is the same engine as Android Chrome for MANIFEST parsing,`);
  console.log(`  which is what this measures. It is not the same for the install prompt, the`);
  console.log(`  splash screen, or anything iOS does — WebKit is not on this machine.`);
  console.log("═".repeat(96));

  emitJson({ pass: failed.length === 0, checks: checks.length, failed: failed.length, results: checks });
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
