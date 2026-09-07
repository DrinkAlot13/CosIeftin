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
