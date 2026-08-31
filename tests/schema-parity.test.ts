// The Postgres schema must stay in step with the SQLite one.
//
// `prisma/schema.postgres.prisma` is a migration prepared in advance: nothing runs against it
// yet. That is precisely what makes it dangerous. A prepared migration nobody executes drifts
// silently — a column added to the live SQLite schema is simply absent from it, and the drift
// is discovered on cutover night, which is the worst possible moment to discover anything.
//
// So this test does the only thing that keeps a parallel schema honest: compares them, model
// by model and field by field. The deliberate differences (provider, @db.Text, extra indexes)
// are normalised away; everything else must match exactly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { generate } from "../scripts/gen-postgres-schema";

const SQLITE = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const POSTGRES = readFileSync(join(process.cwd(), "prisma", "schema.postgres.prisma"), "utf8");

type Model = { name: string; fields: Map<string, string> };

/** Parse `model X { … }` blocks into field name → normalised type. */
function parseModels(src: string): Map<string, Model> {
  const models = new Map<string, Model>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const fields = new Map<string, string>();
    for (const raw of m[2].split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").replace(/\/\/\/.*$/, "").trim();
      if (!line || line.startsWith("@@")) continue;
      const f = line.match(/^(\w+)\s+(\S+)/);
      if (!f) continue;
      const type = f[2]
        // Postgres-only column hints are a deliberate difference, not a schema change.
        .replace(/@db\.\w+(\(\d+\))?/g, "")
        .trim();
      fields.set(f[1], type);
    }
    models.set(m[1], { name: m[1], fields });
  }
  return models;
}

const sq = parseModels(SQLITE);
const pg = parseModels(POSTGRES);

describe("schema parity — the prepared Postgres migration has not drifted", () => {
  it("both schemas parse into models", () => {
    expect(sq.size > 5).toBeTruthy();
    expect(pg.size > 5).toBeTruthy();
  });

  it("every SQLite model exists in the Postgres schema", () => {
    const missing = [...sq.keys()].filter((k) => !pg.has(k));
    if (missing.length) {
      throw new Error(
        `${missing.length} model(s) exist in SQLite but not in the prepared Postgres schema: ` +
        `${missing.join(", ")}. Add them now, not on cutover night.`,
      );
    }
    expect(missing.length).toBe(0);
  });

  it("the Postgres schema invents no models of its own", () => {
    const extra = [...pg.keys()].filter((k) => !sq.has(k));
    if (extra.length) throw new Error(`Postgres-only model(s): ${extra.join(", ")}`);
    expect(extra.length).toBe(0);
  });

  it("every field matches, name and type", () => {
    const problems: string[] = [];
    for (const [name, model] of sq) {
      const other = pg.get(name);
      if (!other) continue; // reported by the model test above
      for (const [f, t] of model.fields) {
        const ot = other.fields.get(f);
        if (ot === undefined) problems.push(`${name}.${f} missing from Postgres schema`);
        else if (ot !== t) problems.push(`${name}.${f}: SQLite ${t} vs Postgres ${ot}`);
      }
      for (const f of other.fields.keys()) {
        if (!model.fields.has(f)) problems.push(`${name}.${f} exists only in the Postgres schema`);
      }
    }
    if (problems.length) {
      throw new Error(
        `${problems.length} field difference(s) between the two schemas:\n  ` +
        problems.slice(0, 25).join("\n  "),
      );
    }
    expect(problems.length).toBe(0);
  });

  it("the Postgres schema really targets postgresql", () => {
    expect(/provider\s*=\s*"postgresql"/.test(POSTGRES)).toBeTruthy();
    expect(/provider\s*=\s*"sqlite"/.test(SQLITE)).toBeTruthy();
  });

  it("Postgres reads its URL from the environment, never a checked-in path", () => {
    expect(/url\s*=\s*env\("DATABASE_URL"\)/.test(POSTGRES)).toBeTruthy();
  });

  // The parity checks above compare the two files. This one is stronger: it regenerates the
  // Postgres schema from the SQLite one and demands the checked-in file match byte for byte.
  // Parity stops being a discipline someone has to remember and becomes a build step.
  it("the checked-in Postgres schema is exactly what the generator produces", () => {
    const norm = (s: string): string => s.split("\r\n").join("\n");
    const generated = norm(generate(SQLITE));
    if (norm(POSTGRES) !== generated) {
      throw new Error(
        "prisma/schema.postgres.prisma is STALE — it does not match what schema.prisma generates. " +
        "Run: npm run gen:postgres",
      );
    }
    expect(true).toBeTruthy();
  });
});
