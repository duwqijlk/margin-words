import sys;sys.path.insert(0,'/workspace/classics/black-beauty/work')
from lib import *
import glob,importlib,os
b=load()
import h
for f in sorted(glob.glob('/workspace/classics/black-beauty/work/b[0-9][0-9]*.py')):
    importlib.import_module(os.path.basename(f)[:-3])
for x in h.P:
    t=b[x['chapter']][x['paragraph']]
    if norm(x['context']) not in norm(t): print('BAD P ctx',x['chapter'],x['context'])
    n=len(x['context'].split())
    if not 6<=n<=14: print('P ctx len',n,x['chapter'])
    for hw in x['hardWords']:
        if hw.lower() not in norm(t): print('hard?',x['chapter'],hw)
for x in h.S:
    if not any(norm(x['context']) in norm(q) for q in b[x['chapter']].values()): print('BAD S ctx',x['chapter'],x['context'])
    n=len(x['context'].split())
    if not 6<=n<=14: print('S ctx len',n,x['chapter'])
full=norm(' '.join(q for c in b.values() for q in c.values()))
for k,v in h.PH.items():
    if v.get('example') and norm(v['example']) not in full: print('EX?',k,v['example'])
from collections import Counter
print(Counter(x['chapter'] for x in h.P).most_common(2), len(h.W))
