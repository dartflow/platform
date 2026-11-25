"use client";

import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import type {OcheLayout} from '@/lib/oche-device-types';

/** D-pad navigation is confined to explicit setup/menu surfaces. */
export function ocheDpad(event:KeyboardEvent<HTMLElement>,back:()=>void){
 if(event.key==='Escape'||event.key==='BrowserBack'||event.key==='GoBack'){event.preventDefault();back();return;}
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
 const items=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)')).filter(item=>item.getClientRects().length>0);
 if(!items.length)return;
 const index=items.indexOf(document.activeElement as HTMLElement),delta=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
 event.preventDefault();items[(index+delta+items.length)%items.length]?.focus();
}

export default function OcheLayoutWizard({initial,canDefer,busy,error,onSave,onClose,allowDual=true}:{initial:OcheLayout|null;allowDual?:boolean;canDefer:boolean;busy:boolean;error:string;onSave:(layout:OcheLayout)=>void;onClose:()=>void}){
 const [layout,setLayout]=useState<OcheLayout>(()=>initial??{orientation:window.innerWidth>=window.innerHeight?'landscape':'portrait',scoreboards:1});
 const [step,setStep]=useState(1),root=useRef<HTMLElement>(null);
 useEffect(()=>{(root.current?.querySelector<HTMLElement>('[aria-pressed="true"]')??root.current?.querySelector<HTMLElement>('button'))?.focus();},[step]);
 const back=()=>{if(step===2)setStep(1);else if(canDefer)onClose();};
 return <section ref={root} className="oche-layout-wizard" role="dialog" aria-modal="true" aria-labelledby="oche-layout-title" onKeyDown={event=>ocheDpad(event,back)}>
  <img src="/assets/dartflow-logo.svg" alt="DartFlow" className="oche-device-logo"/>
  <p className="eyebrow">Oche Live · Schermindeling</p>
  <h1 id="oche-layout-title">{step===1?'Hoe staat dit scherm?':'Hoeveel scoreborden wil je tonen?'}</h1>
  <p>{step===1?'Bevestig de schermstand. De keuze blijft bewaard op dit scherm.':'Kies de indeling van je tv. De beheerder wijst daarna de banen toe.'}</p>
  <div className="oche-layout-choices">{step===1?<>
   <button type="button" aria-pressed={layout.orientation==='portrait'} onClick={()=>setLayout({orientation:'portrait',scoreboards:1})}><span aria-hidden="true" className="oche-layout-mini" data-orientation="portrait"><i>1</i></span><strong>Verticaal</strong><small>9:16 · één scorebord</small></button>
   <button type="button" aria-pressed={layout.orientation==='landscape'} onClick={()=>setLayout({...layout,orientation:'landscape'})}><span aria-hidden="true" className="oche-layout-mini" data-orientation="landscape"><i>1</i></span><strong>Horizontaal</strong><small>16:9</small></button>
  </>:<>{(allowDual?[1,2] as const:[1] as const).map(count=><button key={count} type="button" aria-pressed={layout.scoreboards===count} onClick={()=>setLayout({orientation:'landscape',scoreboards:count})}><span aria-hidden="true" className="oche-layout-mini" data-orientation="landscape" data-scoreboards={count}><i>{count===2?'Links':'1'}</i>{count===2&&<i>Rechts</i>}</span><strong>{count===1?'Eén scorebord':'Twee scoreborden'}</strong><small>{count===2?'Beschikbaar voor locaties':'Voor thuis en op locatie'}</small></button>)}</>}</div>
  {error&&<p className="oche-device-message" role="alert">{error}</p>}
  <footer>{step===2&&<button type="button" className="button" disabled={busy} onClick={()=>setStep(1)}>Terug</button>}{canDefer&&<button type="button" className="button" disabled={busy} onClick={onClose}>Later</button>}<button type="button" className="button gold" disabled={busy} onClick={()=>layout.orientation==='landscape'&&step===1?setStep(2):onSave(layout)}>{busy?'Opslaan…':layout.orientation==='landscape'&&step===1?'Doorgaan':'Opslaan en doorgaan'}</button></footer>
 </section>;
}
