'use client';
import {useEffect} from 'react';
import {legacyDestination} from '@/lib/routes';
export default function LegacyLink() {
  useEffect(()=>{
    const apply=()=>{const destination=legacyDestination(location.hash);if(destination) location.replace(destination);};
    apply(); window.addEventListener('hashchange',apply);return()=>window.removeEventListener('hashchange',apply);
  },[]);
  return null;
}
