require('reflect-metadata');
const {NestFactory}=require('@nestjs/core'),{AppModule}=require('./apps/api/dist/app.module'),{configureApp}=require('./apps/api/dist/configure-app'),{PrismaService}=require('./apps/api/dist/prisma/prisma.service');
const {randomUUID}=require('node:crypto'),fs=require('node:fs');
(async()=>{
 if(!new URL(process.env.DATABASE_URL).pathname.includes('final_audit_'))throw Error('audit database only');
 const app=await NestFactory.create(AppModule,{logger:false});configureApp(app);await app.listen(0,'127.0.0.1');const db=app.get(PrismaService),url=await app.getUrl()+'/api/v1',w=randomUUID(),e=randomUUID(),users=[randomUUID(),randomUUID()],cookies=[];
 const evidence={fixture:'Two distinct normally authenticated operators in one owned event. Pending roots are explicit DB moderation fixtures after normal REST creation.',checks:[]};
 async function call(p,method='GET',body,who=0){const r=await fetch(url+p,{method,headers:{cookie:cookies[who]||'',origin:process.env.WEB_ORIGIN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null),headers:r.headers};}
 const base=`/stream-events/${e}/topics`;let n=0;
 async function create(){const r=await call(base,'POST',{clientOperationId:randomUUID(),text:'Audit moderation race '+(++n)});if(r.status!==201)throw Error('Create '+r.status);return r.body.topic;}
 function record(name,expected,actual){evidence.checks.push({name,expected,actual,result:JSON.stringify(expected)===JSON.stringify(actual)?'PASS':'FAIL'});}
 try{
 const template=await db.user.findFirstOrThrow({where:{email:'alex.morgan@opspilot.demo'}});await db.workspace.create({data:{id:w,name:'Audit topic race fixture',slug:w}});
 for(const id of users){await db.user.create({data:{id,email:id+'@audit.invalid',name:'Audit moderator',avatarInitials:'AM',passwordHash:template.passwordHash,memberships:{create:{workspaceId:w,role:'ADMIN'}}}});const l=await call('/auth/login','POST',{email:id+'@audit.invalid',password:'DemoPass123!'});cookies.push(l.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '));}
 await db.streamEvent.create({data:{id:e,workspaceId:w,title:'Audit concurrent moderation',slug:e,description:'Owned data for concurrent operator requests',status:'READY',scheduledStart:new Date(),scheduledEnd:new Date(Date.now()+3600000)}});
 const root=await create();await db.eventTopic.update({where:{id:root.id},data:{status:'PENDING'}});const before=(await db.streamEvent.findUnique({where:{id:e}})).topicSequence;
 const approvals=await Promise.all(cookies.map((_,i)=>call(base+'/'+root.id+'/approve','POST',{expectedVersion:root.version},i)));record('two moderator approval receipts',[201,201],approvals.map(x=>x.status));record('approval increments event revision once',1,(await db.streamEvent.findUnique({where:{id:e}})).topicSequence-before);
 for(let i=0;i<6;i++){const row=await create();await db.eventTopic.update({where:{id:row.id},data:{status:'PENDING'}});const operations=[()=>call(base+'/'+row.id+'/approve','POST',{expectedVersion:row.version},0),()=>call(base+'/'+row.id,'DELETE',{expectedVersion:row.version},1)];if(i%2)operations.reverse();const result=await Promise.all(operations.map(f=>f()));const stored=await db.eventTopic.findUnique({where:{id:row.id}});record('approval/delete race '+i+' has one committed mutation',1,result.filter(x=>x.status>=200&&x.status<300).length);record('approval/delete race '+i+' preserves valid root',true,stored.deletedAt?stored.text===null:stored.status==='APPROVED');}
 fs.writeFileSync('../topic-race-results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }finally{await db.workspace.delete({where:{id:w}});await db.user.deleteMany({where:{id:{in:users}}});await app.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
