'use client';
import {useState} from 'react';
import {dartValue} from '@/lib/x01-rules';

const hits=['MISS',...Array.from({length:20},(_,i)=>`S${i+1}`),...Array.from({length:20},(_,i)=>`D${i+1}`),...Array.from({length:20},(_,i)=>`T${i+1}`),'SB','DB'];
export default function DartVisitInput({disabled,onSubmit}:{disabled:boolean;onSubmit:(hits:string[])=>void}){
 const [values,setValues]=useState(['','','']);const selected=values.filter(Boolean);
 return <form className="panel" onSubmit={e=>{e.preventDefault();if(selected.length&&!disabled)onSubmit(selected);}}><h2>Pijl voor pijl</h2><p>Registreer de werkelijk geworpen pijlen. Laat volgende velden leeg zodra een finish of bust de beurt beëindigt.</p><div className="field-grid">{values.map((value,i)=><label key={i} className="field">Pijl {i+1}<select value={value} disabled={disabled||i>0&&!values[i-1]} onChange={e=>setValues(values.map((old,index)=>index===i?e.target.value:index>i?'':old))}><option value="">{i===0?'Kies de eerste pijl':'Niet geworpen'}</option>{hits.map(hit=><option key={hit} value={hit}>{hit==='MISS'?'Mis':hit==='SB'?'Single bull · 25':hit==='DB'?'Dubbele bull · 50':hit}</option>)}</select></label>)}</div><p>Waargenomen totaal: {selected.reduce((sum,hit)=>sum+dartValue(hit),0)}</p><button className="button gold" disabled={disabled||!selected.length}>Beurt vastleggen</button></form>;
}
