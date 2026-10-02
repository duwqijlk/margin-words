import re, json, glob
CH = {}
for n in range(3,10):
    paras = {}
    toks = []
    for line in open(f'/workspace/classics/jungle-book/work/ch{n:03d}.txt', encoding='utf8'):
        m = re.match(r'\[(\d+)\] (.*)', line.rstrip('\n'))
        if m: paras[int(m.group(1))] = m.group(2)
    CH[n] = paras
WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
def norm(s):
    s = s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('—','-').replace('–','-').replace('…','...')
    return re.sub(r'\s+',' ',s).lower()
def normp(s):
    return re.sub(r"[^a-z0-9' ]","",re.sub(r'\s+',' ',norm(s).replace('-',' '))).strip()
def count_before(n, pi, charpos, form):
    c = 0
    for i in sorted(CH[n]):
        t = CH[n][i]
        if i > pi: break
        end = charpos if i == pi else len(t)
        for m in WORD.finditer(t[:end]):
            if m.group(0).lower() == form: c += 1
    return c
def find_ctx(n, ctx):
    # raw find, exact substring first; else normalized
    for i in sorted(CH[n]):
        t = CH[n][i]
        p = t.lower().find(ctx.lower())
        if p >= 0: return i, p
    raise SystemExit(f'context not found in ch{n}: {ctx!r}')
def A(n, form, ctx, nth=1):
    pi, p = find_ctx(n, ctx)
    # position of nth occurrence of form inside ctx
    k = 0; off = None
    for m in WORD.finditer(ctx):
        if m.group(0).lower() == form:
            k += 1
            if k == nth: off = m.start(); break
    if off is None: raise SystemExit(f'form {form} not in ctx {ctx!r}')
    # count words of form strictly before the match start
    occ = count_before(n, pi, p + off, form) + 1
    return {"chapter": n - 0 if False else n, "occurrence": occ, "form": form, "context": ctx}
def P(n, ctx):
    pi, p = find_ctx(n, ctx)
    return pi
