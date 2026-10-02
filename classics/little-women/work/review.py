import json,glob,re,sys
lo,hi=int(sys.argv[1]),int(sys.argv[2])
for f in sorted(glob.glob('pieces/ch*.json')):
    c=int(f[-8:-5])
    if not lo<=c<=hi: continue
    d=json.load(open(f)); txt=open(f'ch{c:03d}.txt').read()
    paras=re.split(r'\n\n(?=\[\d+\] )',txt)
    for p in d['paragraphs']:
        key=p['context'].replace("'","’")[:25]
        m=[x for x in paras if p['context'][:20] in x or key[:20] in x]
        print(f"=== CH{c} PARA\nORIG: {m[0] if m else 'NOTFOUND '+p['context']}\nMAIN: {p['mainIdea']}\nSIMPLE: {p['simple']}\n")
