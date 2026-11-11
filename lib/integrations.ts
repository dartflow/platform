import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { database, consumeRateLimit } from './db';
import { appConfig } from './config';
import { hasFreshOtpRecoveryProof } from './google-proof';
import { DomainError } from './domain';
import { emailAddress, exactKeys, integrationRuntime, integrationTransaction, ownerAccess, storeCredential, textField, type MailMode } from './integrations-core';
import { getMailPolicy, getMailPreferences, listMailLog, listMailTemplates, mailAudit, processMailBatch, receiveResendWebhook, retryMail, senderSettings, testMail, updateMailPolicy, updateMailPreferences, updateMailTemplate } from './integrations-mail';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache'}});
async function readBody(request:Request) {
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('content_type','JSON vereist.',415);
 const reader=request.body?.getReader();if(!reader)throw new DomainError('invalid_json','Ongeldige aanvraag.');let length=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384){await reader.cancel();throw new DomainError('too_large','Aanvraag te groot.',413);}chunks.push(value);}
 try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data&&typeof data==='object'&&!Array.isArray(data))return data as Record<string,unknown>;}catch{/* Safe generic error. */}throw new DomainError('invalid_json','Ongeldige aanvraag.');
}
function csrf(request:Request) {if(request.headers.get('origin')!==appConfig().origin||request.headers.get('sec-fetch-site')==='cross-site')throw new DomainError('origin','Ververs de pagina en probeer opnieuw.',403);}
async function recentOwner(actor:string,requireOtpRecovery=false) {
 await ownerAccess(actor);if(appConfig().mode==='local')return;
 const {supabaseServer}=await import('./auth');const client=await supabaseServer();const {data,error}=await client.auth.getClaims();const claims=data?.claims;
 const authTimes=[Number(claims?.auth_time),...(Array.isArray(claims?.amr)?claims.amr.map((entry:{timestamp?:number;method?:string})=>entry.method!=='token_refresh'?Number(entry.timestamp):0):[])].filter(value=>Number.isFinite(value)&&value>0);
 const fresh=authTimes.some(value=>Date.now()/1000-value>=0&&Date.now()/1000-value<=900);
 if(error||claims?.sub!==actor||!fresh||process.env.DARTFLOW_ADMIN_REQUIRE_MFA==='true'&&claims.aal!=='aal2')throw new DomainError('reauth_required','Log opnieuw in om beveiligde instellingen te wijzigen.',403);
 if(requireOtpRecovery&&!hasFreshOtpRecoveryProof(actor,claims))throw new DomainError('google_recovery_otp_required','Log eerst opnieuw in met een e-mailcode voordat je Google uitschakelt.',403);
}
async function limitOwner(actor:string) {const rate=await consumeRateLimit(`integration:${integrationRuntime().environment}:${actor}`,20,600);if(!rate.allowed)throw new DomainError('rate_limited','Wacht voordat je opnieuw instellingen wijzigt.',429);}
export async function getResendSettings(actor:string) {
 await ownerAccess(actor);const runtime=integrationRuntime();const {rows}=await database().query("select revision,updated_at from dartflow_private.integration_settings where environment=$1 and provider='resend'",[runtime.environment]);const credentials=await database().query('select kind,changed_at from dartflow_private.integration_credentials where environment=$1',[runtime.environment]);const settings=await senderSettings();
 const api=credentials.rows.find(row=>row.kind==='resend-api'),webhook=credentials.rows.find(row=>row.kind==='resend-webhook');
 return {environment:runtime.environment,revision:rows[0]?.revision||0,...settings,keyStatus:api?(settings.keyStatus||'stored'):'missing',keyChangedAt:api?.changed_at||null,webhookStatus:webhook?(settings.webhookStatus||'stored'):'missing',lastVerifiedWebhookAt:settings.lastVerifiedWebhookAt||null,webhookUrl:`${runtime.origin}/api/mail/resend/webhook`,runtime:{maxMode:runtime.maxMode,allowedFrom:[...runtime.allowedFrom],testRecipients:[...runtime.testAllowlist]},encryptionReady:!!process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY,lastChangedAt:rows[0]?.updated_at||null};
}
export async function updateResendSettings(actor:string,input:Record<string,unknown>) {
 exactKeys(input,['expectedRevision','mode','from','replyTo','testRecipients','apiKey','webhookSigningSecret']);await recentOwner(actor);await limitOwner(actor);const runtime=integrationRuntime();
 if(!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0)throw new DomainError('revision','Vernieuw de instellingen.');
 if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||!/^re_[A-Za-z0-9_-]{12,200}$/.test(input.apiKey)))throw new DomainError('resend_key','Voer een geldige Resend-verzendsleutel in.');
 if(input.webhookSigningSecret!==undefined&&(typeof input.webhookSigningSecret!=='string'||!/^whsec_[A-Za-z0-9+/=_-]{16,200}$/.test(input.webhookSigningSecret)))throw new DomainError('webhook_secret','Voer een geldig webhook signing secret in.');
 return integrationTransaction(async client=>{await ownerAccess(actor,client);await client.query('select pg_advisory_xact_lock(hashtext($1))',[`resend:${runtime.environment}`]);const old=await client.query("select revision from dartflow_private.integration_settings where environment=$1 and provider='resend' for update",[runtime.environment]);const revision=old.rows[0]?.revision||0;if(input.expectedRevision!==revision)throw new DomainError('revision_conflict','De instellingen zijn gewijzigd. Vernieuw de pagina.',409);const next=await senderSettings(client);
  if(input.mode!==undefined){if(!['log','test','live'].includes(String(input.mode)))throw new DomainError('mail_mode','Ongeldige verzendmodus.');const mode=input.mode as MailMode;if({log:0,test:1,live:2}[mode]>{log:0,test:1,live:2}[runtime.maxMode])throw new DomainError('mail_mode_boundary','De runtime staat deze verzendmodus niet toe.',403);next.mode=mode;}
  if(input.from!==undefined){if(!input.from||typeof input.from!=='object'||Array.isArray(input.from))throw new DomainError('sender','Kies een toegestane afzender.');const from=input.from as Record<string,unknown>;exactKeys(from,['name','address']);const address=emailAddress(from.address);if(!runtime.allowedFrom.has(address))throw new DomainError('sender_boundary','Deze afzender staat niet in de runtimegrens.',403);const name=textField(from.name,80);if(/[<>]/.test(name))throw new DomainError('sender','Gebruik een afzendernaam zonder haaktekens.');next.from={name,address};}
  if(input.replyTo!==undefined){const address=input.replyTo===null?null:emailAddress(input.replyTo);if(address&&!runtime.allowedFrom.has(address)&&!runtime.testAllowlist.has(address))throw new DomainError('reply_to_boundary','Gebruik een toegestaan antwoordadres.',403);next.replyTo=address;}
  if(input.testRecipients!==undefined){if(!Array.isArray(input.testRecipients)||input.testRecipients.length>20)throw new DomainError('test_recipients','Kies maximaal twintig testadressen.');const addresses=[...new Set(input.testRecipients.map(emailAddress))];if(addresses.some(value=>!runtime.testAllowlist.has(value)))throw new DomainError('test_recipient_boundary','Een testadres valt buiten de runtimegrens.',403);next.testRecipients=addresses;}
  if(input.apiKey!==undefined){await storeCredential(client,actor,'resend-api',String(input.apiKey));next.keyStatus='stored';next.lastTest=null;}
  if(input.webhookSigningSecret!==undefined){await storeCredential(client,actor,'resend-webhook',String(input.webhookSigningSecret));next.webhookStatus='stored';next.lastVerifiedWebhookAt=undefined;}
  await client.query("insert into dartflow_private.integration_settings(environment,provider,revision,settings) values($1,'resend',$2,$3) on conflict(environment,provider) do update set revision=excluded.revision,settings=excluded.settings,updated_at=now()",[runtime.environment,revision+1,JSON.stringify(next)]);
  const auditId=await mailAudit(client,actor,'resend-settings',{revision:revision+1,apiKeyChanged:input.apiKey!==undefined,webhookSecretChanged:input.webhookSigningSecret!==undefined,mode:next.mode});return {ok:true,revision:revision+1,auditId};
 });
}
function managementToken() {const token=process.env.SUPABASE_MANAGEMENT_TOKEN;return typeof token==='string'&&token.length>20?token:null;}
async function managementRequest(method:'GET'|'PATCH',patch?:Record<string,unknown>) {
 const token=managementToken();if(!token)throw new DomainError('management_missing','Plaats het projectgebonden Supabase Management-token in de beschermde runtimeconfiguratie.',503);
 const {projectRef}=integrationRuntime();if(projectRef==='local')throw new DomainError('management_local','Google-beheer is alleen beschikbaar voor het eigen staging- of productieproject.',503);
 let response:Response;try{response=await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(patch?{body:JSON.stringify(patch)}:{}),redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});}catch{throw new DomainError('management_unknown','De configuratie-uitkomst is onzeker. Controleer opnieuw voordat je iets wijzigt.',503);}
 if(!response.ok){const code=response.status===401?'management_unauthorized':response.status===403?'management_scope':response.status===429?'management_rate_limit':'management_failed';throw new DomainError(code,response.status===403?'Het token heeft geen beheerrecht voor dit project.':'Supabase kon de configuratie niet veilig controleren.',response.status===429?429:503);}
 const data=await response.json();return {enabled:data.external_google_enabled===true,clientId:typeof data.external_google_client_id==='string'?data.external_google_client_id:'',hasSecret:typeof data.external_google_secret==='string'&&data.external_google_secret.length>0,emailEnabled:data.external_email_enabled===true};
}
export async function getGoogleSettings(actor:string) {
 await ownerAccess(actor);const runtime=integrationRuntime();const {rows}=await database().query("select revision,settings from dartflow_private.integration_settings where environment=$1 and provider='google'",[runtime.environment]);const stored=rows[0]?.settings||{};let checked:null|Awaited<ReturnType<typeof managementRequest>>=null,errorCategory:string|null=null;
 if(managementToken())try{checked=await managementRequest('GET');}catch(error){errorCategory=error instanceof DomainError?error.code:'management_failed';}
 const clientId=checked?.clientId;return {environment:runtime.environment,projectRef:runtime.projectRef,appOrigin:runtime.origin,providerCallback:`https://${runtime.projectRef}.supabase.co/auth/v1/callback`,appCallback:`${runtime.origin}/auth/callback`,management:checked?'ready':managementToken()?'error':'unavailable',providerEnabled:checked?.enabled??null,clientIdHint:clientId?`${clientId.slice(0,8)}…${clientId.slice(-20)}`:null,revision:rows[0]?.revision||0,lastCheckedAt:checked?new Date().toISOString():null,lastVerifiedLoginAt:stored.lastVerifiedLoginAt||null,errorCategory,status:!managementToken()?'Beheerverbinding ontbreekt':!checked?'Configuratiecontrole mislukt':!checked.enabled?'Provider uitgeschakeld':stored.lastVerifiedLoginAt?'Inlogtest geslaagd':'Inlogtest vereist'};
}
export async function updateGoogleSettings(actor:string,input:Record<string,unknown>) {
 exactKeys(input,['expectedRevision','enabled','clientId','clientSecret']);await recentOwner(actor,input.enabled===false);await limitOwner(actor);if(!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0)throw new DomainError('revision','Vernieuw de instellingen.');
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new DomainError('google_enabled','Ongeldige providerstatus.');
 if(input.clientId!==undefined&&(typeof input.clientId!=='string'||!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(input.clientId)))throw new DomainError('google_client','Vul een geldige Google Web Client ID in.');
 if(input.clientSecret!==undefined&&(typeof input.clientSecret!=='string'||input.clientSecret.length>300||/[\s\u0000]/.test(input.clientSecret)))throw new DomainError('google_secret','Voer het client secret opnieuw in.');
 const result=await integrationTransaction(async client=>{await ownerAccess(actor,client);const runtime=integrationRuntime();await client.query('select pg_advisory_xact_lock(hashtext($1))',[`google:${runtime.environment}`]);const {rows}=await client.query("select revision from dartflow_private.integration_settings where environment=$1 and provider='google' for update",[runtime.environment]);const revision=rows[0]?.revision||0;if(revision!==input.expectedRevision)throw new DomainError('revision_conflict','De providerinstellingen zijn gewijzigd. Vernieuw de pagina.',409);
  const before=await managementRequest('GET');const patch:Record<string,unknown>={};const hasNewSecret=typeof input.clientSecret==='string'&&input.clientSecret.length>0;
  if(input.clientId!==undefined&&input.clientId!==before.clientId&&!hasNewSecret)throw new DomainError('google_secret_required','Een andere Client ID vraagt het bijbehorende nieuwe secret.');
  if(input.enabled===false&&!before.emailEnabled)throw new DomainError('google_recovery','Controleer eerst een werkende e-mailherstelroute voor de eigenaar.',409);
  if(input.enabled===true&&!hasNewSecret&&(!before.clientId||!before.hasSecret))throw new DomainError('google_credentials_required','Voer eerst beide Google-credentials in.');
  if(input.enabled!==undefined)patch.external_google_enabled=input.enabled;if(input.clientId!==undefined)patch.external_google_client_id=input.clientId;if(hasNewSecret)patch.external_google_secret=input.clientSecret;
  if(!Object.keys(patch).length)throw new DomainError('google_empty','Kies een wijziging om op te slaan.');
  let after:Awaited<ReturnType<typeof managementRequest>>;try{await managementRequest('PATCH',patch);after=await managementRequest('GET');if(input.enabled!==undefined&&after.enabled!==input.enabled||input.clientId!==undefined&&after.clientId!==input.clientId)throw new DomainError('management_readback','De provideruitkomst is onzeker. Controleer opnieuw.',503);}catch(error){const failure=error instanceof DomainError?error:new DomainError('management_unknown','De configuratie-uitkomst is onzeker. Controleer opnieuw.',503);await client.query("insert into dartflow_private.integration_settings(environment,provider,revision,settings) values($1,'google',$2,$3) on conflict(environment,provider) do update set revision=excluded.revision,settings=excluded.settings,updated_at=now()",[runtime.environment,revision+1,JSON.stringify({lastVerifiedLoginAt:null,lastError:failure.code,requiresLoginTest:true})]);await mailAudit(client,actor,'google-update',{revision:revision+1,errorCategory:failure.code},'uncertain');return {failure};}
  await client.query("insert into dartflow_private.integration_settings(environment,provider,revision,settings) values($1,'google',$2,$3) on conflict(environment,provider) do update set revision=excluded.revision,settings=excluded.settings,updated_at=now()",[runtime.environment,revision+1,JSON.stringify({providerEnabled:after.enabled,lastCheckedAt:new Date().toISOString(),lastVerifiedLoginAt:null})]);const auditId=await mailAudit(client,actor,'google-update',{revision:revision+1,credentialsChanged:hasNewSecret,providerEnabled:after.enabled});return {ok:true,revision:revision+1,auditId,status:'Opgeslagen bij Supabase; echte inlogtest vereist'};
 });if('failure'in result)throw result.failure;return result;
}
// Called only by the authenticated OAuth callback after verified Google login and current owner lookup.
export async function googleConfigurationRevision() {const {rows}=await database().query("select revision from dartflow_private.integration_settings where environment=$1 and provider='google'",[integrationRuntime().environment]);return rows[0]?.revision||0;}
export async function recordVerifiedGoogleLogin(actor:string,provider:string,expectedRevision?:number) {
 if(provider!=='google'||!Number.isSafeInteger(expectedRevision)||Number(expectedRevision)<0)return false;
 return integrationTransaction(async client=>{await ownerAccess(actor,client);const environment=integrationRuntime().environment;const result=await client.query("update dartflow_private.integration_settings set settings=settings||jsonb_build_object('lastVerifiedLoginAt',now()) where environment=$1 and provider='google' and revision=$2",[environment,expectedRevision]);if(result.rowCount){await mailAudit(client,actor,'google-login-proof',{revision:expectedRevision},'verified');return true;}if(expectedRevision!==0)return false;const inserted=await client.query("insert into dartflow_private.integration_settings(environment,provider,revision,settings) values($1,'google',0,jsonb_build_object('lastVerifiedLoginAt',now())) on conflict(environment,provider) do nothing",[environment]);if(inserted.rowCount)await mailAudit(client,actor,'google-login-proof',{revision:expectedRevision},'verified');return Boolean(inserted.rowCount);});
}
export function workerTokenMatches(request:Request) {const expected=process.env.DARTFLOW_MAIL_WORKER_TOKEN;if(!expected||expected.length<40)return false;const value=request.headers.get('authorization')||'';const actual=Buffer.from(value),correct=Buffer.from(`Bearer ${expected}`);return actual.length===correct.length&&timingSafeEqual(actual,correct);}
export async function handleIntegrationPublic(request:Request,path:string[]) {
 if(request.method==='POST'&&path.join('/')==='mail/resend/webhook')return receiveResendWebhook(request);
 if(request.method==='POST'&&path.join('/')==='mail/process'){if(!workerTokenMatches(request))return json({error:'Geen toegang.',code:'unauthorized'},401);return json(await processMailBatch());}
 return null;
}
export async function handleIntegrations(request:NextRequest,actor:string,path:string[]) {
 const route=path.join('/');if(!route.startsWith('admin/integrations/')&&!route.startsWith('mail/'))return null;
 if(request.method!=='GET')csrf(request);
 if(route==='admin/integrations/resend'){if(request.method==='GET')return json(await getResendSettings(actor));if(request.method==='PATCH')return json(await updateResendSettings(actor,await readBody(request)));}
 if(route==='admin/integrations/google-auth'){if(request.method==='GET')return json(await getGoogleSettings(actor));if(request.method==='PATCH')return json(await updateGoogleSettings(actor,await readBody(request)));}
 const scope=request.nextUrl.searchParams.get('scope')||'platform';
 if(route==='mail/templates'&&request.method==='GET')return json(await listMailTemplates(actor,scope));
 if(route==='mail/log'&&request.method==='GET')return json(await listMailLog(actor,scope));
 if(route==='mail/test'&&request.method==='POST')return json(await testMail(actor,await readBody(request)));
 if(path[0]==='mail'&&path[1]==='templates'&&path[2]){const operation=path[3]==='publish'?'publish':path[3]==='reset'?'reset':null;if(path.length===3&&request.method==='PATCH')return json(await updateMailTemplate(actor,path[2],await readBody(request),'draft'));if(path.length===4&&operation&&request.method==='POST')return json(await updateMailTemplate(actor,path[2],await readBody(request),operation));}
 if(path.length===4&&path[0]==='mail'&&path[1]==='jobs'&&path[3]==='retry'&&request.method==='POST')return json(await retryMail(actor,path[2]));
 if(route==='mail/settings'&&request.method==='GET')return json(await getMailPolicy(actor,scope));
 if(route==='mail/settings'&&request.method==='PATCH')return json(await updateMailPolicy(actor,await readBody(request)));
 if(route==='mail/preferences'&&request.method==='GET')return json(await getMailPreferences(actor));
 if(route==='mail/preferences'&&request.method==='PATCH')return json(await updateMailPreferences(actor,await readBody(request)));
 return null;
}
