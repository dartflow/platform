'use client';
import{useEffect,useState}from'react';
import type{Profile}from'@/lib/types';
import{normalizeUsername,validDisplayName,validUsername}from'@/lib/display-name';
import{socialIdentityLabel}from'@/lib/public-identity';
type Availability={valid:boolean;available:boolean;username:string|null;locked:boolean;error?:string};
export default function ProfileIdentityFields({user,disabled=false,onValidity}:{user:Profile;disabled?:boolean;onValidity?:(valid:boolean)=>void}){
 const locked=user.usernameLocked===true;
 const[username,setUsername]=useState(user.username??''),[displayName,setDisplayName]=useState(user.displayName??''),[fullName,setFullName]=useState(user.fullName??''),[confirmed,setConfirmed]=useState(locked),[availability,setAvailability]=useState<Availability|null>(null),[checking,setChecking]=useState(false);
 useEffect(()=>{if(locked||!validUsername(username)){setAvailability(null);setChecking(false);return;}let active=true;const controller=new AbortController(),timer=setTimeout(()=>{setChecking(true);void fetch('/api/profile/username-availability?'+new URLSearchParams({username}),{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('check');return r.json()as Promise<Availability>;}).then(v=>{if(active)setAvailability(v);}).catch(()=>{if(active)setAvailability(null);}).finally(()=>{if(active)setChecking(false);});},250);return()=>{active=false;clearTimeout(timer);controller.abort();};},[username,locked]);
 const valid=(locked||validUsername(username)&&confirmed)&&validDisplayName(displayName)&&fullName.length<=160&&availability?.available!==false;
 useEffect(()=>{onValidity?.(valid);},[valid,onValidity]);
 return <>
 <label className="field">Volledige naam<input name="fullName"autoComplete="name"maxLength={160}value={fullName}disabled={disabled}onChange={e=>setFullName(e.target.value)}/></label><small>Persoonlijk en privé. Andere spelers zien deze naam niet.</small>
 <label className="field">Displaynaam<input name="displayName"autoComplete="nickname"required maxLength={80}value={displayName}disabled={disabled}onChange={e=>setDisplayName(e.target.value)}/></label><small>Openbaar op je spelerskaart en het scorebord. Spaties en dezelfde naam als een andere speler zijn toegestaan.</small>
 <label className="field">Gebruikersnaam<input name="username"autoComplete="username"autoCapitalize="none"autoCorrect="off"spellCheck={false}required maxLength={81}readOnly={locked}value={username}disabled={disabled}onChange={e=>{setUsername(e.target.value);setConfirmed(false);setAvailability(null);}}/></label>
 <small>{locked?'Je gebruikersnaam staat vast en kan niet worden gewijzigd.':'Uniek in DartFlow, zonder witruimte. Hoofdletters tellen als dezelfde naam. Na bevestigen staat deze naam vast.'}</small>
 {!locked&&<><p role="status">{!username?'Kies je eenmalige gebruikersnaam.':!validUsername(username)?'Gebruik 1 tot 80 tekens, minstens één letter of cijfer en geen witruimte of onzichtbare tekens.':checking?'Beschikbaarheid controleren…':availability?.available?`@${availability.username} is beschikbaar.`:availability?.error??(availability?'Deze gebruikersnaam is al in gebruik.':'De server controleert de naam bij opslaan.')}</p><label className="workspace-checkbox"><input name="usernameConfirmation"type="checkbox"required checked={confirmed}disabled={disabled}onChange={e=>setConfirmed(e.target.checked)}/>Ik bevestig @{validUsername(username)?normalizeUsername(username):'…'} als mijn vaste, onveranderbare gebruikersnaam.</label></>}
 <a href="/help/profiel-identiteit"target="_blank"rel="noopener noreferrer">Uitleg over je drie profielnamen</a>
 <div className="notice"aria-label="Openbare identiteit"><strong>Zo zien andere spelers jou</strong><p>{socialIdentityLabel({displayName,username:validUsername(username)?normalizeUsername(username):null})}</p></div>
 {user.identityNeedsReview&&<p className="notice">Je oude accountnaam voldeed niet aan de nieuwe gebruikersnaamregels of had een conflict. Je speler-ID, vrienden, partijen en historie zijn behouden. Controleer je privénaam en kies één geldige vaste gebruikersnaam.</p>}
 </>;
}
