# Nightly refresh & scheduling

## What runs

`npm run nightly` =
`scrape:all` → `set-store-economics` → `scrape:dcneu-tiers` → `backfill:namenorm`
→ `index:compute` → `notify:alerts`

- **scrape:all** — Auchan (catalog master) then every store: Freshful, Mega Image,
  Carrefour, Metro, Sezamo, FineStore, Le Manoir, Carrefour-alcohol, DCNeu, Farmacia Tei,
  **Kaufland**, **Penny** + image download. Auchan gates the run; each other store retries
  once, so one transient failure won't abort the night. **Does NOT reset the DB** — offers
  upsert and a price point is appended *when the price changed*.
- **set-store-economics** — store type, delivery fee, free-delivery threshold, minimum
  order (idempotent). The basket optimizer needs these to be honest.
- **scrape:dcneu-tiers** — one bounded batch (default 160, parallel ×4) of DCNeu quantity
  discounts; only products still missing tiers, so coverage grows every night.
- **backfill:namenorm** — refreshes the diacritic-folded search key on new products.
- **index:compute** — prices the Indexul CoșMic basket and stores one row per day.
- **notify:alerts** — Telegram price-drop notifications. **Safe by default:** with no
  `TELEGRAM_BOT_TOKEN` it dry-runs and sends nothing.

Runtime ≈ 45–65 min. Peak RAM ≈ 1.5–2 GB (headless Chromium).

## Safety rails that run automatically

These exist so a bad night can't destroy good data:

- **Collapsed-run guard** — if a store returns < 60 % of its last offer count (site
  redesign, anti-bot block), `matchPoolToCatalog` **refuses the run** and keeps the
  previous prices rather than marking everything out of stock.
- **Empty-pool guard** — a scraper that parses zero products exits non-zero and never
  touches the database.
- **Price sanity gates** — a price > 4× or < ¼ of the offer's own previous price, or
  > 6× / < ⅙ the cross-store median, is **flagged and not written** (the trusted price is
  kept). Low-confidence matches are written but flagged.
- **Review queue** — everything flagged lands in `/admin/review`. Decisions are stored as
  `MatchOverride` rows, which **survive a full rebuild**.

Check `/admin/review` after a nightly run; a spike in flags usually means a store changed
its markup, not that prices moved.

## Schedule it

Grocery prices move slowly and chains run weekly promo cycles, so **once nightly is enough**.

### Unraid (User Scripts plugin)
Schedule `Custom` → cron `0 4 * * *` (04:00 daily):

```sh
#!/bin/bash
docker exec cosmic sh -lc "cd /app && npm run nightly" >> /mnt/user/appdata/cosmic/nightly.log 2>&1
```

### Plain cron (Linux host)
```cron
0 4 * * *  cd /path/to/grocery-compare && /usr/bin/npm run nightly >> /var/log/cosmic-nightly.log 2>&1
```

## Notes / knobs

- **Images** self-host in bounded batches (default 600/run, `IMG_LIMIT=all` for one big
  pass). Note the legal posture in `docs/data-sources.md`: rehosting images is the
  highest-risk artifact — prefer hotlinking where you can.
- **DCNeu tiers**: raise `DCNEU_TIERS_MAX` (e.g. 500) and/or `DCNEU_TIERS_CONCURRENCY`
  (e.g. 6). It's the slowest step (one page render per product).
- **Do NOT run `npm run refresh` on a schedule** — it `--force-reset`s the DB and wipes
  price history. Use it only for a deliberate clean rebuild.
- **Price history** is now append-**on-change** only (~2–5 % of offers move on a given day),
  which is a 20–50× row reduction versus writing every offer every night — and it removes
  the need for a prune job for a long time.
- **Postgres**: before real traffic, migrate. `prisma/schema.postgres.prisma` +
  `npm run db:migrate-postgres` (row-count and money-checksum verification included).
