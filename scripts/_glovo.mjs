const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const r = await fetch("https://glovoapp.com/ro/ro/bucuresti/kaufland-buc/", { headers: { "User-Agent": UA, "Accept-Language": "ro-RO,ro;q=0.9" } });
const b = await r.text();
console.log("status", r.status, "len", b.length);
// __NEXT_DATA__ ?
const nd = b.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
console.log("__NEXT_DATA__:", nd ? `yes (${nd[1].length}b)` : "no");
// self.__next_f push payloads (app router)
const pushes = [...b.matchAll(/self\.__next_f\.push\(/g)].length;
console.log("__next_f pushes:", pushes);
// any price-looking strings
const prices = [...b.matchAll(/"price[A-Za-z]*":\s*"?([\d.,]+)/g)].slice(0,5).map(m=>m[0]);
console.log("price fields:", prices.join(" | ") || "(none)");
// product names?
const names = [...b.matchAll(/"name":"([^"]{4,40})"/g)].slice(0,8).map(m=>m[1]);
console.log("names:", names.join(" | ") || "(none)");
// api hints
const apis = [...new Set([...b.matchAll(/https:\/\/api[a-z0-9.\-]*glovoapp\.com[^\s"']{0,60}/gi)].map(m=>m[0]))].slice(0,6);
console.log("api urls:", apis.join("\n  ") || "(none)");
