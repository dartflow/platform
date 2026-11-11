import { venueSnapshot } from './venue-engine.js';

const styles = 'df-workspace';
const sameScope = (left, right) => String(left ?? 'platform') === String(right ?? 'platform');
const eventStages = {registration: 'Inschrijving', pools: 'Poulefase', knockout: 'Knock-out', finished: 'Afgerond'};
const tournamentStatuses = {draft: 'In voorbereiding', open: 'Inschrijving open', active: 'Actief', finished: 'Afgerond'};
const boardStatuses = {free: 'Vrij', playing: 'In wedstrijd', called: 'Opgeroepen', reserved: 'Gereserveerd', blocked: 'Geblokkeerd', pending: 'Wacht op akkoord', disputed: 'Betwist'};
const dateFormat = new Intl.DateTimeFormat('nl-NL', {day: 'numeric', month: 'short'});

function getScope(ctx) {
  const id = ctx.scopeId?.() ?? null;
  const name = ctx.scopeName?.() ?? 'Dartflow Wereldwijd';
  const club = ctx.db.play?.clubs?.items?.find(item => sameScope(item.id, id));
  const events = ctx.scopedVenueEvents?.() ?? (ctx.venueEvents?.() || [ctx.db.venue]).filter(event => event && sameScope(event.clubId, id));
  const active = events.find(event => event.id === ctx.db.venue?.id && event.stage !== 'finished')
    ?? events.find(event => event.stage !== 'finished') ?? events[0];
  const tournaments = (ctx.db.tournaments || []).filter(item => sameScope(item.clubId, id));
  const leagues = (ctx.db.play?.leagues || []).filter(item => sameScope(item.clubId, id));
  return {id, name, club, events, active, tournaments, leagues};
}

const badge = (label, tone = 'muted') => `<span class="${styles}__badge ${styles}__badge--${tone}">${label}</span>`;
const actions = (...buttons) => `<div class="${styles}__actions">${buttons.filter(Boolean).join('')}</div>`;

function nav(ctx, to, label, style = 'ghost small') {
  return `<a class="btn ${style}" href="#${ctx.esc(to)}" data-action="nav" data-to="${ctx.esc(to)}">${label}</a>`;
}

function eventLink(ctx, event, to, label, style = 'ghost small') {
  return ctx.button(label, 'venue-open-event', style, `data-event-id="${ctx.esc(event.id)}" data-to="${ctx.esc(to)}"`);
}

function masthead(ctx, scope, title, buttons = '') {
  return `<header class="${styles}__masthead">
    <div class="${styles}__intro">
      <p class="${styles}__kicker">${ctx.esc(scope.name)}</p>
      <h1>${title}</h1>
    </div>
    ${buttons}
  </header>`;
}

function section(id, title, content, button = '', {panel = false, graphic = ''} = {}) {
  return `<section class="${styles}__section${panel ? ` ${styles}__panel` : ''}${graphic ? ` df-graphic df-graphic--${graphic}` : ''}" aria-labelledby="${id}">
    <div class="${styles}__section-head"><h2 id="${id}">${title}</h2>${button}</div>
    ${content}
  </section>`;
}

function tile(ctx, iconName, title, text, button) {
  return `<article class="${styles}__tile df-graphic df-graphic--${iconName === 'target' || iconName === 'pin' ? 'board' : 'lanes'}">
    <span class="${styles}__icon">${ctx.icon(iconName)}</span>
    <h3>${title}</h3><p>${text}</p>${button}</article>`;
}

function row(title, detail, button, tag = '') {
  return `<div class="${styles}__row"><div class="${styles}__row-info"><strong>${title}</strong><small>${detail}</small></div>
    <div class="${styles}__row-actions">${tag}${button}</div></div>`;
}

function empty(title, text, button = '') {
  return `<div class="${styles}__empty"><strong>${title}</strong>${text ? `<p>${text}</p>` : ''}${button}</div>`;
}

function eventStatus(event) {
  if (event.pausedAt != null) return badge('Oproepen gepauzeerd', 'action');
  return badge(eventStages[event.stage] || 'Speeldag', event.stage === 'finished' ? 'muted' : 'live');
}

function eventMetrics(counts) {
  return `<div class="${styles}__stats">${[
    ['Ingecheckt', `${counts.checkedIn} / ${counts.registered}`], ['In wedstrijd', counts.playing],
    ['Vrije banen', counts.freeBoards], ['Uitslagen rond', `${counts.finished} / ${counts.totalMatches}`]
  ].map(([label, value]) => `<div class="${styles}__stat"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>`;
}

function eventCard(ctx, event, snapshot, organizer = true) {
  const {counts, boards} = snapshot;
  return `<article class="${styles}__panel df-organizer-event df-graphic df-graphic--board">
    <div class="${styles}__section-head">
      <div><h2>${ctx.esc(event.name)}</h2><p>Speeldag op locatie</p></div>
      ${eventStatus(event)}
    </div>
    ${eventMetrics(counts)}
    ${boards.length ? `<ul class="df-organizer-boards" aria-label="Bordstatus">
      ${boards.map(board => `<li data-status="${ctx.esc(board.status)}"><strong>${ctx.esc(board.name)}</strong><small>${boardStatuses[board.status] || 'In gebruik'}</small></li>`).join('')}
    </ul>` : ''}
    ${actions(eventLink(ctx, event, 'venue', organizer ? 'Open wedstrijdregie' : 'Open speeldag', 'gold'), eventLink(ctx, event, 'venue/entries', 'Check-in'))}
  </article>`;
}

function queueRows(ctx, scope, event, counts) {
  const rows = [];
  if (event?.pausedAt != null && event.stage !== 'finished') {
    rows.push(row('Bordoproepen gepauzeerd', ctx.esc(event.name), eventLink(ctx, event, 'venue', 'Open oproepregie'), badge('Gepauzeerd', 'action')));
  }
  if (counts?.disputed) {
    rows.push(row('Betwiste uitslagen op locatie', ctx.esc(event.name), eventLink(ctx, event, 'venue', 'Bekijk geschillen'), badge(counts.disputed, 'action')));
  }
  if (counts?.pending) {
    rows.push(row('Uitslagen wachten op akkoord', ctx.esc(event.name), eventLink(ctx, event, 'venue', 'Bekijk uitslagen'), badge(counts.pending, 'action')));
  }
  const linked = event?.matches.filter(match => match.realtimeRoom && match.status === 'playing').length ?? 0;
  if (linked) {
    rows.push(row('Wedstrijden in Baanmodus', 'Haal de uitslag op na akkoord van beide spelers.', eventLink(ctx, event, 'venue/boards', 'Bekijk borden'), badge(linked, 'live')));
  }
  if (counts?.ready && counts.freeBoards && event.pausedAt == null) {
    rows.push(row('Speelklare wedstrijden', `${counts.freeBoards} vrije ${counts.freeBoards === 1 ? 'baan' : 'banen'} bij ${ctx.esc(event.name)}.`, eventLink(ctx, event, 'venue', 'Open bordoproepen'), badge(counts.ready, 'action')));
  }
  const clubRequests = scope.club?.requests?.filter(request => request.status === 'pending').length ?? 0;
  if (clubRequests) {
    rows.push(row('Lidmaatschapsaanvragen', ctx.esc(scope.club.name), nav(ctx, `clubs/${scope.club.id}`, 'Open club'), badge(clubRequests, 'action')));
  }
  const pendingRequests = (ctx.scopedRegistrationRequests?.() ?? (ctx.db.requests || []).filter(request => (
    request.type === 'player' ? scope.id == null : scope.tournaments.some(event => String(event.id) === String(request.tournament))
  ))).filter(request => request.status === 'pending');
  if (pendingRequests.length) {
    const players = pendingRequests.filter(request => request.type === 'player').length;
    const entries = pendingRequests.length - players;
    const title = players && entries ? 'Spelers- en toernooiaanmeldingen' : players ? 'Nieuwe spelersprofielen' : 'Toernooiaanmeldingen';
    const detail = [players ? `${players} voor het spelersregister` : '', entries ? `${entries} voor toernooideelname` : ''].filter(Boolean).join(' · ');
    rows.push(row(title, detail, nav(ctx, 'registrations', 'Bekijk aanmeldingen'), badge(pendingRequests.length, 'action')));
  }
  return rows;
}

function datestr(value) {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? '' : dateFormat.format(date);
}

function activityRows(ctx, scope) {
  const activities = [
    ...scope.tournaments.filter(item => item.status !== 'finished').map(item => ({
      item, date: item.date, type: 'Toernooi', status: tournamentStatuses[item.status], action: 'clubs-tournament'
    })),
    ...scope.leagues.map(item => ({item, date: item.startDate, type: 'Competitie', status: item.season, action: 'clubs-league'}))
  ].sort((left, right) => String(left.date || '').localeCompare(String(right.date || ''))).slice(0, 4);
  if (!activities.length) return empty('Geen competities of toernooien gepland', 'Maak een activiteit aan of open een andere clubomgeving.');
  return `<div class="${styles}__rows">${activities.map(({item, date, type, status, action}) => row(
    ctx.esc(item.name), [type, datestr(date), status].filter(Boolean).map(ctx.esc).join(' · '),
    ctx.button(type === 'Toernooi' ? 'Open toernooi' : 'Open competitie', action, 'ghost small', `data-id="${ctx.esc(item.id)}"`)
  )).join('')}</div>`;
}

export function renderOrganizerDashboard(ctx) {
  const scope = getScope(ctx);
  const snapshot = scope.active ? venueSnapshot(scope.active) : null;
  const queue = queueRows(ctx, scope, scope.active, snapshot?.counts);
  const queueContent = queue.length
    ? `<div class="${styles}__rows ${styles}__queue">${queue.join('')}</div>`
    : empty('Alles bijgewerkt', 'Er zijn geen aanvragen, uitslagen of bordoproepen die actie vragen.');
  const queuePanel = section('df-org-queue', 'Open acties', queueContent, '', {panel: true});
  const eventPanel = scope.active ? eventCard(ctx, scope.active, snapshot) : section(
    'df-org-location', 'Speeldag op locatie',
    empty('Geen speeldag gepland', '', nav(ctx, 'operations', 'Wedstrijdleiding')),
    '', {panel: true, graphic: 'board'}
  );
  const management = `<div class="${styles}__rows">
    ${row('Clubbeheer', scope.club ? 'Leden, aanvragen en clubinstellingen.' : 'Spelersregister, aanvragen en verenigingen.',
      nav(ctx, 'manage', 'Open clubbeheer'))}
    ${scope.club ? row('Clubdossier', ctx.esc(scope.club.name), nav(ctx, `clubs/${scope.club.id}`, 'Open club')) : ''}
    ${row('Meldingen & geschillen', 'Meldingen en betwiste uitslagen uit online wedstrijdkamers.',
      nav(ctx, 'reports', 'Bekijk meldingen'))}
  </div>`;
  return `<div class="${styles} ${styles}--organizer ${styles}--polished">
    ${masthead(ctx, scope, scope.club ? 'Cluboverzicht' : 'Platformoverzicht',
      actions(nav(ctx, 'events', 'Evenementen', 'ghost'), nav(ctx, 'operations', ctx.icon('pin') + ' Wedstrijdleiding', 'gold')))}
    <div class="${styles}__grid ${styles}__grid--2">
      ${queuePanel}
      ${eventPanel}
    </div>
    <div class="${styles}__grid ${styles}__grid--2">
      ${section('df-org-events', 'Kalender', activityRows(ctx, scope), '', {panel: true})}
      ${section('df-org-management', 'Beheer', management, '', {panel: true})}
    </div>
  </div>`;
}

export function renderOperations(ctx) {
  const scope = getScope(ctx);
  const isOrganizer = ctx.db.play?.space === 'organizer' || ctx.db.role === 'admin';
  const event = scope.active;
  const snapshot = event ? venueSnapshot(event) : null;
  const sample = !event && ctx.db.venue;
  const sampleHost = sample && (ctx.db.play?.clubs?.items?.find(club => sameScope(club.id, sample.clubId))?.name ?? 'Dartflow-platform');
  const others = scope.events.filter(item => item.id !== event?.id);
  const operations = event ? `<div class="${styles}__grid ${styles}__grid--3">
    ${tile(ctx, 'users', 'Deelnemers en check-in', 'Bekijk inschrijvingen, wachtlijst en aanwezigheid.', actions(eventLink(ctx, event, 'venue/entries', 'Open check-in')))}
    ${isOrganizer ? tile(ctx, 'target', 'Bordbeheer', 'Bordoproepen, vrije banen en koppelingen met Baanmodus.', actions(eventLink(ctx, event, 'venue/boards', 'Bekijk borden'))) :
      tile(ctx, 'clock', 'Mijn speeldag', 'Bekijk je volgende partij en meld je speelgereed.', actions(eventLink(ctx, event, 'venue', 'Naar mijn speeldag')))}
    ${tile(ctx, 'calendar', 'Schema & uitslagen', 'Poules, knock-out en bevestigde uitslagen.', actions(eventLink(ctx, event, 'venue/schedule', 'Bekijk schema')))}
  </div>` : '';
  const studioAction = event ? eventLink(ctx, event, 'venue-cast/studio', 'Open Schermstudio')
    : sample ? eventLink(ctx, sample, 'venue-cast/studio', `Bekijk demo · ${ctx.esc(sampleHost)}`) : '';
  const demoEvent = sample ? `<div class="${styles}__note">
    <div><strong>Voorbeeldspeeldag</strong><p>${ctx.esc(sample.name)} · ${ctx.esc(sampleHost)}</p></div>
    ${eventLink(ctx, sample, 'venue', 'Bekijk voorbeeld')}
  </div>` : '';
  return `<div class="${styles} ${styles}--operations ${styles}--polished">
    ${masthead(ctx, scope, isOrganizer ? 'Wedstrijdleiding' : 'Spelen op locatie',
      isOrganizer ? actions(ctx.button(ctx.icon('plus') + ' Nieuwe speeldag', 'vf-new-event', event ? 'ghost' : 'gold')) : '')}
    ${event ? eventCard(ctx, event, snapshot, isOrganizer) + operations
      : empty('Geen speeldag gepland', isOrganizer ? 'Maak een speeldag aan om deelnemers en banen in te delen.' : 'Kies een andere vereniging om daar het programma te bekijken.')}
    ${section('df-op-tools', 'Baan & schermen', `<div class="${styles}__grid ${styles}__grid--2">
      ${tile(ctx, 'pin', 'Baanmodus', 'Voer scores in via een baan-QR en volg de stand live op het zaalscherm.', actions(nav(ctx, 'baan', 'Open Baanmodus', event ? 'ghost' : 'gold')))}
      ${isOrganizer ? tile(ctx, 'camera', 'Schermstudio', 'Bedien zaalschermen, het publieksbeeld en OBS-scènes.', studioAction ? actions(studioAction) : '')
        : tile(ctx, 'trophy', 'Evenementen', 'Bekijk geplande wedstrijden, competities en toernooien.', actions(nav(ctx, 'events', 'Bekijk evenementen')))}
    </div>`)}
    ${demoEvent}
    ${others.length ? section('df-op-other', 'Andere speeldagen', `<div class="${styles}__rows">${others.map(item => row(ctx.esc(item.name), eventStages[item.stage] || 'Speeldag', eventLink(ctx, item, 'venue', 'Open speeldag'))).join('')}</div>`) : ''}
  </div>`;
}
