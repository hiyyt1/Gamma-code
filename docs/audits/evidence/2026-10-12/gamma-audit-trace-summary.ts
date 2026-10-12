import {TraceMap,originalPositionFor} from '/home/nikita/menti/mvp_platform/node_modules/.bun/@jridgewell+trace-mapping@0.3.31/node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs'
const trace=await Bun.file('/tmp/gamma-audit-renderer-trace.json').json()
const nodes=new Map();const samples=new Map();const maps=new Map();const timed=new Map()
for(const e of trace.traceEvents){
 if(e.ph==='X'){const v=timed.get(e.name)??[];v.push(e.dur/1000);timed.set(e.name,v)}
 if(e.name!=='ProfileChunk')continue
 const p=e.args?.data?.cpuProfile;if(!p)continue
 const key=`${e.pid}:${e.tid}:${e.id}`
 for(const node of p.nodes??[])nodes.set(`${key}:${node.id}`,node.callFrame)
 for(const sample of p.samples??[]){const id=`${key}:${sample}`;samples.set(id,(samples.get(id)??0)+1)}
}
const mapped=[]
for(const [id,count] of [...samples.entries()].sort((a,b)=>b[1]-a[1]).slice(0,60)){
 const frame=nodes.get(id);if(!frame)continue
 const file=frame.url?.split('/').at(-1);let original
 if(file?.endsWith('.js')){let map=maps.get(file);if(map===undefined){const raw=await Bun.file(`/tmp/gamma-performance-audit-build/assets/${file}.map`).json().catch(()=>null);map=raw?new TraceMap(raw):null;maps.set(file,map)}if(map)original=originalPositionFor(map,{line:frame.lineNumber+1,column:frame.columnNumber})}
 mapped.push({count,frame,original})
}
const result={events:trace.traceEvents.length,timing:Object.fromEntries(['FunctionCall','Layout','UpdateLayoutTree','Paint','MinorGC','MajorGC'].map(name=>{const v=timed.get(name)??[];return[name,{count:v.length,totalMs:v.reduce((a,b)=>a+b,0),maxMs:Math.max(0,...v)}]})),sampleLeaders:mapped}
await Bun.write('/tmp/gamma-audit-trace-summary.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(mapped.filter(x=>x.original).slice(0,14),null,2))
