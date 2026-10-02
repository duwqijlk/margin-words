import { readFileSync } from "node:fs";
import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
const { basic } = await loadAppModules();
const extra = new Set(readFileSync("/workspace/reader/scripts/basic-words-allow.txt","utf8").split(/\s+/).filter(w=>w&&!w.startsWith("#")).map(w=>w.toLowerCase()));
const ws = readFileSync(0,"utf8").split(/\s+/).filter(Boolean);
const ok=[],no=[];
for(const w of ws){ (basic.outsideBasic(w,[],extra).length?no:ok).push(w); }
console.log("OK:",ok.join(" ")); console.log("NO:",no.join(" "));
