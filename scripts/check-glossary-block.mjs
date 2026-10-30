// Check that a direct download of a word list from the public books host is refused, and by
// which layer, while the catalog next to it still loads.
//
//   node scripts/check-glossary-block.mjs
//
// The block is a Cloudflare WAF custom rule on the inputread.site zone (docs/MAINTENANCE.md,
// "Direct word-list downloads"). It answers with Cloudflare's own block page. The retired
// glossary-block Worker answered with the JSON {"error":"glossary-week"}; seeing that again
// means the Worker routes are back. A 200 for a glossary means nothing blocks it: fix at once.
import { execFileSync } from "node:child_process";

const HOST = "https://books.inputread.site";
const GLOSSARY = `${HOST}/word-lists/harry-potter-and-the-sorcerers-stone/glossary.json`;
const CATALOG = `${HOST}/word-lists/catalog.json`;

function get(url) {
  // curl, because Node's fetch does not use this machine's proxy settings everywhere.
  const out = execFileSync("curl", ["-sS", "-o", "-", "-w", "\n%{http_code}", "-A", "inputread-check/1", url], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");
  const cut = out.lastIndexOf("\n");
  return { status: Number(out.slice(cut + 1)), body: out.slice(0, cut) };
}

let failed = false;
// The plain address and percent-encoded spellings of it: the retired Worker only compared the raw
// path, so "glossary%2Ejson" (R2 decodes it to glossary.json) downloaded the whole list.
const variants = [
  GLOSSARY,
  GLOSSARY.replace(".json", "%2Ejson"),
  GLOSSARY.replace(".json", "%2ejson"),
  GLOSSARY.replace("glossary.json", "glossar%79.json"),
  GLOSSARY.replace("glossary.json", "gl%6Fssary.js%6Fn"),
  GLOSSARY.replace("/glossary.json", "%2Fglossary.json"),
  GLOSSARY.replace("glossary.json", "GLOSSARY.JSON"),
];
for (const variant of variants) {
  const { status, body } = get(variant);
  const layer = status === 200 ? "NOT BLOCKED" : body.includes('"glossary-week"') ? "old Worker" : status === 403 ? "WAF rule" : `status ${status}`;
  const fine = status === 403 && layer === "WAF rule" || status === 404;
  if (!fine) failed = true;
  console.log(`${fine ? "ok  " : "FAIL"} ${status} ${layer.padEnd(11)} ${variant.replace(HOST, "")}`);
}
const catalog = get(CATALOG);
let rows = -1;
try {
  rows = JSON.parse(catalog.body).lists.length;
} catch {}
if (catalog.status !== 200 || rows <= 0) failed = true;
console.log(`${catalog.status === 200 && rows > 0 ? "ok  " : "FAIL"} ${catalog.status} catalog    /word-lists/catalog.json (${rows} books)`);
process.exit(failed ? 1 : 0);
