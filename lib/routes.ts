// No legacy numeric ID or prototype board can be assigned to a different match.
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export function legacyDestination(hash:string):string|null {
  if (!hash) return null;
  const route=hash.replace(/^#\/?/,'');
  const hubs:Record<string,string>={home:'/',play:'/spelen',practice:'/spelen',lobby:'/spelen',training:'/spelen',baan:'/spelen',events:'/evenementen',leagues:'/evenementen',hall:'/evenementen',tournaments:'/evenementen',dashboard:'/wedstrijdleiding',operations:'/wedstrijdleiding',venue:'/wedstrijdleiding',manage:'/clubbeheer',clubs:'/clubbeheer',mymatches:'/historie'};
  if (hubs[route]) return hubs[route];
  const match=route.match(new RegExp(`^match/(${uuid})$`,'i'));
  if (match) return `/wedstrijd/${match[1]}`;
  const board=route.match(new RegExp(`^baan-phone/(${uuid})$`,'i'));
  if (board) return `/baan/${board[1]}`;
  return '/link-onbekend';
}
