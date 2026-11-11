// Isolated browser smoke check. Own browser profile/database; never uses the user's browser profile.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const instance=join(root,'instance');mkdirSync(instance,{recursive:true});
const temporary=mkdtempSync(join(instance,'browser-qa-'));
const verifiedTemporary=realpathSync(temporary);
if(!verifiedTemporary.startsWith(realpathSync(instance)+sep))throw Error('Temporary path outside workspace instance');
const freePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const port=await freePort(),debugPort=await freePort();
const base=`http://127.0.0.1:${port}`;
const server=spawn(join(root,'.venv','Scripts','python.exe'),['-m','uvicorn','backend.main:app','--host','127.0.0.1','--port',String(port),'--no-access-log'],{
  cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,DATABASE_URL:'sqlite:///'+join(temporary,'qa.sqlite3').replaceAll('\\','/'),REDIS_URL:'',ADMIN_TOKEN:'',TRAFFIC_FEED_URL:'',OLLAMA_URL:'',OLLAMA_MODEL:''}
});
let serverErrors='';server.stderr.on('data',chunk=>serverErrors+=chunk);
let browser,ws;const pending=new Map();let sequence=0;
async function ready(url,limit=15000){const end=Date.now()+limit;while(Date.now()<end){try{const response=await fetch(url);if(response.ok)return await response.json();}catch{}await new Promise(r=>setTimeout(r,150));}throw Error('Service not ready: '+url+' '+serverErrors.slice(-1000));}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(expression,limit=12000){const end=Date.now()+limit;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}const state=await evaluate(`({status:document.querySelector('.app-status')?.textContent,location:document.querySelector('.location-issue')?.textContent,origin:document.querySelector('.endpoints')?.textContent,nearest:document.querySelector('.nearby-panel .nearby-item strong')?.textContent,nearbyCount:document.querySelectorAll('.nearby-panel .nearby-item').length})`);throw Error('Browser condition timed out: '+expression+' '+JSON.stringify(state));}
const clickPage=label=>evaluate(`Array.from(document.querySelectorAll('.nav button')).find(x=>x.textContent.includes(${JSON.stringify(label)})).click()`);
const input=(id,value)=>evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);

try{
  await ready(base+'/api/health');
  const browserArgs=['--headless=new','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(temporary,'profile')}`,`--remote-debugging-port=${debugPort}`,'--window-size=1440,1000'];
  const proxyValue=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
  if(proxyValue){const proxy=new URL(proxyValue);if(!proxy.username&&!proxy.password)browserArgs.push('--proxy-server='+proxy.origin,'--proxy-bypass-list=localhost;127.0.0.1;[::1]');}
  browserArgs.push('about:blank');
  browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',browserArgs,{windowsHide:true,stdio:'ignore'});
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const target=await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(base)}`,{method:'PUT'}).then(r=>r.json());
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  const exceptions=[],tileResponses=[];
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);if(message.error)request.reject(Error(JSON.stringify(message.error)));else request.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params);if(message.method==='Network.responseReceived'&&message.params.response.url.startsWith('https://tile.openstreetmap.org/'))tileResponses.push(message.params.response.status);});
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await until(`document.querySelectorAll('.hospital-card').length>=40 && document.querySelectorAll('.hospital-map-marker').length>=40 && document.querySelector('.original-logo img')?.complete`);
  assert.equal(await evaluate(`document.querySelector('.original-logo img').naturalWidth>0`),true);
  const logo=await evaluate(`(()=>{const r=document.querySelector('.original-logo').getBoundingClientRect();return {width:r.width,height:r.height,left:r.left};})()`);
  assert(logo.width>100&&logo.width<=220&&logo.left>=0);
  const tilesDeadline=Date.now()+4000;while(Date.now()<tilesDeadline&&!tileResponses.length)await new Promise(r=>setTimeout(r,150));
  writeFileSync(join(instance,'preview-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  // Simulated GPS: an out-of-city fix must never become the origin.
  await call('Browser.grantPermissions',{origin:base,permissions:['geolocation']});
  await call('Emulation.setGeolocationOverride',{latitude:-23.5505,longitude:-46.6333,accuracy:10});
  await evaluate(`Array.from(document.querySelectorAll('.origin-card button')).find(e=>e.textContent.includes('Usar minha localização')).click()`);
  await until(`document.querySelector('.location-issue')?.textContent.includes('fora de Maceió')`);
  assert.equal(await evaluate(`document.querySelectorAll('.origin-map-marker').length`),0);
  const knownHospital=(await fetch(base+'/api/hospitals').then(r=>r.json())).find(p=>p.cnes&&p.routable!==false);
  await call('Emulation.setGeolocationOverride',{latitude:knownHospital.lat,longitude:knownHospital.lon,accuracy:10});
  await evaluate(`Array.from(document.querySelectorAll('.origin-card button')).find(e=>e.textContent.includes('Usar minha localização')).click()`);
  await until(`document.querySelector('.nearby-panel .nearby-item strong')?.textContent===${JSON.stringify(knownHospital.name)}&&document.querySelectorAll('.nearby-panel .nearby-item').length>3`);
  await evaluate(`Array.from(document.querySelectorAll('.nearby-panel button')).find(e=>e.textContent==='Ver ônibus').click()`);
  await until(`document.getElementById('bus-reference')?.value==='origin'&&document.querySelectorAll('.bus-stop-list .bus-card').length>0`);
  await evaluate(`document.querySelector('.bus-stop-list .bus-card .button-row button').click()`);
  await until(`document.querySelector('.bus-focused-marker')!==null&&!document.getElementById('clear-bus').disabled`);
  await evaluate(`document.getElementById('clear-bus').click()`);
  await until(`document.querySelector('.bus-focused-marker')===null&&document.getElementById('clear-bus').disabled`);
  // Controlled route responses verify profile switching and clear without live routing requests.
  await evaluate(`(()=>{window.__qaFetch=window.fetch.bind(window);window.fetch=async(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(url.pathname==='/api/routes'&&options?.method==='POST'){const body=JSON.parse(options.body);return new Response(JSON.stringify({provider:'Controlled browser test',routes:[{distance:100,duration:60,geometry:{type:'LineString',coordinates:[[body.origin.lon,body.origin.lat],[body.destination.lon,body.destination.lat]]},steps:[{instruction:'Siga até o destino',coordinate:[body.origin.lon,body.origin.lat],street:'Teste controlado',distance:100,duration:60}]}],warnings:[],explanation:'Teste controlado'}),{headers:{'Content-Type':'application/json'}});}if(url.pathname==='/api/search')return new Promise(resolve=>setTimeout(()=>resolve(new Response(JSON.stringify([{name:'Endereço de teste em Maceió',lat:-9.6498,lon:-35.7089}]),{headers:{'Content-Type':'application/json'}})),400));return window.__qaFetch(input,options);};})()`);
  await clickPage('Início');
  await evaluate(`document.querySelectorAll('.nearby-panel .nearby-item')[1].click()`);
  await evaluate(`Array.from(document.querySelectorAll('.route-planner>button')).find(e=>e.textContent.includes('Encontrar rotas')).click()`);
  await until(`document.querySelectorAll('.route-options button').length>0`);
  await evaluate(`document.querySelector('.route-comparison').open=true;Array.from(document.querySelectorAll('.route-comparison>button')).find(e=>e.textContent.includes('Comparar formas')).click()`);
  await until(`document.querySelectorAll('.comparison-card').length===6`);
  await evaluate(`Array.from(document.querySelectorAll('.comparison-card')).find(e=>e.querySelector('h3')?.textContent==='Bicicleta').querySelector('button').click()`);
  assert.equal(await evaluate(`document.getElementById('mode').value`),'bike');
  await evaluate(`document.getElementById('clear-planning').click()`);
  await until(`document.querySelector('.origin-map-marker')===null&&document.querySelector('.nearby-panel')===null&&document.querySelectorAll('.route-options button').length===0&&document.querySelectorAll('.comparison-card').length===0`);
  await call('Emulation.setGeolocationOverride',{latitude:knownHospital.lat+.001,longitude:knownHospital.lon,accuracy:10});
  await new Promise(r=>setTimeout(r,250));
  assert.equal(await evaluate(`document.querySelector('.origin-map-marker')===null`),true,'GPS must stay stopped after clear');
  await clickPage('Rotas');await input('query','Rua de teste');
  await evaluate(`document.getElementById('query').form.requestSubmit();document.getElementById('clear-planning').click()`);
  await new Promise(r=>setTimeout(r,650));
  assert.equal(await evaluate(`document.getElementById('query').value===''&&document.querySelectorAll('.results button').length===0`),true,'A late search result must not restore cleared planning');
  await evaluate(`window.fetch=window.__qaFetch;delete window.__qaFetch;`);
  await clickPage('Hospitais');
  await evaluate(`(()=>{const el=document.getElementById('facility-kind');el.value='upa';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelectorAll('.hospital-card').length>0&&document.querySelectorAll('.hospital-card').length<20`);
  await clickPage('Rotas');
  await evaluate(`(()=>{const el=document.getElementById('vehicle-profile');el.value='ambulance';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.vehicle-profile .check')!==null`);
  await evaluate(`Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('Assistente para')).parentElement.open=true`);
  await input('assistant','Quero ir ao HGE de ambulância');
  await evaluate(`document.getElementById('assistant').form.requestSubmit()`);
  await until(`document.querySelector('.endpoints').textContent.includes('GERAL DO ESTADO')&&document.getElementById('vehicle-profile').value==='ambulance'`);
  await clickPage('Ônibus');await until(`document.querySelectorAll('.bus-line-grid .bus-card').length>50`);
  const stats=await evaluate(`Array.from(document.querySelectorAll('.catalog-stats strong')).map(x=>Number(x.textContent))`);
  assert(stats[0]>=80&&stats[1]>=1300);
  await input('bus-query','104');await evaluate(`document.getElementById('bus-query').form.requestSubmit()`);
  await until(`document.querySelectorAll('.bus-line-grid .bus-card').length<10&&document.querySelector('.line-code')?.textContent==='104'`);
  await clickPage('Configurações');
  await evaluate(`Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('Administração')).parentElement.open=true`);
  await until(`document.querySelector('.admin-login button')?.textContent.includes('Acessar')`);
  await evaluate(`document.querySelector('.admin-login').requestSubmit()`);
  await until(`!document.querySelector('.admin-login')`);
  await evaluate(`Array.from(document.querySelectorAll('.admin-panel button')).find(e=>e.textContent==='Atualizar indicadores').click()`);
  await until(`document.querySelectorAll('.indicators dd').length>0`);
  await clickPage('Início');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(r=>setTimeout(r,500));
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=391`),true,'Mobile horizontal overflow');
  writeFileSync(join(instance,'preview-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.equal(exceptions.length,0,'Uncaught browser exceptions: '+JSON.stringify(exceptions));
  console.log(JSON.stringify({browser:'Edge headless',logo,lines:stats[0],stops:stats[1],map_tile_http_statuses:[...new Set(tileResponses)],checks:['simulated GPS outside Maceió rejected','nearest hospitals/stops from simulated local GPS','clear bus point','clear route/origin/GPS and late responses','vehicle/mode comparison','healthcare filter','ambulance declaration','local assistant','bus catalogue/search','local admin/indicators','desktop/mobile layout'],screenshots:['instance/preview-desktop.png','instance/preview-mobile.png']}));
}finally{
  if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
  browser?.kill();server.kill();
  await new Promise(r=>setTimeout(r,700));
  // Containment was verified above; this is only the profile/database created by this run.
  try{rmSync(verifiedTemporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{console.warn('QA temporary profile remains under instance.');}
}
