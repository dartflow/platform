import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  // The local-session helper uses fs; never trace developer databases or env files.
  outputFileTracingExcludes: {'/*':['./.local/**/*','./.env*','./.git/**/*']},
  poweredByHeader: false,
  async headers() {
    return [{source: '/:path*', headers: [
      {key:'Cache-Control',value:'private, no-store'},
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'Referrer-Policy',value:'same-origin'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'}
    ]}];
  }
};
export default config;
