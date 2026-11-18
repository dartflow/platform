import {privacyWorkerPool,processAccountRemovalBatch,supabaseAuthEraser} from '../lib/account-removal-worker';

// Hosted systemd timers provide only the dedicated privacy environment file.
// Local tests inject their own synthetic Auth adapter and never call this script.
const pool=privacyWorkerPool();
try{
 const erase=supabaseAuthEraser();
 const result=await processAccountRemovalBatch(pool,erase);
 console.log(`Privacyverwerking: ${result.processed} voltooid; ${result.retrying} opnieuw gepland.`);
 if(result.retrying)process.exitCode=1;
}catch{
 console.error('Privacyverwerking niet beschikbaar. Controleer de afgeschermde workerconfiguratie.');
 process.exitCode=1;
}finally{await pool.end();}
