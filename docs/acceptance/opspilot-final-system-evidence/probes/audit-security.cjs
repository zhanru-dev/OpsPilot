require('reflect-metadata');
const {NestFactory}=require('@nestjs/core');
const {JwtService}=require('@nestjs/jwt');
const {ConfigService}=require('@nestjs/config');
const {AppModule}=require('./apps/api/dist/app.module');
const {configureApp}=require('./apps/api/dist/configure-app');
const {PrismaService}=require('./apps/api/dist/prisma/prisma.service');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 if(!new URL(process.env.DATABASE_URL).pathname.includes('final_audit_'))throw Error('Audit database only');
 const app=await NestFactory.create(AppModule,{logger:false});configureApp(app);await app.listen(0,'127.0.0.1');
 const db=app.get(PrismaService),api=await app.getUrl()+'/api/v1',w=randomUUID(),event=randomUUID(),ids=[],streams=[];
 const evidence={revision:'516f2a3',setup:'Owned workspace and staff fixtures; real password login. Authority mutations are explicit DB fixtures, not an invented role-management UI.',checks:[]};
 let cookie,adminCookie;
 async function call(path,method='GET',body,credential=cookie){const r=await fetch(api+path,{method,headers:{origin:process.env.WEB_ORIGIN,'content-type':'application/json',...(credential?{cookie:credential}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null,headers:r.headers};}
 async function login(email){const r=await call('/auth/login','POST',{email,password:'DemoPass123!'},'');if(r.status!==200)throw Error('Fixture login failed');return r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
 const observe=(name,expected,r)=>evidence.checks.push({name,expected,actual:r.status,result:expected.includes(r.status)?'PASS':'FAIL'});
 async function stream(credential){const abort=new AbortController();streams.push(abort);const r=await fetch(api+`/stream-events/${event}/live-session/stream`,{headers:{cookie:credential},signal:abort.signal});const observed={status:r.status,text:''};if(r.body){void(async()=>{try{for await(const bytes of r.body)observed.text+=Buffer.from(bytes).toString();}catch{}})();}return observed;}
 try{
 const template=await db.user.findFirstOrThrow({where:{email:'alex.morgan@opspilot.demo'}});
 await db.workspace.create({data:{id:w,name:'Final audit authorization fixture',slug:w}});
 for(const role of ['OPERATIONS_MANAGER','ADMIN']){const id=randomUUID();ids.push(id);await db.user.create({data:{id,email:id+'@audit.invalid',name:'Audit '+role,avatarInitials:'AU',passwordHash:template.passwordHash,memberships:{create:{workspaceId:w,role}}}});}
 cookie=await login(ids[0]+'@audit.invalid');adminCookie=await login(ids[1]+'@audit.invalid');
 await db.streamEvent.create({data:{id:event,workspaceId:w,title:'Audit private event',slug:event,description:'Owned fixture for revocation evidence',ownerId:ids[1],status:'LIVE',scheduledStart:new Date(),scheduledEnd:new Date(Date.now()+3600000),accessPolicy:{create:{mode:'PUBLIC',requiresConsent:false}},liveSession:{create:{workspaceId:w,startedById:ids[1]}}}});
 observe('valid staff event access',[200],await call(`/stream-events/${event}`));
 observe('foreign fixture event remains unavailable to seeded workspace',[404],await call(`/stream-events/${event}`,'GET',undefined,await login(template.email)));
 await db.workspaceMembership.update({where:{workspaceId_userId:{workspaceId:w,userId:ids[0]}},data:{role:'VIEWER'}});
 observe('demoted staff cannot edit event with previously issued cookie',[403],await call(`/stream-events/${event}`,'PATCH',{title:'Changed after role downgrade'}));
 observe('demoted staff cannot create poll with previously issued cookie',[403],await call(`/stream-events/${event}/live-polls`,'POST',{question:'Unauthorized stale role poll?',options:['One','Two']}));
 observe('demoted staff cannot write live operations',[403],await call(`/stream-events/${event}/live-session/updates`,'POST',{severity:'INFO',message:'Stale manager can still write'}));
 const fresh=await login(ids[0]+'@audit.invalid');observe('fresh viewer token rejects event edit',[403],await call(`/stream-events/${event}`,'PATCH',{title:'Denied fresh viewer'},fresh));
 observe('media evaluates current demoted role',[403],await call('/media-assets/uploads','POST',{name:'denied.mp4',kind:'VIDEO',contentType:'video/mp4',sizeBytes:100}));
 const topic=await call(`/stream-events/${event}/topics/context`);evidence.currentTopicsCapabilities=topic.body?.capabilities;
 const before=await stream(cookie);await delay(100);
 await db.workspaceMembership.delete({where:{workspaceId_userId:{workspaceId:w,userId:ids[0]}}});
 for(const [label,path] of [['workspace','/workspaces/current'],['events','/stream-events'],['live operations',`/stream-events/${event}/live-session`],['chat',`/stream-events/${event}/chat/context`],['topics',`/stream-events/${event}/topics/context`],['broadcast',`/stream-events/${event}/broadcast`],['media','/media-assets']])observe('removed member denied '+label,[401,403,404],await call(path));
 const marker='private-after-removal-'+randomUUID();observe('authorized operator publishes new private live update',[201],await call(`/stream-events/${event}/live-session/updates`,'POST',{severity:'INFO',message:marker},adminCookie));
 await delay(3400);evidence.checks.push({name:'existing SSE does not receive new private data after membership removal',expected:false,actual:before.text.includes(marker),result:before.text.includes(marker)?'FAIL':'PASS'});
 observe('logout returns normal contract',[204],await call('/auth/logout','POST'));
 observe('replayed logged-out cookie cannot read workspace',[401],await call('/workspaces/current'));
 observe('replayed logged-out cookie cannot read media',[401],await call('/media-assets'));
 observe('replayed logged-out refresh rejected',[401],await call('/auth/refresh','POST'));
 // Short-lived token for the otherwise legitimately authenticated admin fixture.
 const raw=adminCookie.split('; ').find(s=>s.startsWith('opspilot_access=')).split('=')[1];
 const payload=app.get(JwtService).decode(raw);delete payload.iat;delete payload.exp;
 const short=await app.get(JwtService).signAsync(payload,{secret:app.get(ConfigService).get('JWT_ACCESS_SECRET'),expiresIn:'2s'});
 const shortCookie='opspilot_access='+short,open=await stream(shortCookie);
 await delay(2400);observe('expired access JWT rejected on a new request',[401],await call('/workspaces/current','GET',undefined,shortCookie));
 const marker2='private-after-jwt-expiry-'+randomUUID();await call(`/stream-events/${event}/live-session/updates`,'POST',{severity:'INFO',message:marker2},adminCookie);await delay(3400);
 evidence.checks.push({name:'open SSE stops delivering newly authored data after JWT expiry',expected:false,actual:open.text.includes(marker2),result:open.text.includes(marker2)?'FAIL':'PASS',fixture:'same verified admin identity, test-signed two-second JWT; new REST request returned 401'});
 observe('write from foreign Origin rejected',[403],{status:(await fetch(api+`/stream-events/${event}/live-session/updates`,{method:'POST',headers:{cookie:adminCookie,origin:'https://foreign.invalid','content-type':'application/json'},body:JSON.stringify({severity:'INFO',message:'Origin bypass probe'})})).status});

 // Real issued refresh cookies, no forged identity or clock mocking.
 await delay(1100);
 const rotation=await call('/auth/refresh','POST',undefined,adminCookie);
 const onceCookie=rotation.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const replay1=await call('/auth/refresh','POST',undefined,onceCookie);
 const replay2=await call('/auth/refresh','POST',undefined,onceCookie);
 observe('refresh receipt should become single-use after a successful rotation',[401],replay2);
 const extract=x=>x.split('; ').find(y=>y.startsWith('opspilot_refresh='));
 const afterCookie=replay1.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 evidence.refreshRotation={firstStatus:rotation.status,secondStatus:replay1.status,replayedSecondStatus:replay2.status,tokenChanged:extract(onceCookie)!==extract(afterCookie),method:'Real password login; refresh, then immediately reuse the just-rotated refresh cookie. No token value recorded.'};
 fs.writeFileSync('../security-results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }finally{for(const s of streams)s.abort();await db.workspace.deleteMany({where:{id:w}});await db.user.deleteMany({where:{id:{in:ids}}});await app.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
