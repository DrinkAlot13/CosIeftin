import { PrismaClient } from "@prisma/client";
const p=new PrismaClient();
(async()=>{
  const live={merchant:{active:true},isStale:false,flagged:false};
  const g=await p.product.findMany({where:{section:"grocery",offers:{some:live}},
    select:{id:true,equivalenceClassId:true,offers:{where:live,select:{merchantId:true}}}});
  const strict=g.filter(x=>new Set(x.offers.map(o=>o.merchantId)).size>=2).length;
  const byC=new Map<number,Set<number>>();
  for(const x of g){ if(x.equivalenceClassId==null) continue; const s=byC.get(x.equivalenceClassId)??new Set<number>(); for(const o of x.offers) s.add(o.merchantId); byC.set(x.equivalenceClassId,s); }
  const good=new Set([...byC].filter(([,s])=>s.size>=2).map(([k])=>k));
  const orEq=g.filter(x=>new Set(x.offers.map(o=>o.merchantId)).size>=2||(x.equivalenceClassId!=null&&good.has(x.equivalenceClassId))).length;
  console.log(`BASELINE  live=${g.length}  strict=${strict}  or-equivalent=${orEq}  classes-resolving=${good.size}/${byC.size}`);
  await p.$disconnect();
})();
