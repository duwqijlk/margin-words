import sys,glob
n=0
def fix(old,new):
    global n
    hits=[f for f in glob.glob('c*.txt') if old in open(f).read()]
    if len(hits)!=1: print("FAIL",len(hits),old[:60]); return
    s=open(hits[0]).read(); assert s.count(old)==1,("multi",old[:50]); open(hits[0],'w').write(s.replace(old,new)); n+=1; print("ok",old[:40])
