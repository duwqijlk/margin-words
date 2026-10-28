#!/usr/bin/env python3
"""
Fill American readings from CMUdict into the committed IPA snapshot (src/data/ipa/).

CMUdict (Carnegie Mellon University Pronouncing Dictionary, BSD-2-Clause) is the usual open
source for General American pronunciations. It writes ARPAbet with stress digits; this script
turns that into the snapshot's own US style (Oxford-like: ɑː, ɔː, ɜːr, ər, e, oʊ, stress mark
before the syllable, none on one-syllable words) and only ever adds:

  * a US reading for a snapshot word that has none, and
  * a new word (US only, UK left empty) when CMUdict has it and it is either common
    (--keep-list, one word per line) or used by a catalog glossary (--glossaries).

It never replaces a reading the snapshot already has, never adds a word that differs from a
snapshot word only by case (that would shadow `French` with `french`), and takes CMUdict's first
pronunciation only. UK readings never come from CMUdict.

Run from the repository root with absolute paths, Python in isolated mode:

  python -I scripts/ipa-cmudict.py --cmudict /abs/cmudict.dict --keep-list /abs/en_50k.txt \\
      --glossaries /abs/dir-of-glossaries [--check]

`--check` rebuilds in memory and compares with the committed files (exit 1 on a difference).
`--compare` prints how often the conversion agrees with the snapshot's own US readings.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IPA_DIR = os.path.join(ROOT, "src", "data", "ipa")
BASE_VERSION = "local-ipa-primary-v2-3cdd54963a163a84fb2ff1b1"
POLICY = "cmudict-us-supplement-v1"

WORD = re.compile(r"^[a-z]+(?:[-'][a-z]+)*$")

# ARPAbet vowels: (stressed, unstressed). Stressed means stress 1 or 2.
VOWELS = {
    "AA": ("ɑː", "ɑː"),
    "AE": ("æ", "æ"),
    "AH": ("ʌ", "ə"),
    "AO": ("ɔː", "ɔː"),
    "AW": ("aʊ", "aʊ"),
    "AY": ("aɪ", "aɪ"),
    "EH": ("e", "e"),
    "ER": ("ɜːr", "ər"),
    "EY": ("eɪ", "eɪ"),
    "IH": ("ɪ", "ɪ"),
    "IY": ("iː", "i"),
    "OW": ("oʊ", "oʊ"),
    "OY": ("ɔɪ", "ɔɪ"),
    "UH": ("ʊ", "ʊ"),
    "UW": ("uː", "u"),
}
CONSONANTS = {
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "dʒ",
    "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "r", "S": "s",
    "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}
# A final unstressed "-ən" / "-əl" after these is written (ə)n / (ə)l, as in the snapshot.
SYLLABIC_AFTER = {"P", "B", "T", "D", "K", "G", "F", "V", "TH", "S", "Z", "SH", "ZH", "CH", "JH"}
# Consonant groups that may start an English syllable (maximal onset).
ONSETS = {
    ("p", "l"), ("p", "r"), ("b", "l"), ("b", "r"), ("t", "r"), ("d", "r"), ("k", "l"),
    ("k", "r"), ("ɡ", "l"), ("ɡ", "r"), ("f", "l"), ("f", "r"), ("θ", "r"), ("ʃ", "r"),
    ("s", "p"), ("s", "t"), ("s", "k"), ("s", "m"), ("s", "n"), ("s", "l"), ("s", "w"),
    ("t", "w"), ("d", "w"), ("k", "w"), ("ɡ", "w"), ("θ", "w"), ("s", "f"),
    ("p", "j"), ("b", "j"), ("f", "j"), ("v", "j"), ("m", "j"), ("k", "j"), ("h", "j"),
    ("ɡ", "j"), ("s", "p", "l"), ("s", "p", "r"), ("s", "t", "r"), ("s", "k", "r"),
    ("s", "k", "w"), ("s", "p", "j"), ("s", "k", "j"),
}


def legal_onset(group: list[str]) -> bool:
    if not group:
        return True
    if len(group) == 1:
        return group[0] != "ŋ"
    return tuple(group) in ONSETS


def normalize_phones(phones: list[str]) -> list[str]:
    """CMUdict habits the snapshot does not share, rewritten before conversion."""
    out = list(phones)
    vowel = lambda p: p[:-1] in VOWELS if p[-1:].isdigit() else False
    # Unstressed ER before a vowel is a schwa and an r that starts the next syllable
    # (around: ER0 AW1 -> AH0 R AW1, so the stress mark goes before the r).
    i = 0
    while i < len(out):
        if out[i] == "ER0" and i + 1 < len(out) and vowel(out[i + 1]):
            out[i : i + 1] = ["AH0", "R"]
        i += 1
    primary = next((k for k, p in enumerate(out) if p.endswith("1")), None)
    if primary is not None:
        vowels = [k for k, p in enumerate(out) if vowel(p)]
        before = [k for k in vowels if k < primary]
        for k in vowels:
            if not out[k].endswith("2"):
                continue
            # Keep a secondary stress only well before the main one (two or more syllables earlier).
            if k > primary or (before and k == before[-1]):
                out[k] = out[k][:-1] + "0"
    return out


def arpabet_to_ipa(phones: list[str]) -> str | None:
    """CMUdict phones -> the snapshot's US IPA, or None for anything unexpected."""
    phones = normalize_phones(phones)
    segs: list[tuple[str, int | None]] = []  # (ipa, stress) ; stress None for consonants
    for index, phone in enumerate(phones):
        m = re.fullmatch(r"([A-Z]+)([012])?", phone)
        if not m:
            return None
        base, digit = m.group(1), m.group(2)
        if base in VOWELS:
            if digit is None:
                return None
            stress = int(digit)
            ipa = VOWELS[base][0 if stress else 1]
            nxt = phones[index + 1] if index + 1 < len(phones) else ""
            if base == "IY" and stress and nxt == "R":
                ipa = "ɪ"  # here, near: hɪr, nɪr
            if base == "AH" and not stress and nxt in ("L", "N") and index + 2 == len(phones) and index > 0 and phones[index - 1] in SYLLABIC_AFTER:
                ipa = "(ə)"  # little, listen: ˈlɪt(ə)l, ˈlɪs(ə)n
            segs.append((ipa, stress))
        elif base in CONSONANTS and digit is None:
            segs.append((CONSONANTS[base], None))
        else:
            return None
    vowels = [i for i, (_, s) in enumerate(segs) if s is not None]
    if not vowels:
        return None
    marks: dict[int, str] = {}
    if len(vowels) > 1:
        for n, vi in enumerate(vowels):
            stress = segs[vi][1]
            if not stress:
                continue
            # Walk back over consonants that may begin this syllable.
            start = vi
            prev_vowel = vowels[n - 1] if n else -1
            j = vi - 1
            while j > prev_vowel:
                group = [segs[k][0] for k in range(j, vi)]
                if n and not legal_onset(group):
                    break
                start = j
                j -= 1
            if n == 0:
                start = 0
            marks[start] = "ˈ" if stress == 1 else "ˌ"
    out = []
    for i, (ipa, _) in enumerate(segs):
        if i in marks:
            out.append(marks[i])
        out.append(ipa)
    text = "".join(out)
    # A word with only secondary stress marks gets none (CMUdict writes some compounds that way).
    if "ˈ" not in text:
        text = text.replace("ˌ", "")
    return unicodedata.normalize("NFC", text)


def read_cmudict(path: str) -> dict[str, list[str]]:
    first: dict[str, list[str]] = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            parts = line.split()
            word = re.sub(r"\(\d+\)$", "", parts[0])
            if word not in first:
                first[word] = parts[1:]
    return first


def read_keep_list(path: str) -> set[str]:
    with open(path, encoding="utf-8") as handle:
        return {line.split()[0].lower() for line in handle if line.strip()}


def glossary_words(directory: str) -> set[str]:
    """Every key, form and anchor form of every glossary file under `directory`."""
    words: set[str] = set()
    for dirpath, _dirs, files in os.walk(directory):
        for name in sorted(files):
            if not name.endswith(".json"):
                continue
            try:
                with open(os.path.join(dirpath, name), encoding="utf-8") as handle:
                    data = json.load(handle)
            except (OSError, ValueError):
                continue
            glossary = data.get("glossary") if isinstance(data, dict) else None
            if not isinstance(glossary, dict):
                continue
            for key, entry in glossary.items():
                words.add(str(key).lower())
                if not isinstance(entry, dict):
                    continue
                for form in entry.get("forms") or []:
                    words.add(str(form).lower())
                for sense in entry.get("senses") or []:
                    if not isinstance(sense, dict):
                        continue
                    for form in sense.get("forms") or []:
                        words.add(str(form).lower())
                    for anchor in sense.get("anchors") or []:
                        if isinstance(anchor, dict) and anchor.get("form"):
                            words.add(str(anchor["form"]).lower())
    return {w for w in words if WORD.match(w)}


def load_snapshot() -> dict[str, dict]:
    words: dict[str, dict] = {}
    for letter in "abcdefghijklmnopqrstuvwxyz":
        with open(os.path.join(IPA_DIR, f"{letter}.json"), encoding="utf-8") as handle:
            shard = json.load(handle)
        words.update(shard["words"])
    return words


def base_snapshot() -> dict[str, dict]:
    """The snapshot without any earlier CMUdict additions: every run starts from the same input."""
    words = load_snapshot()
    out: dict[str, dict] = {}
    for word, entry in words.items():
        us = [r for r in entry["US"] if r.get("src") != "cmu"]
        uk = entry["UK"]
        if uk or us:
            out[word] = {"UK": uk, "US": us}
    return out


def build(cmudict: str, keep_list: str, glossaries: str | None) -> tuple[dict[str, dict], dict]:
    snapshot = base_snapshot()
    cmu = read_cmudict(cmudict)
    keep = read_keep_list(keep_list)
    wanted = glossary_words(glossaries) if glossaries else set()
    lower: dict[str, list[str]] = {}
    for word in snapshot:
        lower.setdefault(word.lower(), []).append(word)
    stats = {"filled": 0, "added": 0, "skippedCase": 0, "unconverted": 0}
    for word in sorted(cmu):
        if not WORD.match(word):
            continue
        ipa = arpabet_to_ipa(cmu[word])
        if ipa is None:
            stats["unconverted"] += 1
            continue
        reading = {"ipa": ipa, "src": "cmu"}
        if word in snapshot:
            if not snapshot[word]["US"]:
                snapshot[word]["US"] = [reading]
                stats["filled"] += 1
            continue
        if word in lower:
            stats["skippedCase"] += 1
            continue
        if word in keep:
            snapshot[word] = {"UK": [], "US": [reading]}
            stats["added"] += 1
        elif word in wanted:
            # A list key cut short by the plural rule (goe for goes) is not given the reading of
            # an unrelated rare word that happens to share the spelling (CMUdict's name Goe).
            if any(f"{word}{end}" in snapshot or f"{word}{end}" in cmu for end in ("s", "es")):
                stats["skippedStem"] = stats.get("skippedStem", 0) + 1
                continue
            snapshot[word] = {"UK": [], "US": [reading]}
            stats["added"] += 1
    return snapshot, stats


def shards_of(words: dict[str, dict]) -> tuple[dict[str, bytes], bytes, str]:
    by_letter: dict[str, dict] = {letter: {} for letter in "abcdefghijklmnopqrstuvwxyz"}
    for word in sorted(words):
        by_letter[word[0].lower()][word] = words[word]
    policy_hash = hashlib.sha256(
        json.dumps({"base": BASE_VERSION, "policy": POLICY, "words": by_letter}, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()[:24]
    version = f"local-ipa-primary-v2-{POLICY}-{policy_hash}"
    files: dict[str, bytes] = {}
    manifest_shards = {}
    for letter, entries in by_letter.items():
        body = json.dumps({"schemaVersion": 1, "version": version, "words": entries}, ensure_ascii=True, separators=(",", ":")).encode() + b"\n"
        files[f"{letter}.json"] = body
        manifest_shards[letter] = {"file": f"{letter}.json", "sha256": hashlib.sha256(body).hexdigest()}
    manifest = json.dumps({"schemaVersion": 1, "version": version, "shards": manifest_shards}, ensure_ascii=False, indent=2).encode() + b"\n"
    return files, manifest, version


def compare(cmudict: str) -> None:
    snapshot = base_snapshot()
    cmu = read_cmudict(cmudict)
    same = total = 0
    examples = []
    for word, entry in snapshot.items():
        us = [r["ipa"] for r in entry["US"]]
        if not us or word.lower() not in cmu:
            continue
        ipa = arpabet_to_ipa(cmu[word.lower()])
        if ipa is None:
            continue
        total += 1
        if ipa == us[0]:
            same += 1
        elif len(examples) < 25:
            examples.append((word, us[0], ipa))
    print(f"identical to the snapshot's US reading: {same}/{total} ({same / max(total, 1):.1%})")
    for example in examples:
        print("  ", *example)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cmudict", required=True)
    parser.add_argument("--keep-list")
    parser.add_argument("--glossaries")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--compare", action="store_true")
    args = parser.parse_args()
    for path in [args.cmudict, args.keep_list, args.glossaries]:
        if path and not os.path.isabs(path):
            parser.error("paths must be absolute")
    if args.compare:
        compare(args.cmudict)
        return 0
    if not args.keep_list:
        parser.error("--keep-list is required")
    words, stats = build(args.cmudict, args.keep_list, args.glossaries)
    files, manifest, version = shards_of(words)
    if args.check:
        differs = [name for name, body in files.items() if open(os.path.join(IPA_DIR, name), "rb").read() != body]
        if open(os.path.join(IPA_DIR, "manifest.json"), "rb").read() != manifest:
            differs.append("manifest.json")
        print("check:", "ok" if not differs else f"differs: {', '.join(differs)}")
        return 1 if differs else 0
    for name, body in files.items():
        with open(os.path.join(IPA_DIR, name), "wb") as handle:
            handle.write(body)
    with open(os.path.join(IPA_DIR, "manifest.json"), "wb") as handle:
        handle.write(manifest)
    print(json.dumps({"version": version, **stats, "words": len(words)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
