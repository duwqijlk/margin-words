import re,glob,json
W='/workspace/classics/black-beauty/work'
def load():
    book={}
    for f in sorted(glob.glob(W+'/ch*.txt')):
        i=int(f[-7:-4]); ps={}
        for line in open(f,encoding='utf8').read().split('\n'):
            m=re.match(r'\[(\d+)\] (.*)',line)
            if m: ps[int(m.group(1))]=m.group(2)
        book[i]=ps
    return book
def norm(s):
    return re.sub(r'\s+',' ',s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('—','-').replace('–','-').lower()).strip()
def words(s): return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?",s)
def occ(book,ch,form,ctx):
    """occurrence number of form in chapter for the word inside ctx's paragraph (first match in that ctx)"""
    n=0
    for pi in sorted(book[ch]):
        p=book[ch][pi]
        if norm(ctx) in norm(p):
            # count occurrences before ctx start within paragraph
            pn=p.replace('’',"'")
            idx=pn.lower().find(ctx.replace('’',"'").lower())
            if idx<0: idx=norm(p).find(norm(ctx))
            pre=pn[:idx]
            n+=sum(1 for w in words(pre) if w.lower()==form)
            # then first occurrence inside ctx
            inside=[w.lower() for w in words(ctx.replace('’',"'"))]
            return n+1  # first match within ctx
        n+=sum(1 for w in words(p) if w.lower()==form)
    return None
