import json,glob,sys
def norm(s): return s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
FX=json.load(open(sys.argv[1]))
cnt=0
files={f:json.load(open(f)) for f in glob.glob('pieces/ch*.json')}
for key,upd in FX.items():
    hit=0
    for f,d in files.items():
        for s in d['sentences']:
            if norm(s['context']).startswith(norm(key)):
                for k,v in upd.items(): s[k]=v
                hit+=1
    if hit!=1: print('PROBLEM',key,hit)
    else: cnt+=1
for f,d in files.items(): json.dump(d,open(f,'w'),ensure_ascii=False,indent=1)
print('applied',cnt)
