import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { help } = await loadAppModules();
const { containsContext, looseText, mergeExtras, pickParagraphHelp, pickPhrase, pickSentenceHelp, tokenize, verbForms } = help;

const para = (chapter, paragraph, context) => ({
  chapter,
  paragraph,
  context,
  mainIdea: "x",
  simple: "y",
});

test("looseText ignores quotes, dashes, case and punctuation", () => {
  assert.equal(looseText("\u201cDon\u2019t  go,\u201d he said \u2014 quickly."), "don't go he said quickly");
  assert.equal(containsContext("He said, \u2018Hello there, my friend.\u2019", "hello there my friend"), true);
  assert.equal(containsContext("He said hello", ""), false);
});

test("context must match whole words", () => {
  assert.equal(containsContext("the cathedral was big", "the cat"), false);
});

test("paragraph help: exact index and context", () => {
  const list = [para(1, 4, "the old man walked slowly home")];
  const text = "Then the old man walked slowly home, tired.";
  assert.equal(pickParagraphHelp(list, 1, 4, text)?.paragraph, 4);
});

test("paragraph help: same index but other text is NOT shown", () => {
  const list = [para(1, 4, "the old man walked slowly home")];
  assert.equal(pickParagraphHelp(list, 1, 4, "A completely different paragraph about cats."), null);
});

test("paragraph help: falls back to context when the index has moved", () => {
  const list = [para(1, 4, "the old man walked slowly home"), para(1, 9, "she opened the red door at last")];
  const text = "Then the old man walked slowly home.";
  assert.equal(pickParagraphHelp(list, 1, 7, text)?.paragraph, 4);
  assert.equal(pickParagraphHelp(list, 5, 0, text)?.paragraph, 4); // another chapter number: context still works
});

test("paragraph help: curly quotes in the book, plain quotes in the list", () => {
  const list = [para(0, 0, "\"I don't know,\" said Tom")];
  assert.ok(pickParagraphHelp(list, 0, 0, "\u201cI don\u2019t know,\u201d said Tom, and looked away."));
});

test("sentence help: matches by context inside the sentence, same chapter first", () => {
  const list = [
    { chapter: 2, context: "if only he had known", simple: "a", grammar: "g" },
    { chapter: 3, context: "if only he had known", simple: "b", grammar: "g" },
  ];
  assert.equal(pickSentenceHelp(list, 3, "Oh, if only he had known the truth!")?.simple, "b");
  assert.equal(pickSentenceHelp(list, 9, "if only he had known")?.simple, "a");
  assert.equal(pickSentenceHelp(list, 3, "if only she had known"), null);
});

test("verbForms", () => {
  assert.ok(verbForms("give").includes("gave") && verbForms("give").includes("giving") && verbForms("give").includes("gives"));
  assert.ok(verbForms("look").includes("looked") && verbForms("look").includes("looking"));
  assert.ok(verbForms("stop").includes("stopped") && verbForms("stop").includes("stopping"));
  assert.ok(verbForms("carry").includes("carried") && verbForms("carry").includes("carries"));
  assert.ok(verbForms("make").includes("making") && verbForms("make").includes("made"));
  assert.ok(verbForms("go").includes("went") && verbForms("go").includes("goes"));
  assert.ok(verbForms("pass").includes("passes"));
});

const phrases = {
  "give up": { meaning: "Stop trying.", pos: "phrasal verb" },
  "look after": { meaning: "Take care of.", pos: "phrasal verb", forms: ["looked after", "looking after"] },
  "pick up": { meaning: "Lift.", pos: "phrasal verb" },
  "break the ice": { meaning: "Start a talk.", pos: "idiom" },
  "in front of": { meaning: "Before.", pos: "phrase" },
  "take care of": { meaning: "Look after.", pos: "phrase" },
  "make up one's mind": { meaning: "Decide.", pos: "idiom" },
};
const hit = (sentence, word) => pickPhrase(phrases, sentence, word);

test("phrase: simple inflections", () => {
  assert.equal(hit("He gave up at last.", "gave")?.key, "give up");
  assert.equal(hit("He gave up at last.", "up")?.key, "give up");
  assert.equal(hit("She is giving up now.", "giving")?.key, "give up");
  assert.equal(hit("She gives up easily.", "gives")?.key, "give up");
});

test("phrase: listed forms", () => {
  assert.equal(hit("They looked after the baby.", "after")?.key, "look after");
  assert.equal(hit("They are looking after us.", "looking")?.key, "look after");
});

test("phrase: separable with a gap of up to 3 words", () => {
  const r = hit("She picked the big box up quickly.", "picked");
  assert.equal(r?.key, "pick up");
  assert.equal(r?.matched, "picked the big box up");
  assert.equal(hit("He picked it up.", "up")?.key, "pick up");
  // a gap of 4 words is too far
  assert.equal(hit("She picked the very big red box up.", "picked"), null);
});

test("phrase: a noun phrase before a clause-final particle, not a preposition", () => {
  const pv = (meaning) => ({ meaning, pos: "phrasal verb" });
  const phrases = {
    "put on": pv("Dress in."),
    "pull on": pv("Dress in."),
    "take out": pv("Remove."),
    "put down": pv("Set down."),
    "leave behind": pv("Go on without."),
    "figure out": pv("Solve."),
    "calm down": pv("Become quiet."),
    "pick up": pv("Lift."),
    "turn into": pv("Change into."),
    "dry off": pv("Make dry."),
    "look up": pv("Search for."),
    "hold out": pv("Stretch out."),
    "pull out": pv("Remove."),
    "knock over": pv("Tip."),
    "turn around": pv("Face the other way."),
    "take off": pv("Remove."),
    "let out": pv("Release."),
    "make up": pv("Invent."),
    "show up": pv("Arrive."),
    "go on": pv("Continue."),
    "try on": pv("Test clothes."),
    "come back": pv("Return."),
    "take in": pv("Bring inside."),
    "get at": pv("Reach."),
    "look out": pv("Be careful."),
    "give up": pv("Stop."),
    "make for": pv("Go towards."),
    "come to": pv("Reach."),
    "look after": pv("Care for."),
    "stand for": pv("Mean."),
    "make up for": { meaning: "Compensate.", pos: "phrasal verb", forms: ["make up for"] },
    "find out": pv("Discover."),
    "turn out": pv("Result."),
    "make out": pv("See."),
    "take to": pv("Start to like."),
    "ask for": pv("Request."),
    "get on": pv("Board."),
  };
  const keep = (sentence, word) => pickPhrase(phrases, sentence, word)?.key ?? null;
  assert.equal(keep("They put their new boots on.", "put"), "put on");
  assert.equal(keep("She put a costume on.", "on"), "put on");
  assert.equal(keep("Jack put his pack on.", "pack") , null);
  assert.equal(keep("Jack put his pack on.", "on"), "put on");
  assert.equal(keep("They put the parkas on.", "parkas"), null);
  assert.equal(keep("They put the parkas on.", "put"), "put on");
  assert.equal(keep("He pulled the pants on.", "pulled"), "pull on");
  assert.equal(keep("She put the backpack on.", "on"), "put on");
  assert.equal(keep("They took the masks out.", "out"), "take out");
  assert.equal(keep("She put the basket down.", "down"), "put down");
  assert.equal(keep("She was leaving Winter behind.", "behind"), "leave behind");
  assert.equal(keep("They leave all these dangers behind.", "leave"), "leave behind");
  assert.equal(keep("Leave this dream behind.", "dream"), null);
  assert.equal(keep("Leave this dream behind.", "behind"), "leave behind");
  assert.equal(keep("We can figure things out.", "out"), "figure out");
  assert.equal(keep("Figure that out.", "that"), null);
  assert.equal(keep("Figure that out.", "out"), "figure out");
  assert.equal(keep("Calm things down.", "down"), "calm down");
  assert.equal(keep("She picked each one up.", "up"), "pick up");
  assert.equal(keep("The witch turned the frog into a prince.", "into"), "turn into");
  assert.equal(keep("The sun dries me off.", "off"), "dry off");
  assert.equal(keep("Don't leave us behind.", "us"), null);
  assert.equal(keep("Don't leave us behind.", "behind"), "leave behind");
  assert.equal(keep("She picked it up.", "it"), null);
  assert.equal(keep("She picked it up.", "up"), "pick up");
  assert.equal(keep("Look something up.", "up"), "look up");
  assert.equal(keep("He held his hand out.", "out"), "hold out");
  assert.equal(keep("She pulled the snorkel out.", "out"), "pull out");
  assert.equal(keep("The ball knocked him over.", "over"), "knock over");
  assert.equal(keep("He turned his pony around.", "around"), "turn around");
  assert.equal(keep("Put it on the table.", "on"), null);
  assert.equal(keep("He came right back.", "back"), "come back");

  // Clothing on a person stays. Placement on `his back` / `the` something stays out.
  assert.equal(keep("She put the baby on his back.", "on"), null);
  assert.equal(keep("He put his hand on the lid.", "on"), null);
  assert.equal(keep("They took up in a shack.", "in"), null);
  assert.equal(keep("Make her show up.", "up"), "show up");
  assert.equal(keep("Make her show up.", "make"), null);
  assert.equal(keep("He took turns jumping off.", "off"), null);
  assert.equal(keep("Let them find out.", "out"), "find out");
  assert.equal(keep("Let them find out.", "let"), null);
  assert.equal(keep("Go try it on.", "on"), "try on");
  assert.equal(keep("Go try it on.", "go"), null);
  assert.equal(keep("He stood still for a moment.", "for"), null);
  assert.equal(keep("She made a dash for the trees.", "for"), null);
  assert.equal(keep("They make a cake for her.", "for"), null);
  assert.equal(keep("We can make up for the loss.", "for"), "make up for");
  assert.equal(keep("He came up to the house.", "to"), null);
  assert.equal(keep("He came rushing up to her.", "to"), null);
  assert.equal(keep("He came the back way.", "back"), null);
  assert.equal(keep("They take part in the game.", "in"), null);
  assert.equal(keep("Get off at the station.", "at"), null);
  assert.equal(keep("He looked very put out.", "out"), null);
  assert.equal(keep("She gave a thumbs-up.", "up"), null);
  assert.equal(keep("Figure a way out of the room.", "out"), null);
  assert.equal(keep("He makes his way up the hill.", "up"), null);
  assert.equal(keep("The funny-looking birds walked out.", "out"), null);
  assert.equal(keep("He caught her off-balance.", "off"), null);
  assert.equal(keep("They found him stretched out.", "out"), null);
  assert.equal(keep("The coat was turned inside out.", "out"), null);
  assert.equal(keep("She can make a flower grow out.", "out"), null);
  assert.equal(keep("Take me to the house.", "to"), null);
  assert.equal(keep("Ask him for help.", "for"), "ask for");
  assert.equal(keep("He takes a vindictive pleasure in seeing it.", "in"), null);
  assert.equal(keep("It gets easier further on.", "on"), null);
});

test("phrase: a listed form with its own gap is matched as written", () => {
  const phrases = {
    "pay attention": { meaning: "Notice.", pos: "phrase", forms: ["paid no attention"] },
    "make sense": { meaning: "Be understandable.", pos: "phrase", forms: ["make any sense"] },
    "set free": { meaning: "Let go.", pos: "phrasal verb", forms: ["set them free"] },
    "leave alone": { meaning: "Not trouble.", pos: "phrasal verb", forms: ["leave them alone"] },
    "put on": {
      meaning: "Dress in.",
      pos: "phrasal verb",
      forms: ["put their brand new boots on"],
    },
  };
  assert.equal(pickPhrase(phrases, "He paid no attention.", "attention")?.key, "pay attention");
  assert.equal(pickPhrase(phrases, "It does not make any sense.", "sense")?.key, "make sense");
  assert.equal(pickPhrase(phrases, "The queen set them free.", "free")?.key, "set free");
  assert.equal(pickPhrase(phrases, "Please leave them alone.", "alone")?.key, "leave alone");
  // Four words between the verb and the particle: only the listed form, not the open gap rule.
  assert.equal(
    pickPhrase(phrases, "They put their brand new boots on.", "on")?.key,
    "put on",
  );
  assert.equal(pickPhrase(phrases, "They put their other old boots on.", "on"), null);
});

test("phrase: a hyphen splits like a tap button", () => {
  assert.deepEqual(
    tokenize("funny-looking off-balance face-to-face thumbs-up").map((token) => token.w),
    ["funny", "looking", "off", "balance", "face", "to", "face", "thumbs", "up"],
  );
  const phrases = {
    "uh oh": { meaning: "Oh no.", pos: "phrase" },
    "say good-bye": { meaning: "Farewell.", pos: "phrase" },
    "freeze to death": { meaning: "Freeze.", pos: "phrase" },
    "cro magnon": { meaning: "Early human.", pos: "phrase", forms: ["cro magnons"] },
    "thumbs up": { meaning: "Yes.", pos: "phrase" },
    "give up": { meaning: "Stop.", pos: "phrasal verb" },
    "rear-view mirror": { meaning: "Mirror.", pos: "phrase" },
    "an off-balance step": { meaning: "A stumble.", pos: "phrase" },
    "take off": { meaning: "Remove.", pos: "phrasal verb" },
    "figure out": { meaning: "Solve.", pos: "phrasal verb" },
    "good-bye for now": { meaning: "Farewell.", pos: "phrase" },
    "first person shooter": {
      meaning: "A game.",
      pos: "phrase",
      forms: ["first-person action shooter"],
    },
  };
  const keep = (sentence, word) => pickPhrase(phrases, sentence, word)?.key ?? null;
  assert.equal(keep("Uh-oh, he said.", "oh"), "uh oh");
  assert.equal(keep("Let’s say good-bye.", "good"), "say good-bye");
  assert.equal(keep("Let’s say good-bye.", "bye"), "say good-bye");
  assert.equal(keep("Or fr-freeze to death", "freeze"), "freeze to death");
  assert.equal(keep("They met Cro-Magnons.", "magnons"), "cro magnon");
  assert.equal(keep("I look in the rear-view mirror.", "view"), "rear-view mirror");
  assert.equal(keep("Good-bye for now!", "bye"), "good-bye for now");
  assert.equal(keep("the hottest first-person action shooter", "person"), "first person shooter");
  assert.equal(keep("She gave a thumbs-up sign.", "up"), "thumbs up");
  assert.equal(keep("We were figuring-things-out.", "out"), "figure out");
  assert.equal(keep("He takes an off-balance step.", "off"), "an off-balance step");
  assert.equal(keep("He takes an off-balance step.", "step"), "an off-balance step");
});

test("phrase: scored fixture gaps", () => {
  const pv = (meaning) => ({ meaning, pos: "phrasal verb" });
  const phrases = {
    "put on": pv("Dress."),
    "take out": pv("Remove."),
    "take off": pv("Remove."),
    "figure out": pv("Solve."),
    "come out": pv("Appear."),
    "come in": pv("Enter."),
    "come back": pv("Return."),
    "come across": pv("Find."),
    "come on": pv("Hurry."),
    "pick up": pv("Lift."),
    "wake up": pv("Rouse."),
    "turn over": pv("Flip."),
    "set off": pv("Trigger."),
    "go on": pv("Continue."),
    "keep from": pv("Stop."),
    "make for": pv("Go toward."),
    "look for": pv("Search."),
    "look around": pv("Survey."),
    "wait for": pv("Stay."),
    "get into": pv("Enter."),
    "look into": pv("Examine."),
    "turn into": pv("Become."),
    "leave behind": pv("Leave."),
    "take up": pv("Lift."),
    "make out": pv("See."),
    "bring up": pv("Raise."),
    "meet up": pv("Gather."),
    "watch out": pv("Beware."),
    "take in": pv("Include."),
    "put out": pv("Extinguish."),
    "hold out": pv("Extend."),
    "pull out": pv("Remove."),
    "hold up": pv("Raise."),
    "let out": pv("Release."),
    "burst into": pv("Start."),
    "get back": pv("Return."),
    "put away": pv("Store."),
    "go down": pv("Descend."),
    "make up": pv("Invent."),
    "for a moment": { meaning: "Briefly.", pos: "phrase" },
  };
  const keep = (sentence, word, at) => pickPhrase(phrases, sentence, word, at)?.key ?? null;

  assert.equal(keep("She put a costume on him.", "on"), "put on");
  assert.equal(keep("He put his pack on his back.", "on"), "put on");
  assert.equal(keep("He put his pack on the ground.", "on"), null);
  assert.equal(keep("putting harnesses on all the dogs", "on"), "put on");
  assert.equal(keep("He put his glasses back on.", "on"), "put on");
  assert.equal(keep("when she puts it back on.", "on"), "put on");
  assert.equal(keep("He put his on.", "on"), "put on");
  assert.equal(keep("put the mitten back on", "on"), "put on");
  assert.equal(keep("He took the masks out first and handed them to Annie.", "out"), "take out");
  assert.equal(keep("the blue boa came slithering out of the kettle", "out"), "come out");
  assert.equal(keep("came running out", "out"), "come out");
  assert.equal(keep("came running across the road", "across"), "come across");
  assert.equal(keep("Your uncle will pick you up.", "up"), "pick up");
  assert.equal(keep("You've woken me up all for nothing.", "up"), "wake up");
  assert.equal(keep("turned the mirror over and over", "over"), "turn over");
  assert.equal(keep("set the whole place off", "off"), "set off");
  assert.equal(keep("go back on his word", "on"), null);
  assert.equal(keep("came rushing in", "in"), "come in");
  assert.equal(keep("keep the team from running too fast", "from"), "keep from");
  assert.equal(keep("made straight for the door", "for"), "make for");
  assert.equal(keep("waited patiently for the bell", "for"), "wait for");
  assert.equal(keep("We can figure his out.", "out"), "figure out");
  assert.equal(keep("get back into the car", "into"), "get into");
  assert.equal(keep("looked all around", "around"), "look around");
  assert.equal(keep("looked down into the well", "into"), "look into");
  assert.equal(keep("turned the howling wind into a roar", "into"), "turn into");
  assert.equal(keep("leaving long snaking trails behind them", "behind"), "leave behind");
  assert.equal(keep("went quietly down the stairs", "down"), "go down");
  assert.equal(keep("came back on", "on"), "come on");
  assert.equal(keep("pulled the snorkel out of his mouth", "out"), "pull out");
  assert.equal(keep("Let me out of here!", "out"), "let out");
  assert.equal(keep("held his hand out to Jack", "out"), "hold out");
  assert.equal(keep("held the painting up to Billy", "up"), "hold up");
  assert.equal(keep("They tried to get all of me back", "back"), "get back");
  assert.equal(keep("Figure that out.", "out"), "figure out");
  assert.equal(keep("Put that away.", "away"), "put away");
  assert.equal(keep("take the yoke off the oxen", "off"), "take off");
  assert.equal(keep("He is making it up this whole time.", "up"), "make up");

  assert.equal(keep("Put it on the table.", "on"), null);
  assert.equal(keep("put them on a rickety table", "on"), null);
  assert.equal(keep("put them all on Billy's plate", "on"), null);
  assert.equal(keep("Put it on her face", "on"), null);
  assert.equal(keep("putting it on a boat", "on"), null);
  assert.equal(keep("take it on thy breath", "on"), null);
  assert.equal(keep("took a bite out of it", "out"), null);
  assert.equal(keep("made a monster out of a dead man", "out"), null);
  assert.equal(keep("bring his uncle up to date", "up"), null);
  assert.equal(keep("When the meeting broke up, small groups began", "up"), null);
  assert.equal(keep("like watching the sun come out", "watching"), null);
  assert.equal(keep("taking place in Darkly Wynd", "in"), null);
  assert.equal(keep("turned through an arch into a corridor", "into"), null);
  assert.equal(keep("get a sizeable chunk into the pouch", "into"), null);
  assert.equal(keep("a little burst of flames into the sky", "into"), null);
  assert.equal(keep("a burst of flame into the sky", "into"), null);
  assert.equal(keep("held the book out of reach", "out"), null);
  assert.equal(keep("took the cape up to his room", "up"), null);
  assert.equal(keep("found himself out of breath", "out"), null);
  assert.equal(keep("put it out of Charlie's mind", "out"), null);
  assert.equal(keep("turned their faces up to the sun", "up"), null);
  assert.equal(keep("joined everyone in the kitchen", "in"), null);
  assert.equal(keep("took them up so many staircases", "up"), null);
  assert.equal(keep("looked furtively up and down the street", "up"), null);
  assert.equal(keep("He stood still for a long moment.", "stood"), null);

  const around = "Lysander stood looking around for another companion for a moment.";
  assert.equal(keep(around, "for", around.indexOf("for")), "look for");
  assert.equal(keep(around, "for", around.lastIndexOf("for")), "for a moment");

  const figure = "so I figure we'll figure it out together.";
  assert.equal(keep(figure, "figure", figure.lastIndexOf("figure")), "figure out");
  // The first `figure` is not a token of `figure it out`.
  assert.equal(keep(figure, "figure", figure.indexOf("figure")), null);
});

test("phrase: gap follow-ups from the scored books", () => {
  const pv = (meaning) => ({ meaning, pos: "phrasal verb" });
  const phrases = {
    "put on": pv("Wear."),
    "go on": pv("Continue."),
    "pick up": pv("Lift."),
    "take off": pv("Remove."),
    "get over": pv("Recover."),
    "make for": pv("Head toward."),
    "get out": pv("Leave."),
    "hang on": pv("Wait."),
    "hold on": pv("Grip."),
    "come on": pv("Hurry."),
    "carry on": pv("Continue."),
    "hang around": pv("Stay."),
    "look on": pv("Watch."),
    "take up": pv("Start."),
    "stand up": pv("Rise."),
    "be off": pv("Leave."),
    "hold up": pv("Delay."),
    "take over": pv("Control."),
    "come across": pv("Find."),
    "come out": pv("Appear."),
    "look around": pv("Survey."),
    "figure out": pv("Solve."),
    "on her own": { meaning: "Alone.", pos: "phrase" },
  };
  const at = (sentence, word, nth = 0) => {
    let from = 0;
    for (let i = 0; i <= nth; i += 1) {
      const found = sentence.indexOf(word, from);
      if (found < 0) return -1;
      if (i === nth) return found;
      from = found + word.length;
    }
    return -1;
  };
  const show = (sentence, word, nth = 0) => pickPhrase(phrases, sentence, word, at(sentence, word, nth))?.key ?? null;

  // Correct matches main blocked.
  assert.equal(show("Mr Wonka said, ‘Put these on quick!’", "on"), "put on");
  assert.equal(show("It went right on growing until it was about as big as a horse.", "on"), "go on");
  assert.equal(show("He reached out a hand to pick some of them up before it was too late.", "up"), "pick up");
  assert.equal(show("And don’t put it on till I shout.", "on"), "put on");
  assert.equal(show("They began walking about and picking things up to look at.", "up"), "pick up");
  assert.equal(show("Take this wretched skin off me at once.", "off"), "take off");
  assert.equal(show("The stars came out and time went slowly on—imagine how slowly—while the king stood there.", "on"), "go on");

  // Debatable. Pronoun or filler plus `on` plus a noun stays placement.
  // `get` plus a pronoun plus `out of` is the phrasal verb.
  assert.equal(show("We’re getting you out of there.", "out"), "get out");
  assert.equal(show("Put it on her face, the enchanter commanded.", "on"), null);
  assert.equal(show("“Put them on my heels, of course,” said Shasta.", "on"), null);
  assert.equal(show("He had promised to go straight on his message for Aslan.", "on"), null);

  // Wrong new matches from `all` / `that` / a time period.
  assert.equal(show("He suddenly got warm all over right down to his toes.", "over"), null);
  assert.equal(show("I can tell the others and get it all over.", "over"), null);
  assert.equal(show("Do you remember the Dwarf making that for me?", "for"), null);
  assert.equal(show("Bradley had taken a half-day off.", "off"), null);

  // Wrong matches that main still showed.
  assert.equal(show("He hung the bag on his shoulder and followed Annie.", "on"), null);
  assert.equal(show("Jack held their bag on his lap.", "on"), null);
  assert.equal(show("Holding the raft on his back, the giant shark kept swimming.", "on"), null);
  assert.equal(show("He put his hands on his knees.", "on"), null);
  assert.equal(show("Tolemeo put a hand on his shoulder.", "on"), null);
  assert.equal(show("Mrs. Weedon put her hands on her wide hips.", "on"), null);
  assert.equal(show("Her sisters came close on her heels.", "on"), null);
  assert.equal(show("Annie helped him put the pack on his chest instead of on his back.", "on"), null);
  assert.equal(show("He put magic juice on her eyelids.", "on"), null);
  assert.equal(show("He put the baby on his back.", "on"), null);
  assert.equal(show("They passed women carrying pots on their shoulders.", "on"), null);
  assert.equal(show("He never took his eyes off Charlie.", "off"), null);
  assert.equal(show("She never took her eyes off him.", "off"), null);
  assert.equal(show("Jack quickly took his hand off the wall.", "off"), null);
  assert.equal(show("The girls stood making up their minds.", "up"), null);
  assert.equal(show("The ladder was sliding off the van.", "off"), null);
  assert.equal(show("Olivia came bouncing across the snowy ground.", "across"), null);
  assert.equal(show("I was going to come check on you today.", "on"), null);
  assert.equal(show("Bright pictures hung all around the room.", "around"), null);
  assert.equal(show("They hung all around him.", "around"), null);
  assert.equal(show("He saw a slice of stale-looking bread on his plate.", "on"), null);
  assert.equal(show("Then took a boat up the river.", "up"), null);
  assert.equal(show("She was afraid the vest would be torn off Olivia.", "off"), null);
  assert.equal(show("Quint says, holding his hands up all defensively.", "up"), null);
  assert.equal(show("He’d take a howling snowstorm over this dripping rain.", "over"), null);

  // The same shapes that are real phrases stay.
  assert.equal(show("He put his pack on his back.", "on"), "put on");
  assert.equal(show("She put a costume on him.", "on"), "put on");
  assert.equal(show("They finished putting harnesses on all the dogs.", "on"), "put on");
  assert.equal(show("He put his pack on the ground.", "on"), null);
  assert.equal(show("Charlie burst out and came running across the road.", "across"), "come across");
  assert.equal(show("The boa came slithering out of the kettle.", "out"), "come out");
  assert.equal(show("He looked all around him.", "around"), "look around");
  const aside = "Ask her, then finish on her own.";
  assert.equal(show(aside, "her", 0), null);
  assert.equal(show(aside, "own"), "on her own");
  assert.equal(show(aside, "her", 1), "on her own");
});

test("phrase: motion -ing, all over, and up a bit", () => {
  const pv = (meaning) => ({ meaning, pos: "phrasal verb" });
  const phrases = {
    "shake up": pv("Rouse."),
    "come back": pv("Return."),
    "go off": pv("Burst."),
    "go through": pv("Endure."),
    "talk over": pv("Discuss."),
    "get over": pv("Recover."),
    "put over": pv("Convey."),
    "climb over": pv("Cross."),
    "take up": pv("Start."),
    "come across": pv("Find."),
    "stand up": pv("Rise."),
    "be off": pv("Leave."),
    "put on": pv("Wear."),
  };
  const show = (sentence, word) => pickPhrase(phrases, sentence, word, sentence.indexOf(word))?.key ?? null;

  assert.equal(show("But he did want to shake the old woman up a bit.", "up"), "shake up");
  assert.equal(show("He did want to shake the old woman up.", "up"), "shake up");
  assert.equal(show("Then took a boat up the river.", "up"), null);

  assert.equal(show("The lead dragon come winging back over the wall.", "back"), "come back");
  assert.equal(show("She came hurtling back out of the tunnel.", "back"), "come back");
  assert.equal(show("She came winging back to see him.", "back"), "come back");
  assert.equal(show("The wolf came bounding back and said come in.", "back"), "come back");
  assert.equal(show("The children came trooping back.", "back"), "come back");
  assert.equal(show("The boat came rowing back.", "back"), "come back");
  assert.equal(show("Watch the ticks and fleas go jumping off her.", "off"), null);
  assert.equal(show("The prodigy went flitting through her head.", "through"), null);
  assert.equal(show("Olivia came bouncing across the snowy ground.", "across"), null);
  assert.equal(show("The girls stood making up their minds.", "up"), null);
  assert.equal(show("The ladder was sliding off the van.", "off"), null);

  assert.equal(show("They talked all these adventures over.", "over"), "talk over");
  assert.equal(show("They talked it all over.", "over"), "talk over");
  assert.equal(show("He suddenly got warm all over right down to his toes.", "over"), null);
  assert.equal(show("I can tell the others and get it all over.", "over"), null);
  assert.equal(show("He was climbing all over it.", "over"), null);
  assert.equal(show("You've put it all over your head.", "over"), null);

  assert.equal(show("He put his pack on his back.", "on"), "put on");
  assert.equal(show("Annie helped him put the pack on his chest.", "on"), null);
});

test("phrase: a tap outside the span stays a plain word", () => {
  const phrase = (meaning) => ({ meaning, pos: "phrase" });
  const phrases = {
    "shake your head": { ...phrase("No."), forms: ["shook her head", "shook his head"] },
    "i mean": phrase("That is."),
    "i guess": phrase("I suppose."),
    "in your head": { ...phrase("Imagined."), forms: ["in her head"] },
    "on your own": { ...phrase("Alone."), forms: ["on his own"] },
    "roll one's eyes": phrase("Annoyance."),
    "as fast as they could": phrase("Quickly."),
    "pick up": { meaning: "Lift.", pos: "phrasal verb" },
  };
  const at = (sentence, word, nth = 0) => {
    let from = 0;
    for (let i = 0; i <= nth; i += 1) {
      const found = sentence.indexOf(word, from);
      if (found < 0) return -1;
      if (i === nth) return found;
      from = found + word.length;
    }
    return -1;
  };
  const show = (sentence, word, nth = 0) =>
    pickPhrase(phrases, sentence, word, at(sentence, word, nth))?.key ?? null;

  // wof06: the later "her"s are not part of "shook her head".
  const mud = "The MudWing shook her head quickly and buried her nose in her scroll.";
  assert.equal(show(mud, "shook"), "shake your head");
  assert.equal(show(mud, "her", 0), "shake your head");
  assert.equal(show(mud, "head"), "shake your head");
  assert.equal(show(mud, "her", 1), null);
  assert.equal(show(mud, "her", 2), null);

  // wof06: each "I" opens only the phrase it sits in.
  const guess = "I didn't realize — I mean, I guess I knew.";
  assert.equal(show(guess, "I", 0), null);
  assert.equal(show(guess, "I", 1), "i mean");
  assert.equal(show(guess, "mean"), "i mean");
  assert.equal(show(guess, "I", 2), "i guess");
  assert.equal(show(guess, "guess"), "i guess");
  assert.equal(show(guess, "I", 3), null);

  const head = "All of her mother's nightmare scenarios started playing again in her head.";
  assert.equal(show(head, "her", 0), null);
  assert.equal(show(head, "her", 1), "in your head");
  assert.equal(show(head, "head"), "in your head");

  const own = "He can do his job properly on his own.";
  assert.equal(show(own, "his", 0), null);
  assert.equal(show(own, "his", 1), "on your own");
  assert.equal(show(own, "own"), "on your own");

  const eyes = "She rolled her eyes and hurried after her sister.";
  assert.equal(show(eyes, "rolled"), "roll one's eyes");
  assert.equal(show(eyes, "her", 0), "roll one's eyes");
  assert.equal(show(eyes, "eyes"), "roll one's eyes");
  assert.equal(show(eyes, "her", 1), null);

  const ran = "They ran as fast as they could.";
  assert.equal(show(ran, "They"), null);
  assert.equal(show(ran, "they"), "as fast as they could");

  // A separable gap: every token from the verb through the particle opens the card.
  // A word before or after that span stays a plain tap.
  const box = "She picked the box up.";
  assert.equal(show(box, "She"), null);
  assert.equal(show(box, "picked"), "pick up");
  assert.equal(show(box, "box"), "pick up");
  assert.equal(show(box, "the"), "pick up");
  assert.equal(show(box, "up"), "pick up");

  const held = "Charlie held it out to her.";
  const heldPhrases = {
    ...phrases,
    "held out": { meaning: "Offered.", pos: "phrasal verb" },
  };
  const showHeld = (word, nth = 0) =>
    pickPhrase(heldPhrases, held, word, at(held, word, nth))?.key ?? null;
  assert.equal(showHeld("held"), "held out");
  assert.equal(showHeld("it"), "held out");
  assert.equal(showHeld("out"), "held out");
  assert.equal(showHeld("her"), null);

  const mirror = "Dagbert turned the mirror over and over.";
  const mirrorPhrases = {
    "turn over": { meaning: "Flip.", pos: "phrasal verb" },
  };
  const showMirror = (word, nth = 0) =>
    pickPhrase(mirrorPhrases, mirror, word, at(mirror, word, nth))?.key ?? null;
  assert.equal(showMirror("turned"), "turn over");
  assert.equal(showMirror("the"), "turn over");
  assert.equal(showMirror("mirror"), "turn over");
  assert.equal(showMirror("over", 0), "turn over");
  assert.equal(showMirror("over", 1), null);
  assert.equal(showMirror("and"), null);

  const them = "He picked them up and carried them.";
  assert.equal(show(them, "them", 0), "pick up");
  assert.equal(show(them, "them", 1), null);

  const brows = "Benjamin raised his eyebrows and looked at his dog.";
  const eyePhrases = {
    "raise his eyebrows": {
      meaning: "Surprise.",
      pos: "phrase",
      forms: ["raised his eyebrows"],
    },
  };
  const showBrows = (word, nth = 0) =>
    pickPhrase(eyePhrases, brows, word, at(brows, word, nth))?.key ?? null;
  assert.equal(showBrows("his", 0), "raise his eyebrows");
  assert.equal(showBrows("his", 1), null);
  assert.equal(showBrows("eyebrows"), "raise his eyebrows");
});

test("phrase: a comma written in the entry", () => {
  const show = (phrases, sentence, word) => pickPhrase(phrases, sentence, word)?.key ?? null;
  const comma = { "oh, brother": { meaning: "Wow.", pos: "phrase" } };
  const plain = { "oh brother": { meaning: "A brother.", pos: "phrase" } };
  const form = { "oh boy": { meaning: "Wow.", pos: "phrase", forms: ["oh, boy"] } };
  const gap = { "come, back": { meaning: "Return.", pos: "phrasal verb" } };

  assert.equal(show(comma, "Oh, brother", "brother"), "oh, brother");
  assert.equal(show(comma, "Oh,  brother!", "oh"), "oh, brother");
  assert.equal(show(comma, "Oh brother", "brother"), "oh, brother");
  assert.equal(show(comma, "Oh. brother", "brother"), null);
  assert.equal(show(plain, "Oh brother", "brother"), "oh brother");
  assert.equal(show(plain, "Oh, brother", "brother"), null);
  assert.equal(show(form, "Oh, boy", "boy"), "oh boy");
  assert.equal(show(form, "Oh boy", "boy"), "oh boy");
  assert.equal(show(gap, "Come, back.", "back"), "come, back");
  assert.equal(show(gap, "Come back.", "back"), "come, back");
  assert.equal(show(gap, "Come right back.", "back"), null);
});

test("phrase: no false positives", () => {
  assert.equal(hit("He looked up at the sky.", "up"), null); // "look up" is not listed
  assert.equal(hit("She picked a flower. Then she ran up the hill.", "up"), null); // sentence break
  assert.equal(hit("She picked flowers, and he sat up.", "up"), null); // comma / clause break
  assert.equal(hit("They gave a present to the man who held it up.", "up"), null);
  assert.equal(hit("The cup gave nothing.", "gave"), null);
});

test("phrase: the tapped word must be part of the phrase, not a word in the gap", () => {
  assert.equal(hit("She picked the box up.", "box"), null);
  assert.equal(hit("She picked the box up.", "the"), null);
});

test("phrase: idioms and fixed phrases", () => {
  assert.equal(hit("He told a joke to break the ice.", "ice")?.key, "break the ice");
  assert.equal(hit("It broke the ice at once.", "broke")?.key, "break the ice");
  assert.equal(hit("She stood in front of the door.", "front")?.key, "in front of");
  assert.equal(hit("He took care of the dog.", "care")?.key, "take care of");
  assert.equal(hit("She is taking care of him.", "taking")?.key, "take care of");
  assert.equal(hit("In the front room of the house.", "front"), null);
});

test("phrase: one's", () => {
  assert.equal(hit("He made up his mind.", "mind")?.key, "make up one's mind");
  assert.equal(hit("They make up their minds", "minds"), null);
  assert.equal(hit("He made up the story.", "made"), null);
});

test("phrase: curly apostrophe words are handled", () => {
  assert.equal(hit("\u201cI won\u2019t give up,\u201d she said.", "give")?.key, "give up");
  assert.equal(hit("I couldn\u2018t give up.", "give")?.key, "give up");
  assert.equal(hit("I couldn\u02bct give up.", "give")?.key, "give up");
  assert.deepEqual(
    tokenize("couldn\u2019t we\u2019re Charlie\u2019s couldn\u2018t couldn\u02bct").map((token) => token.w),
    ["couldn't", "we're", "charlie's", "couldn't", "couldn't"],
  );
});

test("phrase: the match that covers the tapped word wins over another match of that word", () => {
  const both = {
    "after all": { meaning: "When you think again.", pos: "phrase" },
    "at all": { meaning: "In any way.", pos: "phrase" },
    "in your head": { meaning: "Only imagined.", pos: "phrase", forms: ["in her head"] },
    "on her own": { meaning: "With no help.", pos: "phrase" },
  };
  const choose = (sentence, word, at) => pickPhrase(both, sentence, word, at);

  const quiet = "It was not at all quiet after all.";
  const allInAt = quiet.indexOf("all");
  const allInAfter = quiet.lastIndexOf("all");
  // Same length, so with no position the first listed phrase wins.
  assert.equal(pickPhrase(both, quiet, "all")?.key, "after all");
  assert.equal(choose(quiet, "all", allInAt)?.key, "at all");
  assert.equal(choose(quiet, "at", quiet.indexOf("at all"))?.key, "at all");
  assert.equal(choose(quiet, "all", allInAfter)?.key, "after all");
  assert.equal(choose(quiet, "after", quiet.indexOf("after"))?.key, "after all");

  const plan = "She kept the plan in her head and finished on her own.";
  const herInHead = plan.indexOf("her");
  const herOnOwn = plan.lastIndexOf("her");
  assert.equal(pickPhrase(both, plan, "her")?.key, "in your head");
  assert.equal(choose(plan, "her", herInHead)?.key, "in your head");
  assert.equal(choose(plan, "head", plan.indexOf("head"))?.key, "in your head");
  assert.equal(choose(plan, "in", plan.indexOf("in her"))?.key, "in your head");
  assert.equal(choose(plan, "her", herOnOwn)?.key, "on her own");
  assert.equal(choose(plan, "own", plan.indexOf("own"))?.key, "on her own");
  assert.equal(choose(plan, "on", plan.indexOf("on her"))?.key, "on her own");

  // A tap outside the span does not open another copy of the same word.
  const aside = "Ask her, then finish on her own.";
  assert.equal(choose(aside, "her", aside.indexOf("her")), null);
  assert.equal(choose(aside, "her", aside.lastIndexOf("her"))?.key, "on her own");

  // Two phrases covering the same token: the longer one wins.
  const longer = {
    "give up": { meaning: "Stop.", pos: "phrasal verb" },
    "give up the ghost": { meaning: "Die.", pos: "idiom" },
  };
  const dying = "He will give up the ghost at dawn.";
  assert.equal(pickPhrase(longer, dying, "give", dying.indexOf("give"))?.key, "give up the ghost");
  assert.equal(pickPhrase(longer, dying, "up", dying.indexOf("up"))?.key, "give up the ghost");
  assert.equal(pickPhrase(longer, dying, "ghost", dying.indexOf("ghost"))?.key, "give up the ghost");
});

test("mergeExtras: replace and add", () => {
  const a = { paragraphs: [para(0, 0, "aaa bbb ccc ddd")], sentences: [], phrases: { "give up": { meaning: "old" } } };
  const b = {
    paragraphs: [{ ...para(0, 0, "new new new new"), simple: "NEW" }],
    sentences: [],
    phrases: { "give up": { meaning: "new" } },
  };
  assert.equal(mergeExtras(a, b, "replace").paragraphs[0]?.simple, "NEW");
  assert.equal(mergeExtras(a, b, "replace").phrases["give up"]?.meaning, "new");
  assert.equal(mergeExtras(a, b, "add").paragraphs[0]?.simple, "y");
  assert.equal(mergeExtras(a, b, "add").phrases["give up"]?.meaning, "old");
  assert.equal(mergeExtras(null, b, "add"), b);
});
