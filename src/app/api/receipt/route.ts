// Receipt (bon fiscal) ingestion. Takes the TEXT of a receipt and returns the parsed
// lines, matched against the catalog where possible.
//
// The OCR step is deliberately NOT here: this route accepts text so it works with any
// source (a vision model, Tesseract, or a paste). Wire an OCR provider in front of it and
// POST the resulting text.
//
// Nothing is written to the price tables yet — receipts are user-submitted, so they need a
// review/aggregation policy (several receipts agreeing) before they can move a price.
// This returns `preview` so the UI can show the shopper what we understood.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseReceiptText, receiptBalances } from "@/lib/receipt";
import { normalizeText } from "@/lib/matching";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = String(body?.text ?? "");
  if (text.trim().length < 10) {
    return NextResponse.json({ error: "trimite textul bonului (câmpul 'text')" }, { status: 400 });
  }

  const parsed = parseReceiptText(text);
  const merchant = parsed.merchant
    ? await prisma.merchant.findUnique({ where: { slug: parsed.merchant }, select: { id: true, name: true } })
    : null;

  // Try to attach each receipt line to a catalog product (best-effort, for the preview).
  const preview = [];
  for (const line of parsed.lines) {
    const norm = normalizeText(line.name);
    const first = norm.split(/\s+/).filter((t) => t.length >= 3)[0] ?? "";
    const match = first
      ? await prisma.product.findFirst({
          where: { section: "grocery", nameNorm: { contains: first } },
          select: { id: true, slug: true, name: true },
        })
      : null;
    preview.push({
      raw: line.name,
      qty: line.qty,
      paidUnitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      matched: match ? { slug: match.slug, name: match.name } : null,
    });
  }

  return NextResponse.json({
    merchant: merchant ? { slug: parsed.merchant, name: merchant.name } : parsed.merchant,
    date: parsed.date,
    total: parsed.total,
    balances: receiptBalances(parsed),
    itemCount: parsed.lines.length,
    preview,
    skipped: parsed.skipped,
    note: "Prețurile din bon nu sunt încă publicate — le folosim după validare (mai multe bonuri care confirmă același preț).",
  });
}
