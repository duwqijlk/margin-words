import sys,json; sys.path.insert(0,'.')
from parse_words import load
e,c,d=load()
g={}
for k,v in e.items():
    ent={'pos':v['pos'],'meaning':v['meaning']}
    if v['forms']: ent['forms']=[f for f in v['forms'] if f!=k]
    g[k]=ent
json.dump({'version':2,'glossary':g},open('/tmp/test_gl.json','w'),indent=1)
