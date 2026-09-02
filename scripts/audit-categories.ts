// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not, and reports the live subset separately.
//
// Does the grocery tree hold what it claims to hold?
//
// IMPORTS ONLY PrismaClient. Not the tree, not the assigner, not normalizeRo. That is the whole
// point: `assign:categories` decided these rows, and a checker that shared its vocabulary would
// share its blind spots and would agree with it by construction. Three corruptions in this
// project were found precisely because the checker did not import the writer. So the token
// analysis below is re-implemented here, deliberately, in a few lines.
//
// Read-only. Run: npm run audit:categories

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number) => String(s).padStart(n);

/** Local, deliberately not imported. Romanian folding + tokens. */
function norm(s: string): string {
  return s.toLowerCase()
    .split("ș").join("s").split("ş").join("s")
    .split("ț").join("t").split("ţ").join("t")
    .split("ă").join("a").split("â").join("a").split("î").join("i")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
const NOISE = new Set([
  "de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "o", "kg", "ml", "buc", "gr",
  "bucati", "set", "pachet", "promo", "x", "cca", "metro", "chef", "aro", "fine", "life",
  "auchan", "carrefour", "sezamo", "eco", "bio", "the", "and",
]);
function toks(s: string): string[] {
  return norm(s).split(/\s+/).filter((t) => t.length >= 4 && !NOISE.has(t) && !/^\d+$/.test(t));
}

async function main(): Promise<void> {
  const cats = await prisma.category.findMany({
    where: { section: "grocery" },
    select: { id: true, slug: true, name: true, parentId: true },
    orderBy: { name: "asc" },
  });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const leaves = cats.filter((c) => c.parentId != null);
  const depts = cats.filter((c) => c.parentId == null);

  const total = await prisma.product.count({ where: { section: "grocery" } });
  const assigned = await prisma.product.count({ where: { section: "grocery", categoryId: { not: null } } });
  const live = await prisma.product.count({
    where: { section: "grocery", offers: { some: { isStale: false, flagged: false, availability: "in stock", merchant: { active: true } } } },
  });
  const liveAssigned = await prisma.product.count({
    where: {
      section: "grocery", categoryId: { not: null },
      offers: { some: { isStale: false, flagged: false, availability: "in stock", merchant: { active: true } } },
    },
  });

  // "WHAT A SIDEBAR WOULD SHOW" HAS TO MEAN WHAT THE SHOPPER CAN SEE.
  //
  // Delivery-platform offers are excluded from every user-facing surface by default, so a
  // product whose ONLY live offer is a Glovo one never renders. Counting those in the live
  // figure measured a catalog nobody can browse: 1,920 platform-only products, nearly all
  // uncategorised, dragged the number from 88.2% down to 85.3% and made the sidebar look
  // worse than it is. The literal, spelled-out price source is used rather than an import,
  // because this file deliberately shares nothing with the code that wrote these rows.
  const visibleOffer = {
    isStale: false, flagged: false, availability: "in stock",
    merchant: { active: true }, NOT: { priceSource: "DELIVERY_PLATFORM" },
  } as const;
  const visible = await prisma.product.count({
    where: { section: "grocery", offers: { some: visibleOffer } },
  });
  const visibleAssigned = await prisma.product.count({
    where: { section: "grocery", categoryId: { not: null }, offers: { some: visibleOffer } },
  });

  console.log(`\n════ GROCERY CATEGORY AUDIT ═════════════════════════════════════════════════`);
  console.log(`  tree: ${depts.length} departments, ${leaves.length} leaves`);
  console.log(`  ALL products : ${assigned}/${total} categorised  (${((assigned / total) * 100).toFixed(1)}%)`);
  console.log(`  LIVE products: ${liveAssigned}/${live} categorised  (${((liveAssigned / live) * 100).toFixed(1)}%)   incl. rows hidden by default`);
  console.log(`  VISIBLE      : ${visibleAssigned}/${visible} categorised  (${((visibleAssigned / visible) * 100).toFixed(1)}%)   <- what a sidebar would show`);

  // ── per category: count + a sample to eyeball
  console.log(`\n\n════ WHAT IS IN EACH CATEGORY ═══════════════════════════════════════════════`);
  const suspects: string[] = [];
  for (const d of depts) {
    const kids = leaves.filter((l) => l.parentId === d.id);
    const deptCount = await prisma.product.count({ where: { section: "grocery", categoryId: { in: [d.id, ...kids.map((k) => k.id)] } } });
    console.log(`\n${d.name}  —  ${deptCount} products`);
    for (const l of kids) {
      const rows = await prisma.product.findMany({
        where: { section: "grocery", categoryId: l.id },
        select: { name: true }, take: 400,
      });
      if (rows.length === 0) { console.log(`   ${pad(l.name, 30)}${lp(0, 6)}`); continue; }
      console.log(`   ${pad(l.name, 30)}${lp(rows.length, 6)}`);
      for (const r of rows.slice(0, 10)) console.log(`        ${r.name.slice(0, 82)}`);

      // ── ODD ONE OUT: a product sharing no token with any sibling is suspect.
      //
      // Re-derived here from the names alone. The assigner's own reason is deliberately NOT
      // consulted — if it were, this would only ever confirm the assigner's opinion of itself.
      const sets = rows.map((r) => new Set(toks(r.name)));
      const freq = new Map<string, number>();
      for (const st of sets) for (const t of st) freq.set(t, (freq.get(t) ?? 0) + 1);
      let odd = 0;
      let firstOdd = "";
      for (let i = 0; i < rows.length; i++) {
        const shared = [...sets[i]].some((t) => (freq.get(t) ?? 0) > 1);
        if (!shared && sets[i].size > 0) { odd++; if (!firstOdd) firstOdd = rows[i].name; }
      }
      if (odd > 0) {
        const share = (odd / rows.length) * 100;
        console.log(`        ⚠ ${odd} product(s) share no word with any sibling (${share.toFixed(0)}%) e.g. "${firstOdd.slice(0, 56)}"`);
        if (share > 25 && rows.length >= 8) suspects.push(`${l.name}: ${odd}/${rows.length} share no word with a sibling`);
      }
    }
  }

  // ── CROSS-CHECK against what merchants say, where both exist.
  //
  // Mega Image publishes its own first-level category in the product URL path. If we filed a
  // product under Lactate and Mega Image shelves it under Băuturi, one of us is wrong, and the
  // disagreement is the finding. Read straight off the URL — no shared code with the assigner.
  console.log(`\n\n════ CROSS-CHECK vs MERCHANT-SUPPLIED CATEGORIES ════════════════════════════`);
  const mega = await prisma.merchant.findFirst({ where: { slug: "mega-image" }, select: { id: true } });
  let compared = 0;
  let disagreed = 0;
  const examples: string[] = [];
  if (mega) {
    const offers = await prisma.offer.findMany({
      where: { merchantId: mega.id, product: { section: "grocery", categoryId: { not: null } } },
      select: { productUrl: true, url: true, product: { select: { name: true, categoryId: true } } },
    });
    for (const o of offers) {
      const u = o.productUrl ?? o.url;
      if (!u) continue;
      const seg = u.split("/").filter(Boolean)[u.startsWith("http") ? 2 : 0];
      if (!seg || seg.length < 3) continue;
      const theirs = norm(seg.replace(/-/g, " "));
      const ours = byId.get(o.product.categoryId!);
      if (!ours) continue;
      const ourDept = ours.parentId ? byId.get(ours.parentId) : ours;
      if (!ourDept) continue;
      compared++;
      // Agreement = any shared significant word between their top level and our department.
      const theirToks = new Set(toks(theirs));
      const ourToks = new Set(toks(ourDept.name));
      const agree = [...theirToks].some((t) => ourToks.has(t));
      if (!agree) {
        disagreed++;
        if (examples.length < 12) examples.push(`${pad(theirs, 26)} vs ${pad(ourDept.name, 22)} — ${o.product.name.slice(0, 44)}`);
      }
    }
    console.log(`  Mega Image publishes a category for ${compared} of our categorised products.`);
    console.log(`  DISAGREEMENTS: ${disagreed} (${compared ? ((disagreed / compared) * 100).toFixed(1) : "0"}%)`);
    for (const e of examples) console.log(`    ${e}`);
    console.log(`\n  A disagreement is not automatically our error — their top level is coarser than`);
    console.log(`  our department in places — but every one is worth an eye.`);
  }

  // ── structural invariants
  console.log(`\n\n════ STRUCTURE ══════════════════════════════════════════════════════════════`);
  const orphanLeaves = leaves.filter((l) => !byId.has(l.parentId!));
  const emptyLeaves: string[] = [];
  for (const l of leaves) {
    const n = await prisma.product.count({ where: { section: "grocery", categoryId: l.id } });
    if (n === 0) emptyLeaves.push(l.name);
  }
  const onParent = await prisma.product.count({ where: { section: "grocery", categoryId: { in: depts.map((d) => d.id) } } });
  console.log(`  leaves whose parent does not exist : ${orphanLeaves.length}`);
  console.log(`  leaves holding no products         : ${emptyLeaves.length}${emptyLeaves.length ? " — " + emptyLeaves.slice(0, 8).join(", ") : ""}`);
  console.log(`  products filed on a DEPARTMENT     : ${onParent}  (should be 0 — every product belongs on a leaf)`);

  if (suspects.length) {
    console.log(`\n  ⚠ CATEGORIES WORTH A SECOND LOOK`);
    for (const s of suspects.slice(0, 12)) console.log(`    ${s}`);
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
