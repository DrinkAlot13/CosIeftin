// Feature flags, and specifically: an ambiguous value must resolve to OFF.
//
// Two features behind these flags publish a claim about a NAMED company — that a pack shrank
// while its price per kilo rose, or that an advertised discount is not a real discount. An
// accidental enable is precisely the failure the flag exists to prevent, so every input that
// is not an explicit affirmative is off.
//
// The realistic accident is not someone typing "flase". It is a deployment script writing the
// literal string "undefined", a template rendering an empty value, or a variable left at
// "false" and read as truthy by a bare `!!process.env.X`.
import { describe, it, expect } from "./run";
import { flagEnabled, trustFeaturesEnabled, allFlags } from "../src/lib/flags";

describe("feature flags — only an explicit affirmative turns one on", () => {
  it("accepts the affirmative spellings", () => {
    for (const v of ["true", "TRUE", "True", "1", "on", "ON", "yes", " true "]) {
      if (!flagEnabled(v)) throw new Error(`"${v}" should enable the flag`);
    }
    expect(true).toBeTruthy();
  });

  it("everything else is OFF", () => {
    const off = [
      undefined, "", "   ", "false", "FALSE", "0", "off", "no", "null",
      // the ones that actually happen in a deploy
      "undefined", "$FEATURE_TRUST", "{{FEATURE_TRUST}}", "nil", "2", "enabled", "tru",
    ];
    const wrong = off.filter((v) => flagEnabled(v as string | undefined));
    if (wrong.length) throw new Error(`these should NOT enable a flag: ${JSON.stringify(wrong)}`);
    expect(wrong.length).toBe(0);
  });

  it('the string "false" is off — the bug a bare !!process.env.X would ship', () => {
    expect(flagEnabled("false")).toBeFalsy();
    // The trap, stated explicitly. Read through a variable because tsc folds the literal form
    // and refuses it as always-truthy — which is the very thing being demonstrated.
    const fromEnv: string | undefined = ["false"][0];
    expect(Boolean(fromEnv)).toBeTruthy();
    expect(flagEnabled(fromEnv)).toBeFalsy();
  });
});

describe("trust features — off by default, because they name a company", () => {
  const restore = process.env.FEATURE_TRUST;

  it("off when the variable is unset", () => {
    delete process.env.FEATURE_TRUST;
    expect(trustFeaturesEnabled()).toBeFalsy();
  });

  it("off when the variable is set to anything but an affirmative", () => {
    for (const v of ["", "false", "0", "undefined"]) {
      process.env.FEATURE_TRUST = v;
      if (trustFeaturesEnabled()) throw new Error(`FEATURE_TRUST="${v}" must not enable it`);
    }
    expect(true).toBeTruthy();
  });

  it("on only when someone explicitly asked for it", () => {
    process.env.FEATURE_TRUST = "true";
    expect(trustFeaturesEnabled()).toBeTruthy();
    if (restore === undefined) delete process.env.FEATURE_TRUST;
    else process.env.FEATURE_TRUST = restore;
  });

  it("every flag is listed with the env var that controls it", () => {
    const flags = allFlags();
    expect(flags.length > 0).toBeTruthy();
    expect(flags.every((f) => f.env.startsWith("FEATURE_"))).toBeTruthy();
    expect(flags.every((f) => f.note.length > 20)).toBeTruthy();
  });
});
