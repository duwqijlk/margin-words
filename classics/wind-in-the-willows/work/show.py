import json,re,sys
g=json.load(open('../glossary.json'))
lo,hi=int(sys.argv[1]),int(sys.argv[2])
cache={}
def para(ch,i):
    if ch not in cache:
        cache[ch]=open('ch%03d.txt'%ch).read()
    m=re.search(r'^\[%d\] (.*)$'%i,cache[ch],re.M)
    return m.group(1)
for k,p in enumerate(g['paragraphs']):
    if lo<=k<hi:
        print('=== #%d ch%d p%d'%(k,p['chapter'],p['paragraph']))
        print('ORIG:',para(p['chapter'],p['paragraph']))
        print('IDEA:',p['mainIdea'])
        print('SIMPLE:',p['simple'])
        print('HARD:',p.get('hardWords'))
