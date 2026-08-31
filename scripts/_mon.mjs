const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
async function probe(label, url, opts={}) {
  const c=new AbortController(); const to=setTimeout(()=>c.abort(),14000);
  try { const r=await fetch(url,{headers:{"User-Agent":UA,Accept:"application/json,text/html",...(opts.h||{})},signal:c.signal});
    clearTimeout(to); const b=await r.text();
    let shape=""; try{const j=JSON.parse(b); shape=Array.isArray(j)?`array(${j.length})`:Object.keys(j).slice(0,8).join(",");}catch{shape=b.slice(0,80).replace(/\s+/g," ");}
    console.log(`${label.padEnd(26)} ${String(r.status).padEnd(4)} ${shape.slice(0,100)}`);
  } catch(e){ clearTimeout(to); console.log(`${label.padEnd(26)} ERR  ${String(e.message).slice(0,45)}`); }
}
// Monitorul Preturilor — domain variants
await probe("monitorulpreturilor.info","https://monitorulpreturilor.info/");
await probe("www.monitorulpreturilor.ro","https://www.monitorulpreturilor.ro/");
await probe("monitorulpreturilor.ro","https://monitorulpreturilor.ro/");
await probe("consiliulconcurentei","https://www.consiliulconcurentei.ro/");
// Glovo — real API surface
await probe("glovo bucuresti stores","https://api.glovoapp.com/v3/feeds/categories?city_code=BUC");
await probe("glovo city feed","https://api.glovoapp.com/v3/cities/BUC/stores");
await probe("glovo web search","https://glovoapp.com/api/v1/search?q=kaufland");
await probe("glovo ro city page","https://glovoapp.com/ro/en/bucharest/");
await probe("glovo stores ro","https://glovoapp.com/ro/ro/bucuresti/kaufland-buc/");
