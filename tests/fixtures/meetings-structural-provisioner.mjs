// Local fixture page only: never navigates to Google, Meet, or any external domain.
import { createServer } from 'node:http';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { RecorderProvisioningHost } from '../../dist/infrastructure/meetings/recorder-provisioning-host.js';
import { PostgresMeetingRepository } from '../../dist/infrastructure/storage/postgres/postgres-meeting-repository.js';
import { encryptSecret } from '../../dist/infrastructure/crypto/secret-cipher.js';

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const database=(await pool.query('select current_database() as name')).rows[0].name;
if(!database.startsWith('vorix_structural_fixture_'))throw new Error('Fixture database required');
const metrics={opened:0,closed:0,active:0,inputs:0,externalRequestsBlocked:0,healthChecks:0};
const config={healthOk:true};
const html=`<!doctype html><html lang="pt-BR"><style>body{font:22px Arial;padding:50px;background:#f0f4ff}label,input,button{display:block;margin:15px 0}input{height:40px;width:380px}button{height:50px;width:380px}</style><h1>SIMULADOR LOCAL — SOMENTE FIXTURES</h1><p>Nenhuma conexão com Google ou Meet.</p><form><label>Senha fictícia<input id="password" type="password"></label><label>MFA fictício<input id="mfa" type="password"></label><button id="submit">Concluir login fictício</button></form><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.body.dataset.complete='yes';document.body.insertAdjacentHTML('beforeend','<p id="success">Fixture validada</p>')};</script></html>`;
const control=createServer(async(req,res)=>{
  res.setHeader('Content-Type',req.url==='/login'?'text/html':'application/json');
  if(req.url==='/login')return res.end(html);
  if(req.url==='/metrics')return res.end(JSON.stringify({...metrics,healthOk:config.healthOk}));
  if(req.url==='/health/fail'&&req.method==='POST'){config.healthOk=false;return res.end('{}');}
  if(req.url==='/health/pass'&&req.method==='POST'){config.healthOk=true;return res.end('{}');}
  res.statusCode=404;res.end('{}');
});
await new Promise(resolve=>control.listen(3310,'0.0.0.0',resolve));
const browsers={async open({loginHint}){
  if(!loginHint.endsWith('.invalid'))throw new Error('Only fictitious .invalid accounts allowed');
  const browser=await chromium.launch({headless:true,executablePath:process.env.MEETINGS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1024,height:720}});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1'&&url.port==='3310')return route.continue();
    metrics.externalRequestsBlocked++;return route.abort();
  });
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:3310/login');
  await page.locator('#password').focus();
  metrics.opened++;metrics.active++;
  const listeners=[];
  let lastFrame;
  let closed=false;
  const frames=setInterval(async()=>{
    if(closed)return;
    const jpeg=await page.screenshot({type:'jpeg',quality:55}).catch(()=>undefined);
    if(!jpeg||closed)return;
    lastFrame={jpeg,width:1024,height:720};for(const listener of listeners)listener(lastFrame);
  },150);
  return {
    onFrame(listener){listeners.push(listener);if(lastFrame)listener(lastFrame)},
    async dispatch(event){
      metrics.inputs++;
      if(event.t==='text')await page.keyboard.insertText(event.v);
      else if(event.t==='key')await page.keyboard[event.a](event.key);
      else if(event.t==='mouse'){await page.mouse.move(event.x,event.y);if(event.a==='down')await page.mouse.down({button:event.b??'left'});if(event.a==='up')await page.mouse.up({button:event.b??'left'});}
      else if(event.t==='wheel')await page.mouse.wheel(event.dx??0,event.dy);
    },
    async detect(){return {loggedIn:await page.locator('#success').count()>0,email:loginHint};},
    async storageState(){return JSON.stringify({cookies:[{name:'fixture_sid',value:`fixture-${Date.now()}`,domain:'.fixture.invalid',path:'/'}],origins:[]});},
    async close(){if(closed)return;closed=true;clearInterval(frames);listeners.length=0;lastFrame=undefined;await context.close();await browser.close();metrics.closed++;metrics.active--;},
  };
}};
const host=new RecorderProvisioningHost({repository:new PostgresMeetingRepository(pool),browsers,healthCheck:{async check(){metrics.healthChecks++;return {ok:config.healthOk,...(config.healthOk?{}:{reason:'redirect_login'}),details:{finalHost:'fixture.invalid'}};}},encryptSession:s=>encryptSecret(s,process.env.JWT_SECRET),workerId:'structural-fixture-provisioner',now:()=>new Date(),pollMs:50,viewerGraceMs:2000}, {port:7088,host:'0.0.0.0',publicEndpoint:'ws://vorix-structural-fixture-provisioner:7088',masterSecret:process.env.JWT_SECRET,maxConcurrent:2});
await host.start();
let ticking=false;
const timer=setInterval(()=>{if(ticking)return;ticking=true;host.tick().catch(()=>console.error('FIXTURE_TICK_FAILED')).finally(()=>ticking=false)},100);
console.log('FIXTURE_ONLY_PROVISIONER_READY');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void(async()=>{clearInterval(timer);await host.stop();await new Promise(resolve=>control.close(resolve));await pool.end();process.exit(0)})());
