import sys
ov={}
for fn in sys.argv[1:]:
    for l in open(fn,encoding='utf8'):
        if l.strip():
            k,m=l.rstrip('\n').split('|',1); ov[k]=m
for fn in ['words1.txt','words2.txt','words3.txt','words4.txt','words5.txt']:
    out=[]
    for l in open(fn,encoding='utf8').read().split('\n'):
        if l and not l.startswith('#'):
            p=l.split('|')
            if p[0] in ov: p[2]=ov[p[0]]
            l='|'.join(p)
        out.append(l)
    open(fn,'w',encoding='utf8').write('\n'.join(out))
