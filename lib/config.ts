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
  if (typeof value !== 'string' || value.length > 240 || /[%\\\r\n?#]/.test(value)) return '/';
  if (/^\/(?:spelen|evenementen|wedstrijdleiding|clubbeheer|historie)?$/.test(value)) return value;
  if (/^\/wedstrijd\/[a-f0-9-]{36}$/.test(value) || /^\/baan\/(?:B[1-9][0-9]?|[a-f0-9-]{36})$/.test(value)) return value;
  return '/';
}
