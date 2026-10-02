import json,re,glob,sys,os
W='/workspace/classics/secret-garden/work/'
BOOK=json.load(open(W+'book.json'))
# paragraphs
P={}
for i in range(31):
    for line in open(W+f'ch{i:03d}.txt'):
        m=re.match(r'\[(\d+)\] (.*)',line.rstrip('\n'))
        if m: P[(i,int(m.group(1)))]=m.group(2)
def norm(t):
    t=t.replace('\u2018',"'").replace('\u2019',"'").replace('\u201c','"').replace('\u201d','"').replace('\u2014','-').replace('\u2013','-').replace('\u2026','...')
    return re.sub(r'\s+',' ',t).lower()
def strip(t): return re.sub(r"[^a-z0-9' ]",'',re.sub(r"\s+"," ",norm(t))).strip()
def orig(t,snip):
    nt=norm(t); ns=norm(snip)
    i=nt.find(ns)
    if i<0: return None
    assert len(nt)==len(norm(t))
    return t[i:i+len(ns)]
def orig_any(snip):
    for t in P.values():
        o=orig(t,snip)
        if o: return o
    return None
gloss={};paras=[];sents=[];phr={};errs=[]
for f in sorted(glob.glob(W+'pieces/ch*.py')):
    ns={}
    exec(open(f).read(),ns)
    ch=int(re.search(r'ch(\d+)',f).group(1))
    for w in ns.get('words',[]):
        key,pos,meaning=w[:3]; forms=w[3] if len(w)>3 else None; coined=w[4] if len(w)>4 else False
        if key in gloss: errs.append(f'dup word {key} ({f})'); continue
        if not re.fullmatch(r"[a-z]+(['-][a-z]+)*",key): errs.append(f'bad key {key}')
        e={"pos":pos,"meaning":meaning}
        if forms: e["forms"]=forms
        if coined: e["coined"]=True
        allt=norm(' '.join(t for (c,_),t in P.items() if c==ch)); toks=set(re.findall(r"[a-z]+(?:'[a-z]+)?",allt))
        cand={key}|set(forms or [])
        if not (cand&toks):
            # allow plural/ed/ing reduction
            if not any(t.startswith(key[:max(3,len(key)-2)]) for t in toks): errs.append(f'word not in chapter {ch}: {key}')
        gloss[key]=e
    for pc,p,ctx,mi,si,hw in ns.get('paras',[]):
        assert pc==ch,(pc,ch)
        t=P.get((ch,p))
        if t is None: errs.append(f'no para {ch}:{p}'); continue
        o=orig(t,ctx)
        if o is None: errs.append(f'para ctx not exact {ch}:{p} {ctx}')
        else: ctx=o
        n=len(ctx.split())
        if n<6 or n>14: errs.append(f'para ctx len {n} {ch}:{p}')
        for h in hw:
            if norm(h) not in norm(t): errs.append(f'hardword missing {ch}:{p} {h}')
        paras.append({"chapter":ch,"paragraph":p,"context":ctx,"mainIdea":mi,"simple":si,"hardWords":hw})
    for ctx,si,gr in ns.get('sents',[]):
        hits=[k for k,t in P.items() if k[0]==ch and orig(t,ctx)]
        if len(hits)!=1: errs.append(f'sent ctx hits={len(hits)} {ch} {ctx}')
        else: ctx=orig(P[hits[0]],ctx)
        n=len(ctx.split())
        if n<6 or n>14: errs.append(f'sent ctx len {n} {ch} {ctx}')
        sents.append({"chapter":ch,"context":ctx,"simple":si,"grammar":gr})
    for key,pos,meaning,forms,ex in ns.get('phrases',[]):
        if key in phr: continue
        e={"meaning":meaning,"pos":pos}
        if forms: e["forms"]=forms
        if ex:
            oo=orig_any(ex)
            if oo is None: errs.append(f'phrase example not exact: {key}: {ex}')
            else: ex=oo
            if len(ex.split())>15: errs.append(f'example long {key}')
            e["example"]=ex
        phr[key]=e
import sys
sys.path.insert(0,W)
from trim import *
gloss={k:v for k,v in gloss.items() if k not in DROP_WORDS}
paras=[p for p in paras if (p['chapter'],p['paragraph']) in KEEP_PARAS]
sents=[s for i,s in enumerate(sents) if i in KEEP_SENT_IDX]
phr={k:v for k,v in phr.items() if k in KEEP_PHR}
d={"version":2,"title":BOOK['title'],"author":BOOK['author'],"sha256":BOOK['sha256'],"chapters":len(BOOK['chapters']),
 "level":"Chinese junior-high (CEFR A2-B1). Simple English meanings.","language":"English",
 "glossary":gloss,"paragraphs":paras,"sentences":sents,"phrases":phr}
json.dump(d,open('/workspace/classics/secret-garden/glossary.json','w'),indent=1,ensure_ascii=False)
print(len(gloss),len(paras),len(sents),len(phr))
for e in errs: print('ERR',e)
