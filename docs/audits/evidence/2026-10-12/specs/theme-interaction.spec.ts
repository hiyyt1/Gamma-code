import {test,expect} from '/home/nikita/menti/mvp_platform/packages/app/node_modules/@playwright/test/index.mjs'
import {setupTimelineBenchmark,buildInitialStreamEvent} from '/home/nikita/menti/mvp_platform/packages/app/e2e/performance/timeline/session-timeline-benchmark.fixture.ts'
import {writeFileSync} from 'node:fs'
test('system switch keeps new chat button hittable but removes contrast',async({page})=>{
 await page.emulateMedia({colorScheme:'light'})
 await page.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=(input,init)=>String(input)==='/auth/session'?Promise.resolve(new Response(JSON.stringify({username:'audit-fixture'}),{headers:{'content-type':'application/json'}})):original(input,init)})
 const fixture=await setupTimelineBenchmark(page,{historyTurns:0,eventBatch:1,newLayoutDesigns:true})
 fixture.transport.enqueue(buildInitialStreamEvent(1));await expect(fixture.text).toContainText('Implementation plan')
 const samples=[]
 for(const mode of ['light','dark','light'] as const){
  await page.emulateMedia({colorScheme:mode});await expect(page.locator('html')).toHaveAttribute('data-color-scheme',mode)
  await expect.poll(()=>page.locator('.gamma-new-chat').evaluate(el=>getComputedStyle(el).color)).toBe(mode==='dark'?'rgb(250, 250, 250)':'rgb(22, 22, 22)')
  samples.push(await page.evaluate(()=>{
   const button=document.querySelector<HTMLButtonElement>('.gamma-new-chat')!;const rect=button.getBoundingClientRect();const s=getComputedStyle(button)
   const p=document.querySelector('[data-component="markdown"] p')!;const h=document.querySelector('[data-session-title] h1')!
   const ancestors=(el:Element)=>{const out=[];while(el){const s=getComputedStyle(el);out.push({tag:el.tagName,class:el.className,color:s.color,bg:s.backgroundColor});el=el.parentElement!}return out}
   return {mode:document.documentElement.dataset.colorScheme,disabled:button.disabled,hit:button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)),display:s.display,visibility:s.visibility,opacity:s.opacity,color:s.color,bg:s.backgroundColor,buttonAncestors:ancestors(button),paragraphAncestors:ancestors(p),headingAncestors:ancestors(h)}
  }))
 }
 writeFileSync('/tmp/gamma-audit-theme-interaction.json',JSON.stringify(samples,null,2))
 expect(samples.every(x=>x.hit&&!x.disabled&&x.opacity==='1')).toBe(true)
})
