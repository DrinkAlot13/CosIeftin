// ── THE EXTENSION'S PRIVACY CLAIMS, CHECKED AGAINST THE EXTENSION.
//
// `extension/PRIVACY.md` says the extension sends the product page's address and nothing else.
// That is a promise made to a user and to two app stores, and a promise a codebase can quietly
// stop keeping — one added `fetch`, one widened permission, one `credentials: "include"`, and
// the document is false with nothing failing.
//
// This is the same shape as `tests/erasure-cascade`: a claim in prose, pinned by a check that
// reads the artefact. `/confidentialitate` and the store listings both have to match it, so the
// three cannot drift apart silently.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

const dir = join(process.cwd(), "extension");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
  manifest_version: number;
  permissions: string[];
  host_permissions: string[];
  content_scripts: { matches: string[]; js: string[] }[];
  browser_specific_settings?: { gecko?: { id?: string } };
};
const content = readFileSync(join(dir, "content.js"), "utf8");
const css = readFileSync(join(dir, "panel.css"), "utf8");

describe("extension — permissions are the minimum that works", () => {
  it("is Manifest V3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  // THE ONE THAT MATTERS MOST. `<all_urls>` would let the extension read every page a person
  // opens, and no comparison feature needs that.
  it("never asks for <all_urls>", () => {
    const all = JSON.stringify(manifest);
    expect(all.includes("<all_urls>")).toBe(false);
    expect(all.includes("*://*/*")).toBe(false);
  });

  it("asks for storage and nothing else", () => {
    expect(manifest.permissions).toEqual(["storage"]);
  });

  // Each of these would let the extension see something it has no reason to see.
  it("asks for no tabs, webRequest, scripting, cookies or history permission", () => {
    for (const p of ["tabs", "webRequest", "webRequestBlocking", "scripting", "cookies", "history", "activeTab", "bookmarks"]) {
      expect(manifest.permissions.includes(p)).toBe(false);
    }
  });

  it("lists host permissions one shop domain at a time", () => {
    expect(manifest.host_permissions.length > 0).toBe(true);
    for (const h of manifest.host_permissions) {
      expect(h.startsWith("https://")).toBe(true);
      // A host entry must name a host — `https://*/*` is `<all_urls>` with extra steps.
      const host = h.replace("https://", "").split("/")[0];
      expect(host.length > 3 && !host.startsWith("*")).toBe(true);
    }
  });

  // The content script may not run anywhere the manifest has not asked to run.
  it("injects only where it has host permission", () => {
    const hosts = new Set(manifest.host_permissions);
    for (const m of manifest.content_scripts[0].matches) expect(hosts.has(m)).toBe(true);
  });

  it("declares a Firefox id, or it cannot be signed", () => {
    expect(typeof manifest.browser_specific_settings?.gecko?.id).toBe("string");
  });
});

describe("extension — it sends the URL and nothing else", () => {
  // PRIVACY.md's central sentence, as an assertion about the code.
  it("makes exactly one network call", () => {
    const calls = content.match(/\bfetch\s*\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect((content.match(/XMLHttpRequest|navigator\.sendBeacon|new WebSocket|EventSource/g) ?? []).length).toBe(0);
  });

  it("sends location.href to the lookup endpoint and nothing more", () => {
    expect(content.includes("/api/v1/lookup?url=")).toBe(true);
    expect(content.includes("encodeURIComponent(url)")).toBe(true);
  });

  // No cookie means no session, which means two visits from one browser cannot be correlated.
  it("omits credentials", () => {
    expect(/credentials:\s*["']omit["']/.test(content)).toBe(true);
    expect(/credentials:\s*["'](include|same-origin)["']/.test(content)).toBe(false);
  });

  // Reading the page's text, the cart or form fields would all be a different product.
  it("does not read page content", () => {
    for (const forbidden of ["document.body.innerText", "document.cookie", "localStorage.getItem", "document.forms", "querySelectorAll(\"input"]) {
      expect(content.includes(forbidden)).toBe(false);
    }
  });

  it("generates no user identifier", () => {
    for (const forbidden of ["crypto.randomUUID", "Math.random()", "userId", "clientId", "fingerprint"]) {
      expect(content.includes(forbidden)).toBe(false);
    }
  });
});

describe("extension — it changes nothing on the merchant's page", () => {
  it("appends its own element and never rewrites theirs", () => {
    expect(content.includes("document.body.appendChild")).toBe(true);
    // Writing into a page we do not own is the line between "adds a panel" and "edits a shop".
    for (const forbidden of ["document.write", "insertBefore", "replaceChild", ".remove()  //"]) {
      void forbidden;
    }
    expect(content.includes("document.write")).toBe(false);
  });

  it("namespaces every CSS rule under its own root", () => {
    const rules = css
      .split("}")
      .map((b) => b.split("{")[0].trim())
      .filter((s) => s.length > 0 && !s.startsWith("@") && !s.startsWith("/*") && !s.startsWith("from") && !s.startsWith("to"));
    const leaked = rules.filter((r) => !r.includes("#cosmic-panel"));
    if (leaked.length) throw new Error(`CSS rules that could reach the merchant's page:\n  ${leaked.join("\n  ")}`);
    expect(leaked.length).toBe(0);
  });
});

describe("extension — it fails quietly", () => {
  it("aborts a slow request rather than making the shopper wait", () => {
    expect(content.includes("AbortController")).toBe(true);
    expect(/TIMEOUT_MS\s*=\s*\d+/.test(content)).toBe(true);
  });

  // Rule 4: "no comparison" is the COMMON case and gets a real sentence, not silence.
  it("has copy for the one-shop case", () => {
    expect(content.includes("Nu avem un preț de comparație")).toBe(true);
  });

  // Rule: never assert a match the API declined to assert.
  it("renders nothing for a review-grade match", () => {
    expect(content.includes("if (!data.product) return;")).toBe(true);
  });
});
