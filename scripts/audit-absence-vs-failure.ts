// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// Where does "we have not tried yet" reach the same branch as "we tried and it failed"?
//
// `ProductImage` had a 3-second timer that started on MOUNT and swapped in the "fără imagine"
// placeholder if the image had not finished. With `loading="lazy"` that is not a measurement of
// failure: an image below the fold has not started loading, so three seconds later it is not
// late, it was never requested. 421 of 494 cards on /c/branzeturi showed initials while ZERO
// image requests failed.
//
// The shape is general. A component that initialises state to the value it also uses for "this
// went wrong" cannot tell the two apart, and neither can anyone reading the screen:
//
//     const [x, setX] = useState<T[]>([]);   // empty means "not fetched yet"
//     …
//     if (x.length === 0) return <Empty />;  // …and now it also means "there are none"
//
// This walks the client components and flags that pattern for a human to judge. It does NOT
// decide: several of these are correct (a list that starts empty and only ever grows on user
// action has nothing to distinguish). Reporting is the whole job.
//
// Run: npm run audit:absence

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components", "src/app"];

type Finding = { file: string; line: number; kind: string; text: string; note: string };

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); continue; }
    if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

function main(): void {
  console.log(`\n════ ABSENCE READ AS FAILURE — CANDIDATES ═══════════════════════════════════`);
  console.log(`  Flags places where "not tried yet" and "tried and failed" could reach one`);
  console.log(`  branch. Judgement is a human's; several of these are certainly fine.\n`);

  const files: string[] = [];
  for (const r of ROOTS) walk(join(process.cwd(), r), files);

  const findings: Finding[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!src.includes('"use client"')) continue;
    const rel = f.split(/[\\/]src[\\/]/)[1] ?? f;
    const lines = src.split("\n");

    // 1. A timer that can fire before the thing it is timing has started.
    const hasLazy = /loading=["']lazy["']/.test(src);
    lines.forEach((l, i) => {
      if (!/setTimeout\(/.test(l)) return;
      // A debounce on user input is the opposite pattern and is fine.
      const context = lines.slice(Math.max(0, i - 6), i + 6).join(" ");
      const isDebounce = /onChange|value|query|\bq\b|debounce/i.test(context);
      const isToast = /setNote|setToast|setFlash|setCopied/.test(context);
      if (isDebounce || isToast) return;
      findings.push({
        file: rel, line: i + 1, kind: "timer",
        text: l.trim().slice(0, 78),
        note: hasLazy
          ? "file also uses loading=lazy — a timer here can fire before the browser requests anything"
          : "check the timer starts when the operation starts, not when the component mounts",
      });
    });

    // 2. State whose initial value is also its failure/empty value.
    lines.forEach((l, i) => {
      const m = /useState<[^>]*>\(\s*(\[\]|null|0|""|false)\s*\)/.exec(l) ?? /useState\(\s*(\[\]|null|0|""|false)\s*\)/.exec(l);
      if (!m) return;
      const name = /const \[(\w+)/.exec(l)?.[1];
      if (!name) return;
      // Does anything branch on that exact emptiness to show a terminal state?
      const branch = new RegExp(`${name}(\\.length === 0|\\s*===\\s*null|\\s*===\\s*0|\\s*\\?\\?|!${name})`);
      const usesEmptyAsAnswer = lines.some((x, j) => j !== i && branch.test(x) && /(return|\?|&&)/.test(x));
      if (!usesEmptyAsAnswer) return;
      // WHAT THIS CANNOT DECIDE, said plainly rather than guessed at.
      //
      // The first version claimed to sort these by whether a loading flag guarded the branch.
      // It could not: ShopBasket's guard is `if (error) return` and RecipeAdd's is a
      // state-machine value, neither of which a line-level regex recognises, so both were
      // reported as suspect when both are correct. Rather than keep tuning a heuristic until it
      // agrees with four hand-checked files, it reports the SHAPE and names what it looked for.
      //
      // A pattern-matcher that quietly mislabels is worse than one that admits its range — that
      // is the whole lesson of the bug this audit exists for.
      const readsFromStorage = /localStorage|sessionStorage|getCards\(|getActive\(/.test(src);
      const hasStateMachine = /useState<"[a-z]+"\s*\|/.test(src) || /if \(loading\)|if \(error\)/.test(src);
      findings.push({
        file: rel, line: i + 1, kind: "empty-state",
        text: l.trim().slice(0, 78),
        note: hasStateMachine
          ? "a state machine or explicit loading/error guard exists here — likely fine, confirm the empty branch sits behind it"
          : readsFromStorage
            ? "filled synchronously from browser storage in an effect, so the wrong value shows for ONE render — check whether that render makes a claim"
            : "no loading state and no storage read: check what is on screen before the answer arrives",
      });
    });
  }

  const byKind = new Map<string, Finding[]>();
  for (const f of findings) {
    const b = byKind.get(f.kind) ?? [];
    b.push(f);
    byKind.set(f.kind, b);
  }

  for (const [kind, list] of byKind) {
    console.log(`  ${kind.toUpperCase()} (${list.length})`);
    for (const f of list) {
      console.log(`    ${pad(`${f.file}:${f.line}`, 42)} ${f.text}`);
      console.log(`      ${f.note}`);
    }
    console.log("");
  }
  if (findings.length === 0) console.log("  Nothing flagged.\n");
  console.log(`  ${findings.length} candidate(s). This audit decides nothing — read each one.\n`);
}

main();
