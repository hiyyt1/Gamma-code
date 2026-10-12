import os,sys,json,time,subprocess,urllib.request,base64,signal,socket
from pathlib import Path
root=Path('/home/nikita/menti/mvp_platform'); out=Path('/tmp/gamma-legacy-audit'); bun='/home/nikita/.bun/bin/bun'
for port in (46408,46456):
 with socket.socket() as s:s.bind(('127.0.0.1',port))
env={'PATH':'/home/nikita/.bun/bin:/usr/local/bin:/usr/bin:/bin','HOME':str(out/'home'),'USER':'gamma-audit','LANG':'C.UTF-8','OPENCODE_DISABLE_MODELS_FETCH':'1','OPENCODE_DISABLE_AUTOUPDATE':'1','OPENCODE_PURE':'1','OPENCODE_DISABLE_PROJECT_CONFIG':'1','OPENCODE_SERVER_USERNAME':'audit','OPENCODE_SERVER_PASSWORD':'isolated-audit-backend-not-a-real-secret','GAMMA_PUBLIC_ORIGIN':'http://localhost:46456','GAMMA_WEB_PORT':'46456','GAMMA_BACKEND_URL':'http://127.0.0.1:46408','GAMMA_WEB_ROOT':str(out/'dist'),'GAMMA_AUTH_CONFIG':str(out/'auth.json'),'GAMMA_TRUST_PROXY':'0'}
for k,d in [('XDG_DATA_HOME','data'),('XDG_CONFIG_HOME','config'),('XDG_STATE_HOME','state'),('XDG_CACHE_HOME','cache'),('GAMMA_WORKSPACES_ROOT','workspaces'),('GAMMA_KNOWLEDGE_ROOT','knowledge')]:
 env[k]=str(out/d);(out/d).mkdir(exist_ok=True)
(out/'home').mkdir(exist_ok=True)
config=out/'config.json';config.write_text(json.dumps({'autoupdate':False,'share':'disabled','plugin':[]}));env['OPENCODE_CONFIG']=str(config)
subprocess.run([bun,'-e','await Bun.write(process.env.GAMMA_AUTH_CONFIG,JSON.stringify({username:"audit",passwordHash:await Bun.password.hash("isolated-audit-password",{algorithm:"argon2id",memoryCost:65536,timeCost:3})}))'],env=env,check=True);os.chmod(out/'auth.json',0o600)
auth='Basic '+base64.b64encode((env['OPENCODE_SERVER_USERNAME']+':'+env['OPENCODE_SERVER_PASSWORD']).encode()).decode()
def get(p='/global/health'):
 with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:46408'+p,headers={'Authorization':auth}),timeout=2) as r:return r.status,json.load(r)
def stats(pid):
 status=Path(f'/proc/{pid}/status').read_text();return {k:next((l.split(':',1)[1].strip() for l in status.splitlines() if l.startswith(k+':')),None) for k in ['VmRSS','VmHWM','Threads']}
results=[];processes=[]
try:
 for i in range(3):
  env['OPENCODE_DB']=str(out/f'run-{i}.db');started=time.perf_counter()
  log=open(out/f'backend-{i}.log','w');p=subprocess.Popen([bun,'run','./src/index.ts','--print-logs','serve','--hostname','127.0.0.1','--port','46408'],cwd=root/'packages/opencode',env=env,stdout=log,stderr=log,start_new_session=True);processes.append(p)
  while time.perf_counter()-started<45:
   try:response=get();break
   except Exception:
    if p.poll() is not None:raise RuntimeError('backend failed')
    time.sleep(.025)
  else:raise RuntimeError('startup timeout')
  ready=(time.perf_counter()-started)*1000;time.sleep(1);sample=stats(p.pid)
  s0=Path(f'/proc/{p.pid}/stat').read_text().split();t0=time.perf_counter();time.sleep(3);s1=Path(f'/proc/{p.pid}/stat').read_text().split()
  cpu=(int(s1[13])+int(s1[14])-int(s0[13])-int(s0[14]))/os.sysconf('SC_CLK_TCK')/(time.perf_counter()-t0)*100
  results.append({'run':i,'readyMs':ready,'stats':sample,'idleCpuPercentOneCore':cpu,'pid':p.pid})
  if i<2:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=10)
 (out/'runtime.json').write_text(json.dumps({'environment':env,'runs':results},indent=2))
 log=open(out/'gateway.log','w');start=time.perf_counter();g=subprocess.Popen([bun,'run','deploy/web.ts'],cwd=root,env=env,stdout=log,stderr=log,start_new_session=True);processes.append(g)
 while time.perf_counter()-start<15:
  try:
   with urllib.request.urlopen('http://localhost:46456/login',timeout=1) as r:
    if r.status==200:break
  except Exception:time.sleep(.025)
 gateway={'readyMs':(time.perf_counter()-start)*1000,'stats':stats(g.pid),'pid':g.pid}
 (out/'gateway-runtime.json').write_text(json.dumps(gateway,indent=2))
 print(json.dumps({'backend':results,'gateway':gateway}),flush=True)
 while not (out/'stop-runtime').exists():time.sleep(.5)
finally:
 for p in reversed(processes):
  if p.poll() is None:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
