'use client';

import {useCallback,useEffect,useState} from 'react';

type Connection={
  status:'disconnected'|'pending'|'active'|'expired'|'rejected';
  environment:string;
  siteId:string;
  origin:string;
  connectionId:string|null;
  destinationId:string|null;
  draft:boolean;
  publish:boolean;
  hasSavedPolicy?:boolean;
  previousConnectionActive?:boolean;
  lastCheckedAt:string|null;
  scopes:string[];
  configured:boolean;
  needsCode?:boolean;
};
type ConnectionResponse={connection:Connection;message?:string};
type Action={action:'pair';code:string;draft:boolean;publish:boolean}|{action:'check'|'disconnect'}|{action:'policy';draft:boolean;publish:boolean};
const endpoint='/api/blog/socialhero';
const statuses:Record<Connection['status'],string>={disconnected:'Niet gekoppeld',pending:'Verificatie nog niet afgerond',active:'Actief',expired:'Koppeling verlopen',rejected:'Koppeling afgewezen'};
const scopes:Record<string,string>={read:'Lezen',draft:'Concepten en afbeeldingen beheren',publish:'Zelfstandig publiceren'};
function checkedAt(value:string|null){return value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('nl-NL',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Amsterdam'}).format(new Date(value)):'Nog niet succesvol gecontroleerd';}
const errors:Record<string,string>={
  INVALID_PAIRING_CODE:'Deze koppelcode is ongeldig of al gebruikt. Maak in SocialHero een nieuwe code aan.',
  PAIRING_EXPIRED:'Deze koppelcode of installatie is verlopen. Maak in SocialHero een nieuwe koppelcode aan.',
  DESTINATION_MISMATCH:'Deze code hoort bij een andere website of omgeving. Kies in SocialHero de website en omgeving die hieronder staan.',
  PAIRING_IN_PROGRESS:'De verificatie is nog niet afgerond. Kies Verbinding controleren om de installatie te hervatten.',
  RATE_LIMITED:'Er zijn te veel pogingen gedaan. Wacht even voordat je het opnieuw probeert.',
};
class ConnectionError extends Error{
  constructor(message:string,readonly status:number){super(message);}
}
async function request(action?:Action,signal?:AbortSignal):Promise<ConnectionResponse>{
  const response=await fetch(endpoint,{method:action?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,...(action?{headers:{'Content-Type':'application/json'},body:JSON.stringify(action)}:{})});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new ConnectionError(errors[data?.code]||(typeof data?.message==='string'?data.message:'De verbinding kan nu niet worden gecontroleerd. Probeer het opnieuw.'),response.status);
  if(!data?.connection)throw new Error('De server gaf geen verbindingsstatus terug. Probeer het opnieuw.');
  return data;
}

export default function SocialHeroConnection(){
  const[connection,setConnection]=useState<Connection|null>(null),[code,setCode]=useState(''),[draft,setDraft]=useState(true),[publish,setPublish]=useState(true);
  const[busy,setBusy]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState(''),[reauth,setReauth]=useState(false),[confirmDisconnect,setConfirmDisconnect]=useState(false);
  const update=useCallback((data:ConnectionResponse,syncPolicy=true)=>{setConnection(data.connection);if(syncPolicy){setDraft(data.connection.draft);setPublish(data.connection.publish);}},[]);
  const report=useCallback((cause:unknown)=>{setError(cause instanceof ConnectionError?cause.message:'De server is niet bereikbaar. Je invoer is behouden. Probeer het opnieuw.');setReauth(cause instanceof ConnectionError&&cause.status===401);},[]);
  useEffect(()=>{
    const controller=new AbortController();
    void request(undefined,controller.signal).then(update).catch(cause=>{if(!controller.signal.aborted)report(cause);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[update,report]);

  async function perform(action?:Action){
    setBusy(true);setError('');setMessage('');setReauth(false);
    try{
      const data=await request(action);update(data);
      if((action?.action==='pair'&&!data.connection.needsCode&&data.connection.connectionId)||(action?.action==='check'&&data.connection.status==='active'))setCode('');
      if(action?.action==='disconnect'){setCode('');setConfirmDisconnect(false);}
      setMessage(data.message||(action?.action==='policy'?'De toestemmingen zijn opgeslagen.':action?.action==='disconnect'?'SocialHero is ontkoppeld. De artikelen en je opgeslagen toestemmingen blijven bewaard.':action?.action==='pair'&&data.connection.status==='active'?'SocialHero is gekoppeld. De verbinding is geverifieerd.':action?.action==='check'?'De verbindingsstatus is bijgewerkt.':''));
    }catch(cause){
      report(cause);
      // A claim may have committed before the response or verification was interrupted.
      // Refresh the durable status while preserving the code and retry feedback.
      if(action?.action==='pair'||action?.action==='check'){
        try{update(await request(),false);}catch{/* Keep the last known status during a network failure. */}
      }
    }finally{setBusy(false);}
  }

  const active=connection?.status==='active',pending=connection?.status==='pending';
  const needsCode=pending&&(connection.needsCode||!connection.connectionId);
  const canPair=connection?.configured&&(!pending||needsCode);
  const canSavePolicy=active||Boolean(connection?.hasSavedPolicy&&connection.destinationId);
  return <section className="studio-panel socialhero-settings" id="socialhero-settings" aria-labelledby="socialhero-title" aria-busy={busy}>
    <div className="socialhero-heading"><div><h2 id="socialhero-title">SocialHero</h2><p>Koppel SocialHero om blogconcepten in DartFlow te beheren.</p></div><span className="studio-badge" data-state={active?'published':pending?'scheduled':'draft'}>{connection?statuses[connection.status]:'Status laden…'}</span></div>
    {error&&<p className="studio-status" data-error="true" role="alert">{error}</p>}
    {reauth&&<p className="socialhero-help">Je aanmelding is verlopen. <a href="/inloggen?next=%2Fblog%2Fbeheer" target="_blank" rel="noopener noreferrer">Meld je opnieuw aan in een nieuw tabblad ↗</a> en probeer het daarna opnieuw. Je koppelcode blijft in dit tabblad bewaard.</p>}
    {message&&<p className="studio-status" role="status">{message}</p>}
    {!connection&&!busy&&<button className="button button-outline button-small" type="button" onClick={()=>void perform()}>Status opnieuw ophalen</button>}
    {connection&&<div className="socialhero-grid">
      <div>
        <dl className="socialhero-facts"><div><dt>Omgeving</dt><dd>{connection.environment==='production'?'Productie':connection.environment==='staging'?'Staging':connection.environment}</dd></div><div><dt>Website</dt><dd>{connection.origin||'Nog niet ingesteld'}</dd></div><div><dt>Laatste controle</dt><dd>{checkedAt(connection.lastCheckedAt)}</dd></div></dl>
        {!connection.configured&&<p className="socialhero-help" role="status">De serverconfiguratie voor deze omgeving moet eerst worden ingericht voordat je kunt koppelen.</p>}
        {pending&&<p className="socialhero-help">{needsCode?'Het claimen van de code is nog niet bevestigd. Vul dezelfde code opnieuw in en kies Koppelen om de installatie te hervatten.':'De code is geclaimd, maar de verificatie is nog niet afgerond. Kies Verbinding controleren om verder te gaan.'}</p>}
        {pending&&connection.previousConnectionActive&&<p className="socialhero-help">De vorige verbinding blijft actief totdat deze installatie is bevestigd.</p>}
        {connection.status==='expired'&&<p className="socialhero-help">De voorlopige installatie is verlopen. Koppel opnieuw met een nieuwe code uit SocialHero.</p>}
        {connection.status==='rejected'&&<p className="socialhero-help">De verificatie is afgewezen. Controleer de website en omgeving in SocialHero en koppel opnieuw met een nieuwe code.</p>}
        {canPair&&<form id="socialhero-pairing-form" className="socialhero-pairing" onSubmit={event=>{event.preventDefault();if(code.trim())void perform({action:'pair',code:code.trim(),draft,publish});}}>
          <label className="studio-field" htmlFor="socialhero-code">{active?'Nieuwe koppelcode':'Eenmalige koppelcode'}<input id="socialhero-code" name="socialhero-code" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={code} onChange={event=>setCode(event.target.value)} disabled={busy} required maxLength={2048} aria-describedby="socialhero-code-help"/></label>
          <p className="socialhero-help" id="socialhero-code-help">Maak in SocialHero bij de blogbestemming voor deze website en omgeving een koppelcode aan. De code is tien minuten geldig.</p>
        </form>}
        <div className="socialhero-actions"><button className="button button-outline button-small" type="button" disabled={busy||!connection.configured} onClick={()=>void perform({action:'check'})}>Verbinding controleren</button>{(connection.connectionId||pending)&&<button className="button button-outline button-small" type="button" disabled={busy} onClick={()=>setConfirmDisconnect(true)}>Ontkoppelen</button>}</div>
        {confirmDisconnect&&<div className="socialhero-confirm" role="group" aria-labelledby="socialhero-disconnect-title"><p id="socialhero-disconnect-title">SocialHero ontkoppelen? De toegang wordt direct ingetrokken. Bestaande artikelen blijven bewaard.</p><div className="socialhero-actions"><button className="button button-outline button-small" type="button" disabled={busy} onClick={()=>setConfirmDisconnect(false)}>Annuleren</button><button className="button button-primary button-small" type="button" disabled={busy} onClick={()=>void perform({action:'disconnect'})}>Ja, ontkoppelen</button></div></div>}
      </div>
      <form className="socialhero-policy" onSubmit={event=>{event.preventDefault();if(canSavePolicy)void perform({action:'policy',draft,publish});}}>
        <h3>Toegang voor deze website</h3>
        <p className="socialhero-help">{connection.hasSavedPolicy?'Eerder uitgezette rechten blijven bij opnieuw koppelen uit. Je kunt ze met Toestemmingen opslaan bewust weer aanzetten.':'Kies welke taken SocialHero mag uitvoeren. Met Koppelen bevestig je deze toestemmingen voor de bestemming.'}</p>
        <label className="studio-checkbox"><input type="checkbox" checked={draft} onChange={event=>{setDraft(event.target.checked);if(!event.target.checked)setPublish(false);}} disabled={busy||(!canSavePolicy&&!canPair)}/>SocialHero mag concepten en afbeeldingen aanmaken en bijwerken.</label>
        <label className="studio-checkbox"><input type="checkbox" checked={publish} onChange={event=>setPublish(event.target.checked)} disabled={busy||!draft||(!canSavePolicy&&!canPair)}/>SocialHero mag artikelen zelfstandig live zetten volgens de campagneplanning en de ingestelde goedkeuringsmodus.</label>
        <p className="socialhero-help">Zelfstandig publiceren vereist toestemming voor concepten. Als je concepten uitschakelt, gaat zelfstandig publiceren ook uit.</p>
        <p className="socialhero-help"><strong>Effectieve toegang:</strong> {connection.scopes.length?connection.scopes.map(scope=>scopes[scope]||scope).join(' · '):'Geen actieve toegang'}</p>
        {!active&&<p className="socialhero-help">Je bevestigt de gekozen toestemmingen met Koppelen.</p>}
        <div className="socialhero-actions">{canSavePolicy&&<button className="button button-outline button-small" type="submit" disabled={busy||(draft===connection.draft&&publish===connection.publish)}>Toestemmingen opslaan</button>}{canPair&&<button className="button button-primary button-small" type="submit" form="socialhero-pairing-form" disabled={busy||!code.trim()}>{busy?'Bezig…':active?'Opnieuw koppelen':'Koppelen'}</button>}</div>
      </form>
    </div>}
  </section>;
}
