// ── docs/openapi.json, GENERATED from the route registry. Never hand-written.
//
// `src/lib/api/routes.ts` is the one description of every parameter, and the ROUTES validate
// with the same objects this walks. A hand-written spec drifts from the code the first time
// somebody adds a field — this project has paid for that shape three times (audit:sitemap's
// copied predicate, audit:rate-limit's recomputed budget, three implementations of head noun).
//
//   npm run gen:openapi
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROUTES } from "../src/lib/api/routes";
import { toOpenApiParams } from "../src/lib/api/schema";
import { LIMITS } from "../src/lib/rate-limit";
// SITE_URL is read in exactly one place — `lib/config/siteUrl` — because two readers is how one
// variable came to have two different defaults. `tests/secrets-and-origin` caught this file
// doing it directly, which is the invariant working.
import { siteUrl } from "../src/lib/config/siteUrl";

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: ["bad_request", "not_found", "rate_limited", "server_error"] },
        message: { type: "string" },
        details: { type: "object", additionalProperties: true },
      },
    },
  },
};

function main(): void {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const r of ROUTES) {
    const limit = LIMITS[r.limit as keyof typeof LIMITS];
    const params = [
      ...r.pathParams.map((p) => ({
        name: p.name, in: "path", required: true, description: p.describe, schema: { type: "string" },
      })),
      ...toOpenApiParams(r.params),
    ];

    paths[r.path] ??= {};
    paths[r.path][r.method] = {
      summary: r.summary,
      description:
        `${r.description}\n\n` +
        // The limit and the cache window are READ from the code, not restated here. A document
        // that names a different number from the limiter is worse than one that names none.
        `Limită: ${limit.max} cereri / ${limit.windowMs / 1000}s per apelant identificat ` +
        `(${limit.sharedMax} partajate când apelantul nu poate fi identificat).\n` +
        (r.cache.sMaxAge > 0
          ? `Cache: s-maxage=${r.cache.sMaxAge}, stale-while-revalidate=${r.cache.swr}.`
          : `Cache: no-store.`),
      ...(params.length ? { parameters: params } : {}),
      responses: {
        "200": { description: "OK" },
        "400": { description: "Parametru lipsă sau invalid", content: { "application/json": { schema: ERROR_SCHEMA } } },
        "404": { description: "Nu există", content: { "application/json": { schema: ERROR_SCHEMA } } },
        "429": { description: "Prea multe cereri", content: { "application/json": { schema: ERROR_SCHEMA } } },
      },
    };
  }

  const doc = {
    openapi: "3.0.3",
    info: {
      title: "CoșMic API",
      version: "1.0.0",
      description:
        "API public de citire pentru catalogul CoșMic.\n\n" +
        "Fiecare preț poartă data la care a fost observat. Rândurile reținute de o verificare " +
        "nu sunt niciodată returnate. „Nu avem o comparație pentru acest produs” este un răspuns " +
        "de sine stătător, nu o listă goală — 89% dintre produsele cu preț au un singur magazin.\n\n" +
        "GENERAT din `src/lib/api/routes.ts`. Nu edita direct.",
    },
    servers: [{ url: siteUrl() }],
    paths,
  };

  const out = join(process.cwd(), "docs", "openapi.json");
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`✓ wrote docs/openapi.json — ${Object.keys(paths).length} paths`);
}

main();
