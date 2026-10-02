import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
import { readFileSync } from "node:fs";
const { basic } = await loadAppModules();
const extra = new Set(readFileSync("/workspace/reader/scripts/basic-words-allow.txt","utf8").split(/\s+/).filter(w=>w&&!w.startsWith("#")).map(w=>w.toLowerCase()));
const words = readFileSync(0,"utf8").split(/\s+/).filter(Boolean);
const bad = words.filter(w=>basic.outsideBasic(w,[],extra).length);
console.log("BAD:",bad.join(" "));
console.log("OK:",words.filter(w=>!bad.includes(w)).join(" "));
