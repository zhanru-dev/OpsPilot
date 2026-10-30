import { spawnSync } from 'node:child_process';
function run(command,args,capture=false){const result=spawnSync(command,args,{stdio:capture?'pipe':'inherit',encoding:'utf8'});if(result.status!==0)throw new Error(`Setup step failed: ${command}`);return result.stdout?.trim();}
run('docker',['compose','-f','docker-compose.chat-test.yml','up','-d','--wait','postgres','minio','mailpit']);
const exists=run('docker',['exec','opspilot-chat-test-postgres-1','psql','-U','opspilot','-d','postgres','-tAc',"SELECT 1 FROM pg_database WHERE datname='opspilot_broadcast_test'"],true)==='1';
if(!exists)run('docker',['exec','opspilot-chat-test-postgres-1','createdb','-U','opspilot','opspilot_broadcast_test']);
const redis=spawnSync('docker',['inspect','opspilot-broadcast-test-redis'],{stdio:'ignore'});
if(redis.status===0)run('docker',['start','opspilot-broadcast-test-redis']);else run('docker',['run','-d','--name','opspilot-broadcast-test-redis','-p','127.0.0.1:6394:6379','redis:7.4.10-alpine']);
run('node',['scripts/with-broadcast-env.mjs','npm','run','db:deploy']);
if(!exists)run('node',['scripts/with-broadcast-env.mjs','npm','run','db:seed']);
run('node',['scripts/with-broadcast-env.mjs','docker','compose','-p','opspilot-broadcast-test','-f','docker-compose.broadcast.yml','up','-d']);
console.log('Isolated broadcast services prepared. Existing database was not reseeded.');
