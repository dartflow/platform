'use client';
import {useEffect,useState} from 'react';
import type {PlayMode} from './play-types';

export type ScoreInputMode='total'|'per-dart';
export const scoreInputGames:readonly {id:PlayMode;name:string;total:boolean}[]=[{id:'x01',name:'X01',total:true},{id:'cricket',name:'Cricket',total:false},{id:'tactics',name:'Tactics',total:false},{id:'around',name:'Around the board',total:false},{id:'bingo',name:'Dubbelbingo',total:false},{id:'finish',name:'Finishtraining',total:false},{id:'leg-challenge',name:'Leguitdaging',total:true}];
type Modes=Record<PlayMode,ScoreInputMode>;
const defaults=():Modes=>({x01:'total',cricket:'per-dart',tactics:'per-dart',around:'per-dart',bingo:'per-dart',finish:'per-dart','leg-challenge':'total'});
const eventName='dartflow-score-input-preference';
export function scoreInputPreferenceKey(actorId?:string){return `dartflow-score-input-v1:${actorId??'guest'}`;}
function read(key:string):Modes{const modes=defaults();try{const saved=JSON.parse(localStorage.getItem(key)??'null');if(saved?.version===1&&saved.modes&&typeof saved.modes==='object')for(const game of scoreInputGames){const value=saved.modes[game.id];if(value==='per-dart'||value==='total'&&game.total)modes[game.id]=value;}}catch{/* Defaults remain available if browser storage is unavailable. */}return modes;}

/** This account's preference in this browser; no profile or game rules are changed. */
export function useScoreInputPreferences(actorId?:string){
 const key=scoreInputPreferenceKey(actorId),[state,setState]=useState<{key:string;modes:Modes}>({key,modes:defaults()}),[error,setError]=useState('');
 useEffect(()=>{const update=()=>setState({key,modes:read(key)});update();const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)update();};const changed=(event:Event)=>{if((event as CustomEvent<string>).detail===key)update();};window.addEventListener('storage',storage);window.addEventListener(eventName,changed);return()=>{window.removeEventListener('storage',storage);window.removeEventListener(eventName,changed);};},[key]);
 const modes=state.key===key?state.modes:defaults();
 function setMode(game:PlayMode,mode:ScoreInputMode){if(mode!=='total'&&mode!=='per-dart'||mode==='total'&&!scoreInputGames.find(item=>item.id===game)?.total)return false;try{const next={...read(key),[game]:mode};localStorage.setItem(key,JSON.stringify({version:1,modes:next}));setState({key,modes:next});setError('');window.dispatchEvent(new CustomEvent(eventName,{detail:key}));return true;}catch{setError('Deze browser kon je scorevoorkeur niet bewaren. Probeer het opnieuw.');return false;}}
 return {modes,setMode,error};
}
