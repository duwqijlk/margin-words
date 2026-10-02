import { readFileSync } from "node:fs";
import cnt from "./bookwords.mjs";
const drop = new Set(readFileSync("/workspace/classics/looking-glass/work/src/drop2.txt","utf8").split(/\s+/).filter(Boolean));
for (let i=1;i<=9;i++){
 for (const line of readFileSync(`/workspace/classics/looking-glass/work/src/words${i}.txt`,"utf8").split("\n").filter(Boolean)) {
  const [key,pos,forms] = line.split("|"); if (drop.has(key)) continue;
  const fs=[key,...(forms?forms.split(","):[])];
  const present = fs.filter(f=>cnt[f]);
  if(!cnt[key] && present.length==0) console.log("MISSING", key, "forms:",forms, "file",i);
  else if (!cnt[key]) console.log("keynotinbook", key, "present forms:", present.join(","));
  else if (forms) { const bad=forms.split(",").filter(f=>!cnt[f]); if(bad.length) console.log("badforms",key,bad.join(",")); }
 }}
