// What makes a product a member of an equivalence class — and what disqualifies it.
//
// THE PROBLEM THIS SOLVES. `EquivalenceClass.attributes` is documented in the schema as "the
// attributes that actually DISTINGUISH variants within this need — not a description, a
// discriminator". Nothing ever read it. The proposer matched on the class LABEL's token overlap
// plus a head-noun rule, which is why its first run proposed:
//
//     branza-telemea-400g  <-  "Branza de burduf Covalact, 300 g"     (a different cheese)
//     cartofi-1kg          <-  "Cartofi proaspeti pai 1 kg"           (julienne fries)
//     carne-porc-1kg       <-  "CARNE SI SARE Slanina de porc"        (lard)
//
// Every one shares the head noun and enough label tokens to score. None is a substitute a
// shopper would accept, and CLAUDE.md is explicit that a wrong class is worse than no class:
// the resolver then offers a substitution that is not equivalent.
//
// So membership carries two explicit lists, written per class alongside the class:
//
//   require — EVERY entry must match. An entry is a "|"-separated set of alternatives, so
//             "integral|3 5" accepts either spelling of the same fact.
//   exclude — ANY match disqualifies. This is where the near-neighbours go.
//
// Both are matched against `normalizeRo(name)`, so diacritics and punctuation are already
// folded and "3,5%" and "3.5%" both read as "3 5".

import { normalizeRo } from "../text/normalizeRo";

export type ClassRules = {
  /** Every entry must match; each entry is "alt1|alt2|…". */
  require?: string[];
  /** Any match disqualifies. */
  exclude?: string[];
  /**
   * Quantity is not a discriminator for this class — for goods sold BY WEIGHT.
   *
   * Bananas are bananas whether the shop prices them at "+/- 1 kg", "(bucata) cca 200 g" or by
   * the piece, and lei/kg is what makes those comparable. Set ONLY where that is true; a packed
   * good still has to match its pack, or 400 g of yoghurt joins the 900 g class.
   */
  anySize?: boolean;
  /**
   * …but not ANY size. `anySize` alone was too blunt: it pulled "Ceapa Galbena 10 Kg" — a
   * catering sack — into the loose-onion class, erasing precisely the loose-vs-packaged
   * distinction it is supposed to preserve. A shopper buying a kilo of onions is not shopping
   * for a 10 kg sack, and the per-kilo price of the two is not the same trade.
   *
   * So a weight-sold class accepts any size UP TO this ceiling, in the class's own unit.
   */
  maxUnitSize?: number;
  /**
   * …and not below this either. Fresh herbs are sold as a bunch of 20-50 g; an 8 g packet of
   * "Mărar" is DRIED seasoning, and the name says nothing to tell them apart. Weight does.
   */
  minUnitSize?: number;
};

/** Does this product name satisfy the class's membership rules? */
export function membershipOk(productName: string, rules: ClassRules): { ok: boolean; failed?: string } {
  const n = ` ${normalizeRo(productName)} `;
  const words = normalizeRo(productName).split(/\s+/).filter(Boolean);
  for (const term of rules.exclude ?? []) {
    for (const alt of term.split("|")) {
      const a = normalizeRo(alt);
      if (!a) continue;
      // Exclusions match on WORD PREFIX, because Romanian inflects: "congelat" has to catch
      // "congelati" and "congelate". Whole-word matching let "Gradena Cartofi congelati 1 kg"
      // into the fresh-potato class. Multi-word terms fall back to substring.
      if (a.includes(" ")) { if (n.includes(a)) return { ok: false, failed: `excluded by "${alt}"` }; continue; }
      if (words.some((w) => w.startsWith(a))) return { ok: false, failed: `excluded by "${alt}"` };
    }
  }
  for (const term of rules.require ?? []) {
    const alts = term.split("|").map((s) => normalizeRo(s)).filter(Boolean);
    if (alts.length === 0) continue;
    // Substring rather than whole-word: "3 5" must match inside "… 3 5 grasime", and
    // "semidegresat" must match "semidegresesat" only if spelled so — no fuzziness here,
    // because a near-miss on a discriminator is exactly the mistake being prevented.
    if (!alts.some((a) => n.includes(a))) return { ok: false, failed: `missing "${term}"` };
  }
  return { ok: true };
}

/** Parse the rules out of a class's stored `attributes` JSON. Tolerates absence. */
export function rulesFromAttributes(attributes: string | null | undefined): ClassRules {
  if (!attributes) return {};
  try {
    const parsed = JSON.parse(attributes) as Record<string, unknown>;
    const req = parsed.require;
    const exc = parsed.exclude;
    return {
      require: Array.isArray(req) ? req.filter((x): x is string => typeof x === "string") : undefined,
      exclude: Array.isArray(exc) ? exc.filter((x): x is string => typeof x === "string") : undefined,
      anySize: parsed.anySize === true,
      maxUnitSize: typeof parsed.maxUnitSize === "number" ? parsed.maxUnitSize : undefined,
      minUnitSize: typeof parsed.minUnitSize === "number" ? parsed.minUnitSize : undefined,
    };
  } catch {
    return {};
  }
}
