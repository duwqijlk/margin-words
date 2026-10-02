import json,re,sys
g=json.load(open('../glossary.json'))
lo,hi=int(sys.argv[1]),int(sys.argv[2])
cache={}
def words(s): return re.findall(r"[A-Za-z0-9]+(?:['’][A-Za-z]+)?",s)
for k,s in enumerate(g['sentences']):
    if not lo<=k<hi: continue
    ch=s['chapter']
    if ch not in cache: cache[ch]=open('ch%03d.txt'%ch).read()
    ws=words(s['context'])
    pat=r"[^A-Za-z0-9]+".join(re.escape(w) for w in ws)
    pat=pat.replace("'","['’]")
    m=re.search(pat,cache[ch],re.I)
    t=cache[ch]
    st=m.start(); en=m.end()
    # sentence start: previous . ! ? followed by space/quote
    b=[x.end() for x in re.finditer(r'[.!?…][”"]? +(?=[“"A-Z‘])|\n\[\d+\] ',t[:st])]
    a=b[-1] if b else 0
    e=re.search(r'[.!?][”"]?(?= +[“"A-Z‘]|\n)',t[en:])
    z=en+e.end() if e else en+500
    print('=== #%d ch%d'%(k,ch))
    print('CTX:',s['context'])
    print('ORIG:',t[a:z].replace('\n',' '))
    print('SIMPLE:',s['simple'])
    print('GRAM:',s['grammar'])
