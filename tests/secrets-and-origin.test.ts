// Defaults that grant access, and the one that publishes our address to Google.
//
// The AUTH_SECRET fallback was found by asking where a committed secret was CONSUMED rather
// than where it was stored. Sweeping for the same shape turned up a worse one:
//
//     const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";   // scripts/seed-admin.ts
//
// wired into `npm run setup`, printing the password to stdout, and live in the database as
// user #1. AUTH_SECRET let an attacker forge a session; this handed them a working login.
//
// The rule these encode: a default that grants access must FAIL, not fall back. A default that
// is a config convenience (a batch size, a timeout) is fine and stays.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { resolveSeedPassword, PUBLISHED_PASSWORDS, MIN_PASSWORD_LENGTH } from "../scripts/seed-admin";
import { resolveSiteUrl, isLocalOrigin, MissingSiteUrlError } from "../src/lib/config/siteUrl";

describe("seed-admin — refuses to create an account with a known password", () => {
  it("throws in production with no ADMIN_PASSWORD", () => {
    const r = resolveSeedPassword({ NODE_ENV: "production" });
    expect(r.ok).toBeFalsy();
    if (!r.ok) expect(r.reason.includes("Refusing")).toBeTruthy();
  });

  it("has NO development fallback either — a seeded account outlives its machine", () => {
    expect(resolveSeedPassword({ NODE_ENV: "development" }).ok).toBeFalsy();
  });

  it("rejects the exact string that was committed, whatever the length", () => {
    expect(resolveSeedPassword({ ADMIN_PASSWORD: "admin1234", NODE_ENV: "development" }).ok).toBeFalsy();
    // …and its longer cousins are only rejected by length, so check the denylist directly.
    for (const p of PUBLISHED_PASSWORDS) {
      expect(resolveSeedPassword({ ADMIN_PASSWORD: p, NODE_ENV: "development" }).ok).toBeFalsy();
    }
  });

  it("rejects anything under the minimum length", () => {
    expect(resolveSeedPassword({ ADMIN_PASSWORD: "x".repeat(MIN_PASSWORD_LENGTH - 1), NODE_ENV: "development" }).ok).toBeFalsy();
  });

  it("accepts a real password", () => {
    const r = resolveSeedPassword({ ADMIN_PASSWORD: "a-genuinely-long-one", NODE_ENV: "production" });
    expect(r.ok).toBeTruthy();
  });

  it("never prints a password", () => {
    const src = readFileSync(join(process.cwd(), "scripts", "seed-admin.ts"), "utf8");
    const logs = [...src.matchAll(/console\.log\(([^;]*)\)/g)].map((m) => m[1]);
    const leaks = logs.filter((l) => /password|PASSWORD|resolved\.password/.test(l));
    if (leaks.length) throw new Error("seed-admin logs a password: " + leaks.join(" | "));
    expect(leaks.length).toBe(0);
  });

  it("an existing account keeps its password when setup re-runs", () => {
    const src = readFileSync(join(process.cwd(), "scripts", "seed-admin.ts"), "utf8");
    const update = src.slice(src.indexOf("update:"), src.indexOf("create:"));
    expect(update.includes("passwordHash")).toBeFalsy();
  });
});

describe("rotate-admin — the password may arrive only by environment", () => {
  const src = readFileSync(join(process.cwd(), "scripts", "rotate-admin.ts"), "utf8");

  it("refuses a password passed as an argument", () => {
    expect(src.includes('a.startsWith("--password")')).toBeTruthy();
  });

  it("never prints the new password", () => {
    const logs = [...src.matchAll(/console\.log\(([^;]*)\)/g)].map((m) => m[1]);
    const leaks = logs.filter((l) => /\$\{next\}|\+ next|, next/.test(l));
    if (leaks.length) throw new Error("rotate-admin logs the password: " + leaks.join(" | "));
    expect(leaks.length).toBe(0);
  });

  it("verifies the rotation by re-reading rather than assuming", () => {
    expect(/findUnique[\s\S]{0,200}after/.test(src) || src.includes("const after =")).toBeTruthy();
    expect(src.includes("oldStillWorks")).toBeTruthy();
  });
});

describe("SITE_URL — one accessor, and it never guesses in production", () => {
  it("throws in production when unset", () => {
    let threw = false;
    try { resolveSiteUrl({ NODE_ENV: "production" }); } catch (e) { threw = e instanceof MissingSiteUrlError; }
    expect(threw).toBeTruthy();
  });

  it("returns the dev origin in development", () => {
    expect(resolveSiteUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("strips a trailing slash so absolute URLs never double up", () => {
    expect(resolveSiteUrl({ SITE_URL: "https://cosmic.ro/", NODE_ENV: "production" })).toBe("https://cosmic.ro");
  });

  it("recognises an origin that must never be published", () => {
    for (const u of ["http://localhost:3000/p/x", "http://127.0.0.1:3200", "https://0.0.0.0/", "http://[::1]:80/a"]) {
      if (!isLocalOrigin(u)) throw new Error(`should be flagged as local: ${u}`);
    }
    for (const u of ["https://cosmic.ro/p/x", "https://localhost.cosmic.ro/"]) {
      if (isLocalOrigin(u)) throw new Error(`should NOT be flagged: ${u}`);
    }
    expect(true).toBeTruthy();
  });

  it("nothing else reads SITE_URL directly", () => {
    const roots = ["src", "scripts"];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (full.includes(join("config", "siteUrl"))) continue;
        const src = readFileSync(full, "utf8").split("\n")
          .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
        if (src.some((l) => /process\.env\.(NEXT_PUBLIC_)?SITE_URL/.test(l))) {
          offenders.push(full.replace(process.cwd(), "").split("\\").join("/"));
        }
      }
    };
    for (const r of roots) walk(join(process.cwd(), r));
    if (offenders.length) {
      throw new Error(
        "SITE_URL is read outside lib/config/siteUrl.ts — that is how two different defaults " +
        "existed for one variable:\n  " + offenders.join("\n  "),
      );
    }
    expect(offenders.length).toBe(0);
  });
});
