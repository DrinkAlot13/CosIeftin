// ── SCOPE: SOMEBODY ACTUALLY USES THE SITE. Drives a real browser.
//
// Nobody ever has. `GroceryList` was empty until instrumentation put a row in it, and every
// check this project owns reads the database or a rendered string. None of them can tell you
// whether the basket a shopper is handed is one they would actually buy.
//
// ── WHAT THIS IS AND IS NOT.
//
// It is a HARNESS, not a judge. It performs the flows, captures what the page said at each
// step, and writes the evidence out. Whether a substitution is defensible, whether a total is
// believable, whether Romanian copy reads right — those are judgements a person makes from the
// evidence, and CLAUDE.md is explicit that some questions have no automated detector.
//
// So it records generously and asserts almost nothing. The output is meant to be READ.
//
//   npm run flow:user
//   npm run flow:user -- --keep     leave the browser open at the end
//   npm run flow:user -- --only=basket,account

import { chromium, type Browser, type Page, type ConsoleMessage } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.FLOW_BASE ?? "http://localhost:3000";
const OUT = join(process.cwd(), "logs", "flow");

/** Twenty staples a Romanian household actually buys. Searched by the words a person types. */
const STAPLES = [
  "lapte", "oua", "paine", "unt", "branza telemea", "iaurt", "ulei floarea soarelui",
  "faina", "zahar", "orez", "paste", "rosii", "cartofi", "ceapa", "mere",
  "piept de pui", "cafea", "hartie igienica", "detergent vase", "apa plata",
];

type Note = { step: string; kind: "fact" | "PROBLEM" | "CONFUSING"; text: string };
const notes: Note[] = [];
const say = (step: string, kind: Note["kind"], text: string) => {
  notes.push({ step, kind, text });
  const mark = kind === "PROBLEM" ? "✗" : kind === "CONFUSING" ? "?" : " ";
  console.log(`  ${mark} [${step}] ${text}`);
};

const consoleErrors: string[] = [];

async function shot(page: Page, name: string): Promise<void> {
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  } catch { /* a screenshot failing must not end the flow */ }
}

/** Text of a selector, trimmed and collapsed, or null. */
async function textOf(page: Page, sel: string): Promise<string | null> {
  const el = page.locator(sel).first();
  if (await el.count() === 0) return null;
  const t = (await el.textContent().catch(() => null)) ?? null;
  return t ? t.replace(/\s+/g, " ").trim() : null;
}

// ── FLOW 1: TWENTY STAPLES ────────────────────────────────────────────────────────────────
async function flowBasket(page: Page): Promise<void> {
  console.log("\n── FLOW 1: add 20 staples and read the optimizer ──");
  await page.goto(`${BASE}/lista`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);

  const input = page.locator('input[aria-label="Adaugă produs"]');
  if (await input.count() === 0) {
    say("basket", "PROBLEM", "the add-product input does not exist on /lista");
    return;
  }

  const added: string[] = [];
  const notFound: string[] = [];
  const slowFirst: string[] = [];
  for (const term of STAPLES) {
    await input.fill("");
    await input.type(term, { delay: 15 });
    const sug = page.locator("ul.lista-suggest li button");

    // WAIT FOR THE LIST, DO NOT GUESS AT A DELAY.
    //
    // The first version waited a flat 700 ms and reported that `lapte`, `oua` and
    // `detergent vase` "return nothing" — for the two commonest staples in Romania. That would
    // have been a serious false claim about the site: `/api/suggest` returns results for all
    // three. It was the HARNESS being impatient, and the first query after a cold page load is
    // the slow one because the search index is built on demand.
    //
    // So: wait properly, and RECORD how long it took, because a suggestion box that takes over
    // a second is a real thing a shopper feels even though nothing errors.
    const started = Date.now();
    await sug.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const waited = Date.now() - started;

    if (await sug.count() === 0) {
      notFound.push(term);
      continue;
    }
    if (waited > 1200) slowFirst.push(`${term} ${waited}ms`);
    const label = (await sug.first().textContent().catch(() => "")) ?? "";
    await sug.first().click().catch(() => {});
    added.push(`${term} -> ${label.replace(/\s+/g, " ").trim()}`);
    await page.waitForTimeout(250);
  }
  if (slowFirst.length > 0) {
    say("basket", "CONFUSING", `suggestions took over 1.2s for: ${slowFirst.join(", ")} — a shopper types into an empty box and waits`);
  }

  say("basket", "fact", `searched ${STAPLES.length} staples, added ${added.length}`);
  for (const a of added) say("basket", "fact", `  ${a}`);
  if (notFound.length > 0) {
    say("basket", "PROBLEM", `NO SUGGESTION for: ${notFound.join(", ")} — a shopper typing these gets nothing`);
  }

  // The optimizer runs on a debounce after the last change.
  await page.waitForTimeout(6000);
  await shot(page, "01-basket");

  const oneStore = await textOf(page, ".result-card:not(.best)");
  const split = await textOf(page, ".result-card.best");
  say("basket", "fact", `ONE-STORE CARD:  ${oneStore ?? "(absent)"}`);
  say("basket", "fact", `SPLIT CARD:      ${split ?? "(absent)"}`);

  for (const sel of [".save-note"]) {
    const all = page.locator(sel);
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const t = ((await all.nth(i).textContent()) ?? "").replace(/\s+/g, " ").trim();
      if (t) say("basket", "fact", `NOTE: ${t}`);
    }
  }

  // The per-store table — the thing a shopper actually compares.
  const rows = page.locator("table.admin-table tbody tr");
  const rn = await rows.count();
  say("basket", "fact", `store table: ${rn} rows`);
  for (let i = 0; i < Math.min(rn, 14); i++) {
    const cells = rows.nth(i).locator("td");
    const c = await cells.count();
    const vals: string[] = [];
    for (let j = 0; j < c; j++) vals.push(((await cells.nth(j).textContent()) ?? "").replace(/\s+/g, " ").trim());
    say("basket", "fact", `  | ${vals.join(" | ")}`);
  }

  // Per-item lines: what each product resolved to, and at what price.
  const items = page.locator("ul.lista-list li.lista-row");
  const inum = await items.count();
  say("basket", "fact", `list rows: ${inum}`);
  for (let i = 0; i < Math.min(inum, 25); i++) {
    const t = ((await items.nth(i).textContent()) ?? "").replace(/\s+/g, " ").trim();
    say("basket", "fact", `  ITEM ${t.slice(0, 150)}`);
  }
}

// ── FLOW 2: COMPLETEAZĂ COȘUL AT THREE SHOPS ──────────────────────────────────────────────
async function flowShops(page: Page): Promise<void> {
  console.log("\n── FLOW 2: 'Completează coșul' at three shops ──");
  const links = page.locator('a[href^="/lista/magazin/"]');
  const n = await links.count();
  if (n === 0) {
    say("shops", "PROBLEM", "no per-shop links rendered — cannot complete a basket anywhere");
    return;
  }
  const hrefs: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < Math.min(n, 3); i++) {
    hrefs.push((await links.nth(i).getAttribute("href")) ?? "");
    labels.push(((await links.nth(i).textContent()) ?? "").replace(/\s+/g, " ").trim());
  }

  for (let i = 0; i < hrefs.length; i++) {
    const href = hrefs[i];
    say("shops", "fact", `--- ${labels[i]}  (${href})`);
    await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(4000);
    await shot(page, `02-shop-${i + 1}`);

    const body = ((await page.locator("body").textContent()) ?? "").replace(/\s+/g, " ").trim();
    if (/Application error|a client-side exception/i.test(body)) {
      say("shops", "PROBLEM", `${href} threw a client-side exception`);
      continue;
    }
    const h1 = await textOf(page, "h1");
    say("shops", "fact", `  h1: ${h1 ?? "(none)"}`);

    // Substitution lines are the thing to judge: did it swap a product, and does the swap read
    // as defensible to a person rather than only to resolveLine?
    const subs = page.locator("[class*=sub], [class*=Sub], .muted");
    const sn = await subs.count();
    const seen = new Set<string>();
    for (let j = 0; j < Math.min(sn, 40); j++) {
      const t = ((await subs.nth(j).textContent()) ?? "").replace(/\s+/g, " ").trim();
      if (t.length > 12 && !seen.has(t)) { seen.add(t); }
    }
    const interesting = [...seen].filter((t) => /în loc de|substitu|lipse|nu are|echivalent|alternativ/i.test(t));
    if (interesting.length === 0) say("shops", "fact", "  no substitution wording found on the page");
    for (const t of interesting.slice(0, 12)) say("shops", "fact", `  SUB: ${t.slice(0, 160)}`);

    const total = await textOf(page, ".rc-total");
    say("shops", "fact", `  TOTAL REAL: ${total ?? "(none)"}`);

    // EVERY LINE, because the substitutions are the thing to judge. A total is only defensible
    // if the swaps behind it are, and "cheapest equivalent" and "the same product" are not the
    // same claim.
    const lineRows = page.locator("tbody tr, li");
    const lrn = await lineRows.count();
    let shown = 0;
    for (let j = 0; j < lrn && shown < 22; j++) {
      const t = ((await lineRows.nth(j).textContent()) ?? "").replace(/\s+/g, " ").trim();
      if (t.length < 15) continue;
      if (!/lei|—|lipse|în loc/i.test(t)) continue;
      say("shops", "fact", `    ${t.slice(0, 150)}`);
      shown++;
    }
  }
}

// ── FLOW 3: A RECIPE ──────────────────────────────────────────────────────────────────────
async function flowRecipe(page: Page): Promise<void> {
  console.log("\n── FLOW 3: add a recipe ──");
  await page.goto(`${BASE}/retete`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  await shot(page, "03-recipes");

  const cards = page.locator(".card");
  say("recipe", "fact", `recipe cards: ${await cards.count()}`);
  // TWO STEPS, and the first version of this harness only knew about the second. The idle
  // button reads "Vezi ce alegem (N)" — a preview — and only after it resolves does an
  // "Adauga N in cos" appear. Searching for /adaug/i on the idle page found nothing and this
  // script reported "no adauga button on /retete", which was a claim about the site and a
  // fact about the harness.
  const previewBtn = page.locator("button", { hasText: /vezi ce alegem/i }).first();
  if (await previewBtn.count() === 0) {
    say("recipe", "PROBLEM", "no 'Vezi ce alegem' button on /retete");
    return;
  }
  say("recipe", "fact", `clicking: ${((await previewBtn.textContent()) ?? "").replace(/\s+/g, " ").trim()}`);
  await previewBtn.click().catch(() => {});
  await page.waitForTimeout(5000);
  await shot(page, "03-recipe-preview");

  // THE PREVIEW IS THE THING TO JUDGE: every line says what it chose and WHY.
  const lines = page.locator("ul.recipe-lines li");
  const ln = await lines.count();
  say("recipe", "fact", `preview lines: ${ln}`);
  for (let i = 0; i < Math.min(ln, 20); i++) {
    const t = ((await lines.nth(i).textContent()) ?? "").replace(/\s+/g, " ").trim();
    say("recipe", "fact", `  LINE ${t.slice(0, 160)}`);
  }

  const addBtn = page.locator("button", { hasText: /adaug.*în coș|adaug.*in cos/i }).first();
  if (await addBtn.count() === 0) {
    say("recipe", "PROBLEM", "preview rendered but no 'Adaugă … în coș' button");
    return;
  }
  say("recipe", "fact", `clicking: ${((await addBtn.textContent()) ?? "").replace(/\s+/g, " ").trim()}`);
  await addBtn.click().catch(() => {});
  await page.waitForTimeout(3500);
  await shot(page, "03-recipe-added");

  const body = ((await page.locator("body").textContent()) ?? "").replace(/\s+/g, " ").trim();
  const notice = body.match(/[^.]*(în loc de|echivalent|preferat|favorit)[^.]*\./gi) ?? [];
  for (const t of notice.slice(0, 8)) say("recipe", "fact", `NOTICE: ${t.trim().slice(0, 180)}`);
  if (notice.length === 0) say("recipe", "fact", "no substitution/favourite wording surfaced after adding");
}

// ── FLOW 4: ACCOUNT, ALERT, LOYALTY CARD ──────────────────────────────────────────────────
async function flowAccount(page: Page): Promise<void> {
  console.log("\n── FLOW 4: register, log out, log back in, alert, loyalty card ──");
  const username = `flow-${Date.now()}`;
  const password = "flow-test-password-1";

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
  await shot(page, "04-login");

  // The page carries both a sign-in and a register form; find the register one by its button.
  const forms = page.locator("form");
  const fn = await forms.count();
  say("account", "fact", `forms on /login: ${fn}`);

  let registered = false;
  for (let i = 0; i < fn; i++) {
    const f = forms.nth(i);
    const btn = ((await f.locator('button[type="submit"]').first().textContent().catch(() => "")) ?? "").toLowerCase();
    if (!/cont|înregistr|inregistr|creaz/i.test(btn)) continue;
    await f.locator('input[name="username"]').first().fill(username).catch(() => {});
    await f.locator('input[type="password"], input[name="password"]').first().fill(password).catch(() => {});
    await f.locator('button[type="submit"]').first().click().catch(() => {});
    registered = true;
    break;
  }
  if (!registered) {
    say("account", "PROBLEM", "could not find a register form on /login");
    return;
  }
  await page.waitForTimeout(3500);
  say("account", "fact", `after register, at ${page.url()}`);
  await shot(page, "04-registered");

  const signedIn = !/\/login/.test(page.url());
  if (!signedIn) {
    const err = await textOf(page, "[class*=err], [role=alert], .muted");
    say("account", "PROBLEM", `registration did not sign in; page says: ${err ?? "(nothing)"}`);
  }

  // Loyalty card
  await page.goto(`${BASE}/carduri`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  await shot(page, "04-cards");
  // TARGET THE CARD FIELD BY ITS LABEL. "the first non-hidden input" is the HEADER SEARCH BOX
  // on every page of this site, so the first version typed a card number into the search bar,
  // clicked a button that was not the save button, and then reported that the card had
  // vanished on reload. Nothing had vanished; nothing had ever been saved.
  const codeInput = page.locator('input[aria-label="Cod card"]');
  say("account", "fact", `/carduri card-code inputs: ${await codeInput.count()}`);
  const cardNumber = `1234${Date.now() % 100000}`;
  let savedCard = false;
  if (await codeInput.count() > 0) {
    await codeInput.first().fill(cardNumber).catch(() => {});
    const save = page.locator("button", { hasText: /salv|adaug/i }).first();
    if (await save.count() > 0) { await save.click().catch(() => {}); savedCard = true; }
    else say("account", "PROBLEM", "card field exists but no save/add button next to it");
  } else {
    say("account", "PROBLEM", "no input labelled 'Cod card' on /carduri");
  }
  await page.waitForTimeout(2500);
  if (savedCard) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const body = ((await page.locator("body").textContent()) ?? "");
    say("account", body.includes(cardNumber) ? "fact" : "PROBLEM",
      body.includes(cardNumber) ? `loyalty card ${cardNumber} survived a reload` : `loyalty card ${cardNumber} is GONE after reload`);
    await shot(page, "04-cards-after-reload");
  } else {
    say("account", "CONFUSING", "/carduri offered no obvious way to save a card");
  }

  // Alert
  await page.goto(`${BASE}/alerte`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  await shot(page, "04-alerts");
  const alertBody = ((await page.locator("body").textContent()) ?? "").replace(/\s+/g, " ").trim();
  say("account", "fact", `/alerte says: ${alertBody.slice(0, 220)}`);

  // Log out, log back in.
  await page.goto(`${BASE}/cont`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  const out = page.locator("button", { hasText: /deconect|ieși|log ?out/i }).first();
  if (await out.count() === 0) {
    say("account", "PROBLEM", "no log-out control on /cont");
  } else {
    await out.click().catch(() => {});
    await page.waitForTimeout(2500);
    say("account", "fact", `after logout, at ${page.url()}`);
  }

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
  const lforms = page.locator("form");
  // FIND THE SIGN-IN FORM BY ITS BUTTON, not by position. /login carries THREE forms — the
  // header search is form 0 — and "the first form that is not the register form" picked the
  // search box, submitted nothing, stayed on /login, and this script called it a failed login.
  // Another claim about the site that was a fact about the harness.
  let loggedIn = false;
  for (let i = 0; i < await lforms.count(); i++) {
    const f = lforms.nth(i);
    const btn = ((await f.locator('button[type="submit"]').first().textContent().catch(() => "")) ?? "").trim();
    if (!/autentificare/i.test(btn)) continue;
    await f.locator('input[name="username"]').first().fill(username).catch(() => {});
    await f.locator('input[type="password"], input[name="password"]').first().fill(password).catch(() => {});
    await f.locator('button[type="submit"]').first().click().catch(() => {});
    loggedIn = true;
    break;
  }
  if (!loggedIn) say("account", "PROBLEM", "no form with an 'Autentificare' button on /login");
  await page.waitForTimeout(3000);
  say("account", loggedIn && !/\/login/.test(page.url()) ? "fact" : "PROBLEM",
    `log back in -> ${page.url()}`);
  await shot(page, "04-logged-back-in");
}

// ── FLOW 5: 390px ─────────────────────────────────────────────────────────────────────────
async function flowMobile(browser: Browser): Promise<void> {
  console.log("\n── FLOW 5: the whole basket flow at 390px ──");
  const ctx = await browser.newContext({
    locale: "ro-RO",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  page.on("console", (m: ConsoleMessage) => { if (m.type() === "error") consoleErrors.push(`[390px] ${m.text().slice(0, 200)}`); });

  await page.goto(`${BASE}/lista`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot(page, "05-mobile-lista");

  const input = page.locator('input[aria-label="Adaugă produs"]');
  if (await input.count() === 0) {
    say("mobile", "PROBLEM", "no add-product input at 390px");
  } else {
    for (const term of ["lapte", "paine", "oua", "unt", "cafea"]) {
      await input.fill("");
      await input.type(term, { delay: 20 });
      await page.waitForTimeout(800);
      const sug = page.locator("ul.lista-suggest li button");
      if (await sug.count() > 0) await sug.first().click().catch(() => {});
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(5000);
    await shot(page, "05-mobile-results");
  }

  // HORIZONTAL SCROLL IS THE MOBILE DEFECT THAT MATTERS: a page wider than the phone makes a
  // person pinch and give up, and it never produces an error anywhere.
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth, bodyScrollW: document.body.scrollWidth };
  });
  if (overflow.scrollW > overflow.clientW + 1) {
    say("mobile", "PROBLEM", `the page scrolls sideways at 390px: content ${overflow.scrollW}px in a ${overflow.clientW}px viewport`);
  } else {
    say("mobile", "fact", `no horizontal scroll at 390px (${overflow.scrollW} <= ${overflow.clientW})`);
  }

  // Tap targets: anything interactive under 32px is hard to hit on a phone.
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, a, input"))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 32 || r.width < 32) {
        const t = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
        out.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${t}"`);
      }
    }
    return out.slice(0, 15);
  });
  if (small.length > 0) {
    say("mobile", "CONFUSING", `${small.length} interactive elements under 32px:`);
    for (const s of small) say("mobile", "CONFUSING", `  ${s}`);
  }

  await ctx.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const argv = process.argv.slice(2);
  const keep = argv.includes("--keep");
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
  const run = (name: string) => !only || only.has(name);

  const alive = await fetch(BASE).then((r) => r.ok).catch(() => false);
  if (!alive) {
    console.error(`Cannot reach ${BASE}. Start the server (npm run serve) and try again.`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("console", (m: ConsoleMessage) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 200)}`));

  console.log("═".repeat(100));
  console.log(`USER FLOWS — performed in a real browser against ${BASE}`);
  console.log("═".repeat(100));

  if (run("basket")) await flowBasket(page);
  if (run("shops")) await flowShops(page);
  if (run("recipe")) await flowRecipe(page);
  if (run("account")) await flowAccount(page);
  if (run("mobile")) await flowMobile(browser);

  console.log(`\n${"─".repeat(100)}`);
  console.log("CONSOLE ERRORS");
  console.log("─".repeat(100));
  if (consoleErrors.length === 0) console.log("  none");
  for (const e of [...new Set(consoleErrors)].slice(0, 25)) console.log(`  ${e}`);

  const problems = notes.filter((n) => n.kind === "PROBLEM");
  const confusing = notes.filter((n) => n.kind === "CONFUSING");
  console.log(`\n${"─".repeat(100)}`);
  console.log(`  ${problems.length} PROBLEM · ${confusing.length} CONFUSING · ${consoleErrors.length} console errors`);
  console.log(`  screenshots in logs/flow/`);
  console.log(`\n  THE REST IS A JUDGEMENT. Whether these baskets are ones a person would buy is`);
  console.log(`  not something this script can answer; it collected the evidence for reading.`);

  writeFileSync(join(OUT, "notes.json"), JSON.stringify({ notes, consoleErrors }, null, 2));

  if (!keep) { await ctx.close(); await browser.close(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
