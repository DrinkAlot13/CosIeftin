// The filename in /api/admin/logs?file=... is untrusted input from a URL. This is the one
// place that decides what counts as a real log file, so it is the one place a path-traversal
// regression would matter.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { listNightlyLogs, readNightlyLog } from "../src/lib/admin/logs";

const LOG_DIR = join(process.cwd(), "logs", "nightly");
const SECRET_OUTSIDE = join(process.cwd(), "logs", "not-a-nightly-log-secret.txt");

describe("admin logs — path safety", () => {
  it("REGRESSION: refuses a path-traversal filename", () => {
    mkdirSync(join(process.cwd(), "logs"), { recursive: true });
    writeFileSync(SECRET_OUTSIDE, "should never be readable via the logs endpoint");
    try {
      expect(readNightlyLog("../not-a-nightly-log-secret.txt")).toBe(null);
      expect(readNightlyLog("..%2F..%2Fnot-a-nightly-log-secret.txt")).toBe(null);
    } finally {
      rmSync(SECRET_OUTSIDE, { force: true });
    }
  });

  it("refuses a filename that isn't the exact YYYY-MM-DD.log shape", () => {
    expect(readNightlyLog("2026-09-30.log.bak")).toBe(null);
    expect(readNightlyLog("nightly.log")).toBe(null);
    expect(readNightlyLog("")).toBe(null);
    expect(readNightlyLog("2026-9-3.log")).toBe(null);
  });

  it("reads a real log file that matches the shape", () => {
    mkdirSync(LOG_DIR, { recursive: true });
    const path = join(LOG_DIR, "2099-01-01.log");
    writeFileSync(path, "=== nightly started ===\nok\n");
    try {
      expect(readNightlyLog("2099-01-01.log")).toContain("nightly started");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("lists files newest-first and never lists a non-matching file", () => {
    mkdirSync(LOG_DIR, { recursive: true });
    const junk = join(LOG_DIR, "scratch.txt");
    const a = join(LOG_DIR, "2099-01-01.log");
    const b = join(LOG_DIR, "2099-01-02.log");
    writeFileSync(junk, "not a nightly log");
    writeFileSync(a, "day one");
    writeFileSync(b, "day two");
    try {
      const names = listNightlyLogs().map((l) => l.filename);
      expect(names.includes("scratch.txt")).toBe(false);
      const ia = names.indexOf("2099-01-01.log");
      const ib = names.indexOf("2099-01-02.log");
      expect(ib < ia).toBe(true); // newest first
    } finally {
      rmSync(junk, { force: true });
      rmSync(a, { force: true });
      rmSync(b, { force: true });
    }
  });

  it("returns an empty list rather than throwing when the directory doesn't exist", () => {
    // MUST NOT delete the real logs/nightly directory — it holds this project's actual nightly
    // history. Rename it aside, exercise the empty-directory path, then always restore it.
    const moved = existsSync(LOG_DIR);
    const asideDir = `${LOG_DIR}.test-aside`;
    if (moved) renameSync(LOG_DIR, asideDir);
    try {
      expect(listNightlyLogs()).toEqual([]);
    } finally {
      if (moved) renameSync(asideDir, LOG_DIR);
    }
  });
});
