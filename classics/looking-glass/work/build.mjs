import { readFileSync, writeFileSync, existsSync } from "node:fs";
const D="/workspace/classics/looking-glass/work/src/";
const book=JSON.parse(readFileSync("/workspace/classics/looking-glass/work/book.json","utf8"));
const drop=new Set(readFileSync(D+"drop2.txt","utf8").split(/\s+/).filter(Boolean));
const glossary={};
for(let i=1;i<=20;i++){
  if(!existsSync(D+`words${i}.txt`)) continue;
  for(const line of readFileSync(D+`words${i}.txt`,"utf8").split("\n")){
    if(!line.trim()) continue;
    const [key,pos,forms,meaning,flag]=line.split("|");
    const old=glossary[key]||{};
    const e={pos:pos||old.pos,meaning};
    const f=forms?forms.split(","):old.forms; if(f) e.forms=f;
    if(flag==="coined"||old.coined){e.coined=true;e.whyHard="This word is made up by the author.";}
    glossary[key]=e;
  }
}
for(const k of drop) delete glossary[k];
const special=JSON.parse(readFileSync(D+"special.json","utf8"));
Object.assign(glossary,special);
const pm={}; for(const l of readFileSync(D+"phr_meanings.txt","utf8").split("\n")) if(l.trim()){const [k,m]=l.split("|");pm[k]=m;}
const phrases={};
const extraForms=JSON.parse(readFileSync(D+"phr_forms.json","utf8"));
for(const l of readFileSync(D+"phr.txt","utf8").split("\n")) if(l.trim()){
  const [k,pos,ex]=l.split("|"); const p={meaning:pm[k],pos,example:ex}; if(extraForms[k]) p.forms=extraForms[k]; phrases[k]=p;}
const paragraphs=[], sentences=[];
for(const c of "abc") paragraphs.push(...JSON.parse(readFileSync(D+`paras_${c}.json`,"utf8")));
sentences.push(...JSON.parse(readFileSync(D+"sents_a.json","utf8")));
paragraphs.sort((a,b)=>a.chapter-b.chapter||a.paragraph-b.paragraph);
const out={version:2,title:book.title,author:book.author,sha256:book.sha256,chapters:book.chapters.length,
 level:"Chinese junior-high (CEFR A2-B1). Simple English meanings.",language:"English",glossary,paragraphs,sentences,phrases};
writeFileSync("/workspace/classics/looking-glass/glossary.json",JSON.stringify(out,null,1));
console.log("words",Object.keys(glossary).length,"paras",paragraphs.length,"sents",sentences.length,"phrases",Object.keys(phrases).length);
