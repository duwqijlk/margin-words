import re, h
from lib import load
from f04_meanings import M
from f04_m2 import M2
M.update(M2)
_b=load()
WRE=r"[A-Za-z]+(?:'[A-Za-z]+)?"
def anchors(form, items):
    out=[]
    for ch,para,occ in items:
        n=0
        for pi in sorted(_b[ch]):
            if pi>=para: break
            n+=sum(1 for m in re.finditer(WRE,_b[ch][pi].replace('’',"'")) if m.group(0).lower()==form)
        k=occ-n
        t=_b[ch][para]
        ws=list(re.finditer(WRE,t.replace('’',"'")))
        idx=[i for i,m in enumerate(ws) if m.group(0).lower()==form][k-1]
        a=max(0,idx-4); z=min(len(ws),idx+5)
        out.append(dict(chapter=ch,occurrence=occ,form=form,context=t[ws[a].start():ws[z-1].end()]))
    return out
# plain meaning changes
for k,v in M.items():
    if k in h.W:
        if 'senses' in h.W[k]: continue
        h.W[k]['meaning']=v
    else:
        raise Exception('missing '+k)
h.W['slight']['pos']='adjective'
h.W['slave']['pos']='verb'
# bit
b=h.W['bit']
b['meaning']="A metal bar that goes in a horse's mouth, held by bands over its head, used to control it."
b['senses'][0]['meaning']=b['meaning']
b['senses'][3]['meaning']="In 'threepenny bit', a small piece of money."
# multi-sense words
def multi(key, pos, default_meaning, forms, senses):
    e={"pos":pos,"meaning":default_meaning}
    if forms: e["forms"]=forms
    e["senses"]=senses
    h.W[key]=e
multi('rank','noun',"A line of cabs waiting for passengers, one behind another.",['ranks'],[
 {"pos":"noun","meaning":"A line of cabs waiting for passengers, one behind another.","default":True,
  "anchors":anchors('rank',[(34,7,1),(36,28,1),(39,4,1),(40,3,1),(45,12,1),(45,20,2)])},
 {"pos":"noun","meaning":"A person's place or level in society.","anchors":anchors('rank',[(12,10,1)])},
 {"pos":"noun","meaning":"A row of soldiers or horses standing or riding side by side.","anchors":anchors('ranks',[(35,13,1),(35,14,2),(35,16,3)])},
])
multi('charge','noun',"A fast attack by soldiers who run or ride at the enemy.",['charges'],[
 {"pos":"noun","meaning":"A fast attack by soldiers who run or ride at the enemy.","default":True,
  "anchors":anchors('charge',[(12,14,1),(35,8,1),(35,13,2),(35,13,3),(35,15,4)])},
 {"pos":"noun","meaning":"The job of looking after someone or something. 'In charge' means looking after it.","anchors":anchors('charge',[(10,11,1),(15,10,1),(18,19,1),(25,2,1),(26,2,1),(49,24,1),(49,25,2)])},
 {"pos":"verb","meaning":"To ask a price for something. A 'charge' is the price that is asked.","anchors":anchors('charge',[(40,4,1),(40,5,2),(46,8,1)])},
])
multi('common','noun',"A big piece of open land that everyone can use.",None,[
 {"pos":"noun","meaning":"A big piece of open land that everyone can use.","default":True,
  "anchors":anchors('common',[(6,2,1),(6,3,2),(6,7,3),(25,17,1),(25,17,2),(25,18,3),(25,19,4)])},
 {"pos":"adjective","meaning":"Plain and ordinary; not special.","anchors":anchors('common',[(5,4,1),(30,22,1)])},
 {"pos":"adjective","meaning":"In 'common sense', ordinary good thinking that most people have.","anchors":anchors('common',[(9,16,1),(12,14,1),(36,39,1)])},
])
h.W['toll']={"pos":"verb","meaning":"To make slow, deep ringing sounds, for example when someone has died.","forms":["tolling","tolled"],
 "senses":[{"pos":"verb","meaning":"To make slow, deep ringing sounds, for example when someone has died.","default":True},
 {"pos":"noun","meaning":"In 'toll-bar', money that you pay to use a road or bridge.","anchors":anchors('toll',[(13,2,1)])}]}
t=h.W['tap']
t['meaning']="A place where beer is sold and drunk."
t['senses']=[{"pos":"noun","meaning":"A place where beer is sold and drunk.","default":True,"anchors":anchors('tap',[(17,22,1)])},
 {"pos":"noun","meaning":"A light knock.","anchors":anchors('tap',[(46,14,1)])}]
# --- fixes after check ---
def _sense(key,i,m): h.W[key]['senses'][i]['meaning']=m
_sense('common',1,"Of the usual kind; not special.")
_sense('tap',1,"A light hit on a door, to ask to come in.")
h.W['rank']['meaning']=h.W['rank']['senses'][0]['meaning']="A line of hired vehicles waiting for people who want a ride, one behind another."
_sense('rank',2,"A line of soldiers or horses side by side.")
h.W['shiver']['meaning']="To move your body in small quick moves because you are cold."
h.W['hooked']['meaning']="Bent and curved, like the beak of a bird."
h.W['niter']['meaning']="A white powder, once used as medicine to cool a sick horse."
_sense('bit',3,"In an old name for a small piece of money.")
PHM={
"break in":"To teach a young horse to carry a rider or pull a vehicle and to do what it is told.",
"get used to":"To start to feel something is normal.",
"pull up":"To stop a horse by pulling on the long bands.",
"put out":"To make someone angry or unhappy.",
"go to the bad":"To become bad and end badly.",
"depend upon":"To be sure about something; to trust it completely.",
"serve him right":"Used to say that someone has earned the bad thing that happens to them.",
"keep one's wits about one":"To stay ready and think quickly.",
"make way":"To move out of the way so that others can pass.",
"draw up":"To stop a horse or a vehicle. Vehicles that are drawn up stand in a line.",
"ride for one's life":"To ride as fast as you can because someone's life is in danger.",
"mind one's own business":"To not get into what other people are doing.",
"bearing rein":"A band that holds a horse's head up high and back.",
"all of a sudden":"Very quickly, when you do not expect it.",
"take pains":"To work hard and with great care.",
"for a wonder":"Which is a surprise.",
"hold one's tongue":"To say nothing.",
"come round":"To come again, as a season does.",
}
for k,v in PHM.items(): h.PH[k]['meaning']=v
_sense('common',1,"Found everywhere; not special.")
_sense('common',2,"In 'common sense', good thinking that most people have.")
h.W['rank']['meaning']=h.W['rank']['senses'][0]['meaning']="A line of vehicles waiting to take people for money, one behind another."
h.W['niter']['meaning']="A white medicine, once used to cool a sick horse."
h.PH['serve him right']['meaning']="Used to say that the bad thing that happens to someone is fair."
h.PH["ride for one's life"]['meaning']="To ride as fast as you can because someone may die."

h.W['skittish']['meaning']="Easily scared or excited; likely to jump and move around a lot."
h.W['breed']['meaning']="A kind of horse; horses of this kind have the same family and look alike."
h.W['veterinary']['meaning']="To do with the care of sick animals. A doctor for animals is a veterinary surgeon."
h.W['rye']['meaning']="A plant grown for its grain. Here it is a kind of grass that is food for horses."
h.W['pocket']['meaning']="To put money into your clothes and keep it."
h.W['hundredweight']['meaning']="A measure of weight; one of them is about 50 kilograms."
h.W['breed']['meaning']="A kind of horse; horses of this kind have the same family and are much the same."
h.W['veterinary']['meaning']="To do with the care of sick animals, as a doctor for animals does."
# --- words whose plain spelling is a common word: put the common meaning first, the book's special meaning on an anchor ---
def two(key,pos,dm,forms,extra):
    e={"pos":pos,"meaning":dm}
    if forms: e["forms"]=forms
    e["senses"]=[{"pos":pos,"meaning":dm,"default":True}]+extra
    h.W[key]=e
def sn(pos,m,form,items): return {"pos":pos,"meaning":m,"anchors":anchors(form,items)}
two('fine','adjective',"Very good; of high quality.",['fined'],[sn('verb',"To make someone pay money because he broke a rule.",'fined',[(45,4,1)])])
two('doctor','noun',"A person whose job is to help sick people get well.",['doctored'],[sn('verb',"To give medicine or care to a sick animal or person.",'doctored',[(41,5,1)])])
two('drove','verb',"Past of 'drive': made a horse or vehicle go along.",['droves'],[sn('noun',"A group of animals that are driven together.",'droves',[(33,3,1)])])
two('pity','noun',"A sad thing, or a feeling of being sorry for someone. 'What a pity' means 'how sad'.",['pitied'],[sn('verb',"To feel sorry for someone.",'pitied',[(27,14,1)])])
two('cutting','verb',"Using something sharp to take a piece off something.",['cuttings'],[
  sn('noun',"A piece cut from a plant, to grow a new plant.",'cuttings',[(20,12,1)]),
  sn('noun',"A long hole cut in the ground.",'cutting',[(25,21,1)])])
two('trying','verb',"Making an effort to do something.",None,[sn('adjective',"Hard to bear; causing trouble or worry.",'trying',[(34,13,1)])])
two('spent','verb',"Past of 'spend': used time or money.",None,[sn('adjective',"Very tired, with no strength left.",'spent',[(19,16,1)])])
two('quick','adjective',"Fast; taking a short time.",None,[sn('noun',"The soft part of a horse's foot under the hard outside, which feels pain easily.",'quick',[(26,9,1)])])
two('rough','adjective',"Not smooth or gentle; hard.",['roughed'],[sn('verb',"Of a horse's shoes: made with sharp parts, so that the horse can walk on ice without falling.",'roughed',[(39,3,1)])])
h.W['hire']={"pos":"verb","meaning":"To pay to use something for a short time. 'For hire' means that you can use it if you pay."}
h.W['pocket']={"pos":"noun","meaning":"A small part of clothes, shaped like a bag, where you keep small things."}
