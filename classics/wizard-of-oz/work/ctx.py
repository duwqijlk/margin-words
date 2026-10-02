import re,sys
sys.path.insert(0,'/workspace/classics/wizard-of-oz/work')
from lib import *
def locate(ch,form,occ):
    n=0
    for p in sorted(CH[ch]):
        t=CH[ch][p]
        for m in TOK.finditer(t):
            if m.group(0).lower()==form:
                n+=1
                if n==occ: return p,m.start(),m.end()
    raise Exception(('no occ',ch,form,occ))
def auto_ctx(ch,form,occ,before=4,after=4):
    p,s,e=locate(ch,form,occ)
    t=CH[ch][p]
    words=[(m.start(),m.end()) for m in re.finditer(r'\S+',t)]
    # find word index containing s
    wi=[i for i,(a,b) in enumerate(words) if a<=s<b][0]
    for extra in range(0,10):
        lo=max(0,wi-before-extra); hi=min(len(words),wi+after+extra+1)
        if hi-lo>=6: break
    lo=max(0,wi-before); hi=min(len(words),wi+after+1)
    while hi-lo<6:
        if lo>0: lo-=1
        if hi-lo<6 and hi<len(words): hi+=1
        if lo==0 and hi==len(words): break
    ctx=t[words[lo][0]:words[hi-1][1]]
    # strip leading/trailing quotes? keep exact.
    return ctx
if __name__=='__main__':
    print(auto_ctx(14,'dashed',1)); print(auto_ctx(3,'dashed',1))
