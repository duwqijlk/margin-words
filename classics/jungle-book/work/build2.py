import sys,json
sys.path.insert(0,'/workspace/classics/jungle-book/work/src')
exec(open('/workspace/classics/jungle-book/work/build.py').read().replace("json.dump(out","FIXAPPLY(out); json.dump(out").replace("out={","from fix import FIX\ndef FIXAPPLY(o):\n    for k,v in FIX.items():\n        if k.startswith('_'): continue\n        e=o['glossary'][k]; e['meaning']=v\n        for s in e.get('senses',[]): pass\nout={",1))
