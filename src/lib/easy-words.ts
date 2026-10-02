const RAW = `
a an the of to and in on at for with from by as or if but so not no nor than then
i you he she it we they me him her us them my your his its our their mine yours ours theirs
this that these those what which who whom whose there here where when why how
be am is are was were been being do does did done have has had having
can could may might must will would shall should
about above across after again against ago all almost along already also always among around
another any anybody anyone anything both each either enough every everybody everyone everything few fewer
many more most much other others some somebody someone something such
up down out off over under into onto upon within without near next
before behind beside between during until while since
yes ok okay please thank thanks hello hi goodbye
one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen
twenty thirty forty fifty hundred thousand
first second third last next once twice
time day week month year today tomorrow yesterday morning afternoon evening night
now later soon early late always never often sometimes usually
people person man men woman women child children boy girl baby family friend
mother father parent brother sister son daughter uncle aunt
home house room door window floor wall school class teacher student
book page pen pencil paper desk chair bag
food water milk bread rice egg meat fish fruit apple orange vegetable
breakfast lunch dinner hungry thirsty
color red blue green yellow black white brown
big small large little long short tall high low wide
good bad better best nice great fine
happy sad angry afraid tired ill sick
hot cold warm cool dry wet
new old young fast slow quick
right left wrong true false
same different only own
come go get make take give see look watch hear listen say tell speak talk ask answer
know think want need like love help try use work play live stay leave
open close start stop begin end
walk run sit stand sleep wake eat drink cook wash wear
read write draw study learn teach
buy sell pay cost
go went gone see saw seen take took taken make made get got give gave
come came think thought know knew known find found tell told
say said speak spoke
feel felt keep kept leave left meet met
run ran sit sat stand stood
write wrote written eat ate eaten drink drank
child children man men woman women
city town village country world street road park shop store hospital hotel
car bus train plane bike boat ship
sun moon star sky rain snow wind cloud river sea lake mountain tree flower grass
animal dog cat bird horse
body head face eye ear nose mouth tooth teeth hair hand arm leg foot feet heart
clothes shirt coat shoe shoes hat
money job doctor nurse police farmer worker driver
music song game sport ball
happy smile laugh cry
because although however
important interesting beautiful careful useful different special
question answer problem idea story word sentence letter name number
morning afternoon evening today tomorrow yesterday
please thank welcome sorry excuse
school grade homework exam test lesson
friend classmate teacher parent
happy sad busy free ready
early late again still just already yet
very too also even
big small many much little few
good bad well
like love enjoy
want hope wish
need must
look see watch
listen hear
talk speak say tell
ask answer
help try
start finish
open close
turn move
put bring carry
wait remember forget
believe understand
easy hard difficult
new old
first last
right left
clean dirty
full empty
cheap expensive
safe dangerous
strong weak
bright dark
loud quiet
sweet
food drink
breakfast lunch supper dinner
rice noodle bread cake milk tea coffee juice water
apple banana orange
meat chicken fish egg
vegetable
house home room kitchen bathroom bedroom
table chair bed door window
bag box cup plate
phone computer tv radio
car bus taxi train plane
city country farm park zoo museum library
spring summer autumn winter fall weather sunny rainy windy cloudy
monday tuesday wednesday thursday friday saturday sunday
january february march april june july august september october november december
red orange yellow green blue purple pink black white brown gray grey
one two three four five six seven eight nine ten
eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty
thirty forty fifty sixty seventy eighty ninety hundred
i you he she it we they
am is are was were
do does did
have has had
can will may
my your his her our their
a an the
and or but
in on at to for of with from by
this that these those
what who where when why how
yes no not
up down
come go
get make
know think
see look
want like
good bad
big small
happy
time day year
people
school
book
friend
family
mother father
boy girl
man woman
mom dad mum kid
`.trim();

export const EASY = new Set(RAW.split(/\s+/).filter((word) => word.length > 0));
