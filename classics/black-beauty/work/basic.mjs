import { loadAppModules } from "/workspace/reader/scripts/lib/app-modules.mjs";
const { basic } = await loadAppModules();
const words = process.argv.slice(2).join(" ");
console.log(JSON.stringify(basic.outsideBasic(words, [], new Set())));
