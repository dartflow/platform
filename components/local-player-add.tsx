"use client";

import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {validUsername} from '@/lib/display-name';
import styles from './local-player-add.module.css';

type Attempt={requestId:string;lobbyId:string;expectedRevision:number;username:string};

/** This authorizes one lobby seat only. PINs are never retained with drafts or receipts. */
export default function LocalPlayerAdd({lobbyId,revision,boardId,disabled,onRefresh}:{lobbyId:string;revision:number;boardId:string;disabled:boolean;onRefresh:()=>Promise<void>}){
  const [open,setOpen]=useState(false),[username,setUsername]=useState(''),[pin,setPin]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState<Attempt|null>(null);
  const ids=useId(),input=useRef<HTMLInputElement>(null),active=useRef(false),request=useRef<AbortController|null>(null);
  useEffect(()=>{
    const clear=()=>{setPin('');};
    const visibility=()=>{if(document.visibilityState!=='visible')clear();};
    window.addEventListener('pagehide',clear);window.addEventListener('popstate',clear);
    document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('pagehide',clear);window.removeEventListener('popstate',clear);document.removeEventListener('visibilitychange',visibility);request.current?.abort();};
  },[]);
  useEffect(()=>{if(open)input.current?.focus();else setPin('');},[open]);
  async function submit(event:FormEvent){
    event.preventDefault();if(active.current||disabled)return;
    const value=pin;setPin('');setMessage('');setError('');
    if(!validUsername(username)){setError('Vul de gebruikersnaam van je tegenstander in.');return;}
    if(!/^[0-9]{6}$/.test(value)&&!(pending&&value==='')){setError('Vul precies zes cijfers in voor de spelerspincode.');return;}
    const attempt=pending?.username===username.trim()?pending:{requestId:crypto.randomUUID(),lobbyId,expectedRevision:revision,username:username.trim()};
    setPending(attempt);active.current=true;setBusy(true);request.current=new AbortController();
    try{
      const response=await fetch('/api/player-pin/lobby-add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...attempt,pin:value}),signal:AbortSignal.any([request.current.signal,AbortSignal.timeout(15000)])});
      const body=await response.json();
      if(!response.ok){if(response.status<500)setPending(null);throw new Error(typeof body.error==='string'?body.error:'De speler kon niet worden toegevoegd.');}
      setPending(null);setUsername('');setOpen(false);setMessage('Speler toegevoegd. Jouw account blijft aangemeld.');await onRefresh();
    }catch(cause){
      if(cause instanceof Error&&cause.name==='AbortError')return;
      setError(cause instanceof TypeError?'De verbinding is onderbroken. Controleer de lobby en probeer met dezelfde gebruikersnaam opnieuw; je pincode is gewist.':cause instanceof Error?cause.message:'De speler kon niet worden toegevoegd.');
      await onRefresh();
    }finally{setPin('');setBusy(false);active.current=false;request.current=null;}
  }
  return <section className={styles.wrapper} aria-label="Een telefoon, twee spelers">
    {!open?<button className="button ghost" type="button" disabled={disabled||busy} onClick={()=>{setError('');setMessage('');setOpen(true);}}>Speler toevoegen</button>:<form className={styles.form} onSubmit={event=>void submit(event)}>
      <h3>Speler toevoegen</h3><p id={`${ids}-hint`}>Geef je telefoon aan je tegenstander. Die vult zelf de eigen gebruikersnaam en spelerspincode in.</p>
      <label htmlFor={`${ids}-username`}>Gebruikersnaam<input ref={input} id={`${ids}-username`} value={username} onChange={event=>{setUsername(event.target.value);setPending(null);}} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={81} required disabled={busy} placeholder="@gebruikersnaam"/></label>
      <label htmlFor={`${ids}-pin`}>Spelerspincode<input id={`${ids}-pin`} type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={event=>setPin(event.target.value.replace(/[^0-9]/g,'').slice(0,6))} autoComplete="off" aria-describedby={`${ids}-hint`} required disabled={busy} /></label>
      <div className={styles.actions}><button className="button gold" type="submit" disabled={busy||disabled}>{busy?'Controleren…':'Toevoegen'}</button><button className="button ghost" type="button" disabled={busy} onClick={()=>{setPin('');setPending(null);setOpen(false);setError('');}}>Sluiten</button></div>
      {pending&&<button className="button ghost small" type="button" disabled={busy} onClick={event=>void submit(event)}>Koppeling controleren zonder pincode</button>}
      <p className={styles.scan}>Liever op je eigen telefoon? <a href={`/baan/${encodeURIComponent(boardId)}`}>Scan zelf de vaste baan-QR</a>.</p>
    </form>}
    {error&&<p className="notice error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </section>;
}
