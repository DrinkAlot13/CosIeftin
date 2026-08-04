// Downloads remote product images (set by the scrapers) into public/product-images
// and rewrites product.image to the local path — so images are self-hosted.
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

const DIR = path.join(process.cwd(), "public", "product-images");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ext(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const products = await prisma.product.findMany({ where: { image: { startsWith: "http" } } });
  let ok = 0;
  let fail = 0;
  for (const p of products) {
    try {
      const res = await fetch(p.image!, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const file = `${p.slug}.${ext(res.headers.get("content-type") ?? "")}`;
      fs.writeFileSync(path.join(DIR, file), buf);
      await prisma.product.update({ where: { id: p.id }, data: { image: `/product-images/${file}` } });
      ok++;
      console.log(`  ✓ ${p.slug}  (${(buf.length / 1024).toFixed(0)} kb)`);
    } catch (e) {
      fail++;
      console.log(`  ! ${p.slug}: ${(e as Error).message}`);
    }
    await sleep(250);
  }
  console.log(`\nDownloaded ${ok} images (${fail} failed) -> public/product-images/`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
