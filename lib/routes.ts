// No legacy numeric ID or prototype board can be assigned to a different match.
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export function legacyDestination(hash:string):string|null {
  if (!hash) return null;
  const route=hash.replace(/^#\/?/,'');
  const hubs:Record<string,string>={home:'/',play:'/spelen',practice:'/spelen',lobby:'/spelen',training:'/spelen',baan:'/spelen',events:'/evenementen',leagues:'/evenementen',hall:'/evenementen',tournaments:'/evenementen',dashboard:'/wedstrijdleiding',operations:'/wedstrijdleiding',venue:'/wedstrijdleiding',manage:'/clubbeheer',clubs:'/clubbeheer',mymatches:'/historie'};
  if (hubs[route]) return hubs[route];
  if(route==='baanbeheer')return '/app/locations';
  if(route==='reservations')return '/app/reservations';
  if(route==='feed')return '/app/feed';
  const match=route.match(new RegExp(`^match/(${uuid})$`,'i'));
  if (match) return `/wedstrijd/${match[1]}`;
  const board=route.match(new RegExp(`^baan-phone/(${uuid})$`,'i'));
  if (board) return `/baan/${board[1]}`;
  const screen=route.match(new RegExp(`^baan-screen/(${uuid})$`,'i'));
  if(screen)return `/oche-live/${screen[1].toLowerCase()}`;
  return '/link-onbekend';
}

/** Scoped fragments are consumed locally by their own page and never prototype navigation. */
export function ownsPrivatePlayFragment(pathname:string,hash:string):boolean{
 return new RegExp(`^/spelen/${uuid}$`,'i').test(pathname)&&/^#(?:controller|participant|claim|recovery)=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i.test(hash)||new RegExp(`^/leg/${uuid}$`,'i').test(pathname)&&/^#code=[A-Za-z0-9_-]{43}$/.test(hash);
}
