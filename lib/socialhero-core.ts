/** Contract/transport primitives: no dependency on DartFlow's database, editor or router. */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {isIP} from 'node:net';

export class SocialHeroError extends Error {
 constructor(readonly code:string,message:string,readonly status=422,readonly retryAfter?:number){super(message);}
}
export type SocialHeroTransport={fetch?:typeof fetch};
export type PairingClaim={connectionId:string;destinationId:string;accessToken:string;expiresAt:string};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function socialHeroOrigin(value:string){
 try{
  const url=new URL(value),host=url.hostname;
  const labels=host.split('.');
  if(url.protocol!=='https:'||url.origin!==value||url.username||url.password||isIP(host)||labels.length<2||host.length>253||labels.some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||!/[a-z]/.test(labels.at(-1)!)||/(?:^|\.)(?:localhost|local|internal|home|lan|test)$/.test(host)||(url.port&&Number(url.port)<1)||!/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(value))throw new Error();
  return url.origin;
 }catch{throw new SocialHeroError('CONFIGURATION_REQUIRED','Stel de vertrouwde HTTPS-origin van SocialHero in op de server.',503);}
}
export function validatePairingClaim(value:unknown):PairingClaim {
 if(!object(value)||!['connectionId','destinationId'].every(k=>typeof value[k]==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value[k] as string))||typeof value.accessToken!=='string'||!/^[A-Za-z0-9_~.+/=-]{43,2048}$/.test(value.accessToken)||typeof value.expiresAt!=='string')throw new SocialHeroError('PROVIDER_UNAVAILABLE','SocialHero gaf geen geldige bevestiging. Probeer opnieuw.',503);
 const end=Date.parse(value.expiresAt);
 if(!Number.isFinite(end)||end<=Date.now())throw new SocialHeroError('PAIRING_EXPIRED','De installatie is verlopen. Maak een nieuwe koppelcode in SocialHero.',410);
 if(end>Date.now()+11*60_000)throw new SocialHeroError('PROVIDER_UNAVAILABLE','SocialHero gaf geen geldige installatietermijn.',503);
 return value as PairingClaim;
}
export function validateSocialHeroPost(value:unknown){
 if(!object(value))throw new SocialHeroError('VALIDATION_ERROR','Gebruik een JSON-object.');
 const allowed=['baseRevision','type','locale','title','content','slug','excerpt','authorId','categoryId','tags','seo','hero','ogImageAssetId'];
 if(Object.keys(value).some(k=>!allowed.includes(k))||!Object.hasOwn(value,'baseRevision')||(value.baseRevision!==null&&(!Number.isSafeInteger(value.baseRevision)||Number(value.baseRevision)<1)))throw new SocialHeroError('VALIDATION_ERROR','Geef baseRevision: null bij aanmaak, of de actuele revisie bij een wijziging.');
 if(!['blog','article'].includes(String(value.type))||typeof value.locale!=='string'||typeof value.title!=='string'||!value.title.trim()||!object(value.content)||value.content.format!=='markdown'||typeof value.content.body!=='string'||Object.keys(value.content).some(k=>!['format','body'].includes(k)))throw new SocialHeroError('VALIDATION_ERROR','Type, taal, titel en Markdown-inhoud zijn verplicht.');
 if(value.hero!==undefined&&(!object(value.hero)||typeof value.hero.assetId!=='string'||!value.hero.assetId||typeof value.hero.alt!=='string'||!value.hero.alt.trim()||Object.keys(value.hero).some(k=>!['assetId','alt','focalPoint'].includes(k))))throw new SocialHeroError('INVALID_MEDIA','Geef bij een hero de assetId en alt-tekst op.',422);
 if(object(value.hero)&&value.hero.focalPoint!==undefined){const f=value.hero.focalPoint;if(!object(f)||Object.keys(f).some(k=>!['x','y'].includes(k))||!['x','y'].every(k=>typeof f[k]==='number'&&Number.isFinite(f[k])&&Number(f[k])>=0&&Number(f[k])<=1))throw new SocialHeroError('INVALID_MEDIA','Het focuspunt moet x en y tussen 0 en 1 bevatten.',422);}
 if(value.seo!==undefined&&(!object(value.seo)||Object.keys(value.seo).some(k=>!['title','description'].includes(k))))throw new SocialHeroError('VALIDATION_ERROR','Controleer de SEO-velden.');
 const {baseRevision,...data}=value;
 return {baseRevision:baseRevision as number|null,data};
}
const providerErrors:Record<string,{status:number;message:string}>={
 INVALID_PAIRING_CODE:{status:400,message:'Deze koppelcode is ongeldig. Kopieer een nieuwe code uit SocialHero.'},
 PAIRING_EXPIRED:{status:410,message:'De koppelcode of installatie is verlopen. Maak een nieuwe code in SocialHero.'},
 DESTINATION_MISMATCH:{status:409,message:'Deze code hoort bij een andere website of omgeving.'},
 INVALID_CREDENTIAL:{status:401,message:'SocialHero heeft deze koppeling afgewezen. Koppel opnieuw.'},
 PERMISSION_DENIED:{status:403,message:'SocialHero heeft de verificatie afgewezen. Koppel opnieuw.'},
 PAIRING_IN_PROGRESS:{status:409,message:'De verificatie is nog bezig. Controleer de verbinding opnieuw.'},
 RATE_LIMITED:{status:429,message:'Er zijn te veel koppelpogingen. Probeer later opnieuw.'},
};
export async function socialHeroRequest(origin:string,path:string,input:unknown,token:string|undefined,options:SocialHeroTransport={}){
 socialHeroOrigin(origin);
 if(!/^\/api\/integrations\/blog\/v1\/pairings\/(?:claim|[A-Za-z0-9_.:-]+\/verify)$/.test(path))throw new SocialHeroError('CONFIGURATION_REQUIRED','Ongeldig SocialHero-verificatiepad.',503);
 try{
  const response=await (options.fetch??fetch)(origin+path,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input)});
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16_384){await reader.cancel();throw new Error();}chunks.push(value);}}finally{reader.releaseLock();}
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new Error();}
  if(!response.ok){
   const code=object(value)&&typeof value.code==='string'?value.code:'';
   const controlled=providerErrors[code];
   if(controlled){const retry=Number(response.headers.get('retry-after'));throw new SocialHeroError(code,controlled.message,controlled.status,code==='RATE_LIMITED'&&Number.isFinite(retry)&&retry>0?Math.min(3600,retry):undefined);}
   throw new Error();
  }
  return value;
 }catch(error){if(error instanceof SocialHeroError)throw error;throw new SocialHeroError('PROVIDER_UNAVAILABLE','SocialHero is niet bereikbaar. Je invoer blijft bewaard; probeer opnieuw.',503,10);}
}
type Envelope={nonce:string;ciphertext:string;tag:string};
function key(){const raw=process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY||'',value=Buffer.from(raw,'base64');if(value.length!==32||!/^[A-Za-z0-9+/]{43}=$/.test(raw))throw new SocialHeroError('CONFIGURATION_REQUIRED','De beveiligde integratieopslag is nog niet ingericht.',503);return value;}
export function encryptSocialHeroSecret(value:string,binding:string):Envelope{
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),nonce);cipher.setAAD(Buffer.from(`socialhero:v1:${binding}`));
 return {nonce:nonce.toString('base64'),ciphertext:Buffer.concat([cipher.update(value,'utf8'),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
export function decryptSocialHeroSecret(value:Envelope,binding:string){
 try{const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(value.nonce,'base64'));decipher.setAAD(Buffer.from(`socialhero:v1:${binding}`));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'base64')),decipher.final()]).toString('utf8');}
 catch{throw new SocialHeroError('CONFIGURATION_REQUIRED','De tijdelijke verificatie kan niet worden hervat. Koppel opnieuw.',503);}
}
