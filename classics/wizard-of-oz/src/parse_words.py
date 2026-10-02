import re,collections
def load():
    ent=collections.OrderedDict(); chap={}; cur=None; dup=[]
    for fn in ['words1.txt','words2.txt','words3.txt','words4.txt','words5.txt']:
        try: lines=open(fn,encoding='utf8').read().splitlines()
        except FileNotFoundError: continue
        for l in lines:
            if not l.strip(): continue
            if l.startswith('#'): cur=int(l[1:]); continue
            p=l.split('|')
            key,pos,mean=p[0].strip(),p[1].strip(),p[2].strip()
            forms=[x for x in (p[3].split(',') if len(p)>3 and p[3] else [])]
            if key in ent: dup.append((key,cur)); continue
            ent[key]=dict(pos=pos,meaning=mean,forms=forms,ch=cur)
            chap.setdefault(cur,[]).append(key)
    return ent,chap,dup
if __name__=='__main__':
    e,c,d=load()
    print(len(e),'dups',d)
    for k in sorted(c): print(k,len(c[k]))
