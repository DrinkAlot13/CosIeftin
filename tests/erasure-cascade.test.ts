// THE RIGHT TO ERASURE MUST SURVIVE THE NEXT MODEL SOMEONE ADDS.
//
// On 2026-09-10 `prisma.user.delete()` failed outright:
//
//     Foreign key constraint violated: `foreign key`
//
// because not one child relation of `User` declared `onDelete: Cascade`. Meanwhile
// `/confidentialitate` — reachable from the footer and listed in the sitemap — promised
// "poți cere ștergerea lor oricând". A GDPR promise backed by an operation the codebase could
// not perform, live.
//
// `erase:user` fixed the immediate problem by deleting dependents in the right order. But a tool
// that KNOWS the list is not the same as a schema that ENFORCES it: add a `UserSavedSearch` next
// month without a cascade and erasure breaks silently. Nothing fails, no test goes red, and the
// defect surfaces the day a real person asks to be forgotten and we cannot do it.
//
// So this reads the schema itself. It is the same shape as `tests/route-config.test.ts`, which
// exists because a caching claim and the layout above it could disagree in silence.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

const SCHEMA = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

/** Every `model X { … }` block, by name. */
function models(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ name: m[1], body: m[2] });
  return out;
}

const ALL = models(SCHEMA);

describe("erasure — the schema, not just the tool, has to be able to delete a person", () => {
  it("finds the models (guards the parser itself)", () => {
    expect(ALL.length > 20).toBeTruthy();
    expect(ALL.some((m) => m.name === "User")).toBe(true);
  });

  // ── THE RULE. A model holding `userId` holds data about a person; deleting the person must
  // delete it, and the database is the only place that can guarantee that.
  it("every model with a userId cascades from User", () => {
    const bad: string[] = [];
    for (const m of ALL) {
      if (m.name === "User") continue;
      if (!/^\s*userId\s/m.test(m.body)) continue;
      // The relation line pointing at User, whatever the field is called.
      const rel = m.body.split("\n").find((l) => /@relation\(fields:\s*\[userId\]/.test(l));
      if (!rel) { bad.push(`${m.name}: has userId but no @relation(fields: [userId])`); continue; }
      if (!/onDelete:\s*Cascade/.test(rel)) {
        bad.push(`${m.name}: userId relation does not declare onDelete: Cascade`);
      }
    }
    if (bad.length) {
      throw new Error(
        "A person cannot be erased while these hold rows about them:\n  " + bad.join("\n  ") +
        "\n\nAdd `onDelete: Cascade` to the relation, run `npx prisma db push`, and add the model " +
        "to `scripts/erase-user.ts` if it needs counting in the report.",
      );
    }
    expect(bad.length).toBe(0);
  });

  // A grandchild is just as fatal: GroceryListItem hangs off GroceryList, which hangs off User.
  // Cascading only the first hop leaves the items behind and the delete still fails.
  it("cascades through GroceryList to its items", () => {
    const item = ALL.find((m) => m.name === "GroceryListItem");
    expect(item !== undefined).toBe(true);
    const rel = (item?.body ?? "").split("\n").find((l) => /@relation\(fields:\s*\[listId\]/.test(l)) ?? "";
    expect(/onDelete:\s*Cascade/.test(rel)).toBe(true);
  });

  // ── THE REGISTER OF WHAT ERASURE COVERS, kept honest from the other side.
  //
  // `erase:user` names the models it clears. If a new one gains `userId` and the schema
  // cascades it, the database will erase it — but the operator's report would silently stop
  // matching what was deleted, and a person told "we erased 4 things" while 5 went is being
  // told something false. So the tool has to mention every one of them.
  it("erase:user mentions every model that holds a userId", () => {
    const tool = readFileSync(join(process.cwd(), "scripts", "erase-user.ts"), "utf8");
    const missing = ALL
      .filter((m) => m.name !== "User" && /^\s*userId\s/m.test(m.body))
      .map((m) => m.name)
      .filter((name) => !tool.includes(name));
    if (missing.length) {
      throw new Error(
        `scripts/erase-user.ts does not mention: ${missing.join(", ")}. The database will ` +
        `cascade them, but the report a person receives would not account for them.`,
      );
    }
    expect(missing.length).toBe(0);
  });
});
