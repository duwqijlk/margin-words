import sys,json
sys.path.insert(0,'/workspace/classics/black-beauty/work')
from lib import *
b=load(); d=json.load(open('/workspace/classics/black-beauty/glossary.json'))
a,z=int(sys.argv[1]),int(sys.argv[2])
for i,x in enumerate(d['paragraphs']):
    if a<=i<z:
        print(f"#### P{i} ch{x['chapter']} para{x['paragraph']}\nORIG: {b[x['chapter']][x['paragraph']]}\nMAIN: {x['mainIdea']}\nSIMPLE: {x['simple']}\n")
