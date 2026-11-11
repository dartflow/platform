function link(ctx, label, route, style = 'ghost') {
  const target = ctx.esc(route);
  return `<a class="btn ${style}" href="#${target}" data-action="nav" data-to="${target}">${ctx.esc(label)}</a>`;
}

function workspace(ctx, {title, description = '', actions = '', content = ''}) {
  return `<div class="df-workspace df-workspace--polished">
    <header class="df-workspace__masthead">
      <div class="df-workspace__intro">
        <p class="df-workspace__kicker">${ctx.esc(ctx.scopeName())}</p>
        <h1>${ctx.esc(title)}</h1>
        ${description ? `<p>${ctx.esc(description)}</p>` : ''}
      </div>
      ${actions ? `<div class="df-workspace__actions">${actions}</div>` : ''}
    </header>
    ${content}
  </div>`;
}

function tile(ctx, {icon, label, description, badge, actions}) {
  const {esc} = ctx;
  const motif = ['pin', 'target', 'trophy'].includes(icon) ? 'board' : 'lanes';
  return `<article class="df-workspace__tile df-graphic df-graphic--${motif}">
    <div class="df-workspace__tile-head">
      <span class="df-workspace__icon">${ctx.icon(icon)}</span>
      ${badge ? `<span class="df-workspace__badge">${esc(badge)}</span>` : ''}
    </div>
    <h3>${esc(label)}</h3>
    <p>${esc(description)}</p>
    ${actions ? `<div class="df-workspace__actions">${actions}</div>` : ''}
  </article>`;
}

function section(ctx, title, tiles) {
  return `<section class="df-workspace__section">
    ${title ? `<div class="df-workspace__section-head"><h2>${ctx.esc(title)}</h2></div>` : ''}
    <div class="df-workspace__grid df-workspace__grid--3">${tiles.map(item => tile(ctx, item)).join('')}</div>
  </section>`;
}

function quickLink(ctx, icon, label, detail, action) {
  return `<div class="df-workspace__row">
    <span class="df-workspace__icon">${ctx.icon(icon)}</span>
    <div class="df-workspace__row-info"><strong>${label}</strong><small>${detail}</small></div>
    <div class="df-workspace__row-actions">${action}</div>
  </div>`;
}

function scoped(ctx, items) {
  const scope = ctx.scopeId();
  return (items || []).filter(item => String(item.clubId ?? '') === String(scope ?? ''));
}

const count = (length, one, many) => `${length} ${length === 1 ? one : many}`;

export function renderPlayHub(ctx) {
  return workspace(ctx, {
    title: 'Spelen',
    actions: ctx.button(ctx.icon('link') + ' Wedstrijdcode invoeren', 'room-join', 'ghost'),
    content: section(ctx, '', [
      {icon: 'users', label: 'Vrij spelen', description: 'Speel tegen een vriend of zoek een tegenstander voor een lokale of online partij.',
        actions: link(ctx, 'Open speelzaal', 'practice')},
      {icon: 'target', label: 'Solo & training', description: 'Oefen finishes, speel de 170-challenge of neem het op tegen de Dartbot.',
        actions: link(ctx, 'Kies training', 'training')},
      {icon: 'pin', label: 'Baanmodus', description: 'Scan de QR bij een dartbaan. Voer scores in op je telefoon en volg de stand op het zaalscherm.',
        actions: link(ctx, 'Open Baanmodus', 'baan', 'gold')},
    ]) + `<section class="df-workspace__section">
      <div class="df-workspace__section-head"><h2>Programma & uitslagen</h2></div>
      <div class="df-workspace__rows">
        ${quickLink(ctx, 'calendar', 'Mijn wedstrijden', 'Lopende partijen en bevestigde uitslagen.', link(ctx, 'Bekijk wedstrijden', 'mymatches', 'ghost small'))}
        ${quickLink(ctx, 'trophy', 'Competities & toernooien', 'Speelschema’s, standen en inschrijvingen.', link(ctx, 'Bekijk evenementen', 'events', 'ghost small'))}
      </div>
    </section>`,
  });
}

export function renderEventsHub(ctx) {
  const organizer = ctx.db.role === 'admin';
  const leagues = scoped(ctx, ctx.db.play?.leagues);
  const tournaments = scoped(ctx, ctx.db.tournaments);
  const openTournaments = tournaments.filter(tournament => tournament.status === 'open');
  const venueDays = ctx.scopedVenueEvents?.() || [];
  const venueDay = venueDays.find(event => event.id === ctx.db.venue?.id) || venueDays[0];
  const venueAction = organizer ? link(ctx, 'Naar wedstrijdleiding', 'operations')
    : venueDay ? ctx.button('Bekijk speeldag', 'venue-open-event', 'ghost', `data-event-id="${ctx.esc(venueDay.id)}"`) : '';
  const tournamentAction = organizer ? link(ctx, 'Beheer toernooien', 'tournaments')
    : openTournaments.length ? link(ctx, 'Bekijk inschrijvingen', 'tournaments') : '';
  return workspace(ctx, {
    title: 'Evenementen',
    actions: organizer ? ctx.button(ctx.icon('plus') + ' Nieuwe competitie', 'comp-new', 'ghost')
      + ctx.button(ctx.icon('plus') + ' Nieuw toernooi', 'new-tour', 'gold') : '',
    content: section(ctx, '', [
      {icon: 'chart', label: 'Competities', badge: leagues.length ? count(leagues.length, 'competitie', 'competities') : '',
        description: leagues.length ? 'Speelschema’s, tijdvoorstellen en standen.' : 'Geen competities in deze omgeving.',
        actions: link(ctx, 'Bekijk competities', 'leagues')},
      {icon: 'trophy', label: 'Toernooien', badge: openTournaments.length ? `${openTournaments.length} open voor inschrijving` : '',
        description: tournaments.length ? 'Deelnemers, check-in, poules en knock-out.' : 'Geen toernooien in deze omgeving.',
        actions: link(ctx, 'Bekijk toernooien', 'hall') + tournamentAction},
      {icon: 'pin', label: 'Speeldagen', badge: venueDays.length ? count(venueDays.length, 'speeldag', 'speeldagen') : '',
        description: venueDay ? venueDay.name : 'Geen speeldag op locatie in deze omgeving.',
        actions: venueAction},
    ]),
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
  if (db.role !== 'admin') return workspace(ctx, {
    title: 'Clubbeheer',
    description: 'Kies Organiseren om het beheer te openen.',
    actions: link(ctx, 'Naar mijn clubs', 'clubs', 'gold'),
  });

  const clubTile = club ? {
    icon: 'shield', label: 'Clubdossier', badge: requests.length ? count(requests.length, 'aanvraag', 'aanvragen') : '',
    description: `${count((club.members || []).length, 'lid', 'leden')} · Lidmaatschap, rollen en instellingen.`,
    actions: link(ctx, 'Open clubdossier', `clubs/${club.id}`, 'gold'),
  } : {
    icon: 'shield', label: 'Verenigingen',
    description: 'Clubdossiers met leden, rollen en lidmaatschapsaanvragen.',
    actions: link(ctx, 'Open verenigingen', 'clubs', 'gold'),
  };

  return workspace(ctx, {
    title: 'Clubbeheer',
    actions: link(ctx, 'Voorkeuren', 'settings'),
    content: section(ctx, club ? 'Vereniging' : 'Platform', [
      clubTile,
      {icon: 'chat', label: club ? 'Clubkamers' : 'Platformkamers',
        description: 'Gesprekken, toegang en moderatie.',
        actions: link(ctx, 'Open chatkamers', 'community')},
      {icon: 'mail', label: 'Mailbeheer',
        description: 'Mailsjablonen, automatiseringen en verzendlog.',
        actions: link(ctx, 'Open mailbeheer', 'mail')},
    ]) + section(ctx, 'Administratie', [
      {icon: 'user', label: 'Spelersregister', badge: count(profileCount, 'profiel', 'profielen'),
        description: 'Goedgekeurde profielen op het platform.',
        actions: link(ctx, 'Open spelersregister', 'players')},
      {icon: 'clipboard', label: 'Aanmeldingen', badge: registrationCount ? `${registrationCount} open` : '',
        description: club ? 'Toernooiaanmeldingen van deze vereniging.' : 'Aanmeldingen voor het spelersregister en platformtoernooien.',
        actions: link(ctx, 'Open aanmeldingen', 'registrations')},
      {icon: 'bell', label: 'Meldingen & geschillen', badge: reports + disputes ? `${reports + disputes} open` : '',
        description: 'Meldingen en betwiste uitslagen uit online wedstrijdkamers.',
        actions: link(ctx, 'Open meldingen', 'reports')},
    ]),
  });
}
