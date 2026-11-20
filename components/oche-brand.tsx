'use client';
import {useEffect,useState} from 'react';
import type {OcheScreenTheme} from '@/lib/oche-device-types';
import {useOcheScreenTheme} from './oche-screen-theme';

export function OcheBrand({theme,kind='logo',className,visible}:{theme?:OcheScreenTheme['id'];kind?:'logo'|'icon'|'wordmark';className?:string;visible?:boolean}){
 const [failed,setFailed]=useState(false);
 const screenTheme=useOcheScreenTheme();
 useEffect(()=>{if(!failed)return;const timer=setTimeout(()=>setFailed(false),30000);return()=>clearTimeout(timer);},[failed]);
 if(screenTheme.id==='club'){
  if(!screenTheme.logoData||failed)return <span className={`${className??''} oche-club-wordmark`} data-visible={visible}>{screenTheme.name}</span>;
  return <img className={className} data-visible={visible} src={screenTheme.logoData} alt={kind==='icon'?'':screenTheme.name} onError={()=>setFailed(true)}/>;
 }
 const club=theme==='onzetrots'&&!failed;
 const fallback=kind==='icon'?'/assets/dartflow-icon.svg':kind==='wordmark'?'/assets/oche-wordmark.png':'/assets/dartflow-logo.svg';
 const source=club?kind==='icon'?'/assets/onzetrots/duindorp-crest.webp':'/assets/onzetrots/onzetrots-wordmark-white.webp':fallback;
 return <img className={className} data-visible={visible} src={source} alt={kind==='icon'?'':club?'Onze Trots':'DartFlow'} onError={()=>{if(club)setFailed(true);}}/>;
}
