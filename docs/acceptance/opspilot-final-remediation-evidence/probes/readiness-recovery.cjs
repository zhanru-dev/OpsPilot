// Diagnostic for the owned final-audit infrastructure only. Never targets shared services.
const {spawn, execFileSync} = require('node:child_process');
const {openSync,closeSync,writeFileSync} = require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const db=new URL(process.env.DATABASE_URL);
assert.equal(db.port,'5549');assert.equal(db.pathname,'/opspilot_final_audit_20261103_test');
assert.equal(process.env.API_PORT,'4225');
const base='http://127.0.0.1:4225/api/v1/health';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchTimed(kind){let start=performance.now();let r=await fetch(base+'/'+kind,{signal:AbortSignal.timeout(5000)});return {status:r.status,ms:Math.round(performance.now()-start),body:await r.json()}}
async function ready(){for(let i=0;i<60;i++){try{if((await fetchTimed('ready')).status===200)return}catch{}await delay(500)}throw Error('Readiness did not recover')}
(async()=>{
try{await fetch(base+'/live',{signal:AbortSignal.timeout(400)});throw Error('Refusing to use an existing API')}catch(e){if(e.message==='Refusing to use an existing API')throw e}
const log=openSync(path.resolve('../logs/readiness-api.log'),'a',0o600);
const child=spawn(process.execPath,['apps/api/dist/main.js'],{stdio:['ignore',log,log],env:process.env});
const results=[];let paused;
try{
await ready();
for(const [service,key] of [['redis','queues'],['postgres','database'],['minio','objectStorage']]){
 const name='opspilot-final-audit-20261103-'+service;
 execFileSync('docker',['pause',name],{stdio:'ignore'});paused=name;
 try{
  const burst=await Promise.all(Array.from({length:20},()=>fetchTimed('ready')));
  assert(burst.every(r=>r.status===503 && r.body.dependencies[key]==='down'));
  assert(Math.max(...burst.map(r=>r.ms))<2500);
  const live=await fetchTimed('live');assert.equal(live.status,200);assert(live.ms<1000);
  const second=await fetchTimed('ready');assert.equal(second.status,503);assert(second.ms<2500);
  results.push({service,requests:21,minMs:Math.min(...burst.map(r=>r.ms)),maxMs:Math.max(...burst.map(r=>r.ms)),secondMs:second.ms,livenessMs:live.ms,down:true});
 }finally{execFileSync('docker',['unpause',name],{stdio:'ignore'});paused=undefined}
 let start=performance.now();await ready();results.at(-1).recoveryMs=Math.round(performance.now()-start);
}
writeFileSync(path.resolve('../readiness-results.json'),JSON.stringify({workload:'20 simultaneous requests, then one further request for each paused owned dependency; 1000ms probe deadline',results},null,2));
console.log(JSON.stringify(results));
}finally{
 if(paused)execFileSync('docker',['unpause',paused],{stdio:'ignore'});
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(5000)]);if(child.exitCode===null)child.kill('SIGKILL');closeSync(log);
}
})().catch(e=>{console.error(e.message);process.exitCode=1});
