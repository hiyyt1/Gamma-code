import { chromium } from "/home/nikita/menti/mvp_platform/packages/app/node_modules/@playwright/test/index.mjs"
const out='/tmp/gamma-legacy-audit';const base='http://localhost:46456'
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'})
await context.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.abort())
const login=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'audit',password:'isolated-audit-password'})});const cookie=login.headers.get('set-cookie')!.split(';')[0].split('=');await context.addCookies([{name:cookie[0],value:cookie[1],url:base}])
const page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable')
let stage='home';const requests=[];const responses=[];const errors=[];const workers=[];const samples=[]
page.on('request',r=>requests.push({stage,url:r.url().replace(base,''),method:r.method(),type:r.resourceType(),time:Date.now()}));page.on('response',r=>responses.push({stage,url:r.url().replace(base,''),status:r.status()}));page.on('pageerror',e=>errors.push({stage,message:e.message}));page.on('worker',w=>workers.push({stage,url:w.url().replace(base,'')}))
await page.coverage.startJSCoverage({resetOnNavigation:false})
async function sample(name){await page.waitForTimeout(2500);samples.push({stage:name,url:page.url().replace(base,''),metrics:(await cdp.send('Performance.getMetrics')).metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','JSEventListeners','TaskDuration','ScriptDuration'].includes(m.name)),dom:await cdp.send('Memory.getDOMCounters'),links:await page.locator('a').evaluateAll(a=>a.map(x=>({href:x.getAttribute('href'),text:x.textContent?.trim().slice(0,80)})))})}
try{
 await page.goto(base);await page.locator('a[href="/agents"]').waitFor({timeout:20000}).catch(()=>{});await sample(stage)
 for(const route of ['agents','knowledge']){stage=route;await page.locator(`a[href="/${route}"]`).first().click();await sample(stage)}
 stage='home-return';await page.locator('a[href="/"]').first().click();await sample(stage)
 stage='idle-home-35s';await page.waitForTimeout(35000);await sample(stage)
 const coverage=await page.coverage.stopJSCoverage();await Bun.write(out+'/coverage.json',JSON.stringify(coverage.filter(x=>typeof x.text==='string').map(x=>({url:x.url.replace(base,''),bytes:x.text.length,used:x.ranges.reduce((n,r)=>n+r.end-r.start,0)})),null,2))
} catch(e){errors.push({stage,message:String(e)});}finally{await Bun.write(out+'/browser-real.json',JSON.stringify({mode:'isolated real backend; empty database; no providers; external browser requests blocked',requests,responses,errors,workers,samples},null,2));await browser.close()}
console.log(JSON.stringify({requests:requests.length,errors,samples:samples.map(s=>({stage:s.stage,url:s.url,dom:s.dom})),workers}))
