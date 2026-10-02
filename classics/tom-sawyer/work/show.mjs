import fs from 'node:fs';
const g=JSON.parse(fs.readFileSync('../glossary.json'));
const [a,b]=process.argv.slice(2).map(Number);
for(const p of g.paragraphs.filter(p=>p.chapter>=a&&p.chapter<=b)){
 const t=fs.readFileSync(`ch${String(p.chapter).padStart(3,'0')}.txt`,'utf8');
 const m=t.match(new RegExp(`\\[${p.paragraph}\\]([\\s\\S]*?)(?=\\n\\[\\d+\\]|$)`));
 console.log(`=== ch${p.chapter} p${p.paragraph}\nORIG: ${m?m[1].trim():'??'}\nMAIN: ${p.mainIdea}\nSIMPLE: ${p.simple}\nHARD: ${p.hardWords}\n`);
}
