// Minimal zero-dependency test runner (no framework in this project by design —
// tsx is already a dev dep, so tests stay one `npm test` away).
//
// Run: npm test
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Case = { name: string; fn: () => void | Promise<void> };
const suites: { name: string; cases: Case[] }[] = [];
let current: { name: string; cases: Case[] } | null = null;

export function describe(name: string, fn: () => void) {
  current = { name, cases: [] };
  suites.push(current);
  fn();
  current = null;
}
export function it(name: string, fn: () => void | Promise<void>) {
  if (!current) throw new Error("it() outside describe()");
  current.cases.push({ name, fn });
}
export function expect(actual: unknown) {
  return {
    toBe(exp: unknown) {
      if (!Object.is(actual, exp)) throw new Error(`expected ${JSON.stringify(exp)}, got ${JSON.stringify(actual)}`);
    },
    toBeCloseTo(exp: number, digits = 2) {
      const a = Number(actual);
      if (!Number.isFinite(a) || Math.abs(a - exp) > Math.pow(10, -digits) / 2) throw new Error(`expected ~${exp}, got ${actual}`);
    },
    /** Structural equality. Key order does not matter; NaN equals NaN. */
    toEqual(exp: unknown) {
      if (!deepEqual(actual, exp)) throw new Error(`expected ${JSON.stringify(exp)}, got ${JSON.stringify(actual)}`);
    },
    /** Substring for a string, membership for an array. */
    toContain(needle: unknown) {
      if (typeof actual === "string") {
        if (!actual.includes(String(needle))) throw new Error(`expected ${JSON.stringify(actual)} to contain ${JSON.stringify(needle)}`);
        return;
      }
      if (Array.isArray(actual)) {
        if (!actual.some((v) => deepEqual(v, needle))) throw new Error(`expected array to contain ${JSON.stringify(needle)}`);
        return;
      }
      throw new Error(`toContain expects a string or array, got ${typeof actual}`);
    },
    toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${JSON.stringify(actual)}`); },
    toBeFalsy() { if (actual) throw new Error(`expected falsy, got ${JSON.stringify(actual)}`); },
    toBeGreaterThan(n: number) { if (!(Number(actual) > n)) throw new Error(`expected > ${n}, got ${actual}`); },
    toBeLessThan(n: number) { if (!(Number(actual) < n)) throw new Error(`expected < ${n}, got ${actual}`); },
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

async function main() {
  const dir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const files: string[] = [];
  const walk = (d: string, prefix = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), prefix + e.name + "/");
      else if (e.name.endsWith(".test.ts")) files.push(prefix + e.name);
    }
  };
  walk(dir);
  files.sort();
  const only = process.argv[2];
  for (const f of files) {
    if (only && !f.includes(only)) continue;
    await import(pathToFileURL(join(dir, f)).href);
  }

  let pass = 0, fail = 0;
  const failures: string[] = [];
  for (const s of suites) {
    console.log(`\n  ${s.name}`);
    for (const c of s.cases) {
      try {
        await c.fn();
        pass++;
        console.log(`    \x1b[32m✓\x1b[0m ${c.name}`);
      } catch (e) {
        fail++;
        console.log(`    \x1b[31m✗\x1b[0m ${c.name}`);
        console.log(`      \x1b[31m${(e as Error).message}\x1b[0m`);
        failures.push(`${s.name} › ${c.name}: ${(e as Error).message}`);
      }
    }
  }
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1); }
}
main();
