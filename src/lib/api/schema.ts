// ── A TINY SCHEMA THAT VALIDATES INPUT *AND* DESCRIBES IT, so the OpenAPI cannot drift.
//
// CLAUDE.md says "Zod at every trust boundary (scraper output, API route input)". Zod is NOT
// INSTALLED — the whole dependency list is `@prisma/client dotenv next react react-dom`, and the
// same file says not to add dependencies without asking. So that rule is, today, enforced by
// nothing; it is the same shape as the "invariant 9" the Kaufland scraper cited, which never
// existed. Reported rather than quietly satisfied by adding a package.
//
// What this is instead: about eighty lines that do the two jobs a route actually needs.
//
//   1. VALIDATE, returning a typed value or a named error — never throwing, because a route that
//      forgets a try/catch would fail open.
//   2. DESCRIBE ITSELF, so `gen:openapi` walks the same objects the routes validate with.
//
// The second is the point. A hand-written spec drifts from the code the first time someone adds
// a field, and this project has paid for that shape three times over (audit:sitemap's copied
// predicate, audit:rate-limit's recomputed budget, three implementations of head noun). There is
// exactly one description of each parameter and both the validator and the document read it.

export type ParamType = "string" | "int" | "number" | "boolean" | "enum";

export type ParamSpec = {
  type: ParamType;
  /** what it is, in one line — this becomes the OpenAPI description */
  describe: string;
  required?: boolean;
  /** for `enum` */
  values?: readonly string[];
  /** for `int` / `number` */
  min?: number;
  max?: number;
  /** for `string` */
  maxLength?: number;
  default?: string | number | boolean;
  example?: string | number | boolean;
};

export type ParamShape = Record<string, ParamSpec>;

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; field: string; message: string };

/**
 * Read and check query parameters against a shape.
 *
 * Unknown parameters are IGNORED rather than rejected: a client appending `?utm_source=…` or a
 * browser adding something is not making a malformed request, and refusing it would break
 * callers for no safety gained. Unknown parameters that CHANGE behaviour do not exist — every
 * behaviour here is driven by a named field below.
 */
export function readParams<T extends Record<string, unknown>>(
  shape: ParamShape,
  get: (name: string) => string | null,
): Validated<T> {
  const out: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(shape)) {
    const raw = get(name);

    if (raw === null || raw === "") {
      if (spec.required) return { ok: false, field: name, message: `${name} este obligatoriu` };
      if (spec.default !== undefined) out[name] = spec.default;
      continue;
    }

    switch (spec.type) {
      case "string": {
        if (spec.maxLength && raw.length > spec.maxLength) {
          return { ok: false, field: name, message: `${name} depășește ${spec.maxLength} caractere` };
        }
        out[name] = raw;
        break;
      }
      case "int":
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n)) return { ok: false, field: name, message: `${name} trebuie să fie un număr` };
        if (spec.type === "int" && !Number.isInteger(n)) {
          return { ok: false, field: name, message: `${name} trebuie să fie un număr întreg` };
        }
        // CLAMPED, NOT REJECTED, for a value merely out of range. `limit=1000` is a client asking
        // for more than we serve, not a malformed request, and answering with 50 is more useful
        // than a 400. A non-number is still an error — that is a different mistake.
        const clamped = Math.min(spec.max ?? n, Math.max(spec.min ?? n, n));
        out[name] = clamped;
        break;
      }
      case "boolean": {
        const v = raw.trim().toLowerCase();
        if (!["true", "false", "1", "0", "yes", "no"].includes(v)) {
          return { ok: false, field: name, message: `${name} trebuie să fie true sau false` };
        }
        out[name] = v === "true" || v === "1" || v === "yes";
        break;
      }
      case "enum": {
        if (!spec.values?.includes(raw)) {
          return { ok: false, field: name, message: `${name} trebuie să fie unul din: ${spec.values?.join(", ")}` };
        }
        out[name] = raw;
        break;
      }
    }
  }
  return { ok: true, value: out as T };
}

/** The OpenAPI `parameters` array for one shape. Generated, never typed out by hand. */
export function toOpenApiParams(shape: ParamShape): unknown[] {
  return Object.entries(shape).map(([name, spec]) => ({
    name,
    in: "query",
    required: spec.required === true,
    description: spec.describe,
    schema: {
      type: spec.type === "int" ? "integer" : spec.type === "enum" ? "string" : spec.type,
      ...(spec.values ? { enum: [...spec.values] } : {}),
      ...(spec.min !== undefined ? { minimum: spec.min } : {}),
      ...(spec.max !== undefined ? { maximum: spec.max } : {}),
      ...(spec.maxLength !== undefined ? { maxLength: spec.maxLength } : {}),
      ...(spec.default !== undefined ? { default: spec.default } : {}),
    },
    ...(spec.example !== undefined ? { example: spec.example } : {}),
  }));
}
