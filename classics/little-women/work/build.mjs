import fs from "node:fs";
const W = "/workspace/classics/little-women/work";
const norm = (s) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9']+/g, " ").replace(/'(?![a-z])|(?<![a-z])'/g, " ").replace(/\s+/g, " ").trim();
const chapText = {};
function paras(ch) {
  if (!chapText[ch]) {
    const t = fs.readFileSync(`${W}/ch${String(ch).padStart(3, "0")}.txt`, "utf8");
    const m = {};
    for (const line of t.split("\n")) { const r = /^\[(\d+)\] (.*)$/.exec(line); if (r) m[+r[1]] = norm(r[2]); }
    chapText[ch] = m;
  }
  return chapText[ch];
}
const out = { version: 2, title: "Little Women", author: "Louisa May Alcott",
  sha256: "095392183d24a7cf84a7333f55a861f79642df2fb52114462c4d35cf73873d3e", chapters: 52,
  level: "Chinese junior-high (CEFR A2-B1). Simple English meanings.", language: "English",
  glossary: {}, paragraphs: [], sentences: [], phrases: {} };
let errs = 0;
const allNorm = []; const wordSet = new Set();
for (let i = 3; i <= 49; i++) { const ps = paras(i); for (const x of Object.values(ps)) allNorm.push(x); }
for (let i = 3; i <= 49; i++) { const t = fs.readFileSync(`${W}/ch${String(i).padStart(3, "0")}.txt`, "utf8").toLowerCase().replace(/\u2019/g, "'"); for (const m of t.matchAll(/[a-z]+(?:'[a-z]+)?/g)) wordSet.add(m[0]); }

const files = fs.readdirSync(`${W}/pieces`).filter((f) => /^ch\d+\.json$/.test(f)).sort();
for (const f of files) {
  const p = JSON.parse(fs.readFileSync(`${W}/pieces/${f}`, "utf8"));
  for (const [k, v] of Object.entries(p.glossary ?? {})) {
    if (out.glossary[k]) { console.log("DUP word", k, f); errs++; }
    const cand = [k, ...(v.forms ?? [])]; const stems = (w) => [w, w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ies$/, "y")];
    if (!cand.some((w) => stems(w).some((x) => wordSet.has(x))) && !cand.some((w) => [...wordSet].some((x) => stems(x).includes(w)))) { console.log("WORD not in book", k); errs++; }
    out.glossary[k] = v;
  }
  for (const n of p.paragraphs ?? []) {
    const c = norm(n.context); const ps = paras(n.chapter);
    const hits = Object.keys(ps).filter((i) => ps[i].includes(c));
    if (hits.length !== 1) { console.log("PARA ctx", f, hits, n.context); errs++; continue; }
    const { chapter, context, mainIdea, simple, hardWords } = n;
    out.paragraphs.push({ chapter, paragraph: +hits[0], context, mainIdea, simple, hardWords });
  }
  for (const n of p.sentences ?? []) {
    const c = norm(n.context); const ps = paras(n.chapter);
    if (!Object.values(ps).some((x) => x.includes(c))) { console.log("SENT ctx", f, n.context); errs++; }
    out.sentences.push(n);
  }
  for (const [k, v] of Object.entries(p.phrases ?? {})) {
    if (out.phrases[k]) { console.log("DUP phrase", k, f); errs++; }
    if (v.example && !allNorm.some((x) => x.includes(norm(v.example)))) { console.log("PHRASE example not found", k, v.example); errs++; }
    out.phrases[k] = v;
  }
}
fs.writeFileSync(`${W}/glossary.merged.json`, JSON.stringify(out, null, 1));
const sw = Object.values(out.glossary).filter((e) => e.senses).length;
console.log(`words ${Object.keys(out.glossary).length} senses ${sw} paras ${out.paragraphs.length} sents ${out.sentences.length} phrases ${Object.keys(out.phrases).length} coined ${Object.values(out.glossary).filter((e) => e.coined).length} errs ${errs}`);
