function link(ctx, label, route, style = 'ghost') {
  const target = ctx.esc(route);
  return `<a class="btn ${style}" href="#${target}" data-action="nav" data-to="${target}">${ctx.esc(label)} ${ctx.icon('right')}</a>`;
}

function workspace(ctx, {kicker, title, description, actions = '', content}) {
  return `<div class="df-workspace">
    <header class="df-workspace__masthead">
      <div class="df-workspace__intro">
        <p class="df-workspace__kicker">${ctx.esc(kicker)}</p>
        <h1>${ctx.esc(title)}</h1>
        <p>${ctx.esc(description)}</p>
      </div>
      ${actions ? `<div class="df-workspace__actions">${actions}</div>` : ''}
    </header>
    ${content}
  </div>`;
}

function tile(ctx, {icon, label, description, badge, actions}) {
  const {esc} = ctx;
  return `<article class="df-workspace__tile">
    <div class="df-workspace__tile-head">
      <span class="df-workspace__icon">${ctx.icon(icon)}</span>
      ${badge ? `<span class="df-workspace__badge">${esc(badge)}</span>` : ''}
    </div>
    <h3>${esc(label)}</h3>
    <p>${esc(description)}</p>
    <div class="df-workspace__row-actions">${actions}</div>
  </article>`;
}

function section(ctx, {title, description, columns, tiles}) {
  return `<section class="df-workspace__section">
    <div class="df-workspace__section-head"><div><h2>${ctx.esc(title)}</h2><p>${ctx.esc(description)}</p></div></div>
    <div class="df-workspace__grid df-workspace__grid--${columns}">${tiles.map(item => tile(ctx, item)).join('')}</div>
  </section>`;
}

function scoped(ctx, items) {
  const scope = ctx.scopeId();
  return (items || []).filter(item => String(item.clubId ?? '') === String(scope ?? ''));
}

const count = (length, one, many) => `${length} ${length === 1 ? one : many}`;

export function renderPlayHub(ctx) {
  const scope = ctx.scopeName();
  return workspace(ctx, {
    kicker: scope,
    title: 'Spelen',
    description: 'Kies tussen een vrije partij, gericht trainen en spelen op een aangesloten baan.',
    actions: ctx.button(ctx.icon('link') + ' Wedstrijdcode invoeren', 'room-join', 'ghost'),
    content: section(ctx, {
      title: 'Start een partij', description: 'Kies de spelvorm die past bij waar je staat en met wie je speelt.', columns: 3,
      tiles: [
        {icon:'users', label:'Vrij spelen', description:'Daag een vriend uit of zoek een tegenstander. Kies één bord, twee borden, online of hybride.', badge:'Wedstrijdkamer · demo', actions:link(ctx,'Open speelzaal','practice')},
        {icon:'target', label:'Solo & training', description:'Oefen je dubbels, pak de 170-challenge of speel een partij tegen de Dartbot.', badge:'Oefenen', actions:link(ctx,'Kies training','training')},
        {icon:'pin', label:'Baanmodus (QR)', description:'Open een baan op je telefoon. De scorekaart op het zaalscherm telt live mee en spelers kunnen de invoer overnemen.', badge:'Live tussen apparaten', actions:link(ctx,'Open Baanmodus','baan','gold')},
      ],
    }) + section(ctx, {
      title: 'Speel volgens planning', description: 'Bekijk je wedstrijden of open het evenement waarvoor je speelt.', columns: 2,
      tiles: [
        {icon:'calendar', label:'Mijn wedstrijden', description:'Vind een lopende wedstrijdkamer en bekijk je bevestigde uitslagen.', actions:link(ctx,'Naar mijn wedstrijden','mymatches')},
        {icon:'trophy', label:'Competities & toernooien', description:'Ga naar het programma, de stand of een geplande speeldag met check-in en bordoproepen.', actions:link(ctx,'Bekijk evenementen','events')},
      ],
    }),
  });
}

export function renderEventsHub(ctx) {
  const organizer = ctx.db.role === 'admin';
  const leagues = scoped(ctx, ctx.db.play?.leagues);
  const tournaments = scoped(ctx, ctx.db.tournaments);
  const openTournaments = tournaments.filter(tournament => tournament.status === 'open');
  const venueDays = ctx.scopedVenueEvents?.() || [];
  const venueDay = venueDays.find(event => event.id === ctx.db.venue?.id) || venueDays[0];
  const venueAction = organizer ? link(ctx,'Naar wedstrijdleiding','operations','gold')
    : venueDay ? ctx.button('Open geplande speeldag ' + ctx.icon('right'), 'venue-open-event', 'gold', `data-event-id="${ctx.esc(venueDay.id)}"`) : '';
  const tournamentAction = organizer ? link(ctx,'Beheer toernooien','tournaments')
    : openTournaments.length ? link(ctx,'Bekijk inschrijvingen','tournaments') : '';
  return workspace(ctx, {
    kicker: ctx.scopeName(),
    title: 'Evenementen',
    description: organizer ? 'Organiseer de kalender, richt wedstrijden in en open de regie voor een speeldag op locatie.'
      : 'Vind competities, toernooien en geplande speeldagen in je gekozen omgeving.',
    actions: organizer ? ctx.button(ctx.icon('plus') + ' Competitie maken', 'comp-new', 'ghost')
      + ctx.button(ctx.icon('plus') + ' Toernooi maken', 'new-tour', 'gold') : '',
    content: section(ctx, {
      title: 'Kies het soort evenement', description: 'Elke vorm heeft een eigen programma en wedstrijdverloop.', columns: 3,
      tiles: [
        {icon:'chart', label:'Competities', badge:count(leagues.length,'competitie','competities'),
          description:leagues.length ? 'Bekijk het seizoen, het speelschema, tijdvoorstellen en de stand.' : 'Er staan nog geen competities in deze omgeving.', actions:link(ctx,'Open competities','leagues')},
        {icon:'trophy', label:'Toernooien', badge:count(tournaments.length,'toernooi','toernooien'),
          description:tournaments.length ? 'Open de toernooizaal voor check-in, deelnemers, poules en knock-out.' : 'Er staan nog geen toernooien in deze omgeving.',
          actions:link(ctx,'Open toernooizaal','hall') + tournamentAction},
        {icon:'pin', label:'Geplande speeldagen', badge:count(venueDays.length,'speeldag','speeldagen'),
          description:venueDay ? `${venueDay.name} · Check-in, bordoproepen en uitslagen op locatie.` : 'Er staat nog geen speeldag op locatie in deze omgeving.',
          actions:venueAction},
      ],
    }),
  });
}

export function renderManageHub(ctx) {
  const {db} = ctx;
  const club = (db.play?.clubs?.items || []).find(item => String(item.id) === String(ctx.scopeId()));
  const requests = (club?.requests || []).filter(request => request.status === 'pending');
  const profileCount = (db.players || []).filter(player => player.status === 'approved').length;
  const registrationCount = (ctx.scopedRegistrationRequests?.() || []).filter(request => request.status === 'pending').length;
  const reports = (db.play?.social?.reports || []).filter(report => !report.resolved).length;
  const disputes = (db.matches || []).filter(match => db.play?.rooms?.[match.id]?.dispute).length;
  const organizer = db.role === 'admin';
  if (!organizer) return workspace(ctx, {
    kicker: ctx.scopeName(), title:'Clubbeheer',
    description:'Kies Organiseren om het clubbeheer in deze demo te openen.',
    actions:link(ctx,'Naar mijn clubs','clubs','gold'), content:'',
  });
  const clubTile = club ? {
    icon:'shield', label:'Leden, rollen & clubinstellingen', badge:count(requests.length,'aanvraag','aanvragen'),
    description:`${count((club.members || []).length,'lid','leden')} bij ${club.name}. Open het clubdossier voor lidmaatschapsaanvragen, rollen en instellingen.`,
    actions:link(ctx,'Open clubdossier',`clubs/${club.id}`,'gold'),
  } : {
    icon:'shield', label:'Verenigingen', description:'Open een clubdossier voor leden, aanvragen en rollen. Kies een vereniging in de omgevingskiezer voor de bijbehorende werkruimte.',
    actions:link(ctx,'Open verenigingen','clubs','gold'),
  };
  return workspace(ctx, {
    kicker: ctx.scopeName(), title:'Clubbeheer',
    description:'Beheer je vereniging en vind de platformbrede beheerfuncties op één plek.',
    actions:link(ctx,'Accountvoorkeuren','settings'),
    content: section(ctx, {
      title:club ? 'Binnen de vereniging' : 'Verenigingen beheren',
      description:club ? `Clubdossier en kamers van ${club.name}.` : 'Clubs hebben elk hun eigen leden, aanvragen en kamers.',
      columns:2,
      tiles:[clubTile,
        {icon:'chat', label:club ? 'Clubkamers & moderatie' : 'Platformkamers & moderatie',
          description:'Open de kamers in deze omgeving om gesprekken, toegangsregels en moderatie te beheren.',
          actions:link(ctx,'Open chatkamers','community')},
      ],
    }) + section(ctx, {
      title:'Overige administratie', description:'Toernooiaanmeldingen volgen de gekozen omgeving. Profielen en meldingen horen bij het platform.', columns:3,
      tiles:[
        {icon:'user', label:'Spelersregister', badge:count(profileCount,'profiel','profielen'), description:'Bekijk goedgekeurde spelersprofielen en beheer profielgegevens.', actions:link(ctx,'Open spelersregister','players')},
        {icon:'clipboard', label:club ? 'Toernooiaanmeldingen' : 'Speler- en toernooiaanmeldingen', badge:`${registrationCount} open`, description:club ? 'Beoordeel deelname aan toernooien van deze vereniging.' : 'Beoordeel nieuwe profielen en deelname aan platformtoernooien.', actions:link(ctx,'Open aanmeldingen','registrations')},
        {icon:'shield', label:'Meldingen & geschillen', badge:`${reports + disputes} open`, description:'Beoordeel meldingen en betwiste uitslagen uit gewone wedstrijdkamers.', actions:link(ctx,'Open meldingen','reports')},
      ],
    }),
  });
}
