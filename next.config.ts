import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  // The local-session helper uses fs; never trace developer databases or env files.
  outputFileTracingExcludes: {'/*':['./.local/**/*','./.env*','./.git/**/*']},
  poweredByHeader: false,
  // Publish canonical and verification markers inside the initial head for every crawler.
  htmlLimitedBots: /.*/,
  async headers() {
    return [{source:'/speelsessie',headers:[{key:'X-DartFlow-Offline-Shell',value:'1'},{key:'Referrer-Policy',value:'no-referrer'}]},{source:'/spelen/:path*',headers:[{key:'Referrer-Policy',value:'no-referrer'}]},{source:'/leg/:path*',headers:[{key:'Referrer-Policy',value:'no-referrer'}]},{source:'/blog/beheer/:path*',headers:[{key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'}]},{source: '/:path*', headers: [
      {key:'Cache-Control',value:'private, no-store'},
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'Referrer-Policy',value:'no-referrer'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'Permissions-Policy',value:'camera=(self), microphone=(self), geolocation=()'}
    ]}];
  }
};
export default config;
