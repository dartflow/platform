// Do not include received values in errors: a misconfigured public variable could
// accidentally contain a private credential and must not leak into job logs.
function requireValue(condition, message) { if (!condition) throw new Error(message); }
requireValue(process.env.DARTFLOW_APP_ORIGIN === 'https://staging.dartflow.nl', 'Staging origin must be canonical');
requireValue(process.env.DARTFLOW_DATA_MODE === 'supabase', 'Public staging must use Supabase mode');
let url;
try { url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''); }
catch { throw new Error('A valid staging Supabase project URL is required'); }
requireValue(url.protocol === 'https:', 'Staging Supabase must use HTTPS');
requireValue(/^[a-z0-9]+\.supabase\.co$/.test(url.hostname), 'Use the verified hosted staging Supabase project URL');
requireValue(url.pathname === '/', 'Project URL must have no path');
requireValue(!url.search && !url.hash && !url.username && !url.password && !url.port, 'Use the project origin only');
requireValue(/^sb_publishable_[A-Za-z0-9_-]+$/.test(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''), 'Use the staging publishable key, never a secret/service-role key');
requireValue(/^[0-9a-f]{40}$/.test(process.env.DARTFLOW_RELEASE_SHA ?? ''), 'Full release SHA required');
console.log('Staging build configuration validated; values are not printed.');
