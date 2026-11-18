'use client';
import {useEffect,useState} from 'react';
type State={configured:boolean;enabled:boolean;email:string|null};
type Credentials={email:string;password:string;playerPin?:string;companionUsername?:string;companionPin?:string;companionEmail?:string;companionPassword?:string;boardUrl?:string};
export function PlayReviewPanel(){
 const [state,setState]=useState<State|null>(null),[credentials,setCredentials]=useState<Credentials|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState('');
 useEffect(()=>{let active=true;fetch('/api/admin/play-review',{cache:'no-store'}).then(async response=>{if(!response.ok)return;const data=await response.json();if(active)setState(data);}).catch(()=>{});return()=>{active=false;};},[]);
 useEffect(()=>{if(!credentials)return;const clear=()=>setCredentials(null);const timer=setTimeout(clear,60000);const onVisibility=()=>{if(document.hidden)clear();};document.addEventListener('visibilitychange',onVisibility);return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',onVisibility);};},[credentials]);
 async function reveal(){setError('');setBusy(true);try{const response=await fetch('/api/admin/play-review',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'De gegevens zijn tijdelijk niet beschikbaar.');setCredentials(data);}catch(value){setError(value instanceof Error?value.message:'De gegevens zijn tijdelijk niet beschikbaar.');}finally{setBusy(false);}}
 const fields=credentials?[
  {label:'E-mailadres',value:credentials.email,secret:false},
  {label:'Wachtwoord',value:credentials.password,secret:true},
  {label:'Spelerspincode beoordelaar',value:credentials.playerPin,secret:true},
  {label:'Gebruikersnaam tweede reviewspeler',value:credentials.companionUsername,secret:false},
  {label:'E-mailadres tweede reviewspeler',value:credentials.companionEmail,secret:false},
  {label:'Wachtwoord tweede reviewspeler',value:credentials.companionPassword,secret:true},
  {label:'Spelerspincode tweede reviewspeler',value:credentials.companionPin,secret:true},
  {label:'Vaste reviewbaan-URL',value:credentials.boardUrl,secret:false},
 ].filter(field=>field.value):[];
 return <section className="panel integration-card">
  <span className="eyebrow">GOOGLE PLAY</span><h2>Toegang voor appbeoordeling</h2>
  <p>Twee afzonderlijke reviewaccounts geven Google toegang zonder eenmalige e-mailcode. Ze hebben geen platformbeheerrechten. De eerste speler beheert uitsluitend de eigen reviewvereniging en reviewbaan. Plaats de gegevens alleen in de beveiligde toegangsvelden van Play Console.</p>
  <p>Status: {state?.configured&&state.enabled?'Ingericht':'Nog niet ingericht'}</p>
  {state?.configured&&state.enabled&&<button type="button" disabled={busy} onClick={()=>void reveal()}>Toon beoordelaargegevens</button>}
  {credentials&&<div><p>Deze gegevens verdwijnen na één minuut of zodra je dit tabblad verlaat.</p>
   {fields.map(field=><div key={field.label}><label>{field.label}<input value={field.value} readOnly autoComplete="off" type={field.secret?'password':'text'}/></label><button type="button" onClick={()=>{void navigator.clipboard.writeText(field.value!).then(()=>setFeedback('Gekopieerd.'),()=>setFeedback('Kopiëren is niet beschikbaar in deze browser.'));}}>Kopieer {field.label.toLowerCase()}</button></div>)}
   <button type="button" onClick={()=>{setCredentials(null);setFeedback('');}}>Verberg gegevens</button>
  </div>}
  {credentials&&feedback&&<p role="status">{feedback}</p>}
  {error&&<p role="alert">{error} <a href="/inloggen?next=/app/platform/integraties&reauth=1">Aanmelding opnieuw bevestigen</a></p>}
  <p>De reviewinstructies beschrijven aanmelden, spelen, melden, blokkeren en accountverwijdering. Gebruik hiervoor de instructies die bij de actuele appversie zijn geleverd.</p>
 </section>;
}
