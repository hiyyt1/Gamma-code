import { build } from "/home/nikita/menti/mvp_platform/packages/app/node_modules/vite/dist/node/index.js"
import { gzipSync } from "node:zlib"
const root = "/home/nikita/menti/mvp_platform"
const started = performance.now()
await build({root: root+"/packages/app", configFile: root+"/packages/app/vite.config.ts", build: {outDir:"/tmp/gamma-legacy-audit/dist-prod", manifest:true}, plugins:[{name:"audit-read-only-stats", generateBundle(_,bundle){
 const chunks=Object.values(bundle).map(x=>x.type==="chunk"?{file:x.fileName,type:x.type,entry:x.isEntry,dynamic:x.isDynamicEntry,bytes:Buffer.byteLength(x.code),gzip:gzipSync(x.code).byteLength,imports:x.imports,dynamicImports:x.dynamicImports,modules:Object.entries(x.modules).map(([id,m])=>({id:id.replace(root+"/",""),rendered:m.renderedLength,original:m.originalLength}))}:{file:x.fileName,type:x.type,bytes:Buffer.byteLength(x.source)})
 return Bun.write("/tmp/gamma-legacy-audit/bundle-prod.json",JSON.stringify({chunks},null,2)).then(()=>{})
}}]})
await Bun.write("/tmp/gamma-legacy-audit/build-time-prod.json",JSON.stringify({elapsedMs:performance.now()-started}))
