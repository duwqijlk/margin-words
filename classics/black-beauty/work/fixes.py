import h
FIXCOUNT={'P':set(),'S':set(),'PH':set(),'W':set()}
def fp(ch,para,**kw):
    for x in h.P:
        if x['chapter']==ch and x['paragraph']==para:
            x.update(kw); FIXCOUNT['P'].add((ch,para)); return
    raise Exception('no P %s %s'%(ch,para))
def fs(ch,idx=0,**kw):
    k=[x for x in h.S if x['chapter']==ch]
    k[idx].update(kw); FIXCOUNT['S'].add((ch,idx))
def fph(key,**kw):
    h.PH[key].update(kw); FIXCOUNT['PH'].add(key)
def fw(key,**kw):
    h.W[key].update(kw); FIXCOUNT['W'].add(key)
def dph(key):
    del h.PH[key]; FIXCOUNT['PH'].add(key)
def dw(key):
    del h.W[key]; FIXCOUNT['W'].add(key)
