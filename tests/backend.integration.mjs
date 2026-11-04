/** Actual API integration tests against SQLite with a small D1 adapter.
 * Run: node tests/backend.integration.mjs
 * No external requests, production records or messages are sent.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
for(const file of (await readdir(resolve('drizzle'))).filter(x=>x.endsWith('.sql')).sort())database.exec(await readFile(resolve('drizzle',file),'utf8'));
class Statement {constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return database.prepare(this.sql).get(...this.args)||null;}async all(){const results=database.prepare(this.sql).all(...this.args);return {results,success:true,meta:{changes:database.prepare('SELECT changes() n').get().n}};}async run(){const result=database.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(result.changes)}};}}
const d1={prepare(sql){return new Statement(sql);},async batch(statements){database.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};
globalThis.__nightshiftTestEnv={DB:d1,SETUP_TOKEN:'test-setup-key-0123456789',SITE_URL:'https://nightshift.example.com'};
const folder=await mkdtemp(join(tmpdir(),'nightshift-api-test-'));
try {
 for(const file of (await readdir(resolve('lib'))).filter(x=>x.endsWith('.ts'))){let source=await readFile(resolve('lib',file),'utf8');source=source.replace("import { env, waitUntil } from 'cloudflare:workers';","const env = globalThis.__nightshiftTestEnv; const waitUntil = (promise) => void promise;");let output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;output=output.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");await writeFile(join(folder,file.replace(/\.ts$/,'.mjs')),output);}
 const {dispatch}=await import(pathToFileURL(join(folder,'api.mjs')).href);
 const origin='https://nightshift.example.com';
 async function call(path,{method='GET',body,cookie,owner=false,automationKey,csrf=true}={}){const headers={};if(body!==undefined)headers['content-type']='application/json';if(method!=='GET'&&csrf)headers.origin=origin;if(cookie)headers.cookie=cookie;if(owner){headers['oai-authenticated-user-id']='trusted-owner';headers['oai-authenticated-user-email']='owner@example.com';}if(automationKey)headers['X-Automation-Key']=automationKey;const response=await dispatch(new Request(origin+'/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}));const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers.get('set-cookie')||''};}
 let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++;};
 check((await call('health')).status===200,'Health endpoint responds.');
 const boot0=(await call('bootstrap')).data;check(boot0.configured===false&&boot0.setupKeyRequired===true,'Fresh deployment requires setup key.');
 check((await call('auth/setup',{method:'POST',body:{name:'Owner',email:'owner@example.com',password:'A-strong-test-password'}})).status===403,'Setup without key rejected.');
 check((await call('auth/setup',{method:'POST',body:{name:'Owner',email:'owner@example.com',password:'A-strong-test-password',setupKey:'wrong-key-0000000000'}})).status===403,'Setup with wrong key rejected.');
 const setup=await call('auth/setup',{method:'POST',body:{name:'Owner',email:'owner@example.com',password:'A-strong-test-password',companyName:'Cab Test Company',setupKey:'test-setup-key-0123456789'}});check(setup.status===201,'Setup key creates first admin.');check(setup.cookie&&/Secure/.test(setup.headers),'HTTPS session cookie is Secure.');let admin=setup.cookie;
 check((await call('auth/setup',{method:'POST',body:{setupKey:'test-setup-key-0123456789'}})).status===409,'Bootstrap cannot be repeated.');
 check((await call('dashboard')).status===401,'Dashboard rejects anonymous.');
 check((await call('admin/settings',{method:'PUT',cookie:admin,csrf:false,body:{companyName:'Bad'}})).status===403,'Writes reject absent origin.');
 const updated=await call('admin/settings',{method:'PUT',cookie:admin,body:{adminEmails:['ops@example.com'],sosEmails:['security@example.com'],teamsTeamId:'team-guid',teamsChannelId:'channel-guid'}});check(updated.status===200,'Admin config persists.');
 const created=await call('admin/employees',{method:'POST',cookie:admin,body:{name:'Employee One',employeeCode:'E001',email:'employee@example.com',phone:'+919876543210',department:'Support',password:'Temporary-test-123'}});check(created.status===201,'Employee provisioned.');
 const login=await call('auth/login',{method:'POST',body:{login:'E001',password:'Temporary-test-123'}});check(login.status===200&&login.data.me.mustChangePassword,'Employee login requires password reset.');let employee=login.cookie;
 check((await call('employee',{cookie:employee})).status===403,'Temporary password cannot record trips.');
 const changed=await call('auth/password',{method:'POST',cookie:employee,body:{currentPassword:'Temporary-test-123',newPassword:'Private-employee-password'}});check(changed.status===200,'Employee changes password.');employee=changed.cookie;
 check((await call('dashboard',{cookie:employee})).status===403,'Employee cannot access admin.');
 const tripId=crypto.randomUUID(),boardKey=crypto.randomUUID();const boardBody={eventId:boardKey,type:'board',direction:'office_to_home',tripId,location:{status:'denied'},deviceTime:'2026-10-29T19:30:00Z'};
 const board=await call('trips/events',{method:'POST',cookie:employee,body:boardBody});check(board.status===201&&board.data.trip.id===tripId,'Offline client trip ID honored.');check(board.data.event.location.status==='denied','Permission denial does not block event.');
 const duplicate=await call('trips/events',{method:'POST',cookie:employee,body:boardBody});check(duplicate.data.duplicate===true,'Retry returns original persisted event.');check(database.prepare('SELECT COUNT(*) n FROM events').get().n===1,'Retry does not duplicate audit event.');check(database.prepare('SELECT COUNT(*) n FROM notifications').get().n===2,'Retry does not duplicate channel jobs.');
 check((await call('trips/events',{method:'POST',cookie:employee,body:{...boardBody,eventId:crypto.randomUUID(),tripId:crypto.randomUUID()}})).status===409,'One active trip enforced.');
 const arrived=await call('trips/events',{method:'POST',cookie:employee,body:{eventId:crypto.randomUUID(),type:'arrive',tripId,location:{status:'available',lat:21.46,lng:80.19,accuracy:15}}});check(arrived.status===201&&arrived.data.trip.status==='completed','Arrival completes active trip.');
 const sosKey=crypto.randomUUID();const sos=await call('trips/events',{method:'POST',cookie:employee,body:{eventId:sosKey,type:'sos',tripId,location:{status:'pending'}}});check(sos.status===201&&sos.data.sos.tripId===null,'Urgent SOS ignores stale trip id and records without active trip.');
 const loc=await call('trips/location',{method:'POST',cookie:employee,body:{eventId:sosKey,location:{status:'available',lat:21.46,lng:80.19,accuracy:20}}});check(loc.status===200,'Late SOS GPS recorded separately.');
 check(database.prepare("SELECT location FROM events WHERE event_id=?").get(sosKey).location.includes('pending'),'Original SOS event remains immutable.');
 const token=await call('admin/automation/token',{method:'POST',cookie:admin,body:{}});check(token.status===200&&token.data.token.length===64,'Admin issues one-time automation secret.');
 check((await call('automation/jobs/claim',{method:'POST',body:{limit:20},csrf:false})).status===401,'Job lease requires automation credential.');
 const key=token.data.token;const jobs=await call('automation/jobs/claim',{method:'POST',body:{limit:20,workerId:'test'},automationKey:key,csrf:false});check(jobs.status===200&&jobs.data.jobs.length===8,'All independent channel jobs leased.');
 check((await call('automation/jobs/claim',{method:'POST',body:{limit:20},automationKey:key,csrf:false})).data.jobs.length===0,'Concurrent claimant cannot take live leases.');
 const job=jobs.data.jobs[0];const fail={leaseToken:job.leaseToken,status:'failed',error:'Simulated provider timeout'};
 const receipt=await call('automation/jobs/'+job.id+'/receipt',{method:'POST',body:fail,automationKey:key,csrf:false});check(receipt.status===200&&receipt.data.status==='pending','Failed provider schedules retry.');
 const receipt2=await call('automation/jobs/'+job.id+'/receipt',{method:'POST',body:fail,automationKey:key,csrf:false});check(receipt2.status===200&&receipt2.data.duplicate,'Failed receipt retry is idempotent.');check(database.prepare('SELECT COUNT(*) n FROM notification_attempts WHERE notification_id=?').get(job.id).n===1,'One receipt per lease.');
 const second=jobs.data.jobs[1];check((await call('automation/jobs/'+second.id+'/receipt',{method:'POST',body:{leaseToken:'invalid',status:'sent'},automationKey:key,csrf:false})).status===409,'Stale/invalid lease cannot claim success.');
 check((await call('automation/jobs/'+second.id+'/receipt',{method:'POST',body:{leaseToken:second.leaseToken,status:'sent',providerId:'provider-123'},automationKey:key,csrf:false})).status===200,'Provider accepted receipt saved.');
 const acknowledged=await call('admin/sos/'+sos.data.sos.id,{method:'POST',cookie:admin,body:{action:'acknowledge',note:'Calling employee'}});check(acknowledged.status===200&&acknowledged.data.sos.status==='acknowledged','Authenticated admin acknowledges SOS.');
 const csv=await call('reports.csv',{cookie:admin});check(csv.status===200&&csv.data.includes(sos.data.sos.id),'Daily export includes standalone SOS.');
 // Scheduled reports catch up missed closed periods and are idempotent.
 const offset=330*60000,local=new Date(Date.now()+offset),cutoff=Math.max(0,local.getUTCHours()-1);
 await call('admin/settings',{method:'PUT',cookie:admin,body:{reportHour:0,reportMinute:0,shiftCutoffHour:cutoff}});
 const targetEnd=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),cutoff)-offset;
 const oldEnd=targetEnd-3*86400000;
 database.prepare('INSERT INTO reports (id,period_start,period_end,generated_at,trip_count,completed_count,active_count,sos_count) VALUES (?,?,?,?,0,0,0,0)').run('old-report',new Date(oldEnd-86400000).toISOString(),new Date(oldEnd).toISOString(),new Date().toISOString());
 const tick=await call('automation/tick',{method:'POST',body:{},automationKey:key,csrf:false});check(tick.status===200&&tick.data.reportsCreated===3,'Daily tick catches up missed periods.');
 check((await call('automation/tick',{method:'POST',body:{},automationKey:key,csrf:false})).data.reportsCreated===0,'Repeated schedule tick does not duplicate reports.');
 // Explicit report windows include all incidents, even when no journey exists.
 database.prepare('INSERT INTO reports (id,period_start,period_end,generated_at,trip_count,completed_count,active_count,sos_count) VALUES (?,?,?,?,0,0,0,1)').run('current-test-window',new Date(Date.now()-60000).toISOString(),new Date(Date.now()+60000).toISOString(),new Date().toISOString());
 check((await call('reports.csv?reportId=current-test-window',{cookie:admin})).data.includes(sos.data.sos.id),'Saved-period export includes standalone SOS.');
 // Unknown or acknowledged SOS reminders cannot be dispatched.
 database.prepare("UPDATE sos SET next_escalation_at=? WHERE id=?").run(new Date(Date.now()-60000).toISOString(),sos.data.sos.id);
 check((await call('automation/tick',{method:'POST',body:{},automationKey:key,csrf:false})).data.escalations===0,'Acknowledged SOS does not create reminders.');
 const deactivated=await call('admin/employees/'+created.data.employee.id,{method:'PATCH',cookie:admin,body:{active:false}});check(deactivated.status===200&&(await call('employee',{cookie:employee})).status===401,'Employee deactivation revokes sessions.');
 // ---- Locations ----
 const boot1=(await call('bootstrap',{cookie:admin})).data;check(boot1.settings.locations.map(l=>l.id).join()==='noida,pune,dehradun'&&!('officeName'in boot1.settings),'Default offices are Noida, Pune, Dehradun (Gondia removed).');
 check((await call('admin/employees',{method:'POST',cookie:admin,body:{name:'Bad Loc',employeeCode:'E900',email:'badloc@example.com',password:'Temporary-test-123',location:'gondia'}})).status===400,'Unknown office location rejected.');
 check((await call('admin/settings',{method:'PUT',cookie:admin,body:{locations:[]}})).status===400,'At least one location required.');
 // ---- RBAC ----
 check(boot1.me.permissions.includes('rbac.manage'),'Admin profile carries all permissions.');
 const roleRes=await call('admin/roles',{method:'POST',cookie:admin,body:{name:'Night supervisor',permissions:['dashboard.view','alerts.manage','bogus.perm']}});check(roleRes.status===201,'Custom role created.');const sup=roleRes.data.roles.find(r=>r.name==='Night supervisor');check(sup&&sup.permissions.join()==='dashboard.view,alerts.manage','Unknown permissions are dropped.');
 const supUser=await call('admin/employees',{method:'POST',cookie:admin,body:{name:'Sup One',employeeCode:'S001',email:'sup@example.com',password:'Temporary-test-123',location:'pune',role:sup.id}});check(supUser.status===201&&supUser.data.employee.location==='pune'&&supUser.data.employee.role===sup.id,'User created with custom role and office.');
 let supLogin=await call('auth/login',{method:'POST',body:{login:'S001',password:'Temporary-test-123'}});supLogin=await call('auth/password',{method:'POST',cookie:supLogin.cookie,body:{currentPassword:'Temporary-test-123',newPassword:'Supervisor-pass-123'}});const supCookie=supLogin.cookie;
 const supDash=await call('dashboard',{cookie:supCookie});check(supDash.status===200&&supDash.data.notifications.length>0&&supDash.data.reports.length===0&&!('adminEmails'in supDash.data.settings),'Dashboard is trimmed to granted permissions.');
 check((await call('admin/settings',{method:'PUT',cookie:supCookie,body:{companyName:'X'}})).status===403,'Custom role without settings.manage is denied.');
 check((await call('admin/rbac',{cookie:supCookie})).status===403,'Custom role without rbac.manage cannot open access control.');
 check((await call('admin/employees',{method:'POST',cookie:supCookie,body:{name:'X',employeeCode:'X01',email:'x@example.com',password:'Temporary-test-123'}})).status===403,'Custom role without employees.manage cannot add users.');
 check((await call('reports.csv',{cookie:supCookie})).status===403,'Custom role without reports.view cannot export.');
 check((await call('admin/roles/'+sup.id,{method:'PATCH',cookie:admin,body:{permissions:['dashboard.view','alerts.manage','reports.view']}})).status===200&&(await call('reports.csv',{cookie:supCookie})).status===200,'Granting a permission takes effect immediately.');
 const rb=await call('admin/rbac',{cookie:admin});check(rb.status===200&&rb.data.users.some(u=>u.id===supUser.data.employee.id&&u.lastActiveAt),'Access control lists users with last activity.');
 check((await call('admin/roles/'+sup.id,{method:'DELETE',cookie:admin})).status===409,'Role in use cannot be deleted.');
 check((await call('admin/employees/'+supUser.data.employee.id,{method:'PATCH',cookie:admin,body:{role:'employee'}})).status===200&&(await call('dashboard',{cookie:supCookie})).status===403,'Role change revokes console access.');
 check((await call('admin/roles/'+sup.id,{method:'DELETE',cookie:admin})).status===200,'Unused custom role deleted.');
 check((await call('admin/roles/admin',{method:'PATCH',cookie:admin,body:{permissions:[]}})).status===400,'Built-in roles are locked.');
 check((await call('admin/employees/'+setup.data.me.id,{method:'PATCH',cookie:admin,body:{role:'employee'}})).status===400,'Last administrator cannot be demoted.');
 check((await call('admin/employees/'+setup.data.me.id,{method:'DELETE',cookie:admin})).status===400,'Admin cannot delete self.');
 const del=await call('admin/employees/'+supUser.data.employee.id,{method:'DELETE',cookie:admin});check(del.status===200&&del.data.removed==='deleted'&&(await call('auth/login',{method:'POST',body:{login:'S001',password:'Supervisor-pass-123'}})).status===401,'User without history is deleted and cannot sign in.');
 const del2=await call('admin/employees/'+created.data.employee.id,{method:'DELETE',cookie:admin});check(del2.data.removed==='archived'&&database.prepare('SELECT COUNT(*) n FROM trips WHERE employee_id=?').get(created.data.employee.id).n>0,'User with journeys is archived; history kept.');
 console.log(`PASS: ${checks} API integration assertions; auth, idempotency, SOS, leasing, retries, CSV, deactivation, locations and RBAC.`);
}finally{database.close();await rm(folder,{recursive:true,force:true});delete globalThis.__nightshiftTestEnv;}
