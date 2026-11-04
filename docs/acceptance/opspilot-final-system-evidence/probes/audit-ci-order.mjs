import {rename,writeFile,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const original='apps/api/dist',saved='apps/api/dist.audit-saved';
await access(original);await rename(original,saved);
let code;
try{
 let resolution='unexpected';try{require.resolve('../apps/api/dist/app.module')}catch(e){resolution=e.code;}
 const child=spawn(process.execPath,['../run.mjs','ci-clean-api-order','npm','run','test:e2e','--workspace=@opspilot/api','--','--runInBand','media-restart.e2e-spec'],{stdio:'inherit'});
 code=await new Promise(r=>child.on('exit',r));
 await writeFile('../ci-order-results.json',JSON.stringify({compiledApiExistsBeforeTest:false,requireResolution:resolution,integrationExitCode:code,workflow:'.github/workflows/ci.yml quality: test:e2e before build',applicationUnchanged:true,method:'Only generated API dist temporarily moved in ignored audit copy; original test and assertions unchanged; compiled files restored in finally.'},null,2));
}finally{await rename(saved,original);}
console.log(JSON.stringify({cleanBuildOrderTestExit:code,compiledBuildRestored:true}));
