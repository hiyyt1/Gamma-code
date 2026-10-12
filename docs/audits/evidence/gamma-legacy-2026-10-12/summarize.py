import json,collections,re,gzip
from pathlib import Path
out=Path('/tmp/gamma-legacy-audit');x=json.loads((out/'inventory.json').read_text());edges=x['edges'];pkgs=x['packages'];b=json.loads((out/'bundle.json').read_text())
def owner(file):
 ps=[p for p in pkgs if file.startswith(str(Path(p['file']).parent)+'/')];return max(ps,key=lambda p:len(p['file']))['file'] if ps else 'package.json'
used=collections.defaultdict(list)
for e in edges:
 if not e['spec'].startswith(('.','@/','node:')):used[(owner(e['from']),e['spec'].split('/')[0] if not e['spec'].startswith('@') else '/'.join(e['spec'].split('/')[:2]))].append(e)
suspects=[]
for p in pkgs:
 for dep in p.get('dependencies',{}):
  if (p['file'],dep) not in used:suspects.append({'manifest':p['file'],'dependency':dep,'otherConsumers':[{'manifest':f,'count':len(es)} for (f,d),es in used.items() if d==dep]})
(out/'dependency-candidates.json').write_text(json.dumps(suspects,indent=2))
chunks=[c for c in b['chunks'] if c['type']=='chunk'];entry=next(c for c in chunks if c['entry']);entryMods=sorted(entry['modules'],key=lambda m:m['rendered'],reverse=True)
assets=list((out/'dist').rglob('*'));sizes=collections.Counter()
for f in assets:
 if f.is_file():sizes['map' if f.suffix=='.map' else 'js' if f.suffix=='.js' else 'css' if f.suffix=='.css' else 'other']+=f.stat().st_size
summary={'buildTime':json.loads((out/'build-time.json').read_text()),'sizes':sizes,'chunks':len(chunks),'entry':{k:v for k,v in entry.items() if k!='modules'},'entryModuleCount':len(entryMods),'topEntryModules':entryMods[:45],'largeChunks':[{k:v for k,v in c.items() if k not in ['modules','dynamicImports']} for c in sorted(chunks,key=lambda c:c['bytes'],reverse=True)[:20]]}
(out/'bundle-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items() if k not in ['largeChunks','entry','topEntryModules']},indent=2));print('TOP APP',[(m['id'],m['rendered']) for m in entryMods if m['id'].startswith('packages/app')][:20])
# candidate evidence both imports/types and all chunks
names=['components/dialog-select-directory.tsx','pages/home/home-projects.tsx','pages/home/home-sessions.tsx','pages/session/review-tab.tsx','pages/session/session-side-panel.tsx','pages/session/v2/review-panel-v2.tsx','pages/skill-market.tsx','pages/product-placeholder.tsx']
a=[]
for n in names:
 f='packages/app/src/'+n;a.append({'file':f,'sourceBytes':Path(f).stat().st_size,'lines':len(Path(f).read_text().splitlines()),'incoming':[e for e in edges if e.get('to')==f and e['from']!=f],'chunks':[{'file':c['file'],'modules':[m for m in c['modules'] if m['id']==f]} for c in chunks if any(m['id']==f for m in c['modules'])]})
(out/'orphan-evidence.json').write_text(json.dumps(a,indent=2));print('ORPHANS',sum(v['sourceBytes'] for v in a),sum(v['lines'] for v in a))
