// Local dev worker. Hosted releases use the existing authenticated /api/mail/process timer.
import {processBoardActivityBatch} from '../lib/board-activity';
import {closeDatabase} from '../lib/db';
try{process.loadEnvFile('.env.local');}catch{/* Explicit environment can provide the loopback config. */}
const target=new URL(process.env.DARTFLOW_DATABASE_URL??'http://invalid');
if(process.env.DARTFLOW_DATA_MODE!=='local'||!['localhost','127.0.0.1','[::1]'].includes(target.hostname))throw new Error('De lokale baanworker vereist de loopback-developmentdatabase.');
let running=true;
process.once('SIGINT',()=>{running=false;});process.once('SIGTERM',()=>{running=false;});
console.log('Oche Live-activiteitsworker gestart (lokaal; interval 1 seconde).');
while(running){
 try{const result=await processBoardActivityBatch();if(result.processed)console.log(`${result.processed} verlopen baansessie(s) vrijgegeven.`);}catch(error){console.error(error instanceof Error?error.message:'Baanworker mislukt.');}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
await closeDatabase();
