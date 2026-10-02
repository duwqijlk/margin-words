import json,glob
files={f:json.load(open(f)) for f in glob.glob('parts/c*.json')}
def para(ch,p):
    for f,d in files.items():
        for x in d.get('paragraphs',[]):
            if x['chapter']==ch and x['paragraph']==p: return x
    raise Exception((ch,p))
def setp(ch,p,**kw): para(ch,p).update(kw)
n=0
setp(10,8,mainIdea="Tom's marble charm does not work. He decides that a witch broke it, and he goes to call into a small hole in the sand.");n+=1
setp(12,25,mainIdea="Tom likes the idea of a written oath. He writes it with red chalk on a pine shingle.");n+=1
p=para(18,52); p['simple']=p['simple'].replace(" Joe said weakly that he had lost his knife and should go and find it."," Then Joe spoke, in a weak voice.");
p['mainIdea']="The boys feel very sick from smoking, but they try not to show it. Then Joe speaks weakly.";n+=1
p=para(28,81); p['simple']=p['simple'].replace('Injun Joe says yes, bury it again. Then he cries out "No!"','Injun Joe says yes, bury it again. The boys above are filled with joy. Then he cries out "No!" and the boys above are filled with deep distress.').replace("He had nearly forgotten that the pick had fresh earth on it.","He had nearly forgotten that the pick had fresh earth on it. At once the boys are sick with fear.");n+=1
p=para(32,44); p['simple']=p['simple'].replace(' He said it weakly, without knowing if it was wise: "Sunday-school books, maybe."',' He said it weakly, at a risk, without knowing if it was wise.')
p['mainIdea']="Huck is in a tight spot, and the old man is looking at him. He has no good answer, so he says the first silly thing that comes to his mind.";n+=1
p=para(33,3); p['simple']="Becky answered Tom's call. They made a smoke mark to guide them back, and started to look around. They went this way and that, far down into the secret deep parts of the cave, made another mark, and went off a new way to find new things to tell people above about. "+p['simple']
p['simple']=p['simple'].replace("In a big cave, hundreds of long shining stones hung from the ceiling","In one place they found a big cave. Many long shining stones hung from the ceiling").replace("The children walked all around it","The children walked all around it").replace("by hundreds, squeaking","by hundreds, squeaking")
n+=1
p=para(34,5); p['simple']="Aunt Polly was completely happy, and Mrs. Thatcher almost so. Mrs. Thatcher would be completely happy as soon as the messenger who was sent to the cave told her husband the good news. "+p['simple'];n+=1
p=para(35,4); p['simple']=p['simple'].replace("It gave a dessertspoonful in twenty-four hours.","It gave about a spoonful in twenty-four hours. That drop was already falling when the Pyramids were new, when Troy fell, when Rome was begun, when Christ was killed on the cross, when William the Conqueror made the British empire, when Columbus sailed, and when the killing at Lexington was news.");n+=1
p=para(37,10); p['simple']=p['simple'].replace("Huck says it makes no difference what everybody does. He is not everybody","Huck says it makes no difference to him what everybody thinks. He is not everybody");n+=1
# sentence note
for f,d in files.items():
    for s in d.get('sentences',[]):
        if s['chapter']==14 and 'metaphorically' in s['context']:
            s['grammar']="'Metaphorically speaking' tells us the words are a picture and not true. Aunt Polly is compared to Death on a horse, because she brings her medicines everywhere.";n+=1
dropS=["Can’t learn an old dog","druther","might a been good","they had a mind not to","Did this attorney","you can’t hang a “clue”","conceived a great opinion","for form’s sake","No mere ferule"]
dropP=[(3,7),(6,44),(25,74),(33,57),(20,87)]
cs=cp=0
for f,d in files.items():
    ns=[s for s in d.get('sentences',[]) if not any(k in s['context'] for k in dropS)]
    cs+=len(d.get('sentences',[]))-len(ns); d['sentences']=ns
    np_=[x for x in d.get('paragraphs',[]) if (x['chapter'],x['paragraph']) not in dropP]
    cp+=len(d.get('paragraphs',[]))-len(np_); d['paragraphs']=np_
print(cs,cp,n)
for f,d in files.items(): json.dump(d,open(f,'w'),indent=0,ensure_ascii=False)
