'use client';

import {useEffect,useState} from 'react';
import type {BlogTaxonomy,BlogTaxonomyEntry,BlogTaxonomyKind} from '../lib/blog-taxonomy';

type FormState={kind:BlogTaxonomyKind;id:string;name:string;revision:number};
const empty=(kind:BlogTaxonomyKind):FormState=>({kind,id:'',name:'',revision:0});
export default function BlogTaxonomySettings(){
 const [taxonomy,setTaxonomy]=useState<BlogTaxonomy|null>(null),[form,setForm]=useState<FormState>(empty('author')),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/blog/taxonomy',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>{
   const value=await response.json();if(!response.ok)throw Error(value.message||'De lijst kon niet worden geladen.');setTaxonomy(value);
  }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'De lijst kon niet worden geladen.');});
  return()=>controller.abort();
 },[]);
 const entries=form.kind==='author'?taxonomy?.authors:taxonomy?.categories;
 const selected=entries?.find(entry=>entry.id===form.id&&form.revision>0);
 async function change(action:'save'|'archive'|'restore',entry?:BlogTaxonomyEntry){
  setBusy(true);setError('');setMessage('');
  try{
   const response=await fetch('/api/blog/taxonomy',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,kind:form.kind,id:entry?.id??form.id,name:action==='save'?form.name:undefined,expectedRevision:entry?.revision??form.revision,requestId:crypto.randomUUID()})});
   const value=await response.json();if(!response.ok)throw Error(value.message||'De wijziging kon niet worden opgeslagen.');
   setTaxonomy({authors:value.authors,categories:value.categories});
   if(action==='save')setForm({...form,id:value.entry.id,name:value.entry.name,revision:value.entry.revision});
   else if(entry?.id===form.id)setForm({...form,name:value.entry.name,revision:value.entry.revision});
   setMessage('Opgeslagen. Sla een openstaand artikel op en herlaad daarna de pagina om de keuzelijsten in de editor te verversen.');
  }catch(error){setError(error instanceof Error?error.message:'De wijziging kon niet worden opgeslagen. Je invoer blijft bewaard.');}
  finally{setBusy(false);}
 }
 return <details className="studio-panel socialhero-settings" id="blog-taxonomy-settings">
  <summary>Auteurs en categorieën beheren</summary>
  <p className="socialhero-help">Voeg namen toe of wijzig bestaande namen. De vaste ID blijft behouden. Gearchiveerde vermeldingen blijven zichtbaar bij bestaande artikelen.</p>
  {error&&<p role="alert" className="studio-dialog-error">{error}</p>}
  {message&&<p role="status" className="socialhero-help">{message}</p>}
  <label className="studio-field">Lijst<select value={form.kind} disabled={busy} onChange={event=>{setForm(empty(event.target.value as BlogTaxonomyKind));setError('');}}><option value="author">Auteurs</option><option value="category">Categorieën</option></select></label>
  {taxonomy?<ul>{entries?.map(entry=><li key={entry.id}>
   <span>{entry.name}{!entry.active?' (gearchiveerd)':''}</span>{' '}
   <button type="button" className="studio-text-button" disabled={busy} onClick={()=>{setForm({kind:form.kind,id:entry.id,name:entry.name,revision:entry.revision});setError('');}}>Bewerken</button>{' '}
   {!(form.kind==='author'&&entry.id==='redactie'||form.kind==='category'&&entry.id==='nieuws')&&<button type="button" className="studio-text-button" disabled={busy} onClick={()=>void change(entry.active?'archive':'restore',entry)}>{entry.active?'Archiveren':'Herstellen'}</button>}
  </li>)}</ul>:<p className="socialhero-help">Lijst laden…</p>}
  <form onSubmit={event=>{event.preventDefault();void change('save');}}>
   <h3>{form.revision?'Naam wijzigen':form.kind==='author'?'Auteur toevoegen':'Categorie toevoegen'}</h3>
   <label className="studio-field">Vaste ID<input value={form.id} onChange={event=>setForm({...form,id:event.target.value})} required pattern="[a-z0-9][a-z0-9-]{0,99}" maxLength={100} disabled={busy||form.revision>0}/><small>Bijvoorbeeld clubredactie. Kleine letters, cijfers en streepjes.</small></label>
   <label className="studio-field">Naam<input value={form.name} onChange={event=>setForm({...form,name:event.target.value})} required maxLength={120} disabled={busy}/></label>
   {selected&&!selected.active&&<p className="socialhero-help">Deze vermelding is gearchiveerd. Gebruik Herstellen om deze weer aan nieuwe artikelen toe te wijzen.</p>}
   <div className="socialhero-actions"><button className="button button-primary button-small" type="submit" disabled={busy||!taxonomy}>{busy?'Opslaan…':'Opslaan'}</button>{form.revision>0&&<button className="button button-outline button-small" type="button" disabled={busy} onClick={()=>setForm(empty(form.kind))}>Nieuwe vermelding</button>}</div>
  </form>
 </details>;
}
