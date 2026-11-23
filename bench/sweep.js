// Sensitivity of the finder benchmark to the number of neighbours K and the vote weighting.
// Run after bench/run.js (it reads results/finder.json for the true journal of each paper).
import fs from "fs";
const R=JSON.parse(fs.readFileSync("results/finder.json"));
const P=JSON.parse(fs.readFileSync("bench/papers.json"));
import {buildQuery,urls} from "../src/finder.js";
import {replayFetch} from "./replay.js";
const out=[];
for (const K of [10,20,30,50]) for (const [wn,wf] of [["count",r=>1],["1/log2(r+1)",r=>1/Math.log2(r+1)],["1/sqrt(r)",r=>1/Math.sqrt(r)],["1/r",r=>1/r]]) {
  let mrr=0,h1=0,h3=0,h5=0,h10=0;
  for (const [i,p] of P.entries()) {
    const ans=await replayFetch(urls.similar(buildQuery(p.title)));
    const truth=R[i].truth; const v=new Map(); let r=0;
    for (const w of ans.results){ if(w.id.endsWith(p.id)) continue; r++; if(r>K) break; const s=w.primary_location?.source; if(!s||s.type!=="journal") continue; v.set(s.id,(v.get(s.id)||0)+wf(r)); }
    const order=[...v.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0].replace("https://openalex.org/",""));
    const k=order.indexOf(truth)+1; if(k){mrr+=1/k; h1+=k<=1; h3+=k<=3; h5+=k<=5; h10+=k<=10;}
  }
  out.push({K,w:wn,h1,h3,h5,h10,mrr:+(mrr/P.length).toFixed(3)});
}
console.table(out);
