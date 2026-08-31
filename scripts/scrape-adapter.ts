// Run any declarative store adapter by name:  npm run scrape:store -- penny
// Adding a store is now a config file, not a script.
import { runAdapter } from "./adapters/runner";
import { penny } from "./adapters/penny";
import { selgros } from "./adapters/selgros";
import type { Adapter } from "./adapters/types";

const ALL: Record<string, Adapter> = { penny, selgros };

async function main() {
  const name = process.argv[2];
  if (!name || !ALL[name]) {
    console.error(`Usage: npm run scrape:store -- <${Object.keys(ALL).join("|")}>`);
    process.exit(1);
  }
  await runAdapter(ALL[name]);
}
main();
