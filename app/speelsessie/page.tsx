import OfflineScoreShell from '@/components/offline-score-shell';
export const dynamic='force-static';
export const metadata={title:'DartFlow · Partij hervatten',robots:{index:false,follow:false}};
/** Generic public shell: identity and accepted scores are read on the device. */
export default function OfflinePlayPage(){return <OfflineScoreShell/>;}
