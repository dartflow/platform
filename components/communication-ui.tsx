"use client";

import {useCallback,useEffect,useRef,useState} from 'react';

export function displayTime(value:string|null|undefined){
 if(!value)return 'Tijdstip niet beschikbaar';
 const time=new Date(value);
 return Number.isNaN(time.getTime())?'Tijdstip niet beschikbaar':time.toLocaleString('nl-NL',{dateStyle:'medium',timeStyle:'short'});
}

export function useCommunicationResource<T>(url:string){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
 const refresh=useCallback(()=>setVersion(value=>value+1),[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);
  void fetch(url,{cache:'no-store',signal:controller.signal}).then(async response=>{
   const result=await response.json();
   if(!response.ok)throw new Error(result.error??'Deze gegevens zijn niet beschikbaar.');
   if(!controller.signal.aborted){setData(result);setError('');}
  }).catch(error=>{if(!controller.signal.aborted){setData(null);setError(error instanceof Error?error.message:'Ververs om opnieuw te proberen.');}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[url,version]);
 return {data,error,loading,refresh,setData};
}

/** Keep the exact request after a lost acknowledgement; a retry cannot create a second action. */
export function useCommunicationCommand<C extends {requestId:string},R>(url:string,onSuccess?:(result:R,command:C)=>void){
 const pending=useRef<C|null>(null),inflight=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(false);
 const success=useRef(onSuccess);useEffect(()=>{success.current=onSuccess;},[onSuccess]);
 const send=useCallback(async(command?:C):Promise<R|undefined>=>{
  if(inflight.current)return;
  if(command&&pending.current){setError('Rond eerst de vorige aanvraag af met Opnieuw proberen. Je nieuwe invoer blijft staan.');return;}
  const current=command??pending.current;if(!current)return;
  pending.current=current;inflight.current=true;setBusy(true);setError('');setRetry(false);
  try{
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(current)});
   const result=await response.json();
   if(!response.ok){if(response.status<500){pending.current=null;}throw new Error(result.error??'De wijziging is niet opgeslagen.');}
   pending.current=null;success.current?.(result,current);return result as R;
  }catch(error){setError(error instanceof Error?error.message:'De ontvangst is niet bevestigd. Probeer dezelfde aanvraag opnieuw.');setRetry(Boolean(pending.current));}
  finally{inflight.current=false;setBusy(false);}
 },[url]);
 return {send,busy,error,retry};
}

export function CommunicationFeedback({error,retry,busy,onRetry}:{error:string;retry?:boolean;busy?:boolean;onRetry?:()=>void}){
 return error?<div className="notice error communication-error" role="alert"><p>{error}</p>{retry&&<button type="button" className="button" disabled={busy} onClick={onRetry}>Opnieuw proberen</button>}</div>:null;
}

export function CommunicationLoading({loading,error,onRetry}:{loading:boolean;error:string;onRetry:()=>void}){
 return <>{loading&&<p role="status">Gegevens ophalen…</p>}{error&&<div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={onRetry}>Opnieuw laden</button></div>}</>;
}
