import type {Metadata} from 'next';
import OcheDevicePair from '@/components/oche-device-pair';

export const metadata:Metadata={title:'Scherm koppelen · DartFlow',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function PairScreenPage(){return <OcheDevicePair/>;}
