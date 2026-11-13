import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DomainError} from './domain';

const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const secretHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function ocheKey(purpose:string):Buffer{
 let source=process.env.DARTFLOW_SCREEN_PAIRING_SECRET||process.env.DARTFLOW_MAIL_WORKER_TOKEN;
 if(!source&&process.env.DARTFLOW_DATA_MODE==='local'){
  const directory=join(process.cwd(),'.local');mkdirSync(directory,{recursive:true,mode:0o700});const file=join(directory,'oche-device.key');
  try{writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  source=readFileSync(file).toString('base64url');
 }
 if(!source||Buffer.byteLength(source)<32)throw new DomainError('screen_configuration','Schermkoppeling is nog niet geconfigureerd.',503);
 return createHmac('sha256',source).update(`dartflow:oche-display:v1:${purpose}`).digest();
}
export function normalizedOcheCode(value:unknown):string{
 const code=typeof value==='string'?value.replace(/[\s–-]/g,'').toUpperCase().replaceAll('O','0').replace(/[IL]/g,'1'):'';
 if(!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(code))throw new DomainError('invalid_code','De koppelcode is ongeldig, gebruikt of verlopen.',400);
 return code;
}
export const codeDigest=(code:string)=>createHmac('sha256',ocheKey('pairing-code')).update(normalizedOcheCode(code)).digest('hex');
export function newOcheCode():string{const bytes=randomBytes(8);return Array.from(bytes,byte=>alphabet[byte&31]).join('');}
export const formatOcheCode=(code:string)=>`${code.slice(0,4)}–${code.slice(4)}`;
export function encryptOcheReceipt(value:unknown):string{
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',ocheKey('receipt'),iv);
 const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');
}
export function decryptOcheReceipt<T>(value:string):T{
 const raw=Buffer.from(value,'base64url');const decipher=createDecipheriv('aes-256-gcm',ocheKey('receipt'),raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));
 return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8')) as T;
}
export function createOcheAccess(deviceId:string,version:number,expires:number):string{
 const payload=Buffer.from(JSON.stringify({d:deviceId,v:version,e:expires,a:'oche-display-v1'})).toString('base64url');
 return `${payload}.${createHmac('sha256',ocheKey('access')).update(payload).digest('base64url')}`;
}
export function readOcheAccess(value:string):{deviceId:string;version:number;expires:number}{
 try{
  const [raw,signature,extra]=value.split('.'),actual=Buffer.from(signature||''),expected=Buffer.from(createHmac('sha256',ocheKey('access')).update(raw).digest('base64url'));
  if(extra||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw 0;
  const decoded=JSON.parse(Buffer.from(raw,'base64url').toString());
  if(decoded.a!=='oche-display-v1'||typeof decoded.d!=='string'||!Number.isSafeInteger(decoded.v)||!Number.isSafeInteger(decoded.e))throw 0;
  return {deviceId:decoded.d,version:decoded.v,expires:decoded.e};
 }catch(error){if(error instanceof DomainError&&error.status===503)throw error;throw new DomainError('device_unauthorized','Dit scherm moet opnieuw worden gekoppeld.',401);}
}
