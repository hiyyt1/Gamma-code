import { test, expect } from '/home/nikita/menti/mvp_platform/packages/app/node_modules/@playwright/test/index.mjs'
import { setupTimelineBenchmark, buildInitialStreamEvent, buildStreamDeltaEvents, textPartID } from '/home/nikita/menti/mvp_platform/packages/app/e2e/performance/timeline/session-timeline-benchmark.fixture.ts'
import { writeFileSync } from 'node:fs'
for (const scenario of [
  {name:'clean-light', system:'light'},
  {name:'clean-dark', system:'dark'},
  {name:'stored-dark-system-light', system:'light', saved:'dark'},
  {name:'stored-light-system-dark', system:'dark', saved:'light'},
  {name:'dark-mobile', system:'dark', width:390},
  {name:'legacy-setting-dark', system:'dark', legacy:true},
]) {
 test(scenario.name, async ({page}) => {
  test.setTimeout(100000)
  const errors: string[]=[]
  page.on('pageerror', e=>errors.push(e.message))
  await page.emulateMedia({colorScheme: scenario.system as 'light'|'dark'})
  await page.addInitScript(({saved})=>{
    if(saved) localStorage.setItem('opencode-color-scheme', saved)
    const fetchOriginal=window.fetch.bind(window)
    window.fetch=(input, init)=>new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href).pathname==='/auth/session'
      ? Promise.resolve(new Response(JSON.stringify({username:'audit-fixture'}), {headers:{'content-type':'application/json'}})) : fetchOriginal(input,init)
    const longTasks: {start:number,duration:number}[]=[]
    new PerformanceObserver(list=>list.getEntries().forEach(e=>longTasks.push({start:e.startTime,duration:e.duration}))).observe({type:'longtask',buffered:true})
    Object.assign(window,{auditLongTasks:longTasks})
  },{saved:scenario.saved})
  const fixture=await setupTimelineBenchmark(page,{historyTurns:0,eventBatch:1,newLayoutDesigns:!scenario.legacy})
  if(scenario.width) await page.setViewportSize({width:scenario.width,height:844})
  fixture.transport.enqueue(buildInitialStreamEvent(5))
  await expect(fixture.text).toContainText('Implementation plan')
  await page.screenshot({path:`/tmp/gamma-audit-${scenario.name}.png`,fullPage:true})
  const metrics=await page.evaluate(()=>{
    const selectors=['html','body','#root','[data-component="gamma-sidebar"]','.workspace-files-content','[data-session-title] h1','[data-component="prompt-input-v2"]','[contenteditable]','[data-slot="text-part-body"]','[data-slot="gamma-page-controls"]','[data-component="gamma-sidebar"] [data-component="button-v2"]']
    return {scheme:document.documentElement.dataset.colorScheme,theme:document.documentElement.dataset.theme,newLayout:document.body.hasAttribute('data-new-layout'),styles:selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector)).slice(0,2).map(el=>{const s=getComputedStyle(el);const rect=el.getBoundingClientRect(); return {selector,text:el.textContent?.slice(0,80),color:s.color,background:s.backgroundColor,display:s.display,opacity:s.opacity,pointerEvents:s.pointerEvents,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}})),longTasks:(window as any).auditLongTasks,supports:{lightDark:CSS.supports('color','light-dark(white,black)'),colorMix:CSS.supports('color','color-mix(in srgb,white,black)')}}
  })
  writeFileSync(`/tmp/gamma-audit-${scenario.name}.json`,JSON.stringify({scenario,metrics,errors},null,2))
  console.log('AUDIT',JSON.stringify({scenario,metrics,errors}))
 })
}
