"use client";

import {useId} from 'react';
import type {OcheLayout} from '@/lib/oche-device-types';
import './oche-device-management.css';

export function ocheLayoutDescription(layout:OcheLayout|null|undefined){
 return layout?`${layout.orientation==='portrait'?'Verticaal':'Horizontaal'} · ${layout.scoreboards===2?'twee scoreborden':'één scorebord'}`:'Adaptief · bestaande schermindeling';
}

export function OcheLayoutPreview({layout,leftName,rightName}:{layout:OcheLayout;leftName?:string;rightName?:string}){
 const dual=layout.scoreboards===2,left=leftName??'Nog geen baan toegewezen',right=rightName??'Nog geen baan toegewezen';
 return <div className="oche-management-preview" data-orientation={layout.orientation} data-scoreboards={layout.scoreboards} role="img" aria-label={`${ocheLayoutDescription(layout)}. ${dual?'Links: ':''}${left}${dual?`. Rechts: ${right}`:''}`}>
  {dual?<><span className="oche-management-preview-board" aria-hidden="true"><small>Scorebord links</small><i>148</i><i>188</i></span><span className="oche-management-preview-rail" aria-hidden="true"><small><b>←</b><strong>{left}</strong></small><i/><small><strong>{right}</strong><b>→</b></small></span><span className="oche-management-preview-board" aria-hidden="true"><small>Scorebord rechts</small><i>301</i><i>241</i></span></>:<span><strong>{left}</strong><i aria-hidden="true">148 — 188</i></span>}
 </div>;
}

export function OcheLayoutControls({layout,onChange,allowDual,disabled=false}:{layout:OcheLayout;onChange:(layout:OcheLayout)=>void;allowDual:boolean;disabled?:boolean}){
 const id=useId();
 return <div className="oche-management-layout"><fieldset disabled={disabled}><legend>Hoe staat dit scherm?</legend><div className="oche-management-choices">{(['portrait','landscape'] as const).map(orientation=><label key={orientation} className="oche-management-choice"><input type="radio" name={`${id}-orientation`} value={orientation} checked={layout.orientation===orientation} onChange={()=>onChange({orientation,scoreboards:orientation==='portrait'?1:layout.scoreboards})}/><span className="oche-management-orientation" data-orientation={orientation} aria-hidden="true"/><span>{orientation==='portrait'?'Verticaal (9:16)':'Horizontaal (16:9)'}</span></label>)}</div></fieldset>{layout.orientation==='landscape'&&<fieldset disabled={disabled}><legend>Hoeveel scoreborden wil je tonen?</legend><div className="oche-management-choices">{([1,2] as const).map(scoreboards=><label key={scoreboards} className="oche-management-choice"><input type="radio" name={`${id}-scoreboards`} value={scoreboards} disabled={scoreboards===2&&!allowDual} checked={layout.scoreboards===scoreboards} onChange={()=>onChange({...layout,scoreboards})}/><span className="oche-management-count" data-scoreboards={scoreboards} aria-hidden="true"><i/>{scoreboards===2&&<><b/><i/></>}</span><span>{scoreboards===1?'Eén scorebord':'Twee scoreborden'}{scoreboards===2&&<small>Beschikbaar voor locaties</small>}</span></label>)}</div></fieldset>}</div>;
}

export function OcheBoardAssignments({layout,boards,boardId,secondaryBoardId,onChange,disabled=false}:{layout:OcheLayout;boards:{id:string;name:string}[];boardId:string;secondaryBoardId:string;onChange:(boardId:string,secondaryBoardId:string)=>void;disabled?:boolean}){
 const dual=layout.scoreboards===2;
 function select(value:string,side:'left'|'right'){
  onChange(side==='left'?value:boardId,side==='right'?value:secondaryBoardId);
 }
 return <div className="oche-management-assignments"><div className="oche-management-board-fields">{(dual?['left','right'] as const:['left'] as const).map(side=>{const value=side==='left'?boardId:secondaryBoardId,other=side==='left'?secondaryBoardId:boardId,label=dual?side==='left'?'Baan links':'Baan rechts':'Baan';return <label className="field" key={side}>{label}<select aria-label={label} disabled={disabled} value={value} onChange={event=>select(event.target.value,side)}><option value="">Nog geen baan toegewezen</option>{value&&!boards.some(board=>board.id===value)&&<option value={value}>Baan niet beschikbaar</option>}{boards.map(board=><option key={board.id} value={board.id} disabled={dual&&board.id===other}>{board.name}</option>)}</select></label>;})}</div><OcheLayoutPreview layout={layout} leftName={boardId?boards.find(board=>board.id===boardId)?.name??'Baan niet beschikbaar':undefined} rightName={secondaryBoardId?boards.find(board=>board.id===secondaryBoardId)?.name??'Baan niet beschikbaar':undefined}/>{dual&&<button className="button ghost small" type="button" disabled={disabled||boardId===secondaryBoardId} onClick={()=>onChange(secondaryBoardId,boardId)}>Wissel links en rechts</button>}</div>;
}
