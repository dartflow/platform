import type {Metadata} from 'next';
import OcheDeviceDisplay from '@/components/oche-device-display';

export const metadata:Metadata={title:'Oche Live · DartFlow',description:'Koppel je scherm en volg de actuele DartFlow-scorekaart.',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function OcheLivePage(){return <OcheDeviceDisplay/>;}
