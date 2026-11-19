'use client';
import {useEffect,useState} from 'react';

export function OcheBrand({theme,kind='logo',className,visible}:{theme?:'dartflow'|'onzetrots';kind?:'logo'|'icon'|'wordmark';className?:string;visible?:boolean}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>{if(!failed)return;const timer=setTimeout(()=>setFailed(false),30000);return()=>clearTimeout(timer);},[failed]);
 const club=theme==='onzetrots'&&!failed;
 const fallback=kind==='icon'?'/assets/dartflow-icon.svg':kind==='wordmark'?'/assets/oche-wordmark.png':'/assets/dartflow-logo.svg';
 const source=club?kind==='icon'?'/assets/onzetrots/duindorp-crest.webp':'/assets/onzetrots/onzetrots-wordmark-white.webp':fallback;
 return <img className={className} data-visible={visible} src={source} alt={kind==='icon'?'':club?'Onze Trots':'DartFlow'} onError={()=>{if(club)setFailed(true);}}/>;
}
