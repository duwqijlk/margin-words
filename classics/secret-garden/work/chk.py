import json,sys
g=json.load(open('/workspace/classics/secret-garden/glossary.json'))
ks=set(g['glossary'])
print([ (k,k in ks) for k in sys.argv[1:]])
