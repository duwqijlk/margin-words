import sys,glob,json,importlib,os
sys.path.insert(0,'/workspace/classics/black-beauty/work')
import h
for f in sorted(glob.glob('/workspace/classics/black-beauty/work/b[0-9][0-9]*.py')):
    importlib.import_module(os.path.basename(f)[:-3])
import fixes,importlib
for f in sorted(glob.glob('/workspace/classics/black-beauty/work/f[0-9][0-9]*.py')):
    importlib.import_module(os.path.basename(f)[:-3])
out={"version":2,"title":"Black Beauty","author":"Anna Sewell","sha256":"6966a8c6669e36854d50d9d6a489c6e9a9d13d90e633c5765d4e67a0bef47b5a","chapters":54,"level":"basic","language":"en","glossary":h.W,"paragraphs":h.P,"sentences":h.S,"phrases":h.PH}
for k,v in h.SENSES.items(): h.W[k]["senses"]=v
json.dump(out,open('/workspace/classics/black-beauty/glossary.json','w'),indent=1,ensure_ascii=False)
print(len(h.W),len(h.P),len(h.S),len(h.PH))
