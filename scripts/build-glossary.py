#!/usr/bin/env python3
"""Build a word list (packs/<slug>/glossary.json) from hand-written source lines.

Source lines (glossary-src/<slug>/g*.txt):  lemma|pos|meaning|note
Candidates (lemma, forms, frequency, example sentences) come from
scripts/extract-hard-words.ts (it runs the app's own collectHardWords/indexBook).
usage: build-glossary.py <slug> <candidates.json> <out.json>
"""
import glob, json, re, sys, os

POS = {
    "n": "singular noun", "un": "uncountable noun", "v": "base verb", "adj": "adjective",
    "adv": "adverb", "pt": "past-tense verb", "pp": "past participle", "ing": "present participle",
    "int": "interjection", "conj": "conjunction", "pron": "pronoun", "prep": "preposition",
}
DEFAULT_WHY = "This word is harder than everyday English."
slug, cand_path, out_path = sys.argv[1:4]
cand = json.load(open(cand_path))
by = {w["lemma"]: w for w in cand["words"]}
entries = {}
for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "glossary-src", slug, "g*.txt"))):
    for line in open(f, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip():
            continue
        lemma, pos, meaning, note = line.split("|")
        assert lemma in by, f"{lemma} not in candidates"
        assert pos in POS, f"{lemma}: bad pos {pos}"
        assert not re.search(r"[\u3400-\u9fff]", line), f"{lemma}: CJK"
        w = by[lemma]
        forms = [x["form"] for x in w["forms"]]
        pat = re.compile(r"\b(" + "|".join(map(re.escape, forms)) + r")\b", re.I)
        ex = [s for s in w["sentences"] if pat.search(s)] or w["sentences"]
        entries[lemma] = {
            "pos": POS[pos],
            "meaning": meaning.strip()[:320],
            "whyHard": (note.strip() or DEFAULT_WHY)[:220],
            "example": ex[0] if ex else "",
            "examples": ex[:2],
            "forms": forms,
            "count": w["count"],
        }
# glossary-src/<slug>/coined.txt: one lemma per line = words the author invented ("coined": true)
coined_file = os.path.join(os.path.dirname(__file__), "..", "glossary-src", slug, "coined.txt")
if os.path.exists(coined_file):
    for line in open(coined_file, encoding="utf-8"):
        lemma = line.strip()
        if lemma and not lemma.startswith("#"):
            assert lemma in entries, f"coined.txt: {lemma} is not an entry"
            entries[lemma]["coined"] = True
ordered = dict(sorted(entries.items(), key=lambda kv: (-kv[1]["count"], kv[0])))
out = {
    "version": 1,
    "title": cand["title"], "author": cand["author"], "sha256": cand["sha256"],
    "level": "Middle-school level. Skips easy words. English-only meanings in simple English.",
    "count": len(ordered),
    "glossary": ordered,
}
json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(ordered), "entries ->", out_path)
