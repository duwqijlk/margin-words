from lib import *
W('exquisitely','adverb','In a very fine and beautiful way.')
W('gowned','past participle','Dressed in a gown. A gown is a long dress.',['gown'])
W('embonpoint','noun','A French word for a body that is a little fat.',why='This is a French word used in English.')
W('appalled','adjective','Shocked and upset.')
W('shudder','noun','A sudden shake of the body, from fear or disgust.')
W('courteously','adverb','In a polite and kind way.')
W('exceedingly','adverb','Very. Much more than usual.')
W('comparatively','adverb','Compared with others.')
W('hostess','noun','A woman who has guests in her home.')
W('contemptuously','adverb','In a way that shows you think something is worth nothing.')
W('overrated','adjective','Thought to be better than it really is.')
W('tragedy','noun','A very sad event.')
W('indignantly','adverb','In an angry way, because something seems unfair.')
W('draggled','adjective','Wet and dirty, as if it was pulled along the ground.')
W('patronisingly','adverb','In a way that treats someone as less clever than you.')
W('ignorant','adjective','Not knowing about something.',['ignorance'])
W('exulting','present participle','Feeling and showing great joy about winning or being right.',['exult'])
W('clenched','past-tense verb','Pressed tightly together.',['clench'])
W('glee','noun','Great joy.')
W('bliss','noun','Great happiness.')
W('crowed','past-tense verb','Cried out in a loud, happy and proud way.',['crow','crowing'])
W('rapturously','adverb','In a way that shows great joy.')
W('humiliating','adjective','Making you feel ashamed in front of other people.')
W('conceit','noun','Too much pride in yourself.')
W('hauteur','noun','A proud way of acting, as if you are better than others.')
W('withdraw','verb','To go away from a place or from a group.')
W('induce','verb','To make someone do something.')
W('aghast','adjective','Shocked and afraid.')
W('thimble','noun','A small cap that you wear on a finger to push a needle when you sew.',['thimbled'])
W('primness','noun','A very proper and serious way of behaving.')
W('customary','adjective','Usual. What people usually do.')
W('agitated','adjective','Upset and nervous.')
W('gurgles','plural noun','Soft sounds like water bubbling.',['gurgle'])
W('distorted','adjective','Twisted out of its usual shape.')
W('amiably','adverb','In a friendly way.')
W('insolently','adverb','In a rude way that shows no respect.')
W('apologetically','adverb','In a way that shows you are sorry.')
W('plied','past-tense verb','Kept giving someone a lot of something. Here, many questions.',['ply'])
W('defray','verb','To pay for something.')
W('flattered','past-tense verb','Made someone feel pleased by praising them.',['flatter'])
W('placidly','adverb','In a calm and quiet way.')
W('relenting','present participle','Becoming less angry and less strict.',['relent'])
W('eaves','plural noun','The edges of a roof that stick out over the walls.',['eave'])
W('misgiving','noun','A feeling of worry about something.')
W('tempted','past-tense verb','Made someone want to do something, often something not wise.',['tempt'])
W('cunning','adjective','Clever in a tricky way.')
W('wriggling','present participle','Twisting and turning the body.',['wriggle'])
W('darn','verb','To mend a hole in clothes by sewing.')
W('inmates','plural noun','People who live together in a room or house.',['inmate'])
W('artfully','adverb','In a clever and tricky way.')
W('dense','adjective','Slow to understand things.')
W('ceased','past-tense verb','Stopped.',['cease'])
W('strained','past-tense verb','Pulled very hard.',['strain'])
W('topping','adjective','An old British slang word that means very good.',why='This is old British slang.')
W('nippy','adjective','Quick and light in movement.')
W('trifling','present participle','Playing with someone and not being serious.',[])
W('superb','adjective','Excellent. Very, very good.')
W('gallant','adjective','Brave and bold.')
W('ripping','adjective','Old British slang for very good.',why='This is old British slang.')
W('elegant','adjective','Graceful and fine.')
W('desist','verb','To stop doing something.')
W('imperiously','adverb','In a proud way, like someone who gives orders.')
W('soared','past-tense verb','Flew high and fast.',['soar'])
W('mantelpiece','noun','The shelf above a fireplace.')
W('ablaze','adjective','Full of bright light, like a fire.')
W('attire','noun','Clothes.',why='This is an old word.')
W('erect','adjective','Straight and standing up.')
WS('cave',[
 dict(pos='noun',meaning='A large hole in the side of a hill or under the ground.',default=True,anchors=[(5,'cave','Look, Michael, there’s your cave'),(6,'cave','would disclose the mouth of a cave')]),
 dict(pos='interjection',meaning='In this line, a Latin word that means "take care".',anchors=[(4,'cave','Cave, Peter')]),
])
Ph('tuck in','To put the bedclothes close round someone in bed.','phrasal verb','you could tuck us in at night',['tucked in'])
Ph('give someone a hiding','To hit someone hard as a punishment.','idiom','he sometimes had to give them a hiding',['give them a hiding'])
Ph('at a venture','By guessing, without knowing for sure.','idiom','he said at a venture')
Ph('in custody','Held by someone so that you cannot get away.','idiom','but in custody of course')
Ph('get in one\'s way','To be in the place where someone wants to go. To make things hard for someone.','idiom','getting in his way and so on',['getting in his way'])
Ph('come off','To become separated from something.','phrasal verb','It has come off?')
Ph('stick on','To join something to a place with something sticky.','phrasal verb','He tried to stick it on with soap')
Ph('run away','To leave a place secretly or quickly.','phrasal verb','Wendy, I ran away the day I was born',['ran away'])
Ph('fall out','To drop out of something.','phrasal verb','who fall out of their perambulators')
Ph('let go','To stop holding something.','phrasal verb','and let go.')
Ph('shut up','To close someone in a place. It can also mean "stop talking", which is rude.','phrasal verb','he had shut Tinker Bell up in the drawer',['shut her up'])
Ph('on the whole','Most of the time. When everything is thought about.','idiom','he liked them on the whole')
Ph('come to rest','To stop moving.','idiom','when it came to rest for a second',['came to rest'])

P(4,"He tried to stick it on with soap from the bathroom",
 "Peter cannot join his shadow back on to himself. He is shocked, sits on the floor and cries.",
 "If Peter thought at all (but I do not think he ever thought), he thought that his shadow and he would join like drops of water when they were brought near each other. When they did not join, he was shocked. He tried to stick the shadow on with soap from the bathroom, but that did not work either. A sudden shake went through Peter, and he sat on the floor and cried.",
 ['appalled','shudder'])
P(4,"talking about what I was to be when I became a man",
 "Peter tells Wendy why he ran away. He does not want to be a man. He wants to be a little boy and have fun always.",
 "Peter explained in a low voice that it was because he heard his father and mother talking about what he would be when he became a man. He was now very upset. \"I never want to be a man,\" he said strongly. \"I always want to be a little boy and have fun. So I ran away to Kensington Gardens and lived a very long time with the fairies.\"",
 ['agitated','extraordinarily'])
P(4,"when the first baby laughed for the first time, its laugh broke into a thousand pieces",
 "Peter tells Wendy how fairies began. They began with a baby's first laugh.",
 "You see, Wendy, when the first baby laughed for the first time, its laugh broke into a thousand pieces. All the pieces went skipping about. That was the beginning of fairies.",
 ['skipping'])
S(4,"had it not been that the little stars were watching them",
 "They would have reached the nursery in time if the little stars had not been watching them.",
 "'Had it not been that...' means 'If it had not been that...'. The word order is turned round to talk about something that did not happen.")
S(4,"such a home life that to know fairies struck her as quite delightful",
 "Wendy had lived such a home life that knowing fairies seemed very lovely to her.",
 "'such a ... that ...' shows a result; 'to know fairies' is the subject of the verb 'struck'.")
S(4,"no one can fly unless the fairy dust has been blown on him",
 "No one can fly unless someone has blown the fairy dust on him.",
 "'unless' means 'if not'; 'has been blown' is the present perfect passive, so the person who blows the dust is not named.")
S(4,"if she would only stand still and let me see her",
 "I wish she would just stand still and let me see her!",
 "'If ... would only' is a strong wish; 'let me see her' is 'let + object + base verb'.")
S(4,"talking about what I was to be when I became a man",
 "He heard them talking about what he would be when he became a man.",
 "'what I was to be' means 'what I would be'; 'was to + verb' talks about the future from a time in the past.")
S(4,"when what you want to be asked is Kings of England",
 "It was like an exam paper that asks about grammar when you want it to ask about the Kings of England.",
 "'what you want to be asked' is a clause that works as the subject of 'is'; 'to be asked' is passive.")
