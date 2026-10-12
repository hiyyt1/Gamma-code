import ts from "/home/nikita/menti/mvp_platform/node_modules/typescript/lib/typescript.js"
import path from "node:path"
const root="/home/nikita/menti/mvp_platform"
process.chdir(root)
const files=(await Bun.$`rg --files --hidden -g '!.git' -g '!node_modules' -g '!dist'`.text()).trim().split('\n')
const manifests=files.filter(f=>f.endsWith('package.json') && !f.includes('/fixture') && !f.includes('/vendor/'))
const packages=await Promise.all(manifests.map(async f=>({file:f,...await Bun.file(f).json()})))
const source=files.filter(f=>/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !f.includes('/vendor/'))
const edges=[];const dynamic=[]
for(const file of source){
 const content=await Bun.file(file).text(); const ast=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true)
 const pkg=packages.filter(p=>file.startsWith(path.dirname(p.file)+'/')).sort((a,b)=>b.file.length-a.file.length)[0]
 function add(spec,kind,typeOnly=false){
  let resolved
  if(spec.startsWith('.')) resolved=path.normalize(path.join(path.dirname(file),spec))
  if(spec.startsWith('@/')&&pkg)resolved=path.join(path.dirname(pkg.file),'src',spec.slice(2))
  if(!resolved){const target=packages.find(p=>spec===p.name||spec.startsWith(p.name+'/'));if(target){const suffix=spec.slice(target.name.length);const exp=target.exports?.[suffix?'./'+suffix.slice(1):'.'];const v=typeof exp==='string'?exp:typeof exp?.import==='string'?exp.import:undefined;resolved=v?path.join(path.dirname(target.file),v):suffix?path.join(path.dirname(target.file),'src',suffix):undefined}}
  const to=resolved?[resolved,...['.ts','.tsx','.js','.jsx','/index.ts','/index.tsx','/index.js'].map(x=>resolved+x)].find(f=>files.includes(f)):undefined
  edges.push({from:file,spec,kind,typeOnly,to})
 }
 function visit(n){
  if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier)){const clause=n.importClause;add(n.moduleSpecifier.text,ts.isImportDeclaration(n)?'import':'export',n.isTypeOnly||clause?.isTypeOnly||!!(clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.length&&clause.namedBindings.elements.every(e=>e.isTypeOnly)))}
  if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||n.expression.getText(ast)==='require')){const a=n.arguments[0];if(a&&ts.isStringLiteral(a))add(a.text,'dynamic');else dynamic.push({file,line:ast.getLineAndCharacterOfPosition(n.pos).line+1,expression:n.getText(ast).slice(0,220)})}
  ts.forEachChild(n,visit)
 }visit(ast)
}
const counts={files:files.length,source:source.length,packages:packages.length,edges:edges.length}
await Bun.write('/tmp/gamma-legacy-audit/inventory.json',JSON.stringify({counts,packages:packages.map(p=>({file:p.file,name:p.name,scripts:p.scripts,exports:p.exports,dependencies:p.dependencies,devDependencies:p.devDependencies})),edges,dynamic},null,2))
console.log(counts)
