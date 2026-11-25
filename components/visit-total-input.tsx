'use client';
import {useEffect,useState} from 'react';
import type {PlayOutRule,PlayVisitInput} from '@/lib/play-types';

/** A reported visit total and actual dart count. It never manufactures dart hits. */
export default function VisitTotalInput({disabled,remaining,outRule='double',resetKey,onSubmit}:{disabled:boolean;remaining:number;outRule?:PlayOutRule;resetKey:string|number;onSubmit:(input:PlayVisitInput&{score:number;darts:number})=>void|boolean}){
 const [draft,setDraft]=useState({key:resetKey,score:'',darts:3,confirmed:false,finishDarts:false,attempts:''});
 const value=draft.key===resetKey?draft:{key:resetKey,score:'',darts:3,confirmed:false,finishDarts:false,attempts:''};
 useEffect(()=>{setDraft(previous=>previous.key===resetKey?previous:{key:resetKey,score:'',darts:3,confirmed:false,finishDarts:false,attempts:''});},[resetKey]);
 const finish=value.score!==''&&Number(value.score)===remaining,invalid=value.score!==''&&Number(value.score)>180;
 const update=(change:Partial<typeof value>)=>setDraft({...value,...change,key:resetKey});
 const score=(next:string)=>update({score:next.replace(/\D/g,'').slice(0,3),confirmed:false,finishDarts:false,attempts:''});
 return <form className="score-console-form visit-total-input" onSubmit={event=>{event.preventDefault();if(disabled||invalid||value.score===''||finish&&(!value.finishDarts||outRule!=='straight'&&!value.confirmed))return;onSubmit({score:Number(value.score),darts:value.darts,...(finish&&outRule!=='straight'?{doubleConfirmed:true}:{}),...(value.attempts!==''?{doubleAttempts:Number(value.attempts)}:{})});}}>
  <h2>Beurtotaal · {value.darts} {value.darts===1?'pijl':'pijlen'}</h2><label className="score-console-entry"><span>Geworpen totaal</span><input aria-label="Bezoekscore" inputMode="none" readOnly value={value.score} placeholder="0" disabled={disabled} onKeyDown={event=>{if(disabled)return;if(/^\d$/.test(event.key)){event.preventDefault();score(value.score+event.key);}else if(event.key==='Backspace'){event.preventDefault();score(value.score.slice(0,-1));}else if(event.key==='Delete'){event.preventDefault();score('');}}}/></label>
  <div className="visit-total-darts" role="group" aria-label={finish?'Pijlen voor finish':'Gegooide pijlen'}><span>{finish?'Werkelijk gebruikt:':'Pijlen:'}</span>{[1,2,3].map(count=><button type="button" key={count} disabled={disabled} aria-label={finish?`Finish in ${count} ${count===1?'dart':'darts'}`:`${count} ${count===1?'pijl':'pijlen'}`} aria-pressed={value.darts===count&&(!finish||value.finishDarts)} onClick={()=>update({darts:count,finishDarts:finish,attempts:''})}>{count}</button>)}</div>
  {finish&&outRule!=='straight'&&<label className="visit-total-finish"><input type="checkbox" checked={value.confirmed} disabled={disabled} onChange={event=>update({confirmed:event.target.checked})}/>{outRule==='master'?'Laatste pijl op dubbel of triple':'Laatste pijl op dubbel'}</label>}
  <div className="score-console-keypad" aria-label="Scoretoetsen">{['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(key=><button type="button" key={key} disabled={disabled} aria-label={key==='C'?'Gehele score wissen':key==='⌫'?'Laatste cijfer wissen':`Cijfer ${key}`} onClick={()=>score(key==='C'?'':key==='⌫'?value.score.slice(0,-1):value.score+key)}>{key}</button>)}</div>
  {invalid&&<p role="alert">Gebruik een beurtotaal van 0 tot en met 180.</p>}
  <button className="score-console-confirm" disabled={disabled||invalid||value.score===''||finish&&(!value.finishDarts||outRule!=='straight'&&!value.confirmed)}>{finish?'Finish bevestigen':'Bevestigen'}</button>
  <details className="visit-total-attempts"><summary>Dubbelpogingen (optioneel)</summary><label>Darts op de uitgooidubbel<select value={value.attempts} disabled={disabled} onChange={event=>update({attempts:event.target.value})}><option value="">Niet bijgehouden</option>{Array.from({length:value.darts+1},(_,count)=><option key={count} value={count} disabled={finish&&count===0}>{count}</option>)}</select></label></details>
 </form>;
}
