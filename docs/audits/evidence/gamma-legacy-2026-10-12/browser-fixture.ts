import { chromium } from "/home/nikita/menti/mvp_platform/packages/app/node_modules/@playwright/test/index.mjs"
import { setupGamma } from "/home/nikita/menti/mvp_platform/packages/app/e2e/gamma-light/fixture.ts"
process.env.PLAYWRIGHT_SERVER_PORT='46457'
process.env.PLAYWRIGHT_PORT='46457'
const out='/tmp/gamma-legacy-audit';const base='http://127.0.0.1:46457'
const server=Bun.serve({idleTimeout:0,hostname:'127.0.0.1',port:46457,async fetch(req){const p=new URL(req.url).pathname;if(['/global/event','/api/event'].includes(p)){const event=p==='/api/event'?{id:'evt_audit',type:'server.connected',data:{}}:{payload:{id:'evt_audit',type:'server.connected',properties:{}}};return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'))}}),{headers:{'Content-Type':'text/event-stream'}})}const file=Bun.file(out+'/dist'+p);return new Response(await file.exists()?file:Bun.file(out+'/dist/index.html'))}})
const browser=await chromium.launch({headless:true});const reports=[]
try{for(const protocol of ['v1','v2'] as const){
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});const page=await context.newPage();await setupGamma(page,{protocol});await page.route('**/global/event',r=>r.continue());await page.route('**/api/event',r=>r.continue());await page.addInitScript(()=>localStorage.setItem('settings.v3',JSON.stringify({general:{newLayoutDesigns:true,shouldDisplayTabsToast:false}})))
 let stage='home';const requests=[];const errors=[];const workers=[];const samples=[]
 page.on('request',r=>requests.push({stage,url:r.url().replace(base,''),method:r.method(),type:r.resourceType()}));page.on('pageerror',e=>errors.push({stage,message:e.message}));page.on('worker',w=>workers.push({stage,url:w.url().replace(base,'')}))
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable')
 async function sample(){await page.waitForTimeout(1800);samples.push({stage,url:page.url().replace(base,''),dom:await cdp.send('Memory.getDOMCounters'),metrics:(await cdp.send('Performance.getMetrics')).metrics.filter(m=>['JSHeapUsedSize','TaskDuration','ScriptDuration'].includes(m.name))})}
 try{
  await page.goto(base);await page.locator('.gamma-dashboard-card').first().waitFor();await sample()
  stage='agents';await page.locator('a[href="/agents"]').click();await sample()
  stage='knowledge';await page.locator('a[href="/knowledge"]').click();await sample()
  stage='projects';await page.locator('.gamma-home-link').click();await sample()
  stage='chat';await page.locator('.gamma-dashboard-card').filter({has:page.getByRole('heading',{name:'Gamma Light',exact:true})}).click();await page.locator('[contenteditable="true"]').first().waitFor({timeout:20000});await sample()
  stage='home-return';await page.locator('.gamma-home-link').click();await sample()
 }catch(e){errors.push({stage,message:String(e)})}
 reports.push({protocol,requests,errors,workers,samples});await context.close()
}}finally{await Bun.write(out+'/browser-fixture.json',JSON.stringify({mode:'production frontend + gamma-light fixture with persistent synthetic SSE; NOT backend/model execution',reports},null,2));await browser.close();server.stop(true)}
console.log(JSON.stringify(reports.map(r=>({protocol:r.protocol,requests:r.requests.length,errors:r.errors,workers:r.workers}))))
