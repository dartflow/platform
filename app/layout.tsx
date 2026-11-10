import type { Metadata, Viewport } from 'next';
import './globals.css';
import LegacyLink from '@/components/legacy-link';
export const metadata: Metadata = {title:'Dartflow · Staging',description:'De clubavond in één flow. Van check-in tot de laatste dubbel.',icons:{icon:'/assets/favicon.svg'}};
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#111310'};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="nl"><body><LegacyLink/>{children}</body></html>; }
