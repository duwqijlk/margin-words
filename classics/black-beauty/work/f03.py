import re, h
from lib import load
_b=load()
def _anchors(items):
    out=[]; 
    for ch,para,occ in items:
        t=_b[ch][para]
        ws=list(re.finditer(r"[A-Za-z]+(?:'[A-Za-z]+)?",t.replace('’',"\x27")))
        # find occurrence index within paragraph: count bit before in this paragraph
        # compute chapter occurrence offset
        n=0
        for pi in sorted(_b[ch]):
            if pi>=para: break
            n+=sum(1 for m in re.finditer(r"[A-Za-z]+(?:'[A-Za-z]+)?",_b[ch][pi].replace('’',"'")) if m.group(0).lower()=='bit')
        k=occ-n  # index among 'bit' in paragraph, 1-based
        bits=[i for i,m in enumerate(ws) if m.group(0).lower()=='bit']
        i=bits[k-1]
        a=max(0,i-4); z=min(len(ws),i+5)
        s=ws[a].start(); e=ws[z-1].end()
        ctx=t[s:e]  # original text slice (curly apostrophes preserved)
        out.append(dict(chapter=ch,occurrence=occ,form='bit',context=ctx))
    return out
MOUTH=[(4,5,1),(4,5,2),(4,5,3),(4,5,4),(4,8,5),(7,2,1),(8,7,2),(8,7,3),(11,2,1),(23,7,1),(23,8,2),(24,4,1),(24,13,2),(25,9,1),(30,7,1),(30,24,2),(32,2,1),(45,19,3)]
SMALL=[(7,2,2),(7,3,3),(8,5,1),(9,12,2),(20,5,1),(21,18,1),(27,8,1),(36,19,1),(38,15,1),(45,10,1),(45,17,2),(49,25,1)]
VERB=[(5,17,1),(5,18,2),(9,7,1)]
COIN=[(50,13,1)]
h.W['bit']={"pos":"noun","meaning":"A metal bar that goes in a horse's mouth, held by straps over its head, used to control it.","forms":["bits"],
 "senses":[
  {"pos":"noun","meaning":"A metal bar that goes in a horse's mouth, held by straps over its head, used to control it.","default":True,"anchors":_anchors(MOUTH)},
  {"pos":"noun","meaning":"A small amount or piece. 'A bit' means 'a little'.","anchors":_anchors(SMALL)},
  {"pos":"verb","meaning":"Past of 'bite': took something between the teeth.","anchors":_anchors(VERB)},
  {"pos":"noun","meaning":"In 'threepenny bit', a small coin.","anchors":_anchors(COIN)}]}
