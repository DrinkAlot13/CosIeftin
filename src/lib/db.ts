import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot-reloads in dev and across script runs.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * QUERY INSTRUMENTATION, off unless asked for.
 *
 * Set `PRISMA_QUERY_LOG=1` and every query is emitted as one line:
 *
 *     [q] 12ms SELECT "main"."Offer"."id", … | params
 *
 * This exists because "the page is slow" is not a diagnosis. The sidebar that took 8.5 s did
 * so by running 85 queries that each looked fast, and nothing in the page's own timing said
 * so. A per-query log with durations is the only thing that tells an N+1 apart from one
 * genuinely slow scan — and they need opposite fixes.
 *
 * Zero cost when off: without the `log` option Prisma emits no events at all.
 */
const wantQueryLog = process.env.PRISMA_QUERY_LOG === "1";

function build(): PrismaClient {
  if (!wantQueryLog) return new PrismaClient();
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  // The event-typed overload is not visible through the plain PrismaClient return type.
  (client as unknown as { $on: (e: "query", cb: (ev: { duration: number; query: string; params: string }) => void) => void })
    .$on("query", (ev) => {
      console.log(`[q] ${String(ev.duration).padStart(5)}ms ${ev.query.slice(0, 300)}`);
    });
  return client;
}

export const prisma = globalForPrisma.prisma ?? build();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite's default rollback-journal mode blocks every reader for the whole duration of a
// writer's transaction. Confirmed live on this machine: a page request returned nothing for
// 60+ seconds, and a concurrent one-off query failed outright with "database is locked" (code
// 5) — both while the nightly scraper held a write transaction. The nightly job is scheduled to
// run in production, so without this every visitor during that window would see the same hang
// or a hard failure, not a slow page.
//
// WAL mode lets readers proceed against the last-committed snapshot while a writer is active —
// exactly this app's shape (many short web reads, one long-running nightly writer) — and is the
// standard fix for this SQLite failure mode. `busy_timeout` is defense in depth for the rarer
// case of two writers overlapping (e.g. a scrape run and an admin action): retry for 5s instead
// of failing immediately. Guarded to sqlite only, so this stays harmless if DATABASE_URL is ever
// switched to the postgres variant (schema.postgres.prisma) without this file being updated.
if ((process.env.DATABASE_URL ?? "").startsWith("file:")) {
  prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch((e) => console.error("[db] failed to enable WAL mode:", (e as Error).message));
  prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000").catch((e) => console.error("[db] failed to set busy_timeout:", (e as Error).message));
}
