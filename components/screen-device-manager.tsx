"use client";

import {useState} from "react";

type Device={id:string;name:string;createdAt:string;expiresAt:string;paired:boolean;revoked:boolean};
type Pairing={code:string;expiresAt:string;screenUrl:string};

/** Manager-only provisioning; the short-lived code never becomes a player invitation. */
export default function ScreenDeviceManager({boardId,boardName}:{boardId:string;boardName:string}){
  const [open,setOpen]=useState(false),[publicScreen,setPublicScreen]=useState<boolean|null>(null),[newPairingUrl,setNewPairingUrl]=useState<string|null>(null),[devices,setDevices]=useState<Device[]>([]),[name,setName]=useState(""),[pairing,setPairing]=useState<Pairing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const path=`/api/boards/${encodeURIComponent(boardId)}/screen-devices`;
  async function load(){const response=await fetch(path,{cache:"no-store"});const body=await response.json();if(!response.ok)throw new Error(typeof body.error==="string"?body.error:"Schermtoegang kon niet worden opgehaald.");setPublicScreen(body.publicScreen===true);setNewPairingUrl(body.newPairingUrl==='/oche-live'?'/oche-live':null);setDevices(body.devices);}
  async function create(){if(busy||publicScreen===null)return;setBusy(true);setError("");try{const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim()||`Scherm ${boardName}`})});const body=await response.json();if(!response.ok)throw new Error(typeof body.error==="string"?body.error:"Het baanscherm kon niet worden gekoppeld.");setPairing(body.pairing);await load();}catch(caught){setError(caught instanceof Error?caught.message:"Koppelen mislukt.");}finally{setBusy(false);}}
  async function revoke(id:string){if(busy||publicScreen===null)return;setBusy(true);setError("");try{const response=await fetch(`${path}/${encodeURIComponent(id)}`,{method:"DELETE"});if(!response.ok){const body=await response.json();throw new Error(typeof body.error==="string"?body.error:"Intrekken mislukt.");}await load();}catch(caught){setError(caught instanceof Error?caught.message:"Intrekken mislukt.");}finally{setBusy(false);}}
  return <details className="screen-device-manager" open={open} onToggle={event=>{const expanded=event.currentTarget.open;setOpen(expanded);if(expanded)void load().catch(caught=>setError(caught instanceof Error?caught.message:"Ophalen mislukt."));}}>
    <summary>Schermtoegang</summary>
    {error&&<p role="alert" className="inline-error">{error}</p>}
    {publicScreen===null&&!error&&<p>Schermtoegang ophalen…</p>}
    {publicScreen===true&&<p>Dit baanscherm is openbaar voor iedereen met de vaste schermlink. Er is geen apparaatkoppeling nodig. De spelers-QR behoudt de bestaande rechten om mee te spelen.</p>}
    {publicScreen!==null&&<>
      {newPairingUrl?<p>Open <a href={newPairingUrl} target="_blank" rel="noopener noreferrer">Oche Live</a> op het schermapparaat. Bevestig de getoonde code via <a href="/koppel-scherm">Koppel scherm</a> en kies deze locatie en baan. Beheer gekoppelde schermen via <a href="/app/schermen">Schermen</a>. Bestaande schermtoegang hieronder blijft werken en telt mee voor de limiet.</p>:<>
      <p>Koppel een apparaat aan {boardName}. De spelers-QR behoudt zijn eigen toegangsregels.</p>
      <label className="field">Naam van het scherm<input maxLength={80} value={name} onChange={event=>setName(event.target.value)} placeholder={`Tablet ${boardName}`} disabled={busy}/></label>
      <button type="button" className="button ghost small" disabled={busy} onClick={()=>void create()}>Koppelcode maken</button>
      {pairing&&<div className="notice" role="status"><strong>Koppelcode: {pairing.code}</strong><p>Open <a href={pairing.screenUrl} target="_blank" rel="noopener noreferrer">dit baanscherm</a> op het schermapparaat en voer deze code daar in. Geldig tot {new Date(pairing.expiresAt).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}.</p></div>}
      </>}
      {devices.map(device=><div className="workspace-row" key={device.id}><div><strong>{device.name}</strong><small>{device.revoked?"Ingetrokken":device.paired?"Gekoppeld":"Wacht op koppeling"} · tot {new Date(device.expiresAt).toLocaleDateString("nl-NL")}</small></div>{!device.revoked&&<button type="button" className="button ghost small" disabled={busy} onClick={()=>void revoke(device.id)}>Schermtoegang intrekken</button>}</div>)}
    </>}
  </details>;
}
