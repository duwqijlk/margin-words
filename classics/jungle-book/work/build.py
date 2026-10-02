import sys, json, hashlib, re, collections
sys.path.insert(0,'/workspace/classics/jungle-book/work'); sys.path.insert(0,'/workspace/classics/jungle-book/work/src')
from lib import *
import words1, words2, words3, words4, words5, words6
from senses import S
from notes_p import PN
from notes_s import SN
from phrases import PH
epub='/workspace/classics/jungle-book/book.epub'
sha=hashlib.sha256(open(epub,'rb').read()).hexdigest()
G={}
for x in words1.W:
    e={"pos":x['pos'],"meaning":x['meaning']}
    if x['why']: e["whyHard"]=x['why']
    if x['forms']: e["forms"]=x['forms']
    G[x['key']]=e
for k,v in S.items():
    senses=[]
    for (m,pos,dflt,forms,anchors) in v['senses']:
        s={"pos":pos,"meaning":m}
        if dflt: s["default"]=True
        if forms: s["forms"]=forms
        s["anchors"]=[A(c,f,ctx) for (c,f,ctx) in anchors]
        # chapter is the reader chapter number already (3..9)
        senses.append(s)
    dm=[s for s in senses if s.get('default')][0]
    e={"pos":v['pos'],"meaning":dm['meaning'],"whyHard":"This word has more than one meaning.","senses":senses}
    if v.get('forms'): e["forms"]=v['forms']
    G[k]=e
paras=[]
for c,ctx,mi,simple,hw in PN:
    paras.append({"chapter":c,"paragraph":P(c,ctx),"context":ctx,"mainIdea":mi,"simple":simple,"hardWords":hw})
paras.sort(key=lambda p:(p['chapter'],p['paragraph']))
sents=[{"chapter":c,"context":ctx,"simple":s,"grammar":g} for c,ctx,s,g in SN]
sents.sort(key=lambda s:s['chapter'])
phr={}
for k,(m,pos,f,ex) in PH.items():
    d={"meaning":m,"pos":pos}
    if f: d["forms"]=f
    d["example"]=ex
    phr[k]=d
out={"version":2,"title":"The Jungle Book","author":"Rudyard Kipling","sha256":sha,"chapters":12,
 "level":"Chinese junior-high (CEFR A2-B1). Simple English meanings.","language":"English",
 "glossary":dict(sorted(G.items())),"paragraphs":paras,"sentences":sents,"phrases":phr}
json.dump(out,open('/workspace/classics/jungle-book/glossary.json','w',encoding='utf8'),ensure_ascii=False,indent=1)
print(len(G),len(S),len(paras),len(sents),len(phr))
