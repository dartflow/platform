const RECENT_AUTH_WINDOW_MS=900_000;
const INTERACTIVE_METHODS=new Set(['password','otp','oauth','totp','magiclink','sso/saml']);

/** Only pass claims verified by Supabase getClaims(), never decoded client tokens or user metadata. */
export function hasRecentVerifiedAuthentication(actor:string,claims:unknown,options:{now?:number;requireMfa?:boolean;method?:'otp'}={}):boolean {
 if(!claims||typeof claims!=='object')return false;
 const verified=claims as {sub?:unknown;aal?:unknown;amr?:unknown};
 if(verified.sub!==actor||!Array.isArray(verified.amr)||options.requireMfa&&verified.aal!=='aal2')return false;
 const now=options.now??Date.now();
 if(!Number.isFinite(now))return false;
 return verified.amr.some(entry=>{
  if(!entry||typeof entry!=='object')return false;
  const {method,timestamp}=entry as {method?:unknown;timestamp?:unknown};
  if(typeof method!=='string'||!INTERACTIVE_METHODS.has(method)||options.method&&method!==options.method||typeof timestamp!=='number'||!Number.isSafeInteger(timestamp)||timestamp<=0)return false;
  const age=now-timestamp*1000;
  return age>=0&&age<=RECENT_AUTH_WINDOW_MS;
 });
}

/** A reauth flag starts a new provider roundtrip; it never upgrades an existing session itself. */
export function googleSignInOptions(origin:string,reauth:unknown) {
 return {provider:'google' as const,options:{redirectTo:`${origin}/auth/callback`,...(reauth==='1'?{queryParams:{prompt:'select_account'}}:{})}};
}
