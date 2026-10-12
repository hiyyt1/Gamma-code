import {test,expect} from '/home/nikita/menti/mvp_platform/packages/app/node_modules/@playwright/test/index.mjs'
import {setupTimelineBenchmark,buildInitialStreamEvent,textPartID} from '/home/nikita/menti/mvp_platform/packages/app/e2e/performance/timeline/session-timeline-benchmark.fixture.ts'
import {writeFileSync} from 'node:fs'
for(const historyTurns of [0,49,249]) test(`history-${historyTurns*2+2}`,async({page})=>{
 test.setTimeout(120000)
 await page.emulateMedia({colorScheme:'light'})
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window)
  const audit={received:[] as number[],mutated:[] as number[],raf:[] as number[],longTasks:[] as number[],sseRequests:0}
  Object.assign(window,{audit})
  new PerformanceObserver(l=>l.getEntries().forEach(e=>audit.longTasks.push(e.duration))).observe({type:'longtask',buffered:true})
  window.fetch=async(input,init)=>{
   const path=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href).pathname
   if(path==='/auth/session') return new Response(JSON.stringify({username:'audit-fixture'}),{headers:{'content-type':'application/json'}})
   const response=await original(input,init)
   if(path!='/global/event'||!response.body)return response
   audit.sseRequests++
   return new Response(response.body.pipeThrough(new TransformStream({transform(chunk,controller){
    if(new TextDecoder().decode(chunk).includes('GAMMA_AUDIT_DELTA_'))audit.received.push(performance.now())
    controller.enqueue(chunk)
   }})),{status:response.status,headers:response.headers})
  }
 })
 const cdp=await page.context().newCDPSession(page)
 await cdp.send('Performance.enable')
 if(process.env.GAMMA_AUDIT_TRACE) await cdp.send('Tracing.start',{categories:'devtools.timeline,v8.execute,disabled-by-default-v8.cpu_profiler',transferMode:'ReturnAsStream'})
 const started=performance.now()
 const fixture=await setupTimelineBenchmark(page,{historyTurns,eventBatch:1,newLayoutDesigns:true})
 const loadMs=performance.now()-started
 fixture.transport.enqueue(buildInitialStreamEvent(1))
 await expect(fixture.text).toContainText('Implementation plan')
 await page.evaluate(partID=>{
   const audit=(window as any).audit
   audit.longTasks=[]
   let found=0
   new MutationObserver(()=>{
    const text=document.querySelector(`[data-timeline-part-id="${partID}"]`)?.textContent??''
    if(!text.includes(`GAMMA_AUDIT_DELTA_${found}_END`))return
    audit.mutated.push(performance.now()); requestAnimationFrame(()=>audit.raf.push(performance.now())); found++
   }).observe(document.body,{childList:true,characterData:true,subtree:true})
 },textPartID)
 const before=await cdp.send('Performance.getMetrics')
 for(let i=0;i<20;i++){
  fixture.transport.enqueue({directory:'C:/OpenCode/TimelineStateRegression',payload:{type:'message.part.delta',properties:{sessionID:'ses_timeline_state_regression',messageID:'msg_assistant_regression',partID:textPartID,field:'text',delta:`\n\nGAMMA_AUDIT_DELTA_${i}_END`}}})
  await page.waitForFunction(i=>(window as any).audit.raf.length>i,i)
 }
 const after=await cdp.send('Performance.getMetrics')
 const metrics=await page.evaluate(()=>({...(window as any).audit,domNodes:document.querySelectorAll('*').length,timelineRows:document.querySelectorAll('[data-timeline-row]').length}))
 const result={historyTurns,totalMessages:historyTurns*2+2,loadMs,metrics,before,after}
 writeFileSync(`/tmp/gamma-perf-${historyTurns}${process.env.GAMMA_AUDIT_TRACE?"-trace":""}.json`,JSON.stringify(result,null,2))
 console.log('PERF',JSON.stringify(result))
 if(process.env.GAMMA_AUDIT_TRACE){const completed=new Promise<any>(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const trace=await completed;let content='';while(true){const part=await cdp.send('IO.read',{handle:trace.stream});content+=part.data;if(part.eof)break}await cdp.send('IO.close',{handle:trace.stream});writeFileSync('/tmp/gamma-audit-renderer-trace.json',content)}
})
