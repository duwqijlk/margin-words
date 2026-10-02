import fs from 'node:fs';
import { loadAppModules } from '/workspace/reader/scripts/lib/app-modules.mjs';
const { basic } = await loadAppModules();
const extra = new Set(fs.readFileSync('/workspace/reader/scripts/basic-words-allow.txt','utf8').split(/\s+/).filter(w=>w&&!w.startsWith('#')).map(w=>w.toLowerCase()));
const ov = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const g = JSON.parse(fs.readFileSync('/workspace/classics/tom-sawyer/glossary.json','utf8')).glossary;
for (const [k,m] of Object.entries(ov)) {
  const e = g[k]; if(!e){console.log('NOKEY',k);continue;}
  const w = basic.outsideBasic(m,[k,...(e.forms||[])],extra);
  if (w.length) console.log(k, '->', w.join(','), '|', m);
}
