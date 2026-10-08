#!/usr/bin/env node
/**
 * Builds the small offline page at /kit/ (the Guide screen of the app lives at /guide): a title, a few short lines (English and Chinese) and ONE download button
 * for book-pack-kit.zip (scripts/build-kit.mjs). The text is in docs/guide-chrome.json.
 *
 *   node scripts/build-guide.mjs --check          build the page in memory and check it (used by check:example)
 *   node scripts/build-guide.mjs --out some/dir   write kit/ files to a folder (for a look)
 *
 * `vite build` calls buildGuide() too (scripts/vite-plugins.mjs) and puts the result in dist/kit/, so the page
 * is a plain offline page. Nothing is fetched from the internet.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildKit, KIT_NAME } from "./build-kit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
:root{color-scheme:light dark;--bg:#fbf8f2;--fg:#2a2622;--muted:#6d655b;--line:#e2dccf;--accent:#8a4b12;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#1d1b18;--fg:#ece6da;--muted:#aaa194;--line:#3a352e;--accent:#e0a867;--accent-fg:#1d1b18}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.65 system-ui,-apple-system,"Segoe UI","Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;overflow-wrap:anywhere}
header.bar{display:flex;gap:.75rem;align-items:center;justify-content:space-between;padding:.6rem 1rem;border-bottom:1px solid var(--line)}
header.bar a,header.bar button{font:inherit;font-size:.95rem;color:var(--accent);background:none;border:1px solid var(--line);border-radius:.6rem;padding:.35rem .75rem;cursor:pointer;text-decoration:none;min-height:2.5rem;display:inline-flex;align-items:center}
main{max-width:36rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-size:1.8rem;line-height:1.25;margin:1rem 0}
p{margin:.6rem 0}
a.download{display:inline-flex;align-items:center;margin-top:1.2rem;min-height:3rem;padding:.6rem 1.2rem;border-radius:.7rem;background:var(--accent);color:var(--accent-fg);font-weight:600;text-decoration:none}
[data-lang-section]{display:none}html[data-lang="en"] [data-lang-section="en"],html[data-lang="zh"] [data-lang-section="zh"]{display:block}
header.bar [data-lang-section]{display:none}html[data-lang="en"] header.bar [data-lang-section="en"],html[data-lang="zh"] header.bar [data-lang-section="zh"]{display:inline}
`;

/** The tiny script on the page: pick the language the reader app uses, let the buttons switch. */
const SCRIPT = `
(function(){
  var KEY="cibian-locale-v1", root=document.documentElement;
  function saved(){try{var v=localStorage.getItem(KEY);if(v){try{v=JSON.parse(v)}catch(e){}if(v==="zh"||v==="en")return v}}catch(e){}return null}
  function detect(){var l=(navigator.languages&&navigator.languages[0])||navigator.language||"en";return /^zh/i.test(l)?"zh":"en"}
  function set(l,persist){root.setAttribute("data-lang",l);root.setAttribute("lang",l==="zh"?"zh-CN":"en");
    var t=document.querySelectorAll("[data-title]");for(var i=0;i<t.length;i++){if(t[i].getAttribute("data-lang-section")===l)document.title=t[i].getAttribute("data-title")}
    if(persist){try{localStorage.setItem(KEY,l)}catch(e){}}}
  set(saved()||detect(),false);
  document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-set-lang]");if(b){set(root.getAttribute("data-lang")==="zh"?"en":"zh",true)}});
})();
`;

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

let cache = null;

/** Returns Map<fileName inside dist, string | Buffer>. fileName starts with "kit/". */
export async function buildGuide() {
  if (cache) return cache;
  const chrome = readJson("docs/guide-chrome.json");
  const sections = ["en", "zh"].map((lang) => {
    const c = chrome[lang];
    const lines = c.lines.map((line) => `<p>${esc(line)}</p>`).join("");
    return `<section data-lang-section="${lang}" data-title="${esc(c.title)} - inputread" lang="${lang === "zh" ? "zh-CN" : "en"}"><h1>${esc(c.title)}</h1>${lines}<a class="download" href="${KIT_NAME}" download data-download>${esc(c.download)}</a></section>`;
  });
  const bar = `<header class="bar"><a href="../" data-back><span data-lang-section="en">&larr; ${esc(chrome.en.back)}</span><span data-lang-section="zh">&larr; ${esc(chrome.zh.back)}</span></a><button type="button" data-set-lang aria-label="${esc(chrome.en.langLabel)} / ${esc(chrome.zh.langLabel)}"><span data-lang-section="en">${esc(chrome.en.langButton)}</span><span data-lang-section="zh">${esc(chrome.zh.langButton)}</span></button></header>`;
  const page = `<!doctype html>
<html lang="en" data-lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(chrome.en.title)} - inputread</title>
<meta name="robots" content="noindex">
<style>${CSS}</style>
<script>${SCRIPT}</script>
</head>
<body>
${bar}
<main>
${sections.join("\n")}
</main>
</body>
</html>
`;
  cache = new Map([
    ["kit/index.html", page],
    [`kit/${KIT_NAME}`, await buildKit()],
  ]);
  return cache;
}

async function check() {
  const problems = [];
  const files = await buildGuide();
  const page = files.get("kit/index.html");
  if (!files.has(`kit/${KIT_NAME}`)) problems.push(`${KIT_NAME} was not built`);
  for (const m of page.matchAll(/href="([^"#:]+)"/g)) {
    if (m[1] !== "../" && !files.has(`kit/${m[1]}`)) problems.push(`the page links to ${m[1]} but that file is not built`);
  }
  for (const lang of ["en", "zh"]) {
    if (!page.includes(`data-lang-section="${lang}" data-title`)) problems.push(`no ${lang} section`);
  }
  if ((page.match(/data-download/g) ?? []).length !== 2) problems.push("expected exactly one download button per language");
  if ((page.match(/<p>/g) ?? []).length > 6) problems.push("the page has too much text (keep it to a few short lines)");
  if (/<script[^>]+src=|<link[^>]+href="https?:|https?:\/\/[^"' ]+\.(css|js)\b/.test(page)) problems.push("the page loads something from the internet");
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const problems = await check();
    if (problems.length) {
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    console.log(`guide ok (${(await buildGuide()).size} files)`);
  } else {
    const at = args.indexOf("--out");
    const outDir = at >= 0 ? args[at + 1] : null;
    if (!outDir) {
      console.error("Usage: node scripts/build-guide.mjs --check | --out DIR");
      process.exit(2);
    }
    for (const [name, data] of await buildGuide()) {
      const file = join(outDir, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    }
    console.log(`Wrote the kit page to ${join(outDir, "kit")}/`);
  }
}
