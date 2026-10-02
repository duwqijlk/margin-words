import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
import { readFileSync } from "node:fs";
const { basic } = await loadAppModules();
const [a,b]=process.argv.slice(2).map(Number);
for (let i=a;i<=b;i++){
  const t=readFileSync(`/workspace/classics/black-beauty/work/ch${String(i).padStart(3,'0')}.txt`,'utf8').replace(/\[\d+\] /g,'');
  const out=basic.outsideBasic(t,[],new Set());
  const c={};for(const w of out)c[w]=(c[w]||0)+1;
  console.log(i, out.join(' '));
}
