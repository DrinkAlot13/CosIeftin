# Overnight session log — 2026-08-31

Branch: `overnight/2026-08-31`. Written as the session runs, not at the end, so that if the
session dies this file shows where it got to.

---

## Phase 0 — the safety net

**Start** 03:26 · **End** 03:40

The price history is the only dataset in this system that cannot be regenerated. Offers can
be re-scraped tomorrow; 78,258 history rows cannot. Before this phase there was one SQLite
file, no backup, on a machine that lost processes mid-write earlier in the week.

### What changed

| file | what |
|---|---|
| `backups/2026-08-30T21-26-38-835Z-pre-session.db` | pre-session snapshot, taken before anything else ran |
| `scripts/backup.ts` (new) | `npm run backup` — VACUUM INTO, integrity check, truncation guard, gzip, retention, restore instructions |
| `scripts/export-history.ts` (new) | `npm run export:history` — full CSV export of the irreplaceable dataset |
| `package.json` | `backup`, `export:history` scripts; **`nightly` now starts with `npm run backup`** |
| `.gitignore` | backup artefacts excluded from git |

### Decisions taken

- **`VACUUM INTO`, never a file copy.** `cp` of a live SQLite file can capture a torn page
  and produces a database that opens cleanly and is quietly wrong. `VACUUM INTO` is
  transactionally consistent against concurrent writers.
- **The backup rejects itself** rather than recording a bad one, on any of: failed
  `PRAGMA integrity_check`, row counts in the snapshot disagreeing with the live DB, or
  `PriceHistory` below 95% of the previous snapshot. A silently truncated backup is worse
  than none, because it looks like protection.
- **Retention never prunes the oldest surviving snapshot**, whatever the policy computes.
  Losing the last line of defence to a retention rule would be the worst possible failure.
- **CSV over Parquet** for the history export: no new dependency, universally readable, and
  78k rows is nowhere near where the format would matter.

### Numbers

- snapshot: 31.5 MB raw → **7.7 MB gzipped (24%)**
- Offer 43,108 · PriceHistory 78,258 · Product 34,263
- history export: **78,258/78,258 rows**, 13.4 MB CSV

### Restore proof (an unverified backup is not a backup)

Decompressed the snapshot and compared it against the live database:

```
restored integrity_check: ok
Offer         43108 / 43108   match
PriceHistory  78258 / 78258   match
Product       34263 / 34263   match
Merchant         13 / 13      match
BulkTier       4708 / 4708    match
price sum (bani) 116852571 / 116852571   match
```

Row counts alone can match while values are corrupt, so the money checksum is part of the
proof, not decoration.

### Deferred to the morning report

- Backups are local only. Off-machine copy is a decision for the owner (see report).

**Tests** — not re-run in this phase (no application code touched; scripts only).
