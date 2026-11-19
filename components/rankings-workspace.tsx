'use client';
import CircuitQualification from './circuit-qualification';

import {useEffect,useState} from 'react';
import type {RankingsResponse} from '@/lib/ranking-types';
import type {RankingListView,RankingPolicy} from '@/lib/ranking-service-types';

type Action=Record<string,unknown> & {type:string};
type Club={id:string;name:string;clubAccess?:{canEditSettings:boolean}};
type Command=(action:Action)=>Promise<boolean>;
const date=(value:string)=>new Date(value).toLocaleString('nl-NL');
const delta=(value:number)=>`${value>0?'+':''}${value.toLocaleString('nl-NL',{maximumFractionDigits:2})}`;

function PolicyFields({policy,kind}:{policy?:RankingPolicy;kind:string}){
 return <>
  <div className="form-grid">
   <label className="field">Startscore<select name="startScore" defaultValue={policy?.startScore??501}>{[301,501,701].map(value=><option key={value}>{value}</option>)}</select></label>
   <label className="field">Toegestane best of legs<input name="bestOfLegs" defaultValue={policy?.bestOfLegs.join(', ')??'5, 7, 9, 11, 13, 15, 17, 19'} required pattern="[0-9, ]+"/></label>
  </div>
  {kind==='circuit'?<>
   <label className="field">Seizoen<input name="season" defaultValue={policy?.season??'2026-2027'} maxLength={80} required/></label>
   <div className="form-grid">
    <label className="field">Aantal evenementen<input name="eventCount" type="number" min={1} max={64} defaultValue={policy?.eventCount??8} required/></label>
    <label className="field">Beste resultaten tellen<input name="bestResults" type="number" min={1} max={64} defaultValue={policy?.bestResults??5} required/></label>
    <label className="field">Minimaal aantal starters<input name="minimumStarters" type="number" min={2} max={256} defaultValue={policy?.minimumStarters??16} required/></label>
   </div>
   <label><input name="allowGuests" type="checkbox" defaultChecked={policy?.allowGuests??false}/> Gastspelers toegestaan</label>
  </>:<div className="form-grid">
   <label className="field">Elo K-factor<input name="k" type="number" min={1} max={128} defaultValue={policy?.k??32} required/></label>
   <label className="field">Partijen voor plaatsing<input name="placementMatches" type="number" min={1} max={100} defaultValue={policy?.placementMatches??10} required/></label>
   <label className="field">Verschillende tegenstanders<input name="placementOpponents" type="number" min={1} max={100} defaultValue={policy?.placementOpponents??5} required/></label>
   <label className="field">Actief tot dagen na laatste partij<input name="activeDays" type="number" min={1} max={730} defaultValue={policy?.activeDays??90} required/></label>
  </div>}
 </>;
}
function readPolicy(form:HTMLFormElement):Record<string,unknown>{
 const input=new FormData(form),policy:Record<string,unknown>={startScore:Number(input.get('startScore')),bestOfLegs:String(input.get('bestOfLegs')).split(',').map(value=>Number(value.trim()))};
 for(const key of ['k','placementMatches','placementOpponents','activeDays','eventCount','bestResults','minimumStarters'])if(input.has(key))policy[key]=Number(input.get(key));
 if(input.has('season')){policy.season=String(input.get('season'));policy.allowGuests=input.has('allowGuests');}
 return policy;
}
function ListManagement({list,clubs,busy,command}:{list:RankingListView;clubs:Club[];busy:boolean;command:Command}){
 const [kind,setKind]=useState('rating');
 return <>
  {clubs.length>0&&<details className="panel"><summary>Clubrating of circuit aanmaken</summary>
   <form onSubmit={event=>{event.preventDefault();const form=event.currentTarget,input=new FormData(form);void command({type:'list.create',clubId:String(input.get('clubId')),kind,name:String(input.get('name')),policy:readPolicy(form)}).then(ok=>{if(ok)form.reset();});}}>
    <label className="field">Vereniging<select name="clubId">{clubs.map(club=><option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
    <label className="field">Naam<input name="name" maxLength={120} required/></label>
    <label className="field">Soort stand<select value={kind} onChange={event=>setKind(event.target.value)}><option value="rating">Spelersrating</option><option value="circuit">Circuitpunten</option></select></label>
    <PolicyFields key={kind} kind={kind}/><p>Publiceer de regels vóór erkenning van het eerste evenement. Daarna blijven deze regels bij het seizoen bewaard.</p>
    <button className="button gold" disabled={busy}>Lijst publiceren</button>
   </form>
  </details>}
  {list.canManage&&<details className="panel"><summary>{list.name} beheren</summary>
   {list.scope==='club'&&<form key={`${list.id}-${list.policyVersion}`} onSubmit={event=>{event.preventDefault();void command({type:'list.policy',listId:list.id,policy:readPolicy(event.currentTarget)});}}>
    <h3>Reglement wijzigen</h3><p>Dit kan zolang er geen evenement een erkenning heeft aangevraagd. Gebruik daarna een nieuwe seizoenlijst.</p>
    <PolicyFields policy={list.policy} kind={list.kind}/><button className="button" disabled={busy}>Nieuwe regelversie publiceren</button>
   </form>}
   <form onSubmit={event=>{event.preventDefault();const input=new FormData(event.currentTarget);void command({type:'list.close',listId:list.id,closesAt:new Date(String(input.get('closesAt'))).toISOString(),reason:String(input.get('reason'))});}}>
    <h3>Sluiten voor nieuwe evenementen</h3><label className="field">Ingangsdatum<input name="closesAt" type="datetime-local" required/></label>
    <label className="field">Reden<textarea name="reason" minLength={3} maxLength={1000} required/></label><button className="button" disabled={busy}>Sluitingsdatum vastleggen</button>
   </form>
  </details>}
 </>;
}

export default function RankingsWorkspace(){
 const [data,setData]=useState<RankingsResponse|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[filter,setFilter]=useState('all'),[view,setView]=useState('top'),[listId,setListId]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[clubs,setClubs]=useState<Club[]>([]);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/platform',{cache:'no-store',signal:controller.signal}).then(async response=>{if(response.ok){const result=await response.json();setClubs((result.clubs??[]).filter((club:Club)=>club.clubAccess?.canEditSettings));}}).catch(()=>{});return()=>controller.abort();},[]);
 useEffect(()=>{const controller=new AbortController();async function update(){try{const query=new URLSearchParams({view,status:filter});if(listId)query.set('listId',listId);const response=await fetch(`/api/rankings?${query}`,{cache:'no-store',signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error??'Rankings zijn tijdelijk niet beschikbaar.');setData(result);setError('');}catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Ververs de ranking om opnieuw te proberen.');}}void update();const timer=setInterval(()=>{if(document.visibilityState==='visible')void update();},5000);return()=>{controller.abort();clearInterval(timer);};},[view,filter,listId,refresh]);
 async function command(action:Action){if(busy)return false;setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/rankings/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),action})});const result=await response.json();if(!response.ok)throw new Error(result.error??'De rankingactie is niet opgeslagen.');setNotice('Opgeslagen. De actuele stand en regels worden opgehaald.');setRefresh(value=>value+1);return true;}catch(error){setError(error instanceof Error?error.message:'Probeer opnieuw.');return false;}finally{setBusy(false);}}
 const selected=data?.selectedList,circuit=selected?.kind==='circuit',rows=data?.rows??[];
 return <>
  <div className="page-title"><div><span className="eyebrow">DartFlow Rankings</span><h1>{selected?.name??'Spelersrating'}</h1><p>{circuit?'Eindplaatsen en punten per seizoen.':'Bevestigde singles · één gezamenlijke stand.'}</p></div><a className="button" href="/help?q=ranking">Hulp bij rankings</a></div>
  {error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}{!data&&!error&&<p role="status">Stand ophalen…</p>}
  {data&&<>
   {data.lists&&<label className="field">Kies een ranking of circuit<select value={listId||selected?.id||''} onChange={event=>{setListId(event.target.value);setFilter('all');}}>{data.lists.map(list=><option key={list.id} value={list.id}>{list.name} · {list.scope==='national'?'Landelijk':'Vereniging'} · {list.kind==='rating'?'Rating':'Circuit'}</option>)}</select></label>}
   <section className="panel"><h2>{circuit?'Mijn circuitstand':'Mijn rating'}</h2><strong style={{fontSize:'2rem',color:'var(--accent-text)'}}>{data.me?.displayRating??(circuit?0:data.policy.initialRating)}{circuit?' punten':''}</strong>
    {circuit?<><p>{data.me?.played??0} evenementen · de beste {selected?.policy.bestResults} van {selected?.policy.eventCount} resultaten tellen.</p>{data.me?.results?.length?<ul>{data.me.results.map(result=><li key={result.sourceId}>{result.points} punten · plaats {result.place} · {result.counting?'Telt mee':'Valt af'}</li>)}</ul>:<p>Nog geen definitieve circuiteindplaats geboekt.</p>}</>:<><p>{data.me?.provisional===false?'Geplaatst':'Voorlopig'} · {data.me?.played??0} van {data.policy.placementMatches} geldige partijen · {data.me?.uniqueOpponents??0} van {data.policy.placementOpponents} verschillende tegenstanders</p><p>De rankingbestemmingen en spelregels staan vóór de start vast. Bevestig de gevolgen vanuit je eigen account.</p>{selected?.scope!=='club'&&<a href="/app/play" className="button gold">Start een partij</a>}</>}
   </section>
   <section className="panel"><h2>{view==='around'?'Rond mijn positie':'Top 50'}</h2><div className="button-row"><button className="button" aria-pressed={view==='top'} onClick={()=>setView('top')}>Top 50</button><button className="button" aria-pressed={view==='around'} onClick={()=>setView('around')}>Rond mijn positie</button></div>
    {!circuit&&<label className="field">Spelers tonen<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">Alle spelers</option><option value="active">Actief en geplaatst</option><option value="provisional">Voorlopig</option><option value="inactive">Inactief</option></select></label>}
    {rows.length?<div className="table-wrap"><table><thead><tr><th scope="col">Positie</th><th scope="col">Speler</th><th scope="col">{circuit?'Punten':'Rating'}</th><th scope="col">{circuit?'Evenementen':'Partijen'}</th>{!circuit&&<th scope="col">Status</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.playerId}><td>{row.position??'—'}</td><th scope="row">{row.name}</th><td>{row.displayRating}</td><td>{row.played}</td>{!circuit&&<td>{row.provisional?'Voorlopig':row.active?'Actief':'Inactief'}</td>}</tr>)}</tbody></table></div>:<p>Er zijn nog geen geboekte uitslagen voor dit filter.</p>}
   </section>
   <section className="panel"><h2>Mijn mutaties</h2>{data.history.length?<div className="table-wrap"><table><thead><tr><th>Datum</th><th>{circuit?'Evenement':'Tegenstander'}</th><th>{circuit?'Plaats':'Rating'}</th><th>{circuit?'Punten':'Mutatie'}</th><th>Bron</th></tr></thead><tbody>{data.history.map(item=><tr key={`${item.sourceId??item.sequence}-${item.sourceRevision??0}`}><td>{date(item.recordedAt)}</td><td>{item.opponentName}</td><td>{circuit?item.place:`${Math.round(item.before)} → ${Math.round(item.after)}`}</td><td>{circuit?item.points:delta(item.delta)}</td><td>{item.sourceKind==='event'&&item.entityId?<a href={`/app/hall/${item.entityId}`}>Evenement bekijken</a>:<a href={`/wedstrijd/${item.matchId}`}>Partij bekijken</a>}</td></tr>)}</tbody></table></div>:<p>Nog geen geboekte uitslagen. Een oefenpartij verandert deze stand niet.</p>}</section>
   <section className="panel"><h2>Gepubliceerde spelregels</h2>{circuit?<><p>Seizoen {selected?.policy.season} · maximaal {selected?.policy.eventCount} evenementen · beste {selected?.policy.bestResults} resultaten · minimaal {selected?.policy.minimumStarters} echte starters.</p><p>{selected?.policy.allowGuests?'Gastspelers zijn toegestaan.':'Alleen toegelaten leden tellen mee.'} Een niet uitgespeelde partij levert geen partijrating op.</p></>:<p>Startwaarde {data.policy.initialRating} · Elo K={data.policy.k} · actief tot {data.policy.activeDays} dagen na de laatste partij. Eén boeking per toegelaten, uitgewerkte en bevestigde single. Persoonlijke toernooien leveren geen officiële punten op.</p>}{selected&&<p>{selected.policy.startScore} · dubbel uit · best of {selected.policy.bestOfLegs.join(', ')} legs. {selected.closesAt&&`Gesloten voor nieuwe evenementen vanaf ${date(selected.closesAt)}.`}</p>}<p>Regelversie {data.policy.version} · bijgewerkt {date(data.updatedAt)}</p></section>
   {!!data.approvals?.length&&<section className="panel"><h2>Erkenning beoordelen</h2>{data.approvals.map(declaration=><form key={declaration.id} onSubmit={event=>{event.preventDefault();const input=new FormData(event.currentTarget);void command({type:'event.approve',declarationId:declaration.id,decision:String(input.get('decision')),reason:String(input.get('reason'))});}}><h3>{declaration.eventName} → {declaration.listName}</h3><p>Regelversie {declaration.policy.version} · <a href={`/app/hall/${declaration.entityId}`}>Bekijk evenement en bestemming</a></p><label className="field">Besluit<select name="decision"><option value="approve">Goedkeuren</option><option value="reject">Afwijzen</option></select></label><label className="field">Reden<textarea name="reason" minLength={3} maxLength={1000} required/></label><button className="button" disabled={busy}>Besluit vastleggen</button></form>)}</section>}
   {selected&&<ListManagement list={selected} clubs={clubs} busy={busy} command={command}/>}<CircuitQualification data={data} busy={busy} command={command}/>
   {!!data.managementSources?.length&&<details className="panel"><summary>Bronnen beoordelen en stand herberekenen</summary><p>Een onafhankelijke beheerder behandelt een ongeldige bron. De volledige volgende keten wordt opnieuw berekend; een eerdere stand blijft bewaard.</p>{data.managementSources.map(source=><form key={`${source.id}-${source.revision}`} onSubmit={event=>{event.preventDefault();const input=new FormData(event.currentTarget);void command({type:'source.decide',sourceId:source.id,expectedRevision:source.revision,decision:source.verdict==='valid'?'void':'restore',reason:String(input.get('reason'))});}}><h3>{source.playersNames.join(' · ')}</h3><p>{source.kind==='event'?'Evenement':'Partij'} · {source.verdict==='valid'?'Erkend':'Ongeldig verklaard'} · versie {source.revision}</p><p>{source.reason}</p>{source.matchId&&<a href={`/wedstrijd/${source.matchId}`}>Bekijk primaire uitslag</a>}<label className="field">Reden van besluit<textarea name="reason" minLength={3} maxLength={1000} required/></label><button className="button" disabled={busy}>{source.verdict==='valid'?'Bron ongeldig verklaren en herberekenen':'Erkenning herstellen en herberekenen'}</button></form>)}</details>}
  </>}
 </>;
}
