const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const res = await fetch("https://www.auchan.ro/api/catalog_system/pub/category/tree/2", { headers: { "user-agent": UA, accept: "application/json" } });
console.log("status", res.status);
const tree = await res.json();
for (const top of tree) {
  console.log(`${top.id}  ${top.name}  (${(top.children || []).length} sub)`);
  for (const c of top.children || []) console.log(`    ${c.id}  ${c.name}`);
}
