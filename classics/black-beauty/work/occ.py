import sys,re
sys.path.insert(0,'/workspace/classics/black-beauty/work')
from lib import *
b=load()
def occs(form):
    out=[]
    for ch in sorted(b):
        n=0
        for pi in sorted(b[ch]):
            t=b[ch][pi].replace('’',"'")
            for m in re.finditer(r"[A-Za-z]+(?:'[A-Za-z]+)?",t):
                if m.group(0).lower()==form:
                    n+=1; out.append((ch,pi,n,t[max(0,m.start()-40):m.end()+30]))
    return out
if __name__=='__main__':
    for o in occs(sys.argv[1]): print(o)
