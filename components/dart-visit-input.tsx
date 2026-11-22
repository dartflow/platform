'use client';
import {useState} from 'react';
import DartScorePad from './dart-score-pad';

export default function DartVisitInput({disabled,onSubmit,thrower,resetKey}:{disabled:boolean;onSubmit:(hits:string[])=>void|boolean;thrower?:string;resetKey?:string|number}){
 const [draft,setDraft]=useState<{key:typeof resetKey;hits:string[]}>({key:resetKey,hits:[]});
 const selected=draft.key===resetKey?draft.hits:[];
 const update=(hits:string[])=>setDraft({key:resetKey,hits});
 return <DartScorePad hits={selected} disabled={disabled} thrower={thrower} onAdd={hit=>update([...selected,hit])} onRemove={()=>update(selected.slice(0,-1))} onSubmit={event=>{event.preventDefault();if(selected.length&&!disabled)onSubmit(selected);}}/>;
}
