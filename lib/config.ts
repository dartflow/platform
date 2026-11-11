export function appConfig() {
  const mode = process.env.DARTFLOW_DATA_MODE;
  if (mode !== 'local' && mode !== 'supabase') throw new Error('DARTFLOW_DATA_MODE moet local of supabase zijn.');
  const origin = new URL(process.env.DARTFLOW_APP_ORIGIN || 'http://localhost:3000');
  if (!['http:','https:'].includes(origin.protocol)) throw new Error('HTTP of HTTPS vereist.');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Ongeldige app-origin.');
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
  if (mode === 'local' && !loopback) throw new Error('Lokale testaccounts zijn uitsluitend toegestaan op loopback.');
  if (mode === 'supabase' && (origin.protocol !== 'https:' || loopback)) throw new Error('Staging vereist een canonieke HTTPS-origin.');
  return {mode,origin:origin.origin,secure:origin.protocol === 'https:'};
}

export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240 || /[%\\\r\n#]/.test(value)) return '/';
  const [pathname,query,...extra]=value.split('?');
  const id='[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
  if(query!==undefined) {
    if(extra.length)return '/';
    const invitation=new RegExp(`^/app/(?:lobby|community|clubs|leagues|tournaments|hall)/${id}$`).test(pathname) && /^code=(?:[A-Za-z0-9]{4}|[A-Za-z0-9_-]{24})$/.test(query);
    const studio=/^\/app\/venue-cast\/(?:studio|hall|obs|public)$/.test(pathname) && new RegExp(`^event=${id}$`).test(query);
    const tablet=new RegExp(`^/wedstrijd/${id}$`).test(pathname) && query==='tablet=1';
    return invitation || studio || tablet ? value : '/';
  }
  if (/^\/(?:spelen|evenementen|wedstrijdleiding|clubbeheer|historie)?$/.test(value)) return value;
  if (/^\/w\/[A-Za-z0-9]{4}$/.test(value)) return value;
  if (/^\/app(?:\/(?:vandaag|spelen|baan|training|vrienden|clubs|kamers|uitdagingen|competities|toernooien|evenementen|wedstrijdleiding|schermen|mail|integraties|profiel|historie))?$/.test(value)) return value;
  if (/^\/app(?:\/(?:play|practice|lobby|events|friends|community|mymatches|settings|dashboard|operations|manage|leagues|tournaments|hall|players|registrations|matches|rankings|statistics|camera|pools|knockout))?$/.test(value)) return value;
  if (value==='/app/platform/integraties' || /^\/app\/venue-cast\/(?:studio|hall|obs|public)$/.test(value) || /^\/app\/venue(?:\/(?:entries|boards|schedule))?$/.test(value)) return value;
  if(new RegExp(`^/app/(?:clubs|community|lobby|leagues|tournaments|training|match|hall|spectator|overlay)/${id}$`).test(value))return value;
  if(new RegExp(`^/app/clubs/${id}/banen$`).test(value))return value;
  if (/^\/wedstrijd\/[a-f0-9-]{36}$/.test(value) || /^\/baan\/(?:B[1-9][0-9]?|[a-f0-9-]{36})$/.test(value)) return value;
  return '/';
}
