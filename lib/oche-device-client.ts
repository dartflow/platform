import type {OcheClaim,OcheManagement} from './oche-device-types';

export const OCHE_PAIR_CODE_KEY='dartflow-oche-pair-code';
/** A public user code, never an installation secret. Keep its representation identical to the API. */
export function normaliseOcheUserCode(value:string){return value.toUpperCase().replace(/[\s–—-]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');}
export function validOcheUserCode(value:string){return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(normaliseOcheUserCode(value));}
export function formattedOcheUserCode(value:string){const code=normaliseOcheUserCode(value);return code.length===8?`${code.slice(0,4)}–${code.slice(4)}`:code;}
export function claimCapacity(context:OcheManagement,scope:OcheClaim['scope'],locationId:string){return scope==='home'?context.home:context.locations.find(location=>location.locationId===locationId);}
export function canReplaceOcheDevice(capacity:{active:number;reserved:number;maximum:number;aboveLimit:boolean}|undefined){return Boolean(capacity&&!capacity.aboveLimit&&capacity.active<=capacity.maximum&&capacity.active>0);}
/** Central limit administration alone does not grant permission to pair a location's screen. */
export function pairableOcheLocations(locations:(Omit<OcheManagement['locations'][number],'canManageScreens'>&{canManageScreens?:boolean})[]){return locations.filter(location=>location.canManageScreens!==false);}

export class OcheClientError extends Error{
 constructor(message:string,readonly status:number,readonly code:string,readonly retryAfter:number=0){super(message);}
}
export async function ocheDeviceRequest<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(`/api/oche/v1/${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok){const error=typeof data?.message==='string'?data.message:typeof data?.error==='string'?data.error:typeof data?.error?.message==='string'?data.error.message:'Het scherm kon niet worden bijgewerkt. Probeer opnieuw.';throw new OcheClientError(error,response.status,String(data?.code??data?.error?.code??''),Number(response.headers.get('Retry-After'))||0);}
 return data as T;
}

/** Capture only the public temporary code, and remove the fragment before any navigation or request. */
export function captureOchePairCode(location:Pick<Location,'hash'|'pathname'|'search'>,history:Pick<History,'replaceState'>,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 const fragment=new URLSearchParams(location.hash.slice(1)),incoming=fragment.get('code');
 if(location.hash)history.replaceState(null,'',`${location.pathname}${location.search}`);
 if(incoming!==null){const code=normaliseOcheUserCode(incoming);if(validOcheUserCode(code)){storage.setItem(OCHE_PAIR_CODE_KEY,code);return code;}storage.removeItem(OCHE_PAIR_CODE_KEY);return '';}
 const stored=storage.getItem(OCHE_PAIR_CODE_KEY)??'';
 if(!validOcheUserCode(stored)){storage.removeItem(OCHE_PAIR_CODE_KEY);return '';}
 return normaliseOcheUserCode(stored);
}

/** A browser-wide lock carries public coordination only; credentials remain HttpOnly. */
export async function withOcheProfileLock<T>(name:string,action:()=>Promise<T>):Promise<T>{
 if(navigator.locks)return navigator.locks.request(`dartflow-oche-${name}`,action);
 const key=`dartflow-oche-${name}-lease`,owner=crypto.randomUUID();
 const pause=()=>new Promise(resolve=>setTimeout(resolve,90));
 for(let round=0;round<80;round++){
  let acquired=false;
  try{
   const raw=localStorage.getItem(key),lease=raw?JSON.parse(raw) as {owner:string;expires:number}:null;
   if(lease&&lease.expires>Date.now()){await pause();continue;}
   localStorage.setItem(key,JSON.stringify({owner,expires:Date.now()+7000}));await pause();
   acquired=(JSON.parse(localStorage.getItem(key)??'null') as {owner:string}|null)?.owner===owner;
  }catch{return action();}
  if(!acquired)continue;
  try{return await action();}finally{try{if((JSON.parse(localStorage.getItem(key)??'null') as {owner:string}|null)?.owner===owner)localStorage.removeItem(key);}catch{/* The expiring public lease clears itself. */}}
 }
 return action();
}
export const withOcheInstallationLock=(action:()=>Promise<void>)=>withOcheProfileLock('installation',action);
