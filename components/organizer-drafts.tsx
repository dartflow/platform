'use client';

import{useCallback,useEffect,useRef,useState}from'react';
import type{OrganizerDraft,OrganizerDraftKind,OrganizerDraftResponse,OrganizerOwnership}from'@/lib/organizer-drafts-types';

function formValues(form:HTMLFormElement):Record<string,unknown>{
 const values:Record<string,unknown>={};for(const[key,value]of new FormData(form))if(typeof value==='string'){const old=values[key];values[key]=old===undefined?value:Array.isArray(old)?[...old,value]:[old,value];}
 for(const control of Array.from(form.elements))if(control instanceof HTMLInputElement&&control.type==='checkbox'&&control.name)values[control.name]=control.checked;
 return values;
}
function context(values:Record<string,unknown>):{ownership:OrganizerOwnership;clubId:string|null}{
 const clubId=String(values.clubId??'');return values.scope==='national'||values.ownership==='platform'?{ownership:'platform',clubId:null}:clubId==='personal'||values.ownership==='personal'?{ownership:'personal',clubId:null}:clubId?{ownership:'club',clubId}:{ownership:'platform',clubId:null};
}
function restoreValues(form:HTMLFormElement,values:Record<string,unknown>){
 for(const control of Array.from(form.elements)){
  if(!(control instanceof HTMLInputElement||control instanceof HTMLSelectElement||control instanceof HTMLTextAreaElement)||!control.name||values[control.name]===undefined)continue;
  const value=values[control.name];
  if(control instanceof HTMLInputElement&&control.type==='checkbox'){control.checked=Array.isArray(value)?value.includes(control.value):value===true||value==='on';}
  else if(control instanceof HTMLSelectElement&&control.multiple){for(const option of Array.from(control.options))option.selected=Array.isArray(value)&&value.includes(option.value);}
  else{const prototype=control instanceof HTMLInputElement?HTMLInputElement.prototype:control instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(control,String(value??''));}
  control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));
 }
}

/** A single form adapter is shared by the tournament and season creation flows. */
export default function OrganizerDrafts({actorId,kind}:{actorId:string;kind:OrganizerDraftKind}){
 const section=useRef<HTMLDivElement>(null),current=useRef<OrganizerDraft|null>(null),newId=useRef<string|null>(null),restoring=useRef(false),saving=useRef(false),pending=useRef(false),saveLatest=useRef<()=>Promise<void>>(async()=>{}),conflict=useRef(false),controllers=useRef<AbortController[]>([]),actor=useRef(actorId);
 const [drafts,setDrafts]=useState<OrganizerDraft[]>([]),[selected,setSelected]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{const controller=new AbortController();controllers.current.push(controller);try{const response=await fetch(`/api/organizer-drafts?kind=${kind}`,{cache:'no-store',signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error??'Concepten zijn tijdelijk niet beschikbaar.');if(actor.current===actorId)setDrafts(result.drafts??[]);}catch(e){if(!controller.signal.aborted&&actor.current===actorId)setError(e instanceof Error?e.message:'Concepten ophalen mislukt.');}},[actorId,kind]);
 const save=useCallback(async()=>{
  const form=section.current?.closest('form');if(!form||conflict.current||restoring.current)return;if(saving.current){pending.current=true;return;}
  const values=formValues(form),scope=context(values),existing=current.current;
  if(kind==='season'&&scope.ownership==='club'&&!scope.clubId)return;
  const same=existing&&existing.kind===kind&&existing.ownership===scope.ownership&&existing.clubId===scope.clubId;
  if(existing&&!same){current.current=null;newId.current=null;}
  const id=same?existing.id:newId.current??crypto.randomUUID();newId.current=id;
  const requestActor=actorId,controller=new AbortController();controllers.current.push(controller);saving.current=true;setBusy(true);
  try{
   const response=await fetch('/api/organizer-drafts/actions',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({requestId:crypto.randomUUID(),action:{type:'draft.save',id,expectedRevision:same?existing.revision:0,kind,...scope,name:String(values.name??'').trim()||'Nieuw organisatieconcept',step:'instellingen',values}})});
   const result=await response.json()as OrganizerDraftResponse&{error?:string};if(!response.ok){if(response.status===409)conflict.current=true;throw new Error(result.error??'Concept opslaan mislukt.');}
   if(actor.current!==requestActor)return;current.current=result.draft??null;setSelected(result.id);setError('');setNotice('Concept opgeslagen. Je kunt op een ander apparaat verdergaan.');await refresh();
  }catch(e){if(!controller.signal.aborted&&actor.current===requestActor)setError(e instanceof Error?e.message:'Concept opslaan mislukt.');}
  finally{saving.current=false;if(actor.current===requestActor){setBusy(false);if(pending.current){pending.current=false;void saveLatest.current();}}}
 },[actorId,kind,refresh]);
 useEffect(()=>{
  actor.current=actorId;saveLatest.current=save;current.current=null;newId.current=null;conflict.current=false;pending.current=false;let timer:ReturnType<typeof setTimeout>|undefined;
  void refresh();const form=section.current?.closest('form');
  const changed=(event:Event)=>{if(restoring.current||section.current?.contains(event.target as Node))return;if(timer)clearTimeout(timer);timer=setTimeout(()=>void save(),1200);};
  form?.addEventListener('input',changed);form?.addEventListener('change',changed);
  return()=>{if(timer)clearTimeout(timer);form?.removeEventListener('input',changed);form?.removeEventListener('change',changed);for(const controller of controllers.current)controller.abort();controllers.current=[];};
 },[actorId,kind,refresh,save]);
 function load(){const draft=drafts.find(row=>row.id===selected),form=section.current?.closest('form');if(!draft||!form)return;restoring.current=true;current.current=draft;newId.current=draft.id;conflict.current=false;restoreValues(form,draft.values);requestAnimationFrame(()=>{restoreValues(form,draft.values);restoring.current=false;});setError('');setNotice(`Concept geladen · revisie ${draft.revision}.`);}
 async function remove(){const draft=drafts.find(row=>row.id===selected);if(!draft)return;setBusy(true);try{const response=await fetch('/api/organizer-drafts/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),action:{type:'draft.delete',id:draft.id,expectedRevision:draft.revision}})});const result=await response.json();if(!response.ok)throw new Error(result.error??'Verwijderen mislukt.');if(current.current?.id===draft.id){current.current=null;newId.current=null;conflict.current=false;}setSelected('');setNotice('Concept verwijderd.');setError('');await refresh();}catch(e){setError(e instanceof Error?e.message:'Verwijderen mislukt.');}finally{setBusy(false);}}
 return <div className="panel" ref={section} aria-label="Organisatieconcepten"><h3>Concept bewaren en hervatten</h3><p>Wijzigingen worden na het invoeren opgeslagen. Clubs delen concepten met hun bevoegde organisatoren.</p><label className="field">Opgeslagen concept<select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Kies een concept</option>{drafts.map(draft=><option key={draft.id}value={draft.id}>{draft.name} · {draft.ownership==='personal'?'persoonlijk':draft.ownership==='club'?'vereniging':'platform'} · revisie {draft.revision}</option>)}</select></label><div className="button-row"><button type="button"className="button"disabled={busy||!selected}onClick={load}>Concept laden</button><button type="button"className="button"disabled={busy||conflict.current}onClick={()=>void save()}>Concept opslaan</button><button type="button"className="button"disabled={busy||!selected}onClick={()=>void remove()}>Concept verwijderen</button><button type="button"className="button"disabled={busy}onClick={()=>{current.current=null;newId.current=null;conflict.current=false;setSelected('');setError('');setNotice('Je invoer wordt als nieuw concept bewaard.');}}>Bewaar als nieuw concept</button><button type="button"className="button"disabled={busy}onClick={()=>void refresh()}>Concepten verversen</button></div>{notice&&<p role="status">{notice}</p>}{error&&<p role="alert"className="notice error">{error}</p>}</div>;
}
