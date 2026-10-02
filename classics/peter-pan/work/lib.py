import re, json, glob, os
D=os.path.dirname(os.path.abspath(__file__))
def norm(s):
    s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('—','-').replace('–','-').replace('…','...')
    return re.sub(r'\s+',' ',s).lower()
def normp(s):  # punctuation ignored
    s=norm(s)
    return ' '.join(re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)*",s))
CH={}
for f in sorted(glob.glob(D+'/ch*.txt')):
    n=int(re.search(r'ch(\d+)',f).group(1))
    paras=[]
    for line in open(f,encoding='utf-8'):
        m=re.match(r'\[(\d+)\] (.*)',line.rstrip('\n'))
        if m: paras.append((int(m.group(1)),m.group(2)))
    CH[n]=paras
def words(s): return [w.lower() for w in re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?",s)]
def find_para(ch,ctx):
    c=normp(ctx); hits=[i for i,t in CH[ch] if c in normp(t)]
    assert len(hits)>=1,('ctx not found',ch,ctx)
    assert len(hits)==1,('ctx ambiguous',ch,ctx,hits)
    return hits[0]
def occ(ch,form,ctx):
    """occurrence number of `form` for the instance inside ctx (ctx must contain form once)"""
    c=norm(ctx); pi=find_para(ch,ctx)
    # exact (non punct-normalised) location needed
    cnt=0
    for i,t in CH[ch]:
        if i<pi: cnt+=words(t).count(form)
    t=CH[ch][[i for i,_ in CH[ch]].index(pi)][1]
    nt=norm(t); pos=nt.find(c)
    assert pos>=0,('ctx not literally found',ctx)
    assert nt.count(c)==1
    assert '…' not in t
    before=words(t[:pos]); inside=words(t[pos:pos+len(c)])
    assert inside.count(form)==1,('form count in ctx',form,ctx,inside.count(form))
    return cnt+before.count(form)+1

G={}; PARA=[]; SENT=[]; PHR={}
SUBS=[(r'\bjoy\b','happiness'),(r'\bcalm\b','peaceful'),(r'\bwicked\b','evil'),(r'\bfrightened\b','afraid'),(r'\bshocked\b','surprised'),(r'\bcheerful\b','happy'),(r'\busual\b','normal'),(r'\bcruel\b','unkind'),(r'\btightly\b','hard'),(r'\bsailors\b','men on ships')]
def sub(m):
    for a,b in SUBS: m=re.sub(a,b,m)
    return m
def W(key,pos,meaning,forms=None,why=None,coined=False):
    assert key not in G,('dup',key)
    meaning=sub(meaning)
    e={'pos':pos,'meaning':meaning}
    if why: e['whyHard']=why
    if forms: e['forms']=forms
    if coined: e['coined']=True
    G[key]=e
def WS(key,senses,forms=None,why=None):
    """senses: list of dict(pos,meaning,default,anchors=[(ch,form,ctx)],forms)"""
    assert key not in G,('dup',key)
    out=[]
    for s in senses:
        o={'pos':s['pos'],'meaning':sub(s['meaning'])}
        if s.get('default'): o['default']=True
        if s.get('forms'): o['forms']=s['forms']
        an=[]
        for ch,form,ctx in s.get('anchors',[]):
            an.append({'chapter':ch,'occurrence':occ(ch,form,ctx),'form':form,'context':ctx})
        if an: o['anchors']=an
        out.append(o)
    dflt=[s for s in out if s.get('default')][0]
    e={'pos':dflt['pos'],'meaning':dflt['meaning'],'senses':out}
    if why: e['whyHard']=why
    if forms: e['forms']=forms
    G[key]=e
def P(ch,ctx,main,simple,hard=None):
    d={'chapter':ch,'paragraph':find_para(ch,ctx),'context':ctx,'mainIdea':main,'simple':simple}
    if hard: d['hardWords']=hard
    PARA.append(d)
def S(ch,ctx,simple,grammar):
    find_para(ch,ctx)
    SENT.append({'chapter':ch,'context':ctx,'simple':simple,'grammar':grammar})
def Ph(key,meaning,pos,example=None,forms=None):
    assert key not in PHR,('dup phrase',key)
    d={'meaning':sub(meaning),'pos':pos}
    if forms: d['forms']=forms
    if example:
        d['example']=example
    PHR[key]=d
