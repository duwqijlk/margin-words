import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
import { readFileSync, existsSync } from "node:fs";
const { basic } = await loadAppModules();
const extra=new Set(readFileSync("/workspace/reader/scripts/basic-words-allow.txt","utf8").split(/\s+/).filter(w=>w&&!w.startsWith("#")).map(w=>w.toLowerCase()));
const args=process.argv.slice(2);
if(args[0]==='--file'){
  // JSON: {key:{meaning, allow:[..]}} or key->string
  const o=JSON.parse(readFileSync(args[1],'utf8')); let n=0;
  for(const [k,v] of Object.entries(o)){ const m=typeof v==='string'?v:v.meaning; const out=basic.outsideBasic(m,[k.split(' ')[0]],extra); if(out.length){n++;console.log(k,'|',out.join(','),'|',m);} }
  console.log('remaining',n);
} else {
  for(const w of args){ const o=basic.outsideBasic(w,[],extra); console.log(w, o.length?'OUT':'ok'); }
}
