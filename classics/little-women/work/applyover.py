import json,glob,sys
ov={}
for fn in sys.argv[1:]:
    for l in open(fn):
        l=l.rstrip('\n')
        if not l.strip(): continue
        k,m=l.split('|',1); ov[k]=m
n=0
for f in glob.glob('pieces/ch*.json'):
    d=json.load(open(f)); ch=False
    for k in d['glossary']:
        if k in ov: d['glossary'][k]['meaning']=ov[k]; ch=True; n+=1
    if ch: json.dump(d,open(f,'w'),indent=1,ensure_ascii=False)
print("applied",n,"of",len(ov))
