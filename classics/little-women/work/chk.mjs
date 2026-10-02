import { readFileSync, existsSync } from "node:fs";
import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
const { basic } = await loadAppModules();
const extra = new Set(readFileSync("/workspace/reader/scripts/basic-words-allow.txt","utf8").split(/\s+/).filter(w=>w&&!w.startsWith("#")).map(w=>w.toLowerCase()));
const lines = readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean);
let bad=0;
for (const l of lines){ const i=l.indexOf("|"); const k=l.slice(0,i), m=l.slice(i+1);
 const w=basic.outsideBasic(m,[k],extra); if(w.length){bad++;console.log(k+"|"+w.join(",")+"|"+m);} }
console.error("bad",bad);
