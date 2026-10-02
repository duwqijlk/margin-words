import fs from 'node:fs';
import { loadAppModules } from '/workspace/reader/scripts/lib/app-modules.mjs';
const { basic } = await loadAppModules();
const extra = new Set(fs.readFileSync('/workspace/reader/scripts/basic-words-allow.txt','utf8').split(/\s+/).filter(w=>w&&!w.startsWith('#')).map(w=>w.toLowerCase()));
for (const w of process.argv.slice(2)) console.log(w, basic.outsideBasic(w,[],extra).length? 'NO':'ok');
