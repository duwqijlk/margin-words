import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
import {readFileSync,writeFileSync} from "node:fs";
const {basic}=await loadAppModules();
const extra=new Set(readFileSync("/workspace/reader/scripts/basic-words-allow.txt","utf8").split(/\s+/).filter(w=>w&&!w.startsWith("#")).map(w=>w.toLowerCase()));
const gp="/workspace/classics/wind-in-the-willows/glossary.json";
const g=JSON.parse(readFileSync(gp,"utf8"));
const arg=process.argv[2];
if(arg==="list"){
  let n=0;
  for(const [k,e] of Object.entries(g.glossary)){
    const w=basic.outsideBasic(e.meaning,[k,...(e.forms??[])],extra);
    if(w.length){n++;console.log(`${k} | ${e.forms?.join(',')??''} | ${e.meaning} <- ${w.join(',')}`);}
  }
  console.error(n,"failing");
} else if(arg==="phrases"){
  for(const [k,e] of Object.entries(g.phrases)){
    const w=basic.outsideBasic(e.meaning,[...k.split(' '),...(e.forms??[])],extra);
    if(w.length)console.log(`${k} | ${e.meaning} <- ${w.join(',')}`);
  }
} else {
  const rep=JSON.parse(readFileSync(arg,"utf8"));
  let ok=0,bad=0;
  for(const [k,m] of Object.entries(rep)){
    const tgt=g.glossary[k]??g.phrases[k];
    if(!tgt){console.log("NOKEY",k);continue;}
    const allow=g.glossary[k]?[k,...(tgt.forms??[])]:[...k.split(' '),...(tgt.forms??[])];
    const w=basic.outsideBasic(m,allow,extra);
    if(w.length){console.log("STILL",k,"<-",w.join(','),"::",m);bad++;}
    else{tgt.meaning=m;ok++;}
  }
  writeFileSync(gp,JSON.stringify(g,null,2)+"\n");
  console.log("applied",ok,"rejected",bad);
}
