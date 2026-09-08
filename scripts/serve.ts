// Build and serve ATOMICALLY: stop the server, build, start. Never build underneath a
// running one.
//
// ── WHY THIS EXISTS.
//
// `next start` reads the build manifest once, at boot, and serves HTML referencing chunk
// filenames that carry a content hash. `next build` rewrites those chunks with NEW hashes and
// DELETES the old ones. Run the build while the server is up and you get a server confidently
// serving HTML that points at files no longer on disk:
//
//     on disk:            /_next/static/chunks/app/index-cosmic/page-f373ff628ef1d37d.js
//     browser requested:  /_next/static/chunks/app/index-cosmic/page-6c7c96c8f5d65aae.js   404
//
// The browser then throws a ChunkLoadError, which React cannot recover from because it happens
// BEFORE any boundary mounts — so the visitor gets Next's bare "Application error: a
// client-side exception has occurred" on a blank page. `src/app/error.tsx` cannot catch it; its
// own comment says so.
//
// This has now confused this project repeatedly, and every time the diagnosis started from the
// wrong end (a null field, a hydration mismatch) because the symptom looks like a render bug.
// It is not. It is two processes disagreeing about which build is live.
//
//   npm run serve          stop, build, start
//   npm run serve -- --no-build   stop and start on the existing build

import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);

function sh(cmd: string): number {
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  return r.status ?? 1;
}

/** Whoever is listening on PORT, gone. */
function stopServer(): void {
  const r = spawnSync(`netstat -ano | findstr ":${PORT} " | findstr LISTENING`, { shell: true, encoding: "utf8" });
  const pids = [...new Set((r.stdout ?? "").split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/).pop())
    .filter((p): p is string => !!p && /^\d+$/.test(p) && p !== "0"))];
  if (pids.length === 0) { console.log(`  nothing listening on :${PORT}`); return; }
  for (const pid of pids) {
    console.log(`  stopping pid ${pid} on :${PORT}`);
    spawnSync(`taskkill /PID ${pid} /T /F`, { shell: true, stdio: "ignore" });
  }
}

function buildId(): string | null {
  const f = join(process.cwd(), ".next", "BUILD_ID");
  return existsSync(f) ? readFileSync(f, "utf8").trim() : null;
}

function main(): void {
  const skipBuild = process.argv.includes("--no-build");

  console.log("── stopping any server on the port first ──");
  console.log("   (building underneath a running server is what produces ChunkLoadError)");
  stopServer();

  if (!skipBuild) {
    console.log("\n── build ──");
    const before = buildId();
    if (sh("npm run build") !== 0) {
      console.error("\n✗ build failed — NOT starting a server on a half-written .next");
      process.exit(1);
    }
    const after = buildId();
    console.log(`\n  BUILD_ID ${before ?? "(none)"} -> ${after ?? "(none)"}`);
  }

  console.log("\n── start ──");
  const child = spawn(`npx next start -p ${PORT}`, { shell: true, stdio: "inherit", detached: false });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
