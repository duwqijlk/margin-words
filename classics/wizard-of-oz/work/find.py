import sys
from lib import *
for w in sys.argv[1:]:
    print('==',w)
    n=0
    for ch in sorted(CH):
        for p in sorted(CH[ch]):
            ts=toks(CH[ch][p])
            for i,t in enumerate(ts):
                if t==w:
                    n+=1
                    cnt=sum(toks(CH[ch][q]).count(w) for q in CH[ch] if q<p)+ts[:i].count(w)+1
                    print(f'  ch{ch} p{p} occ{cnt}: ...'+' '.join(ts[max(0,i-6):i+6]))
