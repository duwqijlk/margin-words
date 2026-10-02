import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
import {readFileSync} from "node:fs";
const {basic}=await loadAppModules();
const extra=new Set(readFileSync("/workspace/reader/scripts/basic-words-allow.txt","utf8").split(/\s+/).filter(w=>w&&!w.startsWith("#")).map(w=>w.toLowerCase()));
const ws=readFileSync(0,"utf8").split(/\s+/).filter(Boolean);
console.log("NO:",ws.filter(w=>basic.outsideBasic(w,[],extra).length).join(" "));
