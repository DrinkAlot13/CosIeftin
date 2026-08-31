import { chromium } from "playwright";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await b.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { globalThis.__name = (f) => f; });
const xhr = [];
page.on("response", async (res) => {
  const u = res.url();
  if (/api|graphql|search|products|collections/i.test(u) && !/\.(png|jpg|svg|css|woff|js)/i.test(u)) {
    xhr.push(`${res.status()} ${u.slice(0, 130)}`);
  }
});
const urls = [
  "https://glovoapp.com/ro/ro/bucuresti/kaufland-buc/",
  "https://glovoapp.com/ro/ro/bucuresti/",
];
for (const u of urls) {
  try {
    await page.goto(u, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(7000);
    const title = await page.title();
    const bodyLen = (await page.content()).length;
    // look for product tiles
    const tiles = await page.$$eval("[class*='product' i], [data-test-id*='product' i], [class*='tile' i]", els => els.length).catch(()=>0);
    const priceTxt = await page.$$eval("[class*='price' i]", els => els.slice(0,5).map(e=>e.textContent.trim().slice(0,24))).catch(()=>[]);
    console.log(`\n=== ${u}\ntitle="${title}" len=${bodyLen} tiles=${tiles}`);
    console.log("prices:", JSON.stringify(priceTxt));
  } catch (e) { console.log(`\n=== ${u}\nERR ${e.message.slice(0,90)}`); }
}
console.log("\n--- XHR endpoints seen ---");
console.log([...new Set(xhr)].slice(0, 18).join("\n") || "(none)");
await b.close();
