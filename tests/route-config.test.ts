// THE FOURTH UNVERIFIED ASSUMPTION: the caching this codebase believes in does not exist.
//
// `src/app/p/[slug]/page.tsx` carries this comment, and has for a long time:
//
//     // Prices refresh once a night, so serve these from cache and regenerate hourly —
//     // nearly-free performance vs hitting the DB on every request.
//     export const revalidate = 3600;
//
// It has never been true. `src/app/layout.tsx` declares `export const dynamic =
// "force-dynamic"`, and route-segment config inherits downward: a force-dynamic root layout
// makes every route under it dynamic, whatever that route asks for. `npm run build` confirms
// it — every single route prints as ƒ (Dynamic), including the two that declare revalidate.
//
// So every product page hits the database on every request, while the code says it does not.
// That matters more than it looks: search already reads the entire grocery catalog per query
// (164 ms to load, ~530 ms to score), and none of it is cached either.
//
// This test does not fix the caching — changing it app-wide affects /admin and the account
// pages and is the owner's call. What it does is make the CONTRADICTION impossible to hold
// silently: a page may not claim a revalidate window that an ancestor layout has already
// overridden. Either the layout is wrong or the page is; the combination is never right.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { describe, it, expect } from "./run";

const APP = join(process.cwd(), "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/^(page|layout)\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const FILES = walk(APP);
const read = (f: string): string => readFileSync(f, "utf8");
const declaresForceDynamic = (src: string): boolean => /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(src);
const declaresRevalidate = (src: string): RegExpMatchArray | null => src.match(/export\s+const\s+revalidate\s*=\s*(\d+)/);

/** Layouts that sit above `file`, nearest last. */
function ancestorLayouts(file: string): string[] {
  const out: string[] = [];
  let dir = dirname(file);
  for (;;) {
    const candidate = join(dir, "layout.tsx");
    if (candidate !== file && FILES.includes(candidate)) out.unshift(candidate);
    if (dir === APP) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

describe("route config — a page cannot claim caching an ancestor has already disabled", () => {
  it("finds the app routes", () => {
    expect(FILES.length > 10).toBeTruthy();
    expect(FILES.some((f) => f.endsWith(join("app", "layout.tsx")))).toBeTruthy();
  });

  it("no page declares revalidate under a force-dynamic layout", () => {
    const conflicts: string[] = [];
    for (const f of FILES) {
      if (!f.endsWith("page.tsx") && !f.endsWith("page.ts")) continue;
      const src = read(f);
      const rev = declaresRevalidate(src);
      if (!rev) continue;
      if (declaresForceDynamic(src)) continue; // the page overrides itself; its own business
      for (const layout of ancestorLayouts(f)) {
        if (declaresForceDynamic(read(layout))) {
          conflicts.push(
            `${relative(process.cwd(), f).split(sep).join("/")} asks for revalidate=${rev[1]}, but ` +
            `${relative(process.cwd(), layout).split(sep).join("/")} declares force-dynamic — the page is never cached.`,
          );
        }
      }
    }
    if (conflicts.length) {
      throw new Error(
        `${conflicts.length} route(s) believe they are cached and are not:\n  ` + conflicts.join("\n  ") +
        "\n  Fix one side or the other. Do not leave a comment describing caching that does not happen.",
      );
    }
    expect(conflicts.length).toBe(0);
  });

  it("a force-dynamic layout says WHY, since it silently overrides every child", () => {
    const undocumented: string[] = [];
    for (const f of FILES.filter((x) => x.endsWith("layout.tsx"))) {
      const src = read(f);
      if (!declaresForceDynamic(src)) continue;
      const idx = src.search(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
      const before = src.slice(Math.max(0, idx - 500), idx);
      // A comment immediately above it. Anything less and the next reader cannot tell whether
      // it is load-bearing or left over.
      if (!/\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*$/.test(before)) {
        undocumented.push(relative(process.cwd(), f).split(sep).join("/"));
      }
    }
    if (undocumented.length) {
      throw new Error(
        "force-dynamic in a layout disables caching for every route beneath it. Say why:\n  " +
        undocumented.join("\n  "),
      );
    }
    expect(undocumented.length).toBe(0);
  });

  // ── A PAGE WHOSE EXISTENCE DEPENDS ON AN ENV VAR MAY NOT BE PRERENDERED.
  //
  // `/shrinkflation` shipped declaring `revalidate = 3600` and calling `trustFeaturesEnabled()`.
  // The build ran without FEATURE_TRUST, `notFound()` fired during static generation, and the
  // 404 was baked into the output — so setting FEATURE_TRUST=true on the running server did
  // NOTHING. Verified by starting a production server with the flag on and fetching the path:
  // 404, with the flag on.
  //
  // `lib/flags.ts` guards hard against a feature turning on by accident and says nothing about
  // a deliberate ON silently failing, which is the direction nobody thinks to test. "Publish
  // this" must not require a rebuild.
  it("a page that reads a feature flag is force-dynamic, not prerendered", () => {
    const bad: string[] = [];
    for (const f of FILES.filter((x) => x.endsWith("page.tsx"))) {
      const src = read(f);
      if (!/from\s+["']@\/lib\/flags["']/.test(src)) continue;
      const rel = relative(process.cwd(), f).split(sep).join("/");
      if (!declaresForceDynamic(src)) {
        bad.push(`${rel} reads a flag but does not declare dynamic = "force-dynamic"`);
      }
      if (declaresRevalidate(src)) {
        bad.push(`${rel} reads a flag and declares revalidate — the flag is then read at BUILD time`);
      }
    }
    if (bad.length) {
      throw new Error(
        "A feature flag decides at RUN time or it does not decide at all:\n  " + bad.join("\n  "),
      );
    }
    expect(bad.length).toBe(0);
  });

  it("every route file is real (guards the walker itself)", () => {
    for (const f of FILES) expect(statSync(f).size > 0).toBeTruthy();
  });
});
