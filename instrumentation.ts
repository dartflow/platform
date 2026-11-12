/** Start the server-side expiry job even when no player or display is connected. */
export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'){
  const {appConfig}=await import('./lib/config');
  appConfig();
  if(process.env.NODE_ENV==='production'||process.env.DARTFLOW_BOARD_ACTIVITY_WORKER==='1'){
   const {startBoardActivityWorker}=await import('./lib/board-activity-worker');
   startBoardActivityWorker();
  }
 }
}
