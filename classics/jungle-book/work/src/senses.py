# multi-sense words: key -> dict(pos, why, senses=[ (meaning,pos,default,forms,[(chapter,form,ctx)]) ])
S = {}
H = "This word has more than one meaning."
S["hide"] = dict(pos="noun", forms=["hides"], senses=[
 ("The skin of an animal.", "noun", True, [], [(3,"hide","Shere Khan’s hide on my head"),(5,"hide","His hide will look well on the Council Rock")]),
 ("To go where no one can see you, or to put something where no one can find it.", "verb", False, ["hide"],
  [(3,"hide","where a hundred wolves could hide"),(3,"hides","Even the tiger hides when little Tabaqui goes mad"),(4,"hide","and hide you, O Poison People"),(5,"hide","Now we must hide this and take the buffaloes home")]),
])
S["spring"] = dict(pos="verb", senses=[
 ("To jump suddenly and fast.", "verb", True, [], [(3,"spring","he was going to spring downhill when a little shadow"),(4,"spring","ready to spring upon him from all sides")]),
 ("The time of year after winter, when plants begin to grow.", "noun", False, [],
  [(6,"spring","every spring would swim from whatever place he happened to be in"),(6,"spring","each spring, the whistling, bellowing, roaring, and blowing"),(6,"spring","finished his forty-fifth fight one spring when Matkah"),(6,"spring","next spring when they all met off the fishing-banks")]),
 ("A piece of metal that is turned round and round. It jumps back when you press it.", "noun", False, [], [(7,"spring","gathered herself together like a watch-spring")]),
])
S["bound"] = dict(pos="noun", senses=[
 ("A big jump.", "noun", True, [], [(3,"bound","He made his bound before he saw what it was"),(4,"bound","twenty feet at a bound"),(9,"bound","a kick and a bound and a snort")]),
 ("Going to a place. Here: on the way to it.", "adjective", False, [], [(6,"bound","all bound for the same place")]),
 ("Held in place with a rope or a band that goes round it.", "past-tense verb", False, [], [(8,"bound","bound round the ends, to prevent them splitting"),(6,"bound","each with an iron-bound club three or four feet long")]),
])
S["fair"] = dict(pos="adjective", senses=[
 ("Right and honest, and the same for everyone.", "adjective", True, [],
  [(3,"fair","change his quarters without fair warning"),(3,"fair","for my fair dues"),(3,"fair","won Mother Wolf in fair fight from five other wolves"),(7,"fair","he didn’t think at first that it was fair to kill them"),(8,"fair","shirking his fair share of the work"),(9,"fair","A tail at each end isn’t fair")]),
 ("Quite big; good in size.", "adjective", False, [], [(4,"fair","“I am a fair length —a fair length,” said Kaa"),(8,"fair","Kala Nag stood ten fair feet at the shoulders")]),
])
S["pace"] = dict(pos="noun", senses=[
 ("Speed; how fast something moves.", "noun", True, [], [(4,"pace","at the pace the monkeys were going"),(6,"pace","and the pace astonished him"),(7,"pace","Nagaina quickened her pace")]),
 ("One step.", "noun", False, ["paces"], [(4,"pace","Come all one pace nearer to me"),(3,"paces","Father Wolf ran out a few paces and heard Shere Khan")]),
])
S["tale"] = dict(pos="noun", senses=[
 ("A story.", "noun", True, [], [(5,"tale","he told a tale of magic and enchantment and sorcery"),(6,"tale","told me the tale when he was blown on to the rigging"),(8,"tale","he told his tale in short words"),(9,"tale","told me a long tale about hunting for me")]),
 ("The whole amount that someone has to pay. 'Full tale' means the full price.", "noun", False, [], [(3,"tale","I will pay Shere Khan full tale for this")]),
])
S["palm"] = dict(pos="noun", senses=[
 ("A tall tree that grows in hot countries. It has no branches and has big leaves at the top.", "noun", True, [], [(3,"palm","there are nuts on that palm"),(3,"palm","against a palm-tree to teach him better manners"),(4,"palm","pickers of palm-leaves have stolen away our man-cub")]),
 ("The flat inside part of the hand.", "noun", False, [], [(5,"palm","peered at Mowgli under the palm of her hand")]),
])
S["game"] = dict(pos="noun", senses=[
 ("Wild animals that people look for and kill for food.", "noun", True, [],
  [(3,"game","frighten every head of game within ten miles"),(3,"game","he has driven game for us"),(4,"game","Is there any news of game afoot"),(5,"game","for the game is scarce"),(5,"game","do not meddle with my game"),(5,"game","for there is big game afoot")]),
 ("Something that you play for fun.", "noun", False, ["games"], [(5,"games","would not play games or fly kites"),(6,"games","the games his companions played")]),
])
S["kite"] = dict(pos="noun", senses=[
 ("A big bird that eats dead animals. It has a wide wing on each side.", "noun", True, [], [(4,"kite","Rann, the Kite, balancing and wheeling")]),
 ("A light thing that children play with. It flies high in the wind and you hold a long string.", "noun", False, ["kites"], [(5,"kites","would not play games or fly kites")]),
])
S["pad"] = dict(pos="noun", senses=[
 ("A thick, soft piece of cloth or skin that protects the body.", "noun", True, ["pads"], [(8,"pad","with a big leather pad on his forehead"),(9,"pad","things on his saddle-pad")]),
 ("The soft part under the foot of an animal.", "noun", False, [], [(3,"pads","the long thorns out of the pads of his friends"),(5,"pads","the tracks of his pads are unequal")]),
])
S["quarters"] = dict(pos="plural noun", forms=["quarter"], senses=[
 ("The place where a person or animal lives for a time.", "plural noun", True, [], [(3,"quarters","to change his quarters without fair warning")]),
 ("The back part of an animal's body, where the back legs are.", "plural noun", False, [], [(3,"quarters","rose up on his hind quarters and grunted")]),
 ("One of four parts that are the same size. Three-quarters means three of the four parts.", "plural noun", False, [], [(9,"quarters","till it was three-quarters of a mile long")]),
])
S["drove"] = dict(pos="noun", senses=[
 ("A group of animals that people drive along together.", "noun", True, [], [(6,"drove","Head off that drove of four-year-olds"),(6,"drove","let the drove cool off for thirty minutes"),(6,"drove","polishing off a drove")]),
 ("Made animals go forward, or hit something in with force. It is the past tense of 'drive'.", "past-tense verb", False, [],
  [(5,"drove","Mowgli drove them on to the edge of the plain"),(5,"drove","as Akela drove the bulls far to the left"),(6,"drove","the men always drove seals in that way"),(8,"drove","and drove in the picket-pegs with big mallets")]),
])
