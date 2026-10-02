import { readFileSync } from "node:fs";
const cnt = {};
for (let i=5;i<=15;i++){ const t=readFileSync(`/workspace/classics/looking-glass/work/ch${String(i).padStart(3,"0")}.txt`,"utf8");
 for (const m of t.matchAll(/[A-Za-z]+(?:'[A-Za-z]+)?/g)) { const w=m[0].toLowerCase(); (cnt[w] ??= {}); cnt[w][i]=(cnt[w][i]||0)+1; } }
export default cnt;
