const playerGroups = [
  ['Speeldag', [['home','home','Vandaag'],['play','target','Spelen'],['mymatches','calendar','Mijn wedstrijden']]],
  ['Competitief', [['events','trophy','Evenementen']]],
  ['Club & community', [['clubs','shield','Verenigingen'],['community','chat','Chatkamers'],['friends','users','Vrienden']]],
  ['Profiel', [['rankings','crown','Ranglijsten'],['settings','settings','Voorkeuren']]]
];
const organizerGroups = [
  ['Werkruimte', [['dashboard','home','Overzicht'],['events','trophy','Evenementen'],['operations','target','Wedstrijdleiding'],['manage','shield','Clubbeheer']]]
];
const organizerWorkspaces = {
  events: [
    ['events','home','Overzicht'],['leagues','chart','Competities'],['hall','trophy','Toernooien'],['tournaments','clipboard','Toernooibeheer']
  ],
  operations: [
    ['operations','home','Overzicht'],['venue','target','Toernooiregie'],['baan','pin','Baanmodus · QR'],['venue-cast/studio','video','Schermstudio']
  ],
  manage: [
    ['manage','home','Overzicht'],['clubs','shield','Verenigingen'],['community','chat','Chatkamers'],['reports','info','Meldingen'],['mail','mail','Mailbeheer'],['settings','settings','Voorkeuren']
  ]
};
const playTabs = [
  ['play','home','Overzicht'],['practice','target','Oefenpartij'],['training','bolt','Training'],['baan','pin','Baanmodus · QR']
];
const playerEventTabs = [
  ['events','home','Overzicht'],['leagues','chart','Competities'],['hall','trophy','Toernooien'],['operations','pin','Speeldagen']
];
const playerParents = {
  practice:'play', training:'play', lobby:'play', baan:'play', camera:'play',
  match:'mymatches', spectator:'mymatches', leagues:'events', hall:'events', tournaments:'events',
  pools:'events', knockout:'events', venue:'events', operations:'events'
};
const organizerParents = {
  home:'dashboard', leagues:'events', hall:'events', tournaments:'events', pools:'events', knockout:'events',
  venue:'operations', 'venue-cast':'operations', baan:'operations', matches:'operations',
  clubs:'manage', community:'manage', reports:'manage', players:'manage', registrations:'manage',
  mail:'manage', settings:'manage', rankings:'manage', statistics:'manage', friends:'manage'
};
const exactLabels = {
  practice:'Oefenpartij', training:'Training', lobby:'Wedstrijdlobby', camera:'Camera & apparaten',
  match:'Wedstrijdkamer', spectator:'Kijkersmodus', baan:'Baanmodus · QR', 'venue-cast':'Schermstudio',
  tournaments:'Toernooibeheer', pools:'Poule-indeling', knockout:'Knock-out', players:'Spelersregister',
  mail:'Mailbeheer', registrations:'Aanmeldingen', statistics:'Clubstatistieken', reports:'Meldingen', matches:'Wedstrijden op locatie'
};
const mobilePlayer = [
  ['home','home','Vandaag'],['play','target','Spelen'],['mymatches','calendar','Wedstrijden'],['baan','pin','Baanmodus']
];
const mobileLabels = {mymatches:'Partijen', baan:'Baan', operations:'Regie', events:'Kalender'};

export function navigationFor(route, organizer) {
  const groups = organizer ? organizerGroups : playerGroups;
  const parent = (organizer ? organizerParents : playerParents)[route] || route;
  const items = groups.flatMap(([,entries]) => entries);
  const item = items.find(([id]) => id === parent);
  const tabs = organizer ? organizerWorkspaces[parent] || [] : parent === 'play' ? playTabs : parent === 'events' ? playerEventTabs : [];
  const venueLabel = route === 'venue' ? organizer ? 'Toernooiregie' : 'Geplande speeldag' : '';
  const entryLabel = !organizer && route === 'tournaments' ? 'Toernooi-inschrijvingen' : '';
  const label = venueLabel || entryLabel || exactLabels[route] || items.find(([id]) => id === route)?.[2]
    || tabs.find(([id]) => id === route)?.[2] || item?.[2] || 'DartFlow';
  const mobile = organizer ? organizerGroups[0][1] : mobilePlayer;
  const mobileActive = !organizer && route === 'baan' ? 'baan' : parent;
  return {groups, parent, label, parentLabel:item?.[2], tabs, mobile, mobileActive};
}

export function routeAfterScopeChange(route, organizer) {
  if (organizer && (route === 'home' || route === 'dashboard')) return 'dashboard';
  if (['leagues','hall','tournaments','events','operations','manage','mail','community','play','practice','training','mymatches','rankings','settings','home'].includes(route)) return route;
  const {parent} = navigationFor(route, organizer);
  if (parent === 'operations' || parent === 'manage' || parent === 'events' || parent === 'play' || parent === 'mymatches') return parent;
  return organizer ? 'dashboard' : 'home';
}

export function navigationSearch(organizer) {
  const primary = (organizer ? organizerGroups : playerGroups).flatMap(([,items]) => items);
  const secondary = organizer ? Object.values(organizerWorkspaces).flatMap(items => items.slice(1)).concat([
    ['players','user','Spelersregister'],['registrations','clipboard','Aanmeldingen'],
    ['rankings','crown','Ranglijsten'],['statistics','chart','Clubstatistieken']
  ]) : [...playTabs.slice(1),...playerEventTabs.slice(1),['camera','camera','Camera & apparaten']];
  return [...primary,...secondary];
}

export function renderShell({route, organizer, navOpen, page, icon, esc, scopeOptions, isClub, avatar, notify, dark, venueId}) {
  const model = navigationFor(route, organizer);
  const home = organizer ? 'dashboard' : 'home';
  const name = organizer ? 'Danny Goldenbelt' : 'Rick van Dijk';
  const isVenueTab = id => ['venue','venue-cast/studio'].includes(id);
  const pageLink = ([id, glyph, label], active, navClass) => {
    const action = isVenueTab(id) && venueId != null ? `data-action="venue-open-event" data-event-id="${esc(venueId)}"` : 'data-action="nav"';
    return `<a class="${navClass}${active ? ' active' : ''}" href="#${id}" ${action} data-to="${id}"${active ? ` aria-current="${id.split('/')[0] === route ? 'page' : 'location'}"` : ''}>${icon(glyph)}<span>${esc(label)}</span></a>`;
  };
  const menu = `aria-controls="df-sidebar" aria-expanded="${navOpen}"`;
  const mode = organizer ? 'Organisator' : 'Speler';
  const profile = `<button type="button" class="df-account" data-action="role" aria-label="Demo-rol wisselen voor ${name}">
    ${avatar(name)}<span class="df-account__text"><strong>${name}</strong><small>${mode} · demo</small></span>${icon('down')}
  </button>`;
  const tabRoute = route === 'venue-cast' ? 'venue-cast/studio' : route === 'lobby' ? 'practice' : !organizer && route === 'venue' ? 'operations' : route;
  const tabs = model.tabs.filter(([id]) => !isVenueTab(id) || venueId != null || id === tabRoute);
  const crumb = model.parentLabel && model.parent !== route && model.parentLabel !== model.label
    ? `<a href="#${model.parent}" data-action="nav" data-to="${model.parent}">${esc(model.parentLabel)}</a><span aria-hidden="true">/</span>`
    : '';
  return `<div class="shell df-shell${dark ? ' df-shell--match' : ''}">
    <a class="df-skip" href="#main-content" data-action="skip-content">Naar de inhoud</a>
    <div class="mobile-shade${navOpen ? ' visible' : ''}" data-action="toggle-menu" aria-hidden="true"></div>
    <aside class="sidebar df-sidebar${navOpen ? ' open' : ''}" id="df-sidebar" aria-label="DartFlow-menu">
      <div class="df-sidebar__head">
        <a class="brand df-brand" href="#${home}" data-action="nav" data-to="${home}"><img src="assets/dartflow-logo.svg" alt="DartFlow" width="1916" height="496"></a>
        <button type="button" class="icon-btn df-menu-close" data-action="toggle-menu" aria-label="Menu sluiten">${icon('close')}</button>
      </div>
      <div class="df-role" role="group" aria-label="Werkruimte">
        <button type="button" data-action="portal-space" data-space="player" aria-pressed="${!organizer}">Speler</button>
        <button type="button" data-action="portal-space" data-space="organizer" aria-pressed="${organizer}">Organiseren</button>
      </div>
      <nav class="df-nav" aria-label="Hoofdnavigatie">
        ${model.groups.map(([label,items])=>`<div class="df-nav__group"><div class="df-nav__label">${esc(label)}</div>${items.map(item=>pageLink(item,item[0]===model.parent,'nav-btn df-nav__link')).join('')}</div>`).join('')}
        <button type="button" class="nav-btn df-nav__link df-drawer-search" data-action="search">${icon('search')}<span>Zoeken</span></button>
      </nav>
      <div class="df-sidebar__foot">
        <a href="/" class="df-about">${icon('info')}<span>Over DartFlow</span>${icon('right')}</a>
        ${profile}
      </div>
    </aside>
    <div class="main df-main">
      <header class="topbar df-topbar">
        <a class="topbar-brand df-mobile-brand" href="#${home}" data-action="nav" data-to="${home}"><img class="mobile-lockup" src="assets/dartflow-logo.svg" alt="DartFlow" width="1916" height="496"></a>
        <nav class="df-breadcrumb" aria-label="Broodkruimelpad">${crumb}<strong aria-current="page">${esc(model.label)}</strong></nav>
        <div class="top-actions df-top-actions">
          <label class="df-scope">${icon(isClub?'shield':'globe')}<select data-scope-select aria-label="Vereniging of platform kiezen">${scopeOptions}</select></label>
          <button type="button" class="icon-btn df-search" aria-label="Zoeken" data-action="search">${icon('search')}<span>Zoeken</span></button>
          <button type="button" class="icon-btn" aria-label="Meldingen" data-action="portal-notifications">${icon('bell')}${notify?'<span class="notification-dot"></span>':''}</button>
        </div>
      </header>
      <main class="content df-content${dark ? ' dr-match-content' : ''}" id="main-content" tabindex="-1">
        ${tabs.length ? `<nav class="df-subnav" aria-label="${esc(model.parentLabel || 'Werkruimte')}">${tabs.map(item=>pageLink(item,item[0]===tabRoute,'df-subnav__link')).join('')}</nav>` : ''}
        ${page}
      </main>
    </div>
    <nav class="bottom-nav df-bottom" aria-label="Mobiele navigatie">
      ${model.mobile.map(([id,glyph,label])=>`<button type="button" class="${model.mobileActive===id?'active':''}" data-action="nav" data-to="${id}" aria-label="${esc(label)}"${model.mobileActive===id?' aria-current="location"':''}>${icon(glyph)}<span>${esc(mobileLabels[id] || label)}</span></button>`).join('')}
      <button type="button" id="df-menu-toggle" class="${navOpen?'active':''}" data-action="toggle-menu" aria-label="Menu openen" ${menu}>${icon('menu')}<span>Menu</span></button>
    </nav>
  </div>`;
}
