import {test,expect} from '/home/nikita/menti/mvp_platform/packages/app/node_modules/@playwright/test/index.mjs'
import {setupTimelineBenchmark,buildInitialStreamEvent} from '/home/nikita/menti/mvp_platform/packages/app/e2e/performance/timeline/session-timeline-benchmark.fixture.ts'
import {writeFileSync} from 'node:fs'
test('missed final response survives reconnect until reload',async({page})=>{
 await page.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=(input,init)=>String(input)==='/auth/session'?Promise.resolve(new Response(JSON.stringify({username:'audit-fixture'}),{headers:{'content-type':'application/json'}})):original(input,init)})
 let originalMessages:unknown[]=[]
 let connections=0
 page.on('response',async response=>{
   if(new URL(response.url()).pathname==='/session/ses_timeline_state_regression/message')originalMessages=await response.json()
   if(new URL(response.url()).pathname==='/global/event')connections++
 })
 const fixture=await setupTimelineBenchmark(page,{historyTurns:0,eventBatch:1,newLayoutDesigns:true})
 fixture.transport.enqueue(buildInitialStreamEvent(1))
 await expect(fixture.text).toContainText('Implementation plan')
 await expect.poll(()=>originalMessages.length).toBeGreaterThan(0)
 const marker='GAMMA_MISSED_FINAL_RESPONSE'
 const changed=structuredClone(originalMessages) as any[]
 const assistant=changed.find(m=>m.info.id==='msg_assistant_regression')
 assistant.parts.push({...((buildInitialStreamEvent(1).payload.properties as any).part),text:marker})
 let historyRefetches=0
 await page.route('**/session/ses_timeline_state_regression/message?*',route=>{historyRefetches++;return route.fulfill({json:changed})})
 const startingConnections=connections
 // Observe repeated server.connected after the persisted response changed without delivering its event.
 await expect.poll(()=>connections-startingConnections,{timeout:10000}).toBeGreaterThanOrEqual(5)
 const visibleBeforeReload=(await fixture.text.textContent())?.includes(marker)??false
 const refetchesBeforeReload=historyRefetches
 await page.reload()
 await expect(page.locator('[data-timeline-part-id="prt_9999_text"]').first()).toContainText(marker)
 const result={startingConnections,connections,refetchesBeforeReload,visibleBeforeReload,visibleAfterReload:true}
 writeFileSync('/tmp/gamma-audit-recovery.json',JSON.stringify(result,null,2))
 console.log('RECOVERY',JSON.stringify(result))
 expect(visibleBeforeReload).toBe(false)
 expect(refetchesBeforeReload).toBe(0)
})
