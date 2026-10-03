# CosIeftin — grocery price comparison + smart shopping list (RO)

Compare prices for a curated set of grocery items across Romanian chains (Kaufland,
Lidl, Carrefour, Auchan, Mega Image, Profi), see the cheapest per item with **price
per unit** (lei/kg, lei/L), and build a **shopping list** that tells you the cheapest
**single store** vs the cheapest **split across stores**.

> Built by reusing the PretMic price-comparison engine (matching, ingestion, pricing,
> design system, auth). **Demo data** — prices are fictional; see `docs/data-sourcing.md`.

## Stack

- **Next.js 14 (App Router) + TypeScript**, **Prisma + SQLite** (→ Postgres for prod).
- Reused core: `src/lib/matching.ts` (fuzzy matching), `src/lib/db.ts`, `src/lib/format.ts`,
  `src/lib/auth.ts`, the CSS design system, `PriceHistoryChart`.
- Grocery-specific: unit-price normalization (`pricing.ts`, `format.ts`), size-aware
  item matching + `ingestItemsForMerchant` (`src/lib/ingest-core.ts`), and the basket
  optimizer (`src/lib/basket.ts`).

## Quick start

```bash
npm install       # runs prisma generate
npm run setup     # reset DB -> sample scraped data -> ingest (match) -> history -> admin
npm run dev       # http://localhost:3000
```

`npm run setup` steps: `generate-sample` (per-chain NDJSON mimicking scraper output) →
`ingest` (seeds the pre-set catalog, then matches offers by size-guarded fuzzy match) →
`seed-history` → `seed-admin`.

## Routes

- `/` home — search, categories, biggest drops, "make a list" CTA
- `/c/[slug]` category — sort by **price/unit**, price, name
- `/p/[slug]` item — per-store price table with **unit price**, price-history chart, add-to-list
- `/lista` — **the list builder**: cheapest single store vs cheapest split, savings, per-store totals
- `/search?q=` typo-tolerant search · `/api/suggest`, `/api/basket`
- `/login`, `/cont`, `/admin` (admin username **`admin`**; there is no default password —
  `ADMIN_PASSWORD='…' npm run seed-admin` sets one, see `scripts/seed-admin.ts`)
- Installable **PWA** (`/manifest.webmanifest`) so the list works on mobile in-store.

## Data sourcing — REAL data only (no sample data)

Prices come exclusively from scrapers. `npm run setup` seeds only the catalog (categories +
pre-set items, no prices) + admin. Then:

| Store | How | Command |
|-------|-----|---------|
| **Auchan** | VTEX public catalog API (`fetch`) | `npm run scrape:auchan` |
| **Freshful** | Next.js SSR category pages (`fetch`) | `npm run scrape:freshful` |
| **Mega Image** | Playwright (Akamai + store-gated + Apollo GraphQL) | `npm run scrape:megaimage` |
| **all + images** | | `npm run scrape:all` |

Full rebuild: `npm run refresh` (= setup + scrape:all). Carrefour (Cloudflare) loads via
Playwright but its Magento product DOM isn't parsed yet — a documented next-step. Details +
legal notes in `docs/data-sourcing.md`. **Get a lawyer's review before scaling scraping.**

## Deploy — Docker + git → Unraid

Everything (web + scrapers, incl. the Playwright/Chromium one) runs in **one container**
(`Dockerfile` is based on the Playwright image). SQLite DB + product images live on mounted
volumes so they survive updates.

**Local:** `docker compose up -d --build` → http://localhost:3000

**Git-based deploy to Unraid:**
1. Push this repo to GitHub. The included Action (`.github/workflows/docker.yml`) builds and
   pushes `ghcr.io/<your-username>/cosmic:latest` on every push to `main`.
   (Make the GHCR package public, or add registry creds on Unraid.)
2. On **Unraid → Docker → Add Container**:
   - Repository: `ghcr.io/<your-username>/cosmic:latest`
   - Port: `3000` → host port of choice
   - Path: `/data` → `/mnt/user/appdata/cosmic/data` (the DB)
   - Path: `/app/public/product-images` → `/mnt/user/appdata/cosmic/images`
   - Env: `AUTH_SECRET` = a long random string; `SITE_URL` = `http://<unraid-ip>:<port>`
3. **Auto-update on git push:** enable Unraid's *CA Auto Update Applications* (or Watchtower)
   for the container — pushing to `main` rebuilds the image and Unraid pulls it.
4. **Scheduled price refresh:** Unraid *User Scripts* plugin, cron e.g. daily:
   `docker exec cosmic sh -lc "cd /app && npm run scrape:all"`
   (Chromium is inside the container, so the Mega Image scraper works there too.)

Postgres instead of SQLite: change the `provider` in `prisma/schema.prisma` and set a
`postgresql://` `DATABASE_URL` (add a Postgres container / Unraid app).
