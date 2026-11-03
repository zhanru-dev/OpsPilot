// Audit-only failure injection. Hard stop unless every dependency is the private run.
require('reflect-metadata');
const {NestFactory}=require('@nestjs/core');
const {AppModule}=require('./apps/api/dist/app.module');
const {WorkerModule}=require('./apps/api/dist/worker.module');
const {configureApp}=require('./apps/api/dist/configure-app');
const {PrismaService}=require('./apps/api/dist/prisma/prisma.service');
const {StorageService}=require('./apps/api/dist/infrastructure/storage/storage.service');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {randomUUID,createHash}=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const run=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
const owned='opspilot-final-audit-20261103-';
const evidence={checks:[],workload:'One owned staff/event fixture, real H264 upload; bounded dependency outages and persisted idempotency; no shared service changed.'};
async function check(name,actual,expected){evidence.checks.push({name,actual,expected,result:actual===expected?'PASS':'FAIL'});await fs.writeFile('../infrastructure-results.json',JSON.stringify(evidence,null,2));}
async function docker(action,kind){if(!['postgres','redis','minio'].includes(kind))throw Error('not audit owned');await run('docker',[action,owned+kind]);}
async function until(fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return true;}catch{}await delay(200);}return false;}
(async()=>{
 if(!new URL(process.env.DATABASE_URL).pathname.includes('final_audit_')||new URL(process.env.S3_ENDPOINT).port!=='9010'||new URL(process.env.REDIS_URL).port!=='6407')throw Error('Audit environment required');
 const app=await NestFactory.create(AppModule,{logger:false});configureApp(app);await app.listen(0,'127.0.0.1');const db=app.get(PrismaService),storage=app.get(StorageService),base=await app.getUrl()+'/api/v1';
 let worker,cookie='';const w=randomUUID(),u=randomUUID(),e=randomUUID(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'final-audit-fault-'));
 async function call(p,body,timeout=15000){const r=await fetch(base+p,{method:body===undefined?'GET':'POST',headers:{origin:process.env.WEB_ORIGIN,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});return {status:r.status,body:await r.json().catch(()=>null),headers:r.headers};}
 try{
 const template=await db.user.findFirstOrThrow({where:{email:'alex.morgan@opspilot.demo'}});await db.workspace.create({data:{id:w,name:'Audit dependency fault fixture',slug:w}});await db.user.create({data:{id:u,email:u+'@audit.invalid',name:'Audit fault operator',avatarInitials:'AF',passwordHash:template.passwordHash,memberships:{create:{workspaceId:w,role:'ADMIN'}}}});await db.streamEvent.create({data:{id:e,workspaceId:w,ownerId:u,title:'Audit dependency faults',slug:e,description:'Owned disposable fault fixture',status:'LIVE',scheduledStart:new Date(),scheduledEnd:new Date(Date.now()+3600000),accessPolicy:{create:{mode:'PUBLIC'}},liveSession:{create:{workspaceId:w,startedById:u}}}});
 const login=await call('/auth/login',{email:u+'@audit.invalid',password:'DemoPass123!'});cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const op={clientMessageId:randomUUID(),text:'Persist through PG and queue restarts'};await check('initial canonical chat send',(await call(`/stream-events/${e}/chat/messages`,op)).status,201);
 await docker('pause','postgres');let pgInterrupted=false;try{await call(`/stream-events/${e}/chat/messages`,undefined,1200);}catch{pgInterrupted=true;}finally{await docker('unpause','postgres');}await check('PG unavailability observed as client timeout',pgInterrupted,true);
 await check('PG recovers without API process restart',await until(async()=>(await call(`/stream-events/${e}/chat/context`)).status===200),true);
 await docker('restart','postgres');await check('PG volume persists messages after restart',await until(async()=>(await call(`/stream-events/${e}/chat/messages`,op)).status===201),true);await check('retry keeps one canonical persisted message',await db.eventChatMessage.count({where:{eventId:e,clientMessageId:op.clientMessageId}}),1);
 await docker('pause','redis');let redisTimed=false;try{await call(`/stream-events/${e}/chat/ticket`,{},1200);}catch{redisTimed=true;}finally{await docker('unpause','redis');}await check('Redis outage interrupts ticket issue',redisTimed,true);await check('Redis resume permits fresh authenticated tickets',await until(async()=>(await call(`/stream-events/${e}/chat/ticket`,{})).status===201),true);

 await docker('pause','redis');const unavailableAt=Date.now();let healthOutcome;
 try{healthOutcome=(await call('/health/ready',undefined,6000)).status;}catch{healthOutcome='no response before 6000ms client deadline';}finally{await docker('unpause','redis');}
 evidence.readinessOutage={dependency:'Redis paused',elapsedMs:Date.now()-unavailableAt,outcome:healthOutcome,source:'HealthService.readiness Promise.allSettled has no deadline; BullMQ connection maxRetriesPerRequest=null'};
 await fs.writeFile('../infrastructure-results.json',JSON.stringify(evidence,null,2));
 await docker('restart','redis');await check('Redis process restart reconnects clients',await until(async()=>(await call('/health/ready')).status===200),true);
 const file=path.join(dir,'source.mp4');await run(require('ffmpeg-static'),['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',file]);const bytes=await fs.readFile(file),hash=createHash('sha256').update(bytes).digest('hex');
 const init=await call('/media-assets/multipart',{clientOperationId:randomUUID(),name:'Audit physical outage media',kind:'VIDEO',contentType:'video/mp4',sizeBytes:bytes.length,hashes:[hash]});await check('owned real upload session',(init.status),201);const receipt=init.body,uploadBase=`/media-assets/multipart/${receipt.id}`;const grant=(await call(uploadBase+'/parts/1',{})).body;
 await docker('pause','minio');let storeInterrupted=false;try{await fetch(grant.url,{method:'PUT',headers:grant.headers,body:bytes,signal:AbortSignal.timeout(1200)});}catch{storeInterrupted=true;}finally{await docker('unpause','minio');}await check('MinIO outage interrupts actual part bytes',storeInterrupted,true);
 await check('same part succeeds after MinIO resume',(await fetch(grant.url,{method:'PUT',headers:grant.headers,body:bytes,signal:AbortSignal.timeout(10000)})).status,200);await check('confirmed part after retry',(await call(uploadBase+'/parts/1/confirm',{})).status,201);
 await check('one completion after transport failure',(await call(uploadBase+'/complete',{})).status,201);
 worker=await NestFactory.createApplicationContext(WorkerModule,{logger:false});await check('real BullMQ and FFmpeg reach READY after dependency restarts',await until(async()=>(await db.mediaAsset.findUnique({where:{id:receipt.assetId}}))?.status==='READY',60000),true);
 await docker('restart','minio');await check('MinIO comes back with stored objects',await until(async()=>{await storage.checkHealth();return true}),true);const asset=await db.mediaAsset.findUniqueOrThrow({where:{id:receipt.assetId}});const saved=path.join(dir,'saved.mp4');await storage.downloadToFile(asset.originalObjectKey,saved);await check('SHA256 survives MinIO restart',createHash('sha256').update(await fs.readFile(saved)).digest('hex'),hash);await check('one durable media processing job',await db.mediaProcessingJob.count({where:{mediaId:asset.id}}),1);await check('two derivatives registered',await db.mediaVariant.count({where:{mediaId:asset.id}}),2);
 await check('all dependency readiness restored',(await call('/health/ready')).status,200);
 console.log(JSON.stringify(evidence));
 }finally{for(const kind of ['postgres','redis','minio']){await run('docker',['unpause',owned+kind]).catch(()=>{});await run('docker',['start',owned+kind]).catch(()=>{});}if(worker)await worker.close();await app.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e.name+': '+String(e.message).slice(0,240));process.exitCode=1});
