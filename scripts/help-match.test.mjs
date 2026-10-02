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

  // Clothing: on a person or `his back`. Placement on `the` something stays out.
  assert.equal(keep("She put the baby on his back.", "on"), "put on");
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
  assert.equal(keep(figure, "figure", figure.indexOf("figure")), "figure out");
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

  // A tap that no phrase covers still falls back to another match of that word.
  const aside = "Ask her, then finish on her own.";
  assert.equal(choose(aside, "her", aside.indexOf("her"))?.key, "on her own");
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
