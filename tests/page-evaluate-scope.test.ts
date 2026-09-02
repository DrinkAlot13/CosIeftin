// A `page.evaluate` callback runs in the BROWSER. Node module scope is not there.
//
// This is not a style rule. Commit 568d283 — "A stalled socket can silently cost the whole
// night, and it just did" — hardened every fetch in the project with
// `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`. Two of those fetches were inside
// `page.evaluate`, where `REQUEST_TIMEOUT_MS` does not exist: the callback is serialized and
// re-evaluated in the page, so a closure over a module-scope constant is a ReferenceError at
// runtime. Both scrapers caught it in their own `catch`, returned `{ __err }`, and broke out
// of pagination after the first page.
//
// The result: Metro and Mega Image returned ZERO products from 31 August onward. The commit
// that fixed silent stalls introduced one, in the same line it added to prevent them.
//
// It stayed invisible for two days because the 60% drop guard did its job — it refused each
// empty run and kept the previous data rather than wiping it. The data was safe and the
// merchant was dead, and nothing distinguished those two states.
//
// So: a `page.evaluate` / `$$eval` callback may only use values passed to it as arguments.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

const SCRIPTS = join(process.cwd(), "scripts");

function allScripts(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) allScripts(full, out);
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Module-scope SCREAMING_CASE constants — the ones a browser callback cannot see. */
function moduleConstants(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]{2,})\s*[:=]/gm)) out.push(m[1]);
  return out;
}

/** Bodies of every page.evaluate / $eval / $$eval callback in a file. */
function evaluateBodies(src: string): string[] {
  const bodies: string[] = [];
  for (const m of src.matchAll(/\.(?:evaluate|\$eval|\$\$eval)\s*\(/g)) {
    // Walk from the opening paren to its match, so nested parens/braces are handled.
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") { depth--; if (depth === 0) break; }
    }
    bodies.push(src.slice(start, i + 1));
  }
  return bodies;
}

describe("page.evaluate callbacks cannot close over Node scope", () => {
  it("no browser callback references a module-scope constant", () => {
    const offenders: string[] = [];
    for (const file of allScripts(SCRIPTS)) {
      const src = readFileSync(file, "utf8");
      if (!/\.(?:evaluate|\$eval|\$\$eval)\s*\(/.test(src)) continue;
      const consts = moduleConstants(src);
      if (consts.length === 0) continue;
      for (const body of evaluateBodies(src)) {
        // The argument list is fine — only the callback body is evaluated in the page. The
        // last argument is what gets passed IN, so strip the trailing `, arg)` before testing.
        const lastComma = body.lastIndexOf(",");
        const callbackOnly = lastComma > 0 ? body.slice(0, lastComma) : body;
        for (const c of consts) {
          if (new RegExp(`\\b${c}\\b`).test(callbackOnly)) {
            offenders.push(`${file.split(/[\\/]/).pop()}: browser callback uses ${c}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the two scrapers that had this bug pass their timeout as an argument", () => {
    for (const f of ["scrape-metro.ts", "scrape-megaimage.ts"]) {
      const src = readFileSync(join(SCRIPTS, f), "utf8");
      expect(src).toContain("timeoutMs");
      expect(src).toContain("timeoutMs: REQUEST_TIMEOUT_MS");
      // and never the closed-over form again
      expect(/signal: AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)[\s\S]{0,200}?\}, url\)/.test(src)).toBe(false);
    }
  });
});
