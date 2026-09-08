# Deployment checklist

**Everything that must be true in production and is NOT true locally.** One page, read before
hosting. If a line here is wrong on the day you go live, the failure is silent — that is the
selection criterion for what appears below.

Run `npm run audit:deploy` to check every mechanical item on this page against the running
process. It cannot check the judgement calls; those are marked ☐ and are yours.

---

## 1. Secrets and origin — the build refuses without some of these, and lies without the others

| variable | local | production | if wrong |
|---|---|---|---|
| `AUTH_SECRET` | placeholder | **a fresh random 32+ bytes** | anyone can forge a session cookie |
| `SITE_URL` | `http://localhost:3000` | **`https://<your domain>`** | every canonical tag, OpenGraph URL and sitemap entry points somewhere you do not control |
| `DATABASE_URL` | `file:./dev.db` | `postgres://…` | see §4 |
| `REVALIDATE_SECRET` | set | **rotated** | anyone can purge your cache at will |
| `TRUST_PROXY` | unset | **`1`, and only behind a proxy that overwrites `x-forwarded-for`** | see §2 |

**`AUTH_SECRET` is a RUNTIME secret and must not be needed at build time.** `SITE_URL` is the
opposite: `metadataBase` is baked into the build output, so `npm run build` refuses to run
without it rather than guessing. That refusal is deliberate — a wrong origin is expensive to
undo once Google has indexed it.

**Rotating `AUTH_SECRET` logs everyone out.** That is correct on first deploy and after any
suspected leak. Do it deliberately, not by accident.

☐ **`SITE_URL` must answer.** It is a separate setting from the port the server listens on, and
they have already disagreed once: `SITE_URL` said `:3200` while the server served `:3000`, so
the sitemap advertised an origin nothing served. `npm run probe:sitemap` now fails on exactly
that, and the failure names it rather than reporting "zero URLs read".

## 2. `TRUST_PROXY` — without it the rate limiter is one shared bucket

`lib/rate-limit.ts` is per-IP. `next start` with nothing in front receives no
`x-forwarded-for` and populates no socket address, so **every caller looks identical** and the
per-IP limiter silently becomes a global one.

That is handled rather than ignored — an unidentified caller gets a larger *shared* budget so
one noisy client cannot lock everyone out — but the protection is much weaker:

| limit | per identified caller | shared, when nobody can be identified |
|---|---|---|
| `login` | 10 / 15 min | 50 / 15 min |
| `register` | 5 / hour | 20 / hour |
| `write` | 60 / min | 600 / min |
| `listAdd` | 120 / min | 2,400 / min |

**Do NOT set `TRUST_PROXY=1` without a proxy in front that OVERWRITES `x-forwarded-for`.** The
header is client-supplied. Trusting it when nothing rewrites it is worse than no limiter,
because an attacker then mints a fresh budget per request while the dashboard says "rate
limiting: on".

☐ Reverse proxy configured to overwrite (not append) `x-forwarded-for`
☐ `TRUST_PROXY=1`
☐ `npm run audit:rate-limit` run against the deployed host and reporting that callers ARE told apart

**This limiter is in-memory and single-process.** It resets on every restart and counts per
process, so two instances behind a load balancer allow twice the budget. It raises the cost of
casual abuse; it is not an edge limiter and must not be described as one.

## 3. Feature flags that are OFF for a reason

| flag | default | why it is off |
|---|---|---|
| `FEATURE_TRUST` | off | the shrinkflation page and the "is this discount real?" verdict both publish a **factual claim about a named company**. Enabling is a decision a person makes after reading the detections, not a default. `/shrinkflation` 404s while it is off, deliberately — an empty page invites the assumption that we simply found nothing |
| `SHOW_DELIVERY_PLATFORM` | off | delivery-platform prices carry a markup. Showing them beside shelf prices without saying so compares two different things |

☐ Both reviewed deliberately, not inherited from a local `.env`

## 4. The Postgres cutover

SQLite is the MVP store. The schema for Postgres is **generated**, never hand-edited.

1. ☐ Edit `prisma/schema.prisma`, then `npm run gen:postgres`. Hand-maintaining
   `schema.postgres.prisma` let it fall **11 models behind** once already.
2. ☐ Set `DATABASE_URL` to the `postgres://` URL and change the provider in `schema.prisma`.
3. ☐ `npm run verify:push -- --out logs/push-before.json` **before** any schema apply.
4. ☐ Apply, then `npm run verify:push -- --out logs/push-after.json --against logs/push-before.json`.
   **Any difference is a failure.** There is no expected row loss for an additive change.
5. ☐ `npm run db:migrate-postgres` to move the data.
6. ☐ `npm run audit:db` — 53 invariants. Know which are red BEFORE the cutover so you can tell a
   new failure from an inherited one.
7. ☐ SQLite cannot express enums and Postgres can; the type system and `audit:db` are what
   enforce single-vocabulary columns today. Do not assume the database now does it for you.

**Never `prisma db push --force-reset` against production.** `npm run db:reset` and `npm run
setup` both carry it.

## 5. Before the first crawl

☐ `npm run probe:sitemap -- --base=https://<domain>` — passes, and the origin answers
☐ `robots.txt` points at `<SITE_URL>/sitemap.xml`, and that URL returns a **sitemap index**, not
   a 404. Splitting the sitemap into chunks once moved it off that path entirely and nothing
   internal noticed
☐ `npm run audit:sitemap` — 0 advertised 404s
☐ The catalog is under 50,000 URLs per child sitemap (`CHUNK` in `lib/sitemap-shape.ts`)

## 6. Operational

☐ `ADMIN_PASSWORD` / the admin account's password set to something you did not generate in a
  chat transcript
☐ Nightly scheduled: `npm run nightly` (scrape → match → compute → `soak:log`)
☐ `npm run soak:report` readable, and someone reads it
☐ Backups: `prisma/dev.db.bak-*` are local snapshots and are **gitignored**. Production needs a
  real backup schedule, not this
☐ ☐ **S4U note:** the "shop for you" flow is not a hosted feature. It runs by hand and writes
  nothing a shopper sees. Do not expose it

## 7. What is still NOT true on the day you host

Stated so nothing here reads as a clean bill of health:

- **The rate limiter has never run behind a real proxy.** It is verified against
  `localhost` only — an exact boundary at 600 requests, and a spoofed `x-forwarded-for`
  correctly buying nothing. Neither result transfers to a proxied deployment untested.
- **No live price has ever been compared against the shop's own page.** Every price
  re-derives from its own `rawPriceText` — that is internal consistency, and it says nothing
  about whether the number matches what the shop charges today.
- **No user flow has been performed end to end.** `GroceryList` was empty until
  instrumentation put a row in it.
- **89.3% of priced grocery products show one shop.** Measured, and the ceiling on fixing that
  by matching is bounded — see `docs/PHASE2-BRAND-GAP.md`. It is a sourcing problem.
