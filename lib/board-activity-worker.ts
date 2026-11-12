import {processBoardActivityBatch} from './board-activity';

const workerGlobal=globalThis as typeof globalThis&{dartflowActivityTimer?:ReturnType<typeof setInterval>};
export function startBoardActivityWorker():void{
 if(workerGlobal.dartflowActivityTimer||!process.env.DARTFLOW_DATABASE_URL)return;
 let busy=false,lastError=0;
 const tick=async()=>{
  if(busy)return;busy=true;
  try{await processBoardActivityBatch();}
  catch(error){if(Date.now()-lastError>30_000){lastError=Date.now();const code=error&&typeof error==='object'&&'code'in error?String(error.code):'worker_error';console.error('Oche Live: verlopen sessies konden niet worden verwerkt.',/^[a-zA-Z0-9_]{1,40}$/.test(code)?code:'worker_error');}}
  finally{busy=false;}
 };
 workerGlobal.dartflowActivityTimer=setInterval(()=>void tick(),1000);
 workerGlobal.dartflowActivityTimer.unref();
 void tick();
}
