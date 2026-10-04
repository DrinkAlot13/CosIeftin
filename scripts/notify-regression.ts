// A check that was PASSING last night and is FAILING tonight is news; a check that has been red
// for weeks is not — see soak-report.ts's own header for why "state changed" is what this project
// treats as worth a human's attention versus a standing, already-known failure.
//
// This is that comparison, run as its own nightly step (scripts/nightly.ts) so a regression does
// not require someone to remember to open /admin/soak. No destination is a FAILURE here, by
// design — `telegramConfigured()` already treats "no bot token" as the normal unconfigured state
// for per-shopper price alerts (src/lib/telegram.ts), and the same posture applies to an ops
// alert: it prints to the nightly log either way, and additionally reaches Telegram once
// OWNER_TELEGRAM_CHAT_ID is set. Nothing here invents or assumes that value.
//
// Run: npm run notify:regression

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sendTelegram, telegramConfigured, esc } from "../src/lib/telegram";
import { findRegressions } from "../src/lib/soak-regression";

const LOG_DIR = join(process.cwd(), "logs", "soak");

type StepResult = { name: string; ok: boolean; exitCode: number };
type Entry = { date: string; steps: StepResult[] };

function load(): Entry[] {
  if (!existsSync(LOG_DIR)) return [];
  return readdirSync(LOG_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(LOG_DIR, f), "utf8"));
        return { date: f.replace(".json", ""), steps: data.steps ?? [] } as Entry;
      } catch {
        return null;
      }
    })
    .filter((e): e is Entry => e !== null);
}

async function main() {
  const entries = load();
  if (entries.length < 2) {
    console.log("notify:regression: fewer than 2 nights recorded — nothing to compare yet.");
    return;
  }
  const [prev, latest] = entries.slice(-2);
  const { regressions, recoveries } = findRegressions(prev.steps, latest.steps);

  if (regressions.length === 0) {
    console.log(`notify:regression: no step regressed between ${prev.date} and ${latest.date}.`);
    if (recoveries.length > 0) console.log(`  recovered: ${recoveries.map((r) => r.name).join(", ")}`);
    return;
  }

  const lines = [
    `⚠️ <b>${regressions.length} check(s) regressed</b> overnight (${prev.date} → ${latest.date}):`,
    ...regressions.map((r) => `  • ${esc(r.name)}`),
  ];
  if (recoveries.length > 0) lines.push("", `Recovered: ${recoveries.map((r) => esc(r.name)).join(", ")}`);
  const message = lines.join("\n");

  console.log(message.replace(/<\/?b>/g, ""));

  const chatId = process.env.OWNER_TELEGRAM_CHAT_ID;
  if (!telegramConfigured() || !chatId) {
    console.log("\n  (not sent to Telegram — set TELEGRAM_BOT_TOKEN and OWNER_TELEGRAM_CHAT_ID to enable)");
    return;
  }
  const sent = await sendTelegram(chatId, message);
  console.log(sent ? "  sent to Telegram." : "  Telegram send failed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
