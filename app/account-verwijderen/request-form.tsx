'use client';
import {useState} from 'react';
import styles from './request-form.module.css';

export default function AccountDeletionForm(){
 const [confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[accepted,setAccepted]=useState(false),[requestId]=useState(()=>globalThis.crypto.randomUUID());
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/account/deletion',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({requestId,confirmation})});
   const data=await response.json();
   if(!response.ok){setMessage(data.error||'Verwijderen is nu niet mogelijk. Probeer opnieuw of mail info@dartflow.nl.');return;}
   setAccepted(true);setConfirmation('');setMessage('Je verwijderverzoek is ontvangen. Je account is geblokkeerd en wordt automatisch verwerkt.');
   await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:'{}'}).catch(()=>undefined);
  }catch{setMessage('Geen verbinding. Dezelfde aanvraag kan veilig opnieuw worden verstuurd.');}finally{setBusy(false);}
 }
 if(accepted)return <p role="status" className={styles.notice}>{message}</p>;
 return <div className={styles.card}>
  <p><a href="/inloggen?reauth=1&next=/account-verwijderen">Opnieuw aanmelden via Google of e-mail</a></p>
  <form onSubmit={submit}>
   <label htmlFor="deletion-confirmation">Typ VERWIJDEREN om te bevestigen</label>
   <input id="deletion-confirmation" autoComplete="off" spellCheck={false} value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy} required aria-describedby="deletion-explanation"/>
   <p id="deletion-explanation">Je account, persoonlijke gegevens en spelerspincode worden verwijderd. Je kunt deze actie niet ongedaan maken.</p>
   <button type="submit" disabled={busy||confirmation!=='VERWIJDEREN'}>{busy?'Verzoek versturen…':'Mijn account definitief verwijderen'}</button>
  </form>
  {message&&<p role="alert" className={styles.notice}>{message}</p>}
 </div>;
}
