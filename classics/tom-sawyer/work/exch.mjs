import fs from 'node:fs';
const g=JSON.parse(fs.readFileSync('../glossary.json'));
const norm=s=>s.replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').toLowerCase();
const text=fs.readdirSync('.').filter(f=>/^ch\d+\.txt$/.test(f)).map(f=>fs.readFileSync(f,'utf8').replace(/\[\d+\]/g,'')).join('\n');
const T=norm(text);
for(const [k,v] of Object.entries(g.phrases)) if(!T.includes(norm(v.example))) console.log('PHR EX',k,'|',v.example);
const per={};
for(const p of g.paragraphs){const t=fs.readFileSync(`ch${String(p.chapter).padStart(3,'0')}.txt`,'utf8');if(!norm(t).includes(norm(p.context)))console.log('PARA CTX',p.chapter,p.paragraph,p.context)}
for(const p of g.sentences){const t=fs.readFileSync(`ch${String(p.chapter).padStart(3,'0')}.txt`,'utf8');if(!norm(t).includes(norm(p.context)))console.log('SENT CTX',p.chapter,p.context)}
