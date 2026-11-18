// Root-only, recoverable setup on dg-nxttrack-01. Never prints credentials.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID,randomInt,createCipheriv,createDecipheriv} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';

const REFS={staging:'dsnqnvbckkqpzadblshu',production:'wlrnowuownakqqgjxnbb'};
const originFor=env=>env==='production'?'https://dartflow.nl':'https://staging.dartflow.nl';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
function requireValue(value){if(!value)throw Error('Provisioning validation failed.');}
export function parseEnvironment(text){return Object.fromEntries(text.split('\n').filter(line=>line.trim()&&!line.trimStart().startsWith('#')).map(line=>{const match=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);requireValue(match);let value=match[2];if(value.startsWith('"')||value.startsWith("'")){requireValue(value.at(-1)===value[0]);value=value.slice(1,-1);}requireValue(!/[\r\n\0]/.test(value));return [match[1],value];}));}
function postgres(value){const url=new URL(value);requireValue(['postgres:','postgresql:'].includes(url.protocol)&&!url.hash&&![...url.searchParams.keys()].some(k=>['host','port','user','password','database'].includes(k.toLowerCase())));requireValue(url.searchParams.get('sslmode')==='verify-full');return url;}
export function validateProvisionEnvironment(environment,runtime,admin){
 const ref=REFS[environment];requireValue(ref&&runtime.DARTFLOW_DATA_MODE==='supabase'&&runtime.DARTFLOW_ENV===environment&&runtime.DARTFLOW_APP_ORIGIN===originFor(environment)&&runtime.NEXT_PUBLIC_SUPABASE_URL===`https://${ref}.supabase.co`);
 requireValue(typeof admin.auth==='string'&&admin.auth.length>20&&!/[\r\n\0]/.test(admin.auth));
 const app=postgres(runtime.DARTFLOW_DATABASE_URL),owner=postgres(admin.database),appUser=decodeURIComponent(app.username),ownerUser=decodeURIComponent(owner.username);
 requireValue(app.hostname===owner.hostname&&app.port===owner.port&&app.pathname===owner.pathname);
 if(app.hostname===`db.${ref}.supabase.co`)requireValue(appUser==='dartflow_app'&&ownerUser==='postgres');
 else requireValue(app.hostname.endsWith('.pooler.supabase.com')&&app.port==='5432'&&appUser===`dartflow_app.${ref}`&&ownerUser===`postgres.${ref}`);
 const publicKey=runtime.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??'';let publicRole=publicKey.startsWith('sb_publishable_');
 if(!publicRole){try{publicRole=JSON.parse(Buffer.from(publicKey.split('.')[1],'base64url').toString()).role==='anon';}catch{}}
 requireValue(publicRole);const key=Buffer.from(runtime.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY??'','base64');requireValue(key.length===32&&/^[A-Za-z0-9+/]{43}=$/.test(runtime.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY));
 return {ref,origin:originFor(environment),authOrigin:`https://${ref}.supabase.co`,key};
}
export function credentialEnvelope(secret,environment,key,open=false){
 const aad=Buffer.from(`dartflow:${environment}:${REFS[environment]}:play-review-password:1`);
 if(open){requireValue(secret?.keyVersion===1);const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(secret.nonce,'base64'));cipher.setAAD(aad);cipher.setAuthTag(Buffer.from(secret.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(secret.ciphertext,'base64')),cipher.final()]).toString('utf8');}
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);const value=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return {keyVersion:1,nonce:nonce.toString('base64'),ciphertext:value.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function rootFile(filename){const stat=fs.lstatSync(filename);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===0&&(stat.mode&0o077)===0&&stat.nlink===1);return fs.readFileSync(filename,'utf8');}
function rootDirectory(directory){fs.mkdirSync(directory,{recursive:true,mode:0o700});const stat=fs.lstatSync(directory);requireValue(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===0&&(stat.mode&0o077)===0);}
function atomic(filename,value,mode=0o600){const temporary=filename+'.'+randomUUID()+'.tmp',fd=fs.openSync(temporary,'wx',mode);try{fs.fchmodSync(fd,mode);fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}try{if(fs.existsSync(filename)){const stat=fs.lstatSync(filename);requireValue(stat.uid===0&&!stat.isSymbolicLink()&&stat.isFile());}fs.renameSync(temporary,filename);const dir=fs.openSync(path.dirname(filename),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}finally{fs.rmSync(temporary,{force:true});}}
export function newPlannedPlayer(environment,label){const suffix=randomBytes(7).toString('hex');return {label,email:`play-review-${environment}-${suffix}@dartflow.nl`,password:randomBytes(24).toString('base64url'),pin:String(randomInt(1000000)).padStart(6,'0'),username:`review_${environment}_${suffix}`,profileRequestId:randomUUID(),preferencesRequestId:randomUUID()};}

/** One transaction creates private metadata and memberships, without publication hooks/mail. */
export async function provisionPrivateReviewBoard(db,environment,player,companion,details={}){
 requireValue(uuid(player.id)&&uuid(companion.id)&&player.id!==companion.id);
 const ids={clubId:details.clubId??randomUUID(),eventId:details.eventId??randomUUID(),locationId:details.locationId??randomUUID(),boardId:details.boardId??randomUUID()};requireValue(Object.values(ids).every(uuid));
 const name='DartFlow appbeoordeling',boardName='Reviewbaan 1';
 // A saved ID may only refer to this exact isolated review ownership graph.
 for(const [table,id,ownerColumn,expected]of [['platform_entities',ids.clubId,'owner_id',player.id],['events',ids.eventId,'club_id',ids.clubId],['locations',ids.locationId,'owner_id',player.id],['boards',ids.boardId,'event_id',ids.eventId]]){
  const row=(await db.query(`select ${ownerColumn} expected from dartflow_private.${table} where id=$1`,[id])).rows[0];if(row)requireValue(row.expected===expected);
 }
 const clubRow=(await db.query('select kind from dartflow_private.platform_entities where id=$1',[ids.clubId])).rows[0];if(clubRow)requireValue(clubRow.kind==='club');
 const clubBoard=(await db.query('select club_id,event_id from dartflow_private.club_boards where board_id=$1',[ids.boardId])).rows[0];if(clubBoard)requireValue(clubBoard.club_id===ids.clubId&&clubBoard.event_id===ids.eventId);
 const locationBoard=(await db.query('select location_id,home_event_id from dartflow_private.location_boards where board_id=$1',[ids.boardId])).rows[0];if(locationBoard)requireValue(locationBoard.location_id===ids.locationId&&locationBoard.home_event_id===ids.eventId);
 await db.query('insert into dartflow_private.clubs(id,name) values($1,$2) on conflict(id) do nothing',[ids.clubId,name]);
 await db.query("insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,state) values($1,'club',$2,'private',$3) on conflict(id) do update set visibility='private',state=jsonb_set(platform_entities.state,'{joinPolicy}','\"closed\"')",[ids.clubId,player.id,JSON.stringify({name,description:'Afgeschermde beoordeling met uitsluitend synthetische gegevens.',capacity:2,joinPolicy:'closed',lifecycle:'active',news:[]})]);
 for(const[id,role,core]of [[player.id,'owner','organizer'],[companion.id,'member','player']]){
  await db.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3) on conflict(club_id,user_id) do update set role=excluded.role',[ids.clubId,id,core]);
  await db.query("insert into dartflow_private.platform_members(entity_id,user_id,role,status,attributes) values($1,$2,$3,'active','{}') on conflict(entity_id,user_id) do update set role=excluded.role,status='active'",[ids.clubId,id,role]);
 }
 requireValue((await db.query("select count(*)::int n from dartflow_private.platform_members where entity_id=$1 and status='active'",[ids.clubId])).rows[0].n===2);
 await db.query('insert into dartflow_private.club_intake_versions(club_id,version) values($1,1) on conflict do nothing',[ids.clubId]);
 await db.query("insert into dartflow_private.location_accounts(user_id,venue_enabled) values($1,true) on conflict(user_id) do update set venue_enabled=true",[player.id]);
 await db.query("insert into dartflow_private.locations(id,owner_id,kind,name) values($1,$2,'venue',$3) on conflict(id) do nothing",[ids.locationId,player.id,name]);
 await db.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,2) on conflict(id) do nothing',[ids.eventId,ids.clubId,'Vrij spelen · '+boardName]);
 await db.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3) on conflict(id) do nothing',[ids.boardId,ids.eventId,boardName]);
 await db.query("insert into dartflow_private.club_boards(board_id,club_id,event_id,name,access,created_by) values($1,$2,$3,$4,'club',$5) on conflict(board_id) do update set access='club'",[ids.boardId,ids.clubId,ids.eventId,boardName,player.id]);
 await db.query('insert into dartflow_private.location_boards(board_id,location_id,home_event_id,reservation_enabled,public_screen) values($1,$2,$3,false,false) on conflict(board_id) do update set reservation_enabled=false,public_screen=false',[ids.boardId,ids.locationId,ids.eventId]);
 await db.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind) values($1,$2,'friend'),($2,$1,'friend') on conflict do nothing",[player.id,companion.id]);
 return {...details,...ids,boardUrl:`${originFor(environment)}/baan/${ids.boardId}`,clubUrl:`${originFor(environment)}/app/clubs/${ids.clubId}`};
}

async function main(environment){
 requireValue(process.getuid?.()===0&&REFS[environment]);
 const run='/run/dartflow-play-provision';rootDirectory(run);
 // flock owns the descriptor for the entire child process, including Auth calls.
 if(process.env.DARTFLOW_PLAY_PROVISION_LOCKED!==environment){
  const lock=path.join(run,environment+'.lock');if(fs.existsSync(lock))rootFile(lock);else{const fd=fs.openSync(lock,'wx',0o600);fs.closeSync(fd);}
  const result=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','--conflict-exit-code','75',lock,process.execPath,fileURLToPath(import.meta.url),environment],{stdio:'inherit',env:{...process.env,DARTFLOW_PLAY_PROVISION_LOCKED:environment}});process.exitCode=result.status??1;return;
 }
 const site=`/srv/sites/dartflow-${environment}`,config=`/etc/dg-sites/dartflow-${environment}`,source=path.join(run,environment+'.json'),journalPath=path.join(config,'play-review-provision.journal.json');
 rootDirectory(config);
 const release=fs.realpathSync(`${site}/current`);
 const runtime={...parseEnvironment(fs.readFileSync(`${release}/.runtime.env`,'utf8')),...parseEnvironment(fs.readFileSync(`${release}/.release.env`,'utf8'))},admin=JSON.parse(rootFile(source));
 const {origin,authOrigin,ref,key}=validateProvisionEnvironment(environment,runtime,admin),require=createRequire(`${release}/server.js`),pg=require('pg');
 const db=new pg.Client({connectionString:admin.database,connectionTimeoutMillis:15000});let completed=false;
 const seal=value=>credentialEnvelope(value,environment,key),open=value=>credentialEnvelope(value,environment,key,true);
 const checkpoint=journal=>atomic(journalPath,JSON.stringify(journal)+'\n');
 async function auth(method,target,body){const response=await fetch(authOrigin+'/auth/v1/'+target,{method,headers:{apikey:admin.auth,Authorization:`Bearer ${admin.auth}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Auth provisioning failed.');return response.json();}
 async function api(token,target,body){const response=await fetch(origin+'/api/player/v1/'+target,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Player provisioning failed.');return response.json();}
 try{
  await db.connect();await db.query('select pg_advisory_lock(hashtextextended($1,0))',[`play-review-provision:${environment}`]);
  const prior=(await db.query('select * from dartflow_private.play_review_accounts where environment=$1',[environment])).rows[0];
  if(prior)requireValue(prior.enabled);
  const priorDetails=prior?.review_details?JSON.parse(open(prior.review_details)):{};
  let journal=fs.existsSync(journalPath)?JSON.parse(rootFile(journalPath)):null;
  if(journal)requireValue(journal.environment===environment&&journal.format===1&&uuid(journal.operationId));
  if(!journal){
   const primary=prior?{id:prior.user_id,email:prior.email,password:open(prior.password_envelope),pin:priorDetails.playerPin,label:'Reviewspeler één',username:(await db.query('select name from dartflow_private.profiles where id=$1',[prior.user_id])).rows[0]?.name,profileRequestId:randomUUID(),preferencesRequestId:randomUUID()}:newPlannedPlayer(environment,'Reviewspeler één');
   const companion=prior?.companion_user_id?{id:prior.companion_user_id,email:priorDetails.companionEmail,password:priorDetails.companionPassword,pin:priorDetails.companionPin,username:priorDetails.companionUsername,label:'Reviewspeler twee',profileRequestId:randomUUID(),preferencesRequestId:randomUUID()}:newPlannedPlayer(environment,'Reviewspeler twee');
   journal={format:1,environment,operationId:randomUUID(),primary,companion};checkpoint(journal);
  }
  async function player(plan){
   requireValue(typeof plan.email==='string'&&new RegExp(`^play-review-${environment}-[a-f0-9]+@dartflow\\.nl$`).test(plan.email)&&typeof plan.password==='string'&&plan.password.length>=24);
   if(!plan.id){
    // The planned email is durable before Auth creation. A crash between creation
    // and checkpoint can recover only an identity with our admin-owned marker.
    let found=(await db.query('select id,raw_app_meta_data from auth.users where lower(email)=$1',[plan.email])).rows[0];
    if(!found){await auth('POST','admin/users',{email:plan.email,password:plan.password,email_confirm:true,user_metadata:{full_name:plan.label},app_metadata:{dartflow_review_provision:journal.operationId,dartflow_review_environment:environment}});found=(await db.query('select id,raw_app_meta_data from auth.users where lower(email)=$1',[plan.email])).rows[0];}
    requireValue(found&&found.raw_app_meta_data?.dartflow_review_provision===journal.operationId&&found.raw_app_meta_data?.dartflow_review_environment===environment);plan.id=found.id;checkpoint(journal);
   }
   requireValue(uuid(plan.id));
   const existing=(await db.query('select email,deletion_requested_at,deleted_at from dartflow_private.profiles where id=$1',[plan.id])).rows[0];if(existing)requireValue(!existing.deletion_requested_at&&!existing.deleted_at&&existing.email===plan.email);
   await db.query('insert into dartflow_private.profiles(id,name,email,email_verified) values($1,$2,$3,true) on conflict(id) do nothing',[plan.id,plan.username??plan.label,plan.email]);
   // This fixture never delivers mail, including an unexpected welcome retry.
   await db.query("insert into dartflow_private.mail_suppressions(environment,recipient_key,category) values($1,$2,'review-fixture') on conflict do nothing",[environment,`user:${plan.id}`]);
   const response=await fetch(authOrigin+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:runtime.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:plan.email,password:plan.password}),redirect:'error',signal:AbortSignal.timeout(20000)});requireValue(response.ok);const session=await response.json();requireValue(session.user?.id===plan.id&&!session.user.is_anonymous);
   const profile=(await db.query('select onboarding_complete,exists(select 1 from dartflow_private.player_pin_verifiers where user_id=$1) as pin from dartflow_private.profiles where id=$1',[plan.id])).rows[0];
   if(!profile.onboarding_complete||!profile.pin){requireValue(typeof plan.pin==='string'&&/^\d{6}$/.test(plan.pin)&&typeof plan.username==='string');await api(session.access_token,'profile/complete',{requestId:plan.profileRequestId,username:plan.username,displayName:plan.label,pin:plan.pin,pinConfirmation:plan.pin});}
   await api(session.access_token,'platform/actions',{requestId:plan.preferencesRequestId,action:{type:'preferences.update',discoverable:false,allowRequests:false}});
   requireValue((await db.query('select count(*)::int n from dartflow_private.platform_roles where user_id=$1',[plan.id])).rows[0].n===0);
   return plan;
  }
  const primary=await player(journal.primary),companion=await player(journal.companion);
  await db.query('begin');
  try{
   const details=await provisionPrivateReviewBoard(db,environment,primary,companion,{...priorDetails,playerPin:primary.pin,companionUsername:companion.username,companionPin:companion.pin,companionEmail:companion.email,companionPassword:companion.password});
   const saved=await db.query('insert into dartflow_private.play_review_accounts(environment,user_id,email,password_envelope,review_details,companion_user_id) values($1,$2,$3,$4,$5,$6) on conflict(environment) do update set password_envelope=excluded.password_envelope,review_details=excluded.review_details,companion_user_id=excluded.companion_user_id where play_review_accounts.user_id=excluded.user_id and play_review_accounts.enabled',[environment,primary.id,primary.email,seal(primary.password),seal(JSON.stringify(details)),companion.id]);
   requireValue(saved.rowCount===1);
   await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  const workerPath=path.join(config,'privacy-worker.env');let worker;
  if(fs.existsSync(workerPath)){
   worker=parseEnvironment(rootFile(workerPath));const url=postgres(worker.DARTFLOW_PRIVACY_DATABASE_URL),app=postgres(runtime.DARTFLOW_DATABASE_URL);requireValue(url.hostname===app.hostname&&url.port===app.port&&url.pathname===app.pathname&&decodeURIComponent(url.username)===(decodeURIComponent(app.username).includes('.')?`dartflow_privacy_worker.${ref}`:'dartflow_privacy_worker')&&worker.NEXT_PUBLIC_SUPABASE_URL===authOrigin&&url.password);
  }else{
   const url=postgres(runtime.DARTFLOW_DATABASE_URL);url.username=decodeURIComponent(url.username).includes('.')?`dartflow_privacy_worker.${ref}`:'dartflow_privacy_worker';url.password=randomBytes(36).toString('base64url');worker={DARTFLOW_DATA_MODE:'supabase',DARTFLOW_PRIVACY_DATABASE_URL:String(url),NEXT_PUBLIC_SUPABASE_URL:authOrigin,SUPABASE_AUTH_ADMIN_KEY:admin.auth};
   // The intended password is durable before ALTER ROLE. Retry repairs either
   // side of an interrupted initial setup instead of generating another value.
   atomic(workerPath,Object.entries(worker).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
  }
  worker.DARTFLOW_DATA_MODE='supabase';worker.SUPABASE_AUTH_ADMIN_KEY=admin.auth;
  atomic(workerPath,Object.entries(worker).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
  const password=decodeURIComponent(new URL(worker.DARTFLOW_PRIVACY_DATABASE_URL).password);requireValue(/^[A-Za-z0-9_-]{40,}$/.test(password));
  await db.query(`alter role dartflow_privacy_worker password '${password}'`);
  const service=`[Unit]\nDescription=DartFlow ${environment} account erasure\nAfter=dartflow-${environment}.service network-online.target\n[Service]\nType=oneshot\nDynamicUser=yes\nEnvironment=NODE_EXTRA_CA_CERTS=/usr/local/share/dg-certificates/supabase-prod-ca-bundle.crt\nEnvironmentFile=${workerPath}\nExecStart=/opt/node-v24.18.0-linux-x64/bin/node ${site}/current/account-removal-worker.mjs\nTimeoutStartSec=180\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectHome=yes\nProtectSystem=strict\nProtectProc=invisible\nRestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX\nUMask=0077\n`;
  atomic(`/etc/systemd/system/dartflow-privacy-${environment}.service`,service,0o644);
  atomic(`/etc/systemd/system/dartflow-privacy-${environment}.timer`,`[Unit]\nDescription=DartFlow ${environment} privacy queue\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1min\nPersistent=true\n[Install]\nWantedBy=timers.target\n`,0o644);
  execFileSync('/usr/bin/systemctl',['daemon-reload']);completed=true;
  console.log(JSON.stringify({environment,reviewerConfigured:true,reviewBoardConfigured:true,privacyWorkerConfigured:true,credentialsPrinted:false,timerActivated:false}));
 }finally{
  await db.end();
  if(completed){fs.rmSync(source,{force:true});fs.rmSync(journalPath,{force:true});}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){main(process.argv[2]).catch(()=>{console.error('DartFlow reviewer/privacy provisioning failed. No credentials printed.');process.exitCode=1;});}
