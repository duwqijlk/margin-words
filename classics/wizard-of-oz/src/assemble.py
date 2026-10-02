import sys,json,re
sys.path.insert(0,'/workspace/classics/wizard-of-oz/src');sys.path.insert(0,'/workspace/classics/wizard-of-oz/work')
from build_words import build
from paras1 import P as p1
from paras2 import P as p2
from paras3 import P as p3
from paras4 import P as p4
from sents import S
from phrases import PH
from lib import find_para
g=build()
if 'munchkin' in g: g['munchkin']['coined']=True; g['munchkin']['whyHard']='This word is made up by the author.'
paras=sorted(p1+p2+p3+p4,key=lambda x:(x[0],x[1]))
forms=set(g)
for k,v in g.items():
    forms|=set(v.get('forms',[]))
    for s in v.get('senses',[]): forms|=set(s.get('forms',[]))
out_p=[]
for ch,p,c,mi,s,h in paras:
    hw=[w for w in h if w.lower() in forms or ' ' in w]
    out_p.append({'chapter':ch,'paragraph':p,'context':c,'mainIdea':mi,'simple':s,'hardWords':hw})
out_s=[{'chapter':ch,'context':c,'simple':s,'grammar':gr} for ch,c,s,gr in sorted(S,key=lambda x:x[0])]
ph={}
for k,(m,pos,f,ex) in PH.items():
    e={'meaning':m,'pos':pos}
    if f: e['forms']=f
    if ex: e['example']=ex
    ph[k]=e
doc={'version':2,'title':'The Wonderful Wizard of Oz','author':'L. Frank Baum','sha256':'be8f7802b737cf2f402960d4c691238ccd51b67de0cd69b909e35a2108da47a3','chapters':29,'level':'Middle-school level. Skips easy words. English-only meanings in simple English.','language':'English','glossary':g,'paragraphs':out_p,'sentences':out_s,'phrases':ph}
json.dump(doc,open('/workspace/classics/wizard-of-oz/glossary.json','w'),indent=1,ensure_ascii=False)
print(len(g),len(out_p),len(out_s),len(ph))
