// Telegram bot webhook. Lets a shopper watch prices without opening the site.
//
// Commands:
//   /start              — welcome + how it works
//   /watch <text>       — search the catalog and watch the best match
//   /watch <text> < 20  — watch with a target price
//   /list               — what you're watching
//   /stop <text>        — stop watching
//
// Security: Telegram sends the shared secret in X-Telegram-Bot-Api-Secret-Token when the
// webhook was registered with secret_token. Without TELEGRAM_WEBHOOK_SECRET set, the route
// refuses everything rather than accepting unauthenticated calls.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendTelegram, esc } from "@/lib/telegram";
import { normalizeText } from "@/lib/matching";
import { parsePriceLei } from "@/lib/price/parsePrice";

export const dynamic = "force-dynamic";

type Update = { message?: { chat?: { id?: number | string }; text?: string } };

const HELP = [
  "👋 Salut! Sunt botul <b>CosIeftin</b> — te anunț când se ieftinesc produsele pe care le urmărești.",
  "",
  "<b>Comenzi:</b>",
  "/watch lapte zuzu — urmărește produsul",
  "/watch cafea &lt; 25 — urmărește cu preț țintă 25 lei",
  "/list — ce urmărești acum",
  "/stop lapte zuzu — nu mai urmări",
].join("\n");

async function findProduct(q: string) {
  const norm = normalizeText(q);
  if (!norm) return null;
  return prisma.product.findFirst({
    where: { nameNorm: { contains: norm }, offers: { some: { availability: "in stock", flagged: false } } },
    select: {
      id: true, name: true, slug: true,
      offers: {
        where: { availability: "in stock", flagged: false },
        select: { price: true, merchant: { select: { name: true } } },
        orderBy: { price: "asc" }, take: 1,
      },
    },
  });
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = (await req.json().catch(() => null)) as Update | null;
  const chatId = update?.message?.chat?.id;
  const text = (update?.message?.text ?? "").trim();
  if (!chatId || !text) return NextResponse.json({ ok: true });
  const chat = String(chatId);

  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, "");
  let arg = rest.join(" ").trim();

  // "/watch cafea < 25" — optional target price
  let target: number | null = null;
  const t = arg.match(/[<≤]\s*([\d.,]+)\s*$/);
  if (t) {
    // a shopper-typed target is still a price — same parser, same rules
    target = parsePriceLei(t[1]);
    arg = arg.slice(0, t.index).trim();
  }

  if (cmd === "/start" || cmd === "/help") {
    await sendTelegram(chat, HELP);
    return NextResponse.json({ ok: true });
  }

  if (cmd === "/list") {
    const rows = await prisma.priceAlert.findMany({
      where: { chatId: chat, active: true },
      include: { product: { select: { name: true } } },
      take: 40,
    });
    const body = rows.length
      ? rows.map((r) => `• ${esc(r.product.name)}${r.targetPrice ? ` (țintă ${r.targetPrice} lei)` : ""}`).join("\n")
      : "Nu urmărești niciun produs încă. Încearcă: <code>/watch lapte</code>";
    await sendTelegram(chat, `<b>Produse urmărite</b>\n${body}`);
    return NextResponse.json({ ok: true });
  }

  if (cmd === "/watch") {
    if (!arg) { await sendTelegram(chat, "Scrie ce să urmăresc, ex: <code>/watch lapte zuzu</code>"); return NextResponse.json({ ok: true }); }
    const p = await findProduct(arg);
    if (!p || !p.offers[0]) {
      await sendTelegram(chat, `Nu am găsit „${esc(arg)}”. Încearcă alt nume.`);
      return NextResponse.json({ ok: true });
    }
    const price = p.offers[0].price;
    await prisma.priceAlert.upsert({
      where: { chatId_productId: { chatId: chat, productId: p.id } },
      update: { targetPrice: target, basePrice: price, active: true },
      create: { chatId: chat, productId: p.id, targetPrice: target, basePrice: price },
    });
    await sendTelegram(
      chat,
      `✅ Urmăresc <b>${esc(p.name)}</b>\nAcum: ${price.toFixed(2)} lei la ${esc(p.offers[0].merchant.name)}` +
        (target ? `\nTe anunț sub ${target} lei.` : "\nTe anunț când se ieftinește."),
    );
    return NextResponse.json({ ok: true });
  }

  if (cmd === "/stop") {
    const p = await findProduct(arg);
    if (p) {
      await prisma.priceAlert.updateMany({ where: { chatId: chat, productId: p.id }, data: { active: false } });
      await sendTelegram(chat, `🛑 Nu mai urmăresc <b>${esc(p.name)}</b>.`);
    } else {
      await sendTelegram(chat, "Nu am găsit produsul.");
    }
    return NextResponse.json({ ok: true });
  }

  await sendTelegram(chat, HELP);
  return NextResponse.json({ ok: true });
}
