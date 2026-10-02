import json,re,sys
g=json.load(open('../glossary.json'))
P={}
for i in range(31):
    for line in open(f'ch{i:03d}.txt'):
        m=re.match(r'\[(\d+)\] (.*)',line.rstrip('\n'))
        if m: P[(i,int(m.group(1)))]=m.group(2)
a,b=int(sys.argv[1]),int(sys.argv[2])
for i,p in enumerate(g['paragraphs'][a:b],a):
    print(f"=== P{i} {p['chapter']}:{p['paragraph']}\nORIG: {P[(p['chapter'],p['paragraph'])]}\nMAIN: {p['mainIdea']}\nSIMP: {p['simple']}\n")
