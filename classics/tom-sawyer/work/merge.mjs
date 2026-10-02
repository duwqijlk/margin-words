import fs from 'node:fs';
const dir='parts';
const out={version:2,title:"The Adventures of Tom Sawyer",author:"Mark Twain",sha256:"5819605c2b1f5714ba5c1273827422f60ebd18e3d46c939bcec9e2613c37f2a7",chapters:42,level:"Chinese junior-high (CEFR A2-B1). Simple English meanings.",language:"English",glossary:{},paragraphs:[],sentences:[],phrases:{}};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort()){
  let d; try{d=JSON.parse(fs.readFileSync(dir+'/'+f,'utf8'))}catch(e){console.error('BAD JSON',f,e.message);process.exit(1)}
  for(const [k,v] of Object.entries(d.glossary||{})){ if(out.glossary[k]) console.error('DUP word',k,f); out.glossary[k]=v;}
  out.paragraphs.push(...(d.paragraphs||[])); out.sentences.push(...(d.sentences||[]));
  for(const [k,v] of Object.entries(d.phrases||{})){ if(out.phrases[k]) console.error('DUP phrase',k,f); out.phrases[k]=v;}
}
const ov=JSON.parse(fs.readFileSync('ov3.json','utf8'));
for(const [k,m] of Object.entries(ov)){ if(out.glossary[k]) out.glossary[k].meaning=m; else console.error('NOKEY',k);}
for(const k of (JSON.parse(fs.readFileSync('drop.json','utf8')))) delete out.glossary[k];
fs.writeFileSync('../glossary.json',JSON.stringify(out,null,1));
console.log(Object.keys(out.glossary).length,'words',out.paragraphs.length,'para',out.sentences.length,'sent',Object.keys(out.phrases).length,'phr');
