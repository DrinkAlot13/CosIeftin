// Confirm rate, sliced the ways that change a decision.
//
// A single blended rate is nearly useless. What matters is WHICH RULE produced the candidate:
// `mutually-distinct` exists specifically to separate products where each name carries a token
// the other lacks, so if a human confirms those often, the rule is rejecting real matches and
// the fix belongs in the matcher, not in a queue someone has to work through forever.
//
// The reading, agreed in advance so the number cannot be rationalised after the fact:
//   confirm rate ABOVE ~40%  -> the rule is too aggressive; fix the rule AND keep the queue
//   confirm rate BELOW ~15%  -> the rule is working; the queue is mostly genuine rejections
//   in between               -> not enough signal to act on; keep sampling
//
// Rank matters too. If the top 100 by value confirm at 30% and the tail confirms at 3%, the
// queue is worth working in order and abandoning early — which a blended rate would hide.

import { prisma } from "./db";

/** Where the rule stops being plausible and starts being wrong. Stated up front, on purpose. */
export const TOO_AGGRESSIVE_ABOVE = 0.40;
export const WORKING_BELOW = 0.15;

export type RateRow = { key: string; confirmed: number; rejected: number; total: number; rate: number };

export type Verdict = "too aggressive" | "working" | "not enough signal";

/** How to read a rate, given how many decisions produced it. */
export function verdictFor(rate: number, sample: number, minSample = 30): Verdict {
  if (sample < minSample) return "not enough signal";
  if (rate > TOO_AGGRESSIVE_ABOVE) return "too aggressive";
  if (rate < WORKING_BELOW) return "working";
  return "not enough signal";
}

function tally(rows: { decision: string | null }[]): { confirmed: number; rejected: number; total: number; rate: number } {
  const confirmed = rows.filter((r) => r.decision === "confirm").length;
  const rejected = rows.filter((r) => r.decision === "reject").length;
  const total = confirmed + rejected;
  return { confirmed, rejected, total, rate: total ? confirmed / total : 0 };
}

function group<T extends { decision: string | null }>(rows: T[], keyOf: (r: T) => string): RateRow[] {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const a = by.get(k) ?? [];
    a.push(r);
    by.set(k, a);
  }
  return [...by.entries()]
    .map(([key, list]) => ({ key, ...tally(list) }))
    .sort((a, b) => b.total - a.total);
}

/** Score bands, coarse enough that each holds a usable sample. */
function scoreBand(score: number): string {
  if (score < 0.46) return "0.42–0.46";
  if (score < 0.50) return "0.46–0.50";
  if (score < 0.54) return "0.50–0.54";
  if (score < 0.58) return "0.54–0.58";
  return "0.58+";
}

/** Rank buckets, so "does working in order pay" is answerable. */
function rankBand(rank: number | null): string {
  if (rank == null) return "bulk (no rank)";
  if (rank <= 25) return "1–25";
  if (rank <= 50) return "26–50";
  if (rank <= 100) return "51–100";
  if (rank <= 250) return "101–250";
  return "251+";
}

export async function matchStats() {
  const decided = await prisma.pendingMatch.findMany({
    where: { resolved: true, decision: { not: null } },
    select: {
      decision: true, reason: true, score: true, section: true, rankAtDecision: true,
      createdComparison: true, decidedAt: true,
      merchant: { select: { slug: true } },
    },
    orderBy: { decidedAt: "asc" },
  });

  const overall = tally(decided);
  const byRule = group(decided, (r) => r.reason);
  const byScore = group(decided, (r) => scoreBand(r.score));
  const bySection = group(decided, (r) => r.section);
  const byMerchant = group(decided, (r) => r.merchant.slug);
  const byRank = group(decided, (r) => rankBand(r.rankAtDecision));
  const byCreatesComparison = group(decided, (r) =>
    r.createdComparison === null ? "unknown" : r.createdComparison ? "creates a comparison" : "adds breadth only",
  );

  const mutuallyDistinct = byRule.find((r) => r.key === "mutually-distinct") ?? null;

  return {
    overall,
    byRule,
    byScore,
    bySection,
    byMerchant,
    byRank,
    byCreatesComparison,
    mutuallyDistinct,
    mutuallyDistinctVerdict: mutuallyDistinct ? verdictFor(mutuallyDistinct.rate, mutuallyDistinct.total) : null,
    firstDecisionAt: decided[0]?.decidedAt ?? null,
    lastDecisionAt: decided[decided.length - 1]?.decidedAt ?? null,
  };
}

/** Just the headline, for the queue header — cheap enough to run on every page load. */
export async function runningConfirmRate(): Promise<{ confirmed: number; total: number; rate: number }> {
  const [confirmed, rejected] = await Promise.all([
    prisma.pendingMatch.count({ where: { resolved: true, decision: "confirm" } }),
    prisma.pendingMatch.count({ where: { resolved: true, decision: "reject" } }),
  ]);
  const total = confirmed + rejected;
  return { confirmed, total, rate: total ? confirmed / total : 0 };
}
