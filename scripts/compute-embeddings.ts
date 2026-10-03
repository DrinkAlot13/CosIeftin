// Computes and stores a semantic-similarity vector for every grocery product that doesn't
// have one yet. One-time cost (~14 minutes for the whole catalog, measured), re-run safely
// any time — only products with `embedding: null` are processed, so a nightly re-scrape that
// adds new products only pays for those.
//
// WHY THIS EXISTS. The structural fallback (`structuralCandidateIds`, queries.ts) only ever
// finds a candidate that shares the exact same head NOUN. Two products describing the same
// thing in different words — a true synonym, a different brand's phrasing, a translated term —
// never become candidates at all, which is a real recall gap the head-noun approach cannot
// close by construction. A semantic embedding model finds those.
//
// WHAT THIS DOES NOT DO. It does not replace the mutual-distinction safety check. Measured
// directly (see docs in prisma/schema.prisma and queries.ts): BGE-M3 scores "crema depilatoare
// ... piele sensibilă" against "crema de mâini ... glicerină" at 0.856 cosine similarity —
// HIGHER than two genuine coffee-bean matches scored against each other (0.827-0.841). There is
// no similarity threshold that is simultaneously safe and useful on its own. Embedding
// similarity here is a CANDIDATE FINDER (recall), never the accept/reject decision (precision) —
// that stays with the existing token-based mutual-distinction check.
//
//   npm run compute:embeddings

import { pipeline } from "@huggingface/transformers";
import { prisma } from "../src/lib/db";

const MODEL = "Xenova/bge-m3";
const BATCH_LOG_EVERY = 500;

async function main() {
  const todo = await prisma.product.findMany({
    where: { section: "grocery", embedding: null, offers: { some: { isStale: false, flagged: false } } },
    select: { id: true, name: true, brand: true },
  });
  if (todo.length === 0) {
    console.log("Nothing to do — every live grocery product already has an embedding.");
    await prisma.$disconnect();
    return;
  }
  console.log(`Computing embeddings for ${todo.length} products (model: ${MODEL})…`);

  const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  const t0 = Date.now();
  let done = 0;
  for (const p of todo) {
    const text = `${p.brand ?? ""} ${p.name}`.trim();
    const out = await extractor(text, { pooling: "mean", normalize: true });
    const vec = Float32Array.from(out.data as Float32Array);
    await prisma.product.update({
      where: { id: p.id },
      data: { embedding: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength) },
    });
    done++;
    if (done % BATCH_LOG_EVERY === 0) {
      const elapsedMin = (Date.now() - t0) / 60000;
      const rate = done / elapsedMin;
      const etaMin = (todo.length - done) / rate;
      console.log(`  ${done}/${todo.length} (${elapsedMin.toFixed(1)} min elapsed, ~${etaMin.toFixed(1)} min remaining)`);
    }
  }
  console.log(`\n✓ Computed ${done} embeddings in ${((Date.now() - t0) / 60000).toFixed(1)} minutes.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
