#!/usr/bin/env python3
"""Build local-only IPA shards from pinned data, never downloaded executable code."""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import string
import sys
import tempfile
import zipfile

POLICY = "local-ipa-primary-v2"
WORD = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*\Z")
TITLE = re.compile(r"[A-Z][a-z]+(?:[-'][a-z]+)*\Z")
PINS = {
    "bnc-coca": ("downloads/bnc-coca/repository-data.zip", "86a66f3dc74b724c89b333e281f2346b599bd41e174f3144e4f2f88212674b2e"),
    "dictionarydata": ("downloads/dictionarydata/word.csv", "29183117768c8c5bbdd13545c4482f62aa7980852ae6848a27a95d68b1ab3d60"),
    "kajweb-all-books": ("downloads/kajweb-all-books/repository-data.zip", "ebfcfe6450e21784b5be8b195dde5e79ff01ac13832ef0bd17e2b6b498e19e6e"),
}
EMPTY = {"", "NULL", "null", "None", "nan", "\\N", "-"}
IPA_CHARS = set("abdefghijklmnoprstuvwxzɑɒæɔəɚɛɜɝɪʊʌθðŋʃʒɡɹɾʔɫɐɨɯʍɲɳʎçɣʁɥœøʏɶːˑˈˌ.̩̯̃ʰʲʷʳ ()")
VOWELS = set("aeiouɑɒæɔəɚɛɜɝɪʊʌɐɨɯœøʏɶ")
POS = {"n": "n.", "v": "v.", "adj": "adj.", "adv": "adv.", "vt": "vt.", "vi": "vi."}
# Exact, source-scoped denials: do not repair an incorrect source by guessing sounds.
KAJWEB_DENY = {
    ("book", "UK", "buk"): "book-vowel-anomaly",
    ("us", "UK", "juːɛs"): "acronym-contamination",
    ("us", "US", "juːɛs"): "acronym-contamination",
    ("a", "UK", "æn"): "different-headword-an",
    ("Polish", "UK", "ˈpɒlɪʃ"): "case-sibling-contamination",
    ("Polish", "US", "ˈpɑlɪʃ"): "case-sibling-contamination",
    ("polish", "UK", "ˈpoulɪʃ"): "case-sibling-contamination",
    ("wound", "UK", "wʊːnd"): "wound-vowel-anomaly",
    ("gym", "UK", "dʒɪmˈneɪziəm"): "different-headword-gymnasium",
}
# Only these reviewed DictionaryData extras supplement a nonempty BNC accent.
DICTIONARY_EXTRAS = {("use", "UK", "juːs"), ("use", "US", "jus")}
# Reviewed spelling variants/homophones can legitimately match the lemma sound.
BNC_COPY_EXCEPTIONS = {("color", "colour"), ("gray", "grey"), ("true", "TRUE"), ("false", "FALSE")}
MAX_ARCHIVE = 160 * 1024 * 1024
MAX_MEMBER = 1024 * 1024
MAX_NESTED = 20 * 1024 * 1024
MAX_BOOK = 32 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_LINE = 256 * 1024


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded(value, pretty=False) -> bytes:
    return (json.dumps(value, ensure_ascii=True, sort_keys=False,
                       indent=2 if pretty else None,
                       separators=None if pretty else (",", ":")) + "\n").encode("utf-8")


def digest_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def bounded_read(archive, info, limit):
    if info.is_dir() or info.flag_bits & 1 or info.file_size > limit:
        raise ValueError("Unsafe or oversized ZIP member: " + info.filename)
    if ".." in PurePosixPath(info.filename).parts or "\\" in info.filename or info.filename.startswith("/"):
        raise ValueError("Unsafe ZIP member name")
    with archive.open(info) as stream:
        data = stream.read(limit + 1)
    if len(data) > limit or len(data) != info.file_size:
        raise ValueError("ZIP member read limit or size mismatch")
    return data


def annotation(text):
    text = text.strip().lower()
    if text == "read, read":
        return "past/past participle"
    if not text.startswith("for "):
        return None
    tokens = re.findall(r"[a-z]+", text[4:])
    if not tokens or any(token not in POS for token in tokens):
        return None
    # Only a small grammar is supported; unknown commentary is never silently removed.
    if re.sub(r"[a-z. &,]", "", text[4:]):
        return None
    return " / ".join(dict.fromkeys(POS[token] for token in tokens))


def clean_field(raw):
    """Return independent alternatives with actions, plus rejected fragments."""
    if raw is None or (isinstance(raw, str) and raw.strip() in EMPTY):
        return [], [(raw, "empty-field", [])]
    if not isinstance(raw, str):
        return [], [(raw, "non-string-field", [])]
    if len(raw) > 1024:
        return [], [(raw, "oversized-field", [])]
    text = raw.strip()
    actions = ["trim"] if text != raw else []
    # Wrappers must enclose the whole field, be balanced, and be from the supported pair.
    pairs = {"[": "]", "/": "/"}
    while text and text[0] in pairs:
        end = pairs[text[0]]
        if len(text) < 2 or text[-1] != end:
            return [], [(text, "unbalanced-wrapper", actions)]
        if text[0] == "/" and text.count("/") != 2:
            break
        if text[0] == "[" and (text.count("[") != 1 or text.count("]") != 1):
            break
        text = text[1:-1].strip()
        actions = actions + ["strip-balanced-wrapper"]
    for old, new, action in [("\uFF1B", ";", "semicolon-width"), (":", "ː", "length-mark"),
                              ("'", "ˈ", "apostrophe-stress"), ("’", "ˈ", "apostrophe-stress"),
                              ("‘", "ˈ", "apostrophe-stress")]:
        if old in text:
            # This is stress notation, never a phoneme-equivalence rewrite.
            text = text.replace(old, new)
            actions = actions + [action]
    if ";" in text:
        actions = actions + ["split-semicolon"]
    accepted, rejected = [], []
    for segment in text.split(";"):
        segment = segment.strip()
        steps = list(actions)
        pos = None
        annotations = re.findall(r"\([^()]*\)", segment)
        for token in annotations:
            label = annotation(token[1:-1])
            if label:
                if pos and pos != label:
                    pos = " / ".join(dict.fromkeys([pos, label]))
                else:
                    pos = label
                segment = segment.replace(token, "", 1).strip()
                steps.append("parse-annotation:" + label)
        compact = re.sub(r"\s+", " ", segment).strip()
        if compact != segment:
            steps.append("collapse-whitespace")
        reason = None
        if not compact:
            reason = "empty-alternative"
        elif len(compact) > 160:
            reason = "oversized-alternative"
        elif any(c not in IPA_CHARS for c in compact):
            reason = "unsupported-symbol-or-prose"
        elif "-" in compact or "/" in compact:
            reason = "abbreviated-or-slash-fragment"
        elif "()" in compact or compact.count("(") != compact.count(")") or re.search(r"\([^()]{4,}\)|\([^)]*\(", compact):
            reason = "unknown-or-unbalanced-annotation"
        elif re.search(r"\([^)]*[ .ˈˌ][^)]*\)", compact):
            reason = "unknown-annotation"
        elif re.search(r"(?:^|\s)(?:for|also|before|unknown|prose|hello|world|pronounced|pronunciation|noun|verb|canadian|occas)(?:$|\s)", compact):
            reason = "unsupported-prose-token"
        elif not any(c in VOWELS for c in compact):
            reason = "no-vowel"
        elif compact.startswith(("ː", ".", ")")) or compact.endswith(("ˈ", "ˌ", "(")):
            reason = "incomplete-reading"
        if reason:
            rejected.append((segment, reason, steps))
        else:
            accepted.append(({"ipa": compact, **({"pos": pos} if pos else {})}, steps))
    return accepted, rejected


def read_sources(source_root):
    """Every yielded row points to original downloaded fields, not adapter output."""
    assets = {}
    for source, (name, expected) in PINS.items():
        path = source_root / name
        if path.stat().st_size > MAX_ARCHIVE or digest_file(path) != expected:
            raise ValueError("Pinned source hash/size mismatch: " + source)
        assets[source] = path
    bnc = assets["bnc-coca"]
    with zipfile.ZipFile(bnc) as archive:
        if len(archive.infolist()) > 100000:
            raise ValueError("Too many BNC ZIP members")
        members = sorted((m for m in archive.infolist() if len(PurePosixPath(m.filename).parts) == 3
                          and PurePosixPath(m.filename).parts[1] == "data" and m.filename.endswith(".json")), key=lambda m: m.filename)
        total = 0
        for member in members:
            total += member.file_size
            if total > MAX_TOTAL:
                raise ValueError("BNC aggregate uncompressed limit")
            obj = json.loads(bounded_read(archive, member, MAX_MEMBER).decode("utf-8-sig"))
            yield {"source": "bnc-coca", "member": member.filename, "row": 1,
                   "word": obj.get("word"), "headword": obj.get("headword"),
                   "fields": {"UK": ("ukPhone", obj.get("ukPhone")), "US": ("usPhone", obj.get("usPhone"))}}
    with assets["dictionarydata"].open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=">")
        if not {"vc_vocabulary", "vc_phonetic_uk", "vc_phonetic_us"}.issubset(reader.fieldnames or []):
            raise ValueError("Unexpected DictionaryData CSV header")
        for line, obj in enumerate(reader, 2):
            if line > 100000 or None in obj:
                raise ValueError("DictionaryData row limit/schema")
            yield {"source": "dictionarydata", "member": "word.csv", "row": line,
                   "word": obj["vc_vocabulary"], "sourceRowId": obj.get("vc_id"),
                   "fields": {"UK": ("vc_phonetic_uk", obj["vc_phonetic_uk"]), "US": ("vc_phonetic_us", obj["vc_phonetic_us"])}}
    with zipfile.ZipFile(assets["kajweb-all-books"]) as outer:
        if len(outer.infolist()) > 200:
            raise ValueError("Too many outer kajweb members")
        total = 0
        members = sorted((m for m in outer.infolist() if len(PurePosixPath(m.filename).parts) == 3
                          and PurePosixPath(m.filename).parts[1] == "book" and m.filename.endswith(".zip")), key=lambda m: m.filename)
        for member in members:
            with zipfile.ZipFile(io.BytesIO(bounded_read(outer, member, MAX_NESTED))) as inner:
                entries = [m for m in inner.infolist() if not m.is_dir()]
                if len(entries) != 1 or not entries[0].filename.endswith(".json"):
                    raise ValueError("Unexpected nested kajweb members")
                info = entries[0]
                total += info.file_size
                if total > MAX_TOTAL:
                    raise ValueError("kajweb aggregate uncompressed limit")
                data = bounded_read(inner, info, MAX_BOOK)
                for line, raw in enumerate(data.splitlines(), 1):
                    if not raw.strip():
                        continue
                    if line > 25000 or len(raw) > MAX_LINE:
                        raise ValueError("kajweb row bounds")
                    obj = json.loads(raw)
                    content = obj.get("content", {}).get("word", {}).get("content", {})
                    yield {"source": "kajweb-all-books", "member": member.filename + "!" + info.filename,
                           "row": line, "word": obj.get("headWord"), "sourceRowId": obj.get("wordRank"),
                           "fields": {"UK": ("content.word.content.ukphone", content.get("ukphone")), "US": ("content.word.content.usphone", content.get("usphone"))}}


class Cleaner:
    def __init__(self):
        self.words = {}
        self.audit = []
        self.counts = collections.Counter()
        self.lemma = {}
        self.bnc_present = set()

    def event(self, row, locale, field, raw, status, reason, reading=None, actions=None):
        event = {key: row[key] for key in ["source", "member", "row", "word", "headword", "sourceRowId"] if key in row}
        event.update({"accent": locale, "field": field, "raw": raw, "status": status, "reason": reason,
                      "actions": actions or []})
        if reading:
            event["reading"] = reading
        self.audit.append(event)
        self.counts[row["source"] + ":" + status + ":" + reason] += 1

    def add_rows(self, rows):
        # BNC first, including an index of the explicit lemma records for the copy heuristic.
        rows = list(rows)
        for row in rows:
            if row["source"] == "bnc-coca" and row.get("word") == row.get("headword"):
                for accent, (_, raw) in row["fields"].items():
                    self.lemma[(row["word"], accent)] = {r["ipa"] for r, _ in clean_field(raw)[0]}
        for row in rows:
            self.add_row(row)
        self.words = dict(sorted((word, item) for word, item in self.words.items() if item["UK"] or item["US"]))
        return self.words

    def add_row(self, row):
        word = row.get("word")
        valid_word = isinstance(word, str) and len(word) <= 96 and WORD.fullmatch(word)
        for accent, (field, raw) in row["fields"].items():
            if not valid_word:
                self.event(row, accent, field, raw, "rejected", "non-single-ascii-word")
                continue
            readings, rejects = clean_field(raw)
            for fragment, reason, actions in rejects:
                self.event(row, accent, field, raw, "rejected", reason, actions=actions + ["fragment:" + str(fragment)])
            for reading, actions in readings:
                ipa = reading["ipa"]
                source = row["source"]
                if source == "bnc-coca" and row.get("headword") != word:
                    lemma = self.lemma.get((row.get("headword"), accent))
                    if (word, row.get("headword")) in BNC_COPY_EXCEPTIONS:
                        actions += ["reviewed-spelling-variant"]
                    elif not lemma:
                        self.event(row, accent, field, raw, "quarantined", "unverified-mismatched-headword", reading, actions)
                        continue
                    elif ipa in lemma:
                        self.event(row, accent, field, raw, "quarantined", "same-as-lemma-reading", reading, actions)
                        continue
                    else:
                        actions += ["mismatched-headword-distinct-reading"]
                if source == "kajweb-all-books" and (word, accent, ipa) in KAJWEB_DENY:
                    self.event(row, accent, field, raw, "quarantined", KAJWEB_DENY[(word, accent, ipa)], reading, actions)
                    continue
                item = self.words.setdefault(word, {"UK": [], "US": []})
                prior = next((r for r in item[accent] if r["ipa"] == ipa), None)
                if prior is not None:
                    # Dedup literal normalized IPA only; metadata never creates a fake reading.
                    self.event(row, accent, field, raw, "duplicate", "literal-normalized-ipa", reading, actions)
                    continue
                if source == "dictionarydata" and (word, accent) in self.bnc_present and (word, accent, ipa) not in DICTIONARY_EXTRAS:
                    self.event(row, accent, field, raw, "excluded", "bnc-accent-already-present", reading, actions)
                    continue
                if len(item[accent]) >= 128:
                    raise ValueError("Runtime reading limit: " + word)
                item[accent].append(reading)
                if source == "bnc-coca":
                    self.bnc_present.add((word, accent))
                reason = "reviewed-extra" if source == "dictionarydata" and (word, accent, ipa) in DICTIONARY_EXTRAS else "source-priority"
                self.event(row, accent, field, raw, "accepted", reason, reading, actions)


def product_lookup(words, query):
    if not WORD.fullmatch(query):
        return []
    if query in words:
        return [query]
    if TITLE.fullmatch(query) and query.lower() in words:
        return [query.lower()]
    return []


def benchmarks(source_root, words):
    previous = source_root.parent / "reading-ipa-evaluation-e16ee32d"
    ngsl_path = previous / "references/ngsl-1.2/NGSL_12_stats.csv"
    easy_path = previous / "results/easy-benchmark.txt"
    story_path = previous / "results/coverage.json"
    if digest_file(ngsl_path) != "2098bab8955a120a9766c6282a51d7d578c6cb0a7d946600d2ffb73ba25a0b44":
        raise ValueError("NGSL benchmark hash mismatch")
    with ngsl_path.open(encoding="utf-8-sig", newline="") as stream:
        ngsl = list(csv.DictReader(stream))
    if len(ngsl) != 2809:
        raise ValueError("NGSL benchmark row count")
    easy = easy_path.read_text(encoding="utf-8").split()
    story = json.loads(story_path.read_text(encoding="utf-8"))["epubTokenCounts"]
    fold = collections.defaultdict(list)
    for word in words:
        fold[word.casefold()].append(word)
    inputs = [{"file": str(p.relative_to(source_root.parent)).replace("\\", "/"), "sha256": digest_file(p)} for p in [ngsl_path, easy_path, story_path]]
    sets = [("NGSL-1.2-top-" + str(n), {r["Lemma"]: 1 for r in ngsl[:n]}) for n in [100, 500, 1000, 2809]]
    sets += [("Project-EASY-620", dict.fromkeys(easy, 1)), ("Shipped-story-593-tokens", story)]
    result = []
    for name, queries in sets:
        for policy in ["exact", "product", "old-casefold-union"]:
            counts = collections.Counter()
            tokens = collections.Counter()
            missing = {"UK": [], "US": [], "both": [], "either": []}
            for query, weight in queries.items():
                keys = ([query] if query in words else []) if policy == "exact" else product_lookup(words, query) if policy == "product" else fold.get(query.casefold(), [])
                uk = any(words[k]["UK"] for k in keys)
                us = any(words[k]["US"] for k in keys)
                for flag, hit in [("UK", uk), ("US", us), ("both", uk and us), ("either", uk or us)]:
                    if hit:
                        counts[flag] += 1
                        tokens[flag] += weight
                    else:
                        missing[flag].append(query)
            total = sum(queries.values())
            result.append({"benchmark": name, "policy": policy, "words": len(queries), "tokens": total,
                           "counts": {flag: counts[flag] for flag in missing}, "tokenCounts": {flag: tokens[flag] for flag in missing},
                           "percent": {flag: round(100 * counts[flag] / len(queries), 2) for flag in missing},
                           "tokenPercent": {flag: round(100 * tokens[flag] / total, 2) for flag in missing}, "missing": missing})
    return {"inputs": inputs, "benchmarks": result,
            "limits": "Headword-field coverage, not phonetic correctness or complete heteronyms. Old casefold unions case siblings and can combine accents; product uses exact then controlled Titlecase-to-lowercase only, never fills an exact entry's missing accent. EASY is the prior frozen 620-word input; story uses prior frozen 278 types/593 tokens. No stemming or inferred sounds."}


def primary_readings(words):
    """Select one explicit source-priority reading per accent, never invent sounds."""
    return {word: {accent: entry[accent][:1] for accent in ("UK", "US")} for word, entry in words.items()}


def build(source_root, out, check=False):
    cleaner = Cleaner()
    candidates = cleaner.add_rows(read_sources(source_root))
    words = primary_readings(candidates)
    for event in cleaner.audit:
        if event["status"] == "accepted":
            primary = words[event["word"]][event["accent"]]
            event["runtimeRole"] = "primary" if primary and event["reading"]["ipa"] == primary[0]["ipa"] else "audit-only-alternative"
    policy = {"name": POLICY, "selection": "first-accepted-source-priority-per-accent; alternatives audit-only; no phoneme rewriting", "pins": PINS, "dictionaryExtras": sorted(DICTIONARY_EXTRAS),
              "kajwebDeny": [list(key) + [value] for key, value in sorted(KAJWEB_DENY.items())],
              "bncCopyExceptions": sorted(BNC_COPY_EXCEPTIONS)}
    version = POLICY + "-" + sha(encoded({"policy": policy, "words": words}))[:24]
    files = {}
    shards = {}
    for letter in string.ascii_lowercase:
        shard_words = {w: value for w, value in words.items() if w[0].lower() == letter}
        payload = encoded({"schemaVersion": 1, "version": version, "words": shard_words})
        files[out / (letter + ".json")] = payload
        shards[letter] = {"file": letter + ".json", "sha256": sha(payload)}
    files[out / "manifest.json"] = encoded({"schemaVersion": 1, "version": version, "shards": shards}, True)
    audit_dir = out.parent / "audit"
    files[audit_dir / "provenance.jsonl"] = b"".join(encoded(row) for row in cleaner.audit)
    files[audit_dir / "policy.json"] = encoded(policy, True)
    coverage = benchmarks(source_root, words)
    files[audit_dir / "coverage.json"] = encoded(coverage, True)
    stats = {"schemaVersion": 1, "version": version, "words": len(words),
             "UKWords": sum(bool(e["UK"]) for e in words.values()), "USWords": sum(bool(e["US"]) for e in words.values()),
             "bothWords": sum(bool(e["UK"]) and bool(e["US"]) for e in words.values()),
             "UKReadings": sum(len(e["UK"]) for e in words.values()), "USReadings": sum(len(e["US"]) for e in words.values()),
             "auditedUKCandidates": sum(len(e["UK"]) for e in candidates.values()),
             "auditedUSCandidates": sum(len(e["US"]) for e in candidates.values()),
             "auditOnlyAlternatives": sum(max(0, len(e[a]) - 1) for e in candidates.values() for a in ("UK", "US")),
             "dataBytes": sum(len(v) for p, v in files.items() if p.parent == out),
             "auditEvents": len(cleaner.audit), "decisions": dict(sorted(cleaner.counts.items())),
             "coverage": [r for r in coverage["benchmarks"] if r["policy"] == "product"]}
    files[audit_dir / "stats.json"] = encoded(stats, True)
    mismatches = []
    for path, content in files.items():
        if check:
            if not path.exists() or path.read_bytes() != content:
                mismatches.append(str(path))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    if check and out.exists():
        expected = {p.name for p in files if p.parent == out}
        mismatches.extend(str(p) for p in out.iterdir() if p.name not in expected)
    if mismatches:
        raise ValueError("Generated bytes differ: " + ", ".join(mismatches))
    print(json.dumps({k: v for k, v in stats.items() if k not in ["decisions", "coverage"]}, ensure_ascii=True))
    print("CHECK OK" if check else "BUILD OK")


def self_test():
    cases = [
        ("[ju:s]", ["juːs"]), ("/ə; eɪ/", ["ə", "eɪ"]), ("'wɔ:tə(r)", ["ˈwɔːtə(r)"]),
        ("(for v.)rɪˈkɔːd; (for n.) ˈrekɔːd", ["rɪˈkɔːd", "ˈrekɔːd"]),
        ("riːd; (read, read) red", ["riːd", "red"]), ("laɪv\uFF1Blɪv", ["laɪv", "lɪv"]),
        ("<b>bʊk</b>", []), ("[bʊk", []), ("bʊk]", []), ("(unknown prose) bʊk", []),
        ("-ɡɪt", []), ("b3k", []), ("hello world", []), ("bʊk / buk", []),
        ("bʊk; -k", ["bʊk"]), ("bʊk (r)", ["bʊk (r)"]),
        ("nekst", ["nekst"]), ("ˈkwestʃən", ["ˈkwestʃən"]),
        ("(for adj., also) bʊk", []), ("(canadian) bʊk", []),
        ("(for n. adj.) ˈrekɔːd", ["ˈrekɔːd"]),
        ("ˈhaɪpə()θɜm", []), ("pə()ˈtenɪŋ", []), ("bə(ː)ˈmjuːdə", ["bə(ː)ˈmjuːdə"]),
    ]
    for raw, expected in cases:
        actual = [r["ipa"] for r, _ in clean_field(raw)[0]]
        assert actual == expected, (raw, actual, expected)
    assert clean_field("riːd; (read, read) red")[0][1][0]["pos"] == "past/past participle"
    def row(source, word, uk=None, us=None, headword=None):
        return {"source": source, "member": "synthetic", "row": 1, "word": word,
                **({"headword": headword} if headword else {}), "fields": {"UK": ("uk", uk), "US": ("us", us)}}
    cleaner = Cleaner()
    words = cleaner.add_rows([
        row("bnc-coca", "book", "bʊk", "bʊk", "book"),
        row("bnc-coca", "books", "bʊk", "bʊks", "book"),
        row("bnc-coca", "use", "juːz", "juːz", "use"),
        row("dictionarydata", "use", "[ju:s]", "[jus]"),
        row("dictionarydata", "book", "[buk]", "[bʊk]"),
        row("kajweb-all-books", "book", "buk", None),
        row("kajweb-all-books", "book", "bʊk", None),
        row("kajweb-all-books", "read", "riːd; (read, read) red", "rid; rɛd"),
        row("dictionarydata", "Polish", "[ˈpəʊlɪʃ]", None),
        row("dictionarydata", "polish", "[ˈpɒlɪʃ]", "[ˈpɑlɪʃ]"),
        row("dictionarydata", "US", None, "[ju ɛs]"),
        row("dictionarydata", "us", "[əs]", "[ʌs]"),
        row("dictionarydata", "two words", "tuː", "tuː"),
    ])
    assert words["books"] == {"UK": [], "US": [{"ipa": "bʊks"}]}
    assert [x["ipa"] for x in words["use"]["UK"]] == ["juːz", "juːs"]
    assert [x["ipa"] for x in words["book"]["UK"]] == ["bʊk"]
    assert product_lookup(words, "Polish") == ["Polish"]
    assert not words["Polish"]["US"]
    assert product_lookup(words, "US") == ["US"] and not words["US"]["UK"]
    assert product_lookup(words, "Book") == ["book"]
    assert product_lookup(words, "BOOK") == [] and product_lookup(words, "bOOk") == []
    assert "two words" not in words
    assert words["read"]["UK"][1] == {"ipa": "red", "pos": "past/past participle"}
    assert any(e["reason"] == "book-vowel-anomaly" for e in cleaner.audit)
    assert any(e["reason"] == "same-as-lemma-reading" for e in cleaner.audit)
    primary = primary_readings(words)
    assert primary["use"] == {"UK": [{"ipa": "juːz"}], "US": [{"ipa": "juːz"}]}
    assert primary["read"] == {"UK": [{"ipa": "riːd"}], "US": [{"ipa": "rid"}]}
    assert primary["books"] == {"UK": [], "US": [{"ipa": "bʊks"}]}
    assert all(len(entry[accent]) <= 1 for entry in primary.values() for accent in ("UK", "US"))
    assert words["read"]["UK"][1]["ipa"] == "red"  # Audited alternatives remain untouched.
    assert product_lookup(primary, "Book") == ["book"]
    with tempfile.TemporaryDirectory() as directory:
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("../evil.json", "{}")
        with zipfile.ZipFile(io.BytesIO(stream.getvalue())) as archive:
            try:
                bounded_read(archive, archive.infolist()[0], 100)
            except ValueError:
                pass
            else:
                raise AssertionError("Unsafe ZIP name accepted")
    print("SELF TEST OK: normalization, annotations, priority, no accent pairing, case, quarantine, ZIP bounds")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not sys.flags.isolated:
        parser.error("Run this data reader with python -I")
    if args.self_test:
        self_test()
        return
    if not args.source_root or not args.out or not args.source_root.is_absolute() or not args.out.is_absolute():
        parser.error("--source-root and --out must be absolute paths")
    source_root, out = args.source_root.resolve(), args.out.resolve()
    if source_root == out or source_root in out.parents or out in source_root.parents:
        parser.error("Source and output directories must not overlap")
    build(source_root, out, args.check)


if __name__ == "__main__":
    main()
