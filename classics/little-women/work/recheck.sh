cd /workspace/classics/little-women/work && node build.mjs && cp glossary.merged.json ../glossary.json && cd /workspace/reader && node scripts/check-definition-words.mjs --json /workspace/classics/little-women/glossary.json > /tmp/cdw.json; python3 - <<'PY'
import json
d=json.load(open('/tmp/cdw.json'))[0]
print(d['failing'],'of',d['checked'])
with open('/tmp/bad.txt','w') as f:
    for b in d['bad']: f.write(f"{b['lemma']}|{','.join(b['words'])}|{b['meaning']}\n")
PY
