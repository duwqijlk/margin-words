import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
import { readFileSync } from "node:fs";
const { basic } = await loadAppModules();
const d=JSON.parse(readFileSync('/workspace/classics/black-beauty/glossary.json','utf8'));
const keys=Object.keys(d.glossary);
const out=basic.outsideBasic(keys.join(' '),[],new Set());
const outSet=new Set(out.map(x=>x.toLowerCase()));
console.log('IN BASIC:', keys.filter(k=>!outSet.has(k.toLowerCase())).join(' '));
