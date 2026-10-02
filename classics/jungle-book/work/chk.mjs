import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
import { readFileSync, existsSync } from "node:fs";
const { basic } = await loadAppModules();
const extra = new Set(readFileSync("/workspace/reader/scripts/basic-words-allow.txt","utf8").split(/\s+/).filter(w=>w&&!w.startsWith("#")).map(w=>w.toLowerCase()));
const lines = readFileSync(0,"utf8").split("\n").filter(Boolean);
for (const l of lines) { const [key, ...rest] = l.split("\t"); const text = rest.join("\t"); const o = basic.outsideBasic(text,[key],extra); console.log(o.length? "BAD "+key+": "+o.join(",") : "ok  "+key); }
