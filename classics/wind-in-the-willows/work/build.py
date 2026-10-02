#!/usr/bin/env python3
"""Merge chapter piece files (work/cNN.txt) into ../glossary.json and check them against the numbered text."""
import json,re,sys,glob,os
W=os.path.dirname(os.path.abspath(__file__))
book=json.load(open(W+'/book.json')) if os.path.exists(W+'/book.json') else {}
def norm(s): return re.sub(r'\s+',' ',s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('—','-').replace('–','-').replace('…','...')).lower()
def lettersonly(s): return re.sub(r"[^a-z0-9' ]+",' ',norm(s)).split()
def load_chapter(n):
    t=open(f'{W}/ch{n:03d}.txt').read()
    paras={}
    for m in re.finditer(r'^\[(\d+)\] (.*)$',t,flags=re.M): paras[int(m.group(1))]=m.group(2)
    return paras
CH={n:load_chapter(n) for n in range(16)}
ALLTEXT=norm(' '.join(p for n in CH for p in CH[n].values()))
def words(s): return re.findall(r"[a-z]+(?:'[a-z]+)?",norm(s))
errors=[]
glossary={};paragraphs=[];sentences=[];phrases={}
def contains_words(par,ctx):
    a=' '.join(lettersonly(par)); b=' '.join(lettersonly(ctx)); return b in a
for f in sorted(glob.glob(W+'/c[0-9][0-9].txt')):
    n=int(os.path.basename(f)[1:3]); sec=None; cur=None
    paras=CH[n]; chtext=norm(' '.join(paras.values())); chwords=set(words(' '.join(paras.values())))
    def flush():
        global cur
        if cur is None: return
        kind,d=cur
        if kind=='P':
            c=d['context']; hits=[i for i,p in paras.items() if contains_words(p,c)]
            if len(hits)!=1: errors.append(f'ch{n} P ctx not unique/found ({len(hits)}): {c}'); return
            i=hits[0]; nw=len(c.split())
            if not 6<=nw<=14: errors.append(f'ch{n} P ctx words {nw}: {c}')
            hw=[h.strip() for h in d.pop('hard','').split(';') if h.strip()]
            for h in hw:
                if norm(h) not in norm(paras[i]): errors.append(f'ch{n} p{i} hardWord not in para: {h}')
            paragraphs.append(dict(chapter=n,paragraph=i,context=c,mainIdea=d['idea'],simple=d['simple'],hardWords=hw))
        elif kind=='S':
            c=d['context']; nw=len(c.split())
            if not 6<=nw<=14: errors.append(f'ch{n} S ctx words {nw}: {c}')
            hits=[i for i,p in paras.items() if contains_words(p,c)]
            if not hits: errors.append(f'ch{n} S ctx not found: {c}')
            sentences.append(dict(chapter=n,context=c,simple=d['simple'],grammar=d['gram']))
        cur=None
    for line in open(f).read().split('\n'):
        if not line.strip() or line.startswith('#'): continue
        if line.startswith('@'):
            flush(); sec=line[1:].strip().split()[0]
            if sec in('P','S'): cur=(sec,{})
            continue
        if sec=='W':
            parts=[x.strip() for x in line.split('|')]
            if len(parts)<3: errors.append(f'ch{n} bad W line {line}'); continue
            key,pos,meaning=parts[:3]; forms=[x.strip() for x in parts[3].split(',') if x.strip()] if len(parts)>3 else []
            why=parts[4] if len(parts)>4 and parts[4] else None
            if key in glossary: errors.append(f'dup key {key} (ch{n})'); continue
            if not re.match(r"^[a-z]+(['-][a-z]+)*$",key): errors.append(f'bad key {key}')
            seen=[key]+forms
            if not any(w in chwords or w+'s' in chwords or w+'es' in chwords or (w.endswith('y') and w[:-1]+'ies' in chwords) for w in seen): errors.append(f'ch{n} word not in chapter: {key} {forms}')
            for w in forms:
                if w not in chwords and w not in set(words(ALLTEXT)): errors.append(f'form not in book: {w}')
            e={'pos':pos,'meaning':meaning}
            if why: e['whyHard']=why
            if forms: e['forms']=forms
            glossary[key]=e
        elif sec in('P','S'):
            k,_,v=line.partition(':'); k=k.strip(); v=v.strip()
            m={'ctx':'context','idea':'idea','simple':'simple','hard':'hard','gram':'gram'}[k]
            cur[1][m]=v
        elif sec=='PH':
            parts=[x.strip() for x in line.split('|')]
            if len(parts)<4: errors.append(f'ch{n} bad PH {line}'); continue
            key,pos,meaning=parts[:3]; forms=[x.strip() for x in parts[3].split(',') if x.strip()]; ex=parts[4] if len(parts)>4 else ''
            if pos not in('phrasal verb','idiom','phrase'): errors.append(f'bad pos {key}')
            if len(key.split())<2: errors.append(f'phrase key {key}')
            if key in phrases: errors.append(f'dup phrase {key}'); continue
            e={'meaning':meaning,'pos':pos}
            if forms: e['forms']=forms
            if ex:
                if norm(ex) not in ALLTEXT: errors.append(f'phrase example not exact: {key}: {ex}')
                e['example']=ex
            phrases[key]=e
    flush()
if errors:
    print('\n'.join(errors)); 
out=dict(version=2,title=book.get('title'),author=book.get('author'),sha256=book.get('sha256'),chapters=16,
 level='Chinese junior-high (CEFR A2-B1). Simple English meanings.',language='English',
 glossary=glossary,paragraphs=paragraphs,sentences=sentences,phrases=phrases)
json.dump(out,open(W+'/../glossary.json','w'),indent=2,ensure_ascii=False)
print('words',len(glossary),'paras',len(paragraphs),'sents',len(sentences),'phrases',len(phrases),'errors',len(errors))
