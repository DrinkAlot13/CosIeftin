# Self-hosting product images — what it would cost

**Status: measured, not built. This is a decision document, not a plan of record.**

`/confidentialitate` currently carries a whole section disclosing that a visitor's browser
contacts eighteen third-party hosts on every product page, handing each of them an IP address, a
User-Agent and a Referer naming the page being read. That section exists because the disclosure
is true. Self-hosting the images removes the section by removing the disclosure.

## The measurement (2026-09-10)

Image sizes are **sampled from the live hosts**, three products per host, not estimated:

| | products | GB at 63 KB avg |
|---|---|---|
| remote images, whole catalog | 50,907 | 3.06 |
| **remote images on SHOWABLE products** | **42,871** | **2.58** |
| already self-hosted | 5,678 (517 MB on disk) | — |

Weighted average image: **63 KB**. The per-host spread is wide and worth knowing, because the
big hosts are not the heavy ones:

| host | products | avg KB |
|---|---|---|
| comenzi.dcneu.ro | 13,043 | 29 |
| cdn.sezamo.ro | 8,297 | **165** |
| www.mega-image.ro | 5,963 | 45 |
| cdn.metro-group.com | 5,230 | 117 |
| auchan.vteximg.com.br | 4,130 | 57 |
| cdn-media.carrefour.ro | 4,060 | 10 |
| …12 more | 10,184 | 2–101 |

**Fetching only what a visitor can actually load saves 0.48 GB** — 8,036 products whose every
offer is stale or withheld. There is no reason to store an image for a product that cannot be
displayed, and the filter is one `where` clause.

## The important thing: this is not a build

`scripts/download-images.ts` **already exists, already works, and has already converted 5,678
products**. It fetches, writes to `public/product-images/`, and rewrites `Product.image` to the
local path. `public/product-images/` is gitignored (0 files tracked; the repo is 46 MB and stays
that way).

So the question is not "what would it cost to write" — it is **where the files live in
production**, and that is blocked on a decision nobody has made yet.

## Two shapes, and they cost differently

### A. Download and self-host (the script that exists)

- **Routes**: none. Next serves `public/` statically.
- **Caching**: static files with immutable URLs. Nothing to invent.
- **Storage**: ~2.6 GB for showable products, ~3.1 GB for everything. Plus 517 MB already there.
- **Bandwidth in**: 2.6 GB once, then only new products.
- **Bandwidth out**: ours, where today it is the retailers'. On a small VPS this is the cheapest
  part; on metered egress it is a new line item.
- **Time**: at the script's current 250 ms politeness delay, 42,871 images is **~3 hours of
  waiting**, not of work. One overnight run.
- **Ongoing**: one nightly step for newly added products. Images change rarely.

**What it does NOT work on: a serverless deploy.** `public/` is bundled into the deployment
artifact, and 3 GB exceeds what Vercel and similar will take. This shape needs either a VPS with
a persistent volume, or object storage (S3/R2/Spaces) plus a small change to write there instead
of to disk — which is the only actual code in this option.

### B. On-demand proxy route

- **Routes**: one handler, e.g. `/api/img?p=<productId>`, fetching upstream and streaming back.
- **Caching**: needs a real cache (CDN or disk), or every view re-fetches from the retailer —
  worse for them and slower for us.
- **Storage**: only the cache.
- **Bandwidth**: every image view crosses our server, both directions.
- **Risk this shape adds**: an image proxy taking a URL is an SSRF hole. It must take a product
  id and look the URL up, never accept one — or it becomes a way to make our server fetch
  arbitrary addresses.

**B is more code, more risk and more ongoing bandwidth than A.** Its only advantage is not
storing anything, and storage is the cheap part.

## What it would NOT fix

- **Some hosts already refuse us.** In the sample, `www.penny.ro` failed 3 of 3, `auchan` 1 of 3
  and `media.kaufland.com` 1 of 3. Expect a single-digit percentage that cannot be fetched at
  all; those products keep hotlinking or lose their image. `ProductImage` already renders a
  named placeholder, so the failure mode is handled.
- **The privacy section does not disappear the day the run finishes.** It is generated from the
  database and shrinks as products convert. It only vanishes when the last remote URL does.

## Honest estimate

**A day's work, most of it waiting — IF the storage decision is already made.** The code to
download exists; the code to write to object storage instead of disk is perhaps an hour. What is
not a day's work is choosing a host, and that decision is the actual blocker.

## What it buys

- Removes an entire section of the privacy policy, and with it the disclosure that eighteen
  companies see our visitors.
- Removes a hard dependency on eighteen CDNs that can rate-limit, hotlink-block or simply change
  their URL scheme — the same class of failure as Sezamo's 9,420 dead links, which is exactly
  the kind this project has already paid for once.
- Makes pages faster and predictable: one origin, one connection, no third-party TLS handshakes.

**Recommended sequence when it is taken up:** pick the host first, then run the existing script
against showable products only, then let the policy section shrink on its own.
