# helpers for pieces
W={}; P=[]; S=[]; PH={}; SENSES={}
def w(key,pos,meaning,forms=None,why=None):
    e={"pos":pos,"meaning":meaning}
    if forms: e["forms"]=forms
    if why: e["whyHard"]=why
    if key in W:
        import sys; print('dup word',key,file=sys.stderr); return
    W[key]=e
def p(ch,para,ctx,main,simple,hard): P.append(dict(chapter=ch,paragraph=para,context=ctx,mainIdea=main,simple=simple,hardWords=hard))
def s(ch,ctx,simple,grammar): S.append(dict(chapter=ch,context=ctx,simple=simple,grammar=grammar))
def ph(key,meaning,pos,example,forms=None):
    e={"meaning":meaning,"pos":pos}
    if forms: e["forms"]=forms
    if example: e["example"]=example
    if key in PH:
        import sys; print('dup phrase',key,file=sys.stderr); return
    PH[key]=e
