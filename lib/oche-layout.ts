import type {OcheDisplaySnapshot,OcheLayout} from './oche-device-types';

export const OCHE_LAYOUT_KEY='dartflow-oche-layout-v1';
export const OCHE_LAYOUT_LATER_KEY='dartflow-oche-layout-later-v1';
export const OCHE_LAYOUT_PROPOSAL_KEY='dartflow-oche-layout-proposal-v1';
export function validOcheLayout(value:unknown):value is OcheLayout{
 if(!value||typeof value!=='object')return false;
 const item=value as Record<string,unknown>;
 return (item.orientation==='portrait'&&item.scoreboards===1)||(item.orientation==='landscape'&&(item.scoreboards===1||item.scoreboards===2));
}
export function readOcheLayout(storage:Pick<Storage,'getItem'>):OcheLayout|null{
 try{const value:unknown=JSON.parse(storage.getItem(OCHE_LAYOUT_KEY)??'null');return validOcheLayout(value)?value:null;}catch{return null;}
}
/** Save before requesting a code; a storage failure must remain visible and retryable. */
export function saveOcheLayout(storage:Pick<Storage,'setItem'|'getItem'>,layout:OcheLayout){
 if(!validOcheLayout(layout))throw Error('Kies een geldige schermindeling.');
 const value=JSON.stringify(layout);storage.setItem(OCHE_LAYOUT_KEY,value);
 if(storage.getItem(OCHE_LAYOUT_KEY)!==value)throw Error('De schermindeling kon niet worden opgeslagen. Probeer opnieuw.');
}
export function hasActiveOcheMatch(snapshot:OcheDisplaySnapshot){
 const sources=snapshot.panels?.map(panel=>panel.snapshot)??[snapshot];
 return sources.some(source=>{const display=source?.display?.snapshot,match=display?.match,play=display?.play;return Boolean(play?.status==='active'&&play.game.status!=='finished'||match&&!['result','confirmed','disputed','abandoned','interrupted'].includes(match.status));});
}
export function ocheLayoutName(layout:OcheLayout|null|undefined){return !layout?'Bestaande automatische indeling':layout.orientation==='portrait'?'Verticaal · één scorebord':layout.scoreboards===2?'Horizontaal · twee scoreborden':'Horizontaal · één scorebord';}

/** Full pane snapshots have their own retained event window; a gap baselines only that pane. */
export function ochePanelEventGap(previous:OcheDisplaySnapshot|null|undefined,next:OcheDisplaySnapshot|null|undefined){
 const before=previous?.display?.snapshot,after=next?.display?.snapshot;
 if(!before||!after||before.sessionKey!==after.sessionKey)return false;
 const events=after.scoreEvents??[];
 return events.length>=64&&(before.match?.revision??previous?.revision??0)<Math.min(...events.map(event=>event.revision))-1;
}
