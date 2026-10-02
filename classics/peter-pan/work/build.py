import json, importlib, re, sys, hashlib
import lib
from lib import *
for n in range(2,19):
    importlib.import_module('c%02d'%n)
from keep import KEEP
for k in list(G):
    if k not in KEEP: del G[k]
from over1 import MEAN
for k,m in MEAN.items():
    if k in G and 'senses' not in G[k]: G[k]['meaning']=m
from over2 import MEAN2
for k,m in MEAN2.items():
    if k in G and 'senses' not in G[k]: G[k]['meaning']=m
from over3 import PM
for k,m in PM.items():
    assert k in PHR,k
    PHR[k]['meaning']=m
# verify phrase examples
bookall=' '.join(norm(t) for ch in CH for i,t in CH[ch])
bad=0
for k,v in PHR.items():
    ex=v.get('example')
    if ex and norm(ex) not in bookall:
        print('EXAMPLE NOT EXACT',k,repr(ex)); bad+=1
# form collisions
seen={}
for k,e in G.items():
    for f in [k]+e.get('forms',[]):
        if f in seen and seen[f]!=k: print('FORM COLLISION',f,seen[f],k)
        seen.setdefault(f,k)
sha=hashlib.sha256(open(D+'/../book.epub','rb').read()).hexdigest()
out={'version':2,'title':'Peter and Wendy','author':'J. M. Barrie','sha256':sha,'chapters':21,
 'level':'Chinese junior-high (CEFR A2-B1). Simple English meanings.','language':'English',
 'glossary':G,'paragraphs':PARA,'sentences':SENT,'phrases':PHR}
json.dump(out,open(D+'/../glossary.json','w'),ensure_ascii=False,indent=1)
nsense=sum(1 for e in G.values() if 'senses' in e)
print('words',len(G),'senses',nsense,'paras',len(PARA),'sents',len(SENT),'phrases',len(PHR),'coined',sum(1 for e in G.values() if e.get('coined')),'bad',bad)
