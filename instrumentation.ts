export async function register() {
  if(process.env.NEXT_RUNTIME==='nodejs') {
    const {appConfig}=await import('./lib/config');
    appConfig();
  }
}
