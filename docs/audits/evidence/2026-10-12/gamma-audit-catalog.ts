import { bundle } from '/home/nikita/menti/mvp_platform/packages/core/src/agent-market/catalog.ts'
import { readdir } from 'node:fs/promises'
const root='/home/nikita/menti/mvp_platform/gamma-agent-market/bundles'
for(const id of await readdir(root)) {
 const manifest=await Bun.file(`${root}/${id}/manifest.json`).json().catch(()=>undefined)
 if(!manifest) continue
 const samples=[]
 const before=process.cpuUsage()
 for(let i=0;i<5;i++){const start=performance.now();await bundle(id);samples.push(performance.now()-start)}
 console.log(JSON.stringify({id,files:Object.keys(manifest.files).length,skills:manifest.skills.length,samplesMs:samples,cpuMicros:process.cpuUsage(before),rss:process.memoryUsage().rss}))
}
