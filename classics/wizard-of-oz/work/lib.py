import re,glob,json
TOK=re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
def norm(t):
    return t.replace('\u2019',"'").replace('\u2018',"'").replace('\u201c','"').replace('\u201d','"').replace('\u2014','-').replace('\u2013','-').replace('\u2026','...')
CH={}
for f in sorted(glob.glob('/workspace/classics/wizard-of-oz/work/ch0*.txt')):
    n=int(re.search(r'ch(\d+)',f).group(1))
    paras={}
    for line in open(f,encoding='utf8'):
        m=re.match(r'\[(\d+)\] (.*)',line.rstrip('\n'))
        if m: paras[int(m.group(1))]=m.group(2)
    CH[n]=paras
def toks(t): return [m.group(0).lower() for m in TOK.finditer(t.replace('\u2019','\u2019'))]
def loose(t):
    t=norm(t).lower()
    t=re.sub(r"(\w)'(?=\w)",lambda m:m.group(1)+"\ue000",t)
    t=re.sub(r"[^a-z0-9\ue000]+"," ",t)
    return t.replace('\ue000',"'").strip()
def find_para(ch,context):
    c=' '+loose(context)+' '
    hits=[p for p,t in CH[ch].items() if c in ' '+loose(t)+' ']
    return hits
def occ(ch,form,context):
    """occurrence number of form for the first match of form inside context"""
    form=form.lower()
    hits=find_para(ch,context)
    assert len(hits)==1,(ch,context,hits)
    p=hits[0]
    count=0
    for q in sorted(CH[ch]):
        if q<p: count+=toks(CH[ch][q]).count(form)
    # inside paragraph: find context position in normalized text (with punctuation preserved)
    t=norm(CH[ch][p]); c=norm(context)
    i=t.lower().find(c.lower())
    if i<0:
        # fallback: loose search over tokens
        ptoks=toks(t); ctoks=toks(context)
        for s in range(len(ptoks)-len(ctoks)+1):
            if ptoks[s:s+len(ctoks)]==ctoks:
                before=ptoks[:s].count(form); inside=ctoks.count(form)
                assert inside>=1,(form,context)
                return count+before+1
        raise Exception(('nomatch',ch,context))
    before=toks(t[:i]).count(form)
    inside=toks(c).count(form)
    assert inside>=1,('form not in context',form,context)
    return count+before+1
