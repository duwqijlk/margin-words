import sys,json
sys.path.insert(0,'/workspace/classics/wizard-of-oz/src'); sys.path.insert(0,'/workspace/classics/wizard-of-oz/work')
from parse_words import load
from senses import S
from ctx import auto_ctx
def build():
    e,c,d=load()
    g={}
    for k,v in e.items():
        ent={'pos':v['pos'],'meaning':v['meaning']}
        fs=[f for f in v['forms'] if f!=k]
        if fs: ent['forms']=fs
        g[k]=ent
    for k,pos,forms,ss in S:
        senses=[]
        for (sp,m,df,sf,anc) in ss:
            se={'pos':sp,'meaning':m}
            if df: se['default']=True
            if sf: se['forms']=sf
            if anc:
                se['anchors']=[{'chapter':ch,'occurrence':o,'form':f,'context':auto_ctx(ch,f,o)} for ch,f,o in anc]
            senses.append(se)
        ent={'pos':pos,'meaning':ss[0][1],'senses':senses}
        if forms: ent['forms']=forms
        g[k]=ent
    return g
