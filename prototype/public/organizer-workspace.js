import { venueSnapshot } from './venue-engine.js';

const styles = 'df-workspace';
const sameScope = (left, right) => String(left ?? 'platform') === String(right ?? 'platform');
const eventStages = {registration: 'Inschrijving', pools: 'Poulefase', knockout: 'Knock-out', finished: 'Afgerond'};
const tournamentStatuses = {draft: 'In voorbereiding', open: 'Inschrijving open', active: 'Actief', finished: 'Afgerond'};
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

function masthead(ctx, scope, kicker, title, description, buttons) {
  return `<header class="${styles}__masthead"><div class="${styles}__intro">
    <p class="${styles}__kicker">${kicker} · ${ctx.esc(scope.name)}</p><h1>${title}</h1><p>${description}</p>
    </div>${buttons}</header>`;
}

function section(id, title, subtitle, content, button = '', {panel = false} = {}) {
  return `<section class="${styles}__section${panel ? ` ${styles}__panel` : ''}" aria-labelledby="${id}"><div class="${styles}__section-head">
    <div><h2 id="${id}">${title}</h2><p>${subtitle}</p></div>${button}</div>${content}</section>`;
}

function tile(ctx, iconName, title, text, button, tag = '', featured = false) {
  return `<article class="${styles}__tile${featured ? ` ${styles}__tile--featured` : ''}">
    <div class="${styles}__tile-head"><span class="${styles}__icon">${ctx.icon(iconName)}</span>${tag}</div>
    <h3>${title}</h3><p>${text}</p>${button}</article>`;
}

function row(title, detail, button, tag = '') {
  return `<div class="${styles}__row"><div class="${styles}__row-info"><strong>${title}</strong><p>${detail}</p></div>
    <div class="${styles}__row-actions">${tag}${button}</div></div>`;
}

function empty(title, text, button = '') {
  return `<div class="${styles}__empty"><strong>${title}</strong><p>${text}</p>${button}</div>`;
}

function venueCounts(event) {
  return event ? venueSnapshot(event).counts : null;
}

function eventStatus(event) {
  if (event.pausedAt != null) return badge('Oproepen gepauzeerd', 'action');
  return badge(eventStages[event.stage] || 'Speeldag', event.stage === 'finished' ? 'muted' : 'live');
}

function eventMetrics(counts) {
  return `<div class="${styles}__stats">${[
    ['Ingecheckt', `${counts.checkedIn} / ${counts.registered}`], ['In wedstrijd', counts.playing],
    ['Vrije borden', counts.freeBoards], ['Uitslagen rond', `${counts.finished} / ${counts.totalMatches}`]
  ].map(([label, value]) => `<div class="${styles}__stat"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>`;
}

function eventCard(ctx, event, counts, organizer = true) {
  return `<article class="${styles}__tile ${styles}__tile--featured"><div class="${styles}__tile-head">
    <span class="${styles}__icon">${ctx.icon('target')}</span>${eventStatus(event)}</div>
    <h3>${ctx.esc(event.name)}</h3><p>Deelnemers, bordoproepen en het wedstrijdschema in de browserdemo.</p>
    ${eventMetrics(counts)}${actions(eventLink(ctx, event, 'venue', organizer ? 'Open wedstrijdregie' : 'Open speeldag', 'gold'), eventLink(ctx, event, 'venue/entries', 'Check-in'))}
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
    rows.push(row('Wedstrijden gekoppeld aan Baanmodus', 'Haal de uitslag op bij het bord zodra beide spelers haar hebben bevestigd.', eventLink(ctx, event, 'venue/boards', 'Bekijk gekoppelde borden'), badge(linked, 'live')));
  }
  if (counts?.ready && counts.freeBoards && event.pausedAt == null) {
    rows.push(row('Speelklare wedstrijden', `${counts.freeBoards} vrije ${counts.freeBoards === 1 ? 'baan' : 'banen'} bij ${ctx.esc(event.name)}.`, eventLink(ctx, event, 'venue', 'Open bordoproepen'), badge(counts.ready, 'action')));
  }
  const clubRequests = scope.club?.requests?.filter(request => request.status === 'pending').length ?? 0;
  if (clubRequests) {
    rows.push(row('Aanvragen voor lidmaatschap', `Beoordeel nieuwe leden van ${ctx.esc(scope.club.name)} in het clubdossier.`, nav(ctx, `clubs/${scope.club.id}`, 'Open club'), badge(clubRequests, 'action')));
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
  const counts = venueCounts(scope.active);
  const queue = queueRows(ctx, scope, scope.active, counts);
  return `<div class="${styles} ${styles}--organizer">
    ${masthead(ctx, scope, 'Organiseren', scope.club ? 'Cluboverzicht' : 'Platformoverzicht',
      'Bekijk open acties, bereid activiteiten voor en volg de voortgang op locatie.',
      actions(nav(ctx, 'operations', ctx.icon('pin') + ' Open wedstrijdleiding', 'gold'), nav(ctx, 'events', 'Bekijk evenementen', 'ghost')))}
    ${section('df-org-queue', 'Op te pakken', 'Open acties in deze omgeving.', queue.length ? `<div class="${styles}__rows ${styles}__queue">${queue.join('')}</div>` :
      empty('Geen open acties', 'Nieuwe aanvragen, uitslagen en bordoproepen komen hier te staan.'))}
    <div class="${styles}__grid ${styles}__grid--2">
      ${section('df-org-location', 'Op locatie', 'De speeldag in deze omgeving.', scope.active ? eventCard(ctx, scope.active, counts) :
        empty('Geen speeldag in deze omgeving', 'Open Baanmodus voor een losse partij of maak een speeldag aan.', nav(ctx, 'operations', 'Naar wedstrijdleiding')), '', {panel: true})}
      ${section('df-org-events', 'Competities en toernooien', 'Activiteiten in de geselecteerde omgeving.', activityRows(ctx, scope), nav(ctx, 'events', 'Evenementen'), {panel: true})}
    </div>
    ${section('df-org-management', 'Beheer', scope.club ? 'Leden en clubinstellingen beheren.' : 'Spelers, clubs en meldingen beheren.',
      `<div class="${styles}__grid ${styles}__grid--2">${
        tile(ctx, 'shield', scope.club ? 'Clubbeheer' : 'Platformbeheer', scope.club ? 'Bekijk leden, aanvragen, clubactiviteiten en instellingen.' : 'Open het spelersregister, aanvragen en de clubomgeving.',
          actions(nav(ctx, 'manage', 'Open clubbeheer'), scope.club && nav(ctx, `clubs/${scope.club.id}`, 'Open club')))
      }${tile(ctx, 'bell', 'Meldingen en online geschillen', 'Bekijk meldingen en betwiste uitslagen van de wedstrijdkamers.', actions(nav(ctx, 'reports', 'Bekijk meldingen')))}</div>`)}
  </div>`;
}

export function renderOperations(ctx) {
  const scope = getScope(ctx);
  const isOrganizer = ctx.db.play?.space === 'organizer' || ctx.db.role === 'admin';
  const event = scope.active;
  const counts = venueCounts(event);
  const sample = !event && ctx.db.venue;
  const sampleHost = sample && (ctx.db.play?.clubs?.items?.find(club => sameScope(club.id, sample.clubId))?.name ?? 'Dartflow-platform');
  const others = scope.events.filter(item => item.id !== event?.id);
  const operations = event ? `<div class="${styles}__grid ${styles}__grid--3">
    ${tile(ctx, 'users', 'Deelnemers en check-in', 'Bekijk inschrijvingen, wachtlijst en aanwezigheid.', actions(eventLink(ctx, event, 'venue/entries', 'Open check-in')))}
    ${isOrganizer ? tile(ctx, 'target', 'Bordbeheer', 'Beheer oproepen, vrije borden en koppelingen met Baanmodus.', actions(eventLink(ctx, event, 'venue/boards', 'Bekijk borden'))) :
      tile(ctx, 'clock', 'Mijn speeldag', 'Bekijk je volgende partij en meld je speelgereed.', actions(eventLink(ctx, event, 'venue', 'Open speeldag')))}
    ${tile(ctx, 'calendar', 'Schema en uitslagen', 'Bekijk poules, knock-out en bevestigde uitslagen.', actions(eventLink(ctx, event, 'venue/schedule', 'Bekijk schema')))}
  </div>` : empty('Geen speeldag in deze omgeving', isOrganizer ? 'Maak een speeldag met inschrijving, bordoproepen en wedstrijdschema.' : 'Kies een andere omgeving voor geplande partijen.',
    isOrganizer ? actions(ctx.button('Nieuwe speeldag', 'vf-new-event', 'gold')) : '');
  return `<div class="${styles} ${styles}--operations">
    ${masthead(ctx, scope, 'Op locatie', isOrganizer ? 'Baan, speeldag en schermregie' : 'Spelen op locatie',
      isOrganizer ? 'Gebruik Baanmodus voor live score-invoer of open een speeldag voor wedstrijdregie.' : 'Scan de QR van je baan, open de scorekaart of meld je aan voor een speeldag.',
      isOrganizer && event ? actions(ctx.button('Nieuwe speeldag', 'vf-new-event', 'ghost')) : '')}
    ${section('df-op-tools', 'Baan en schermen', 'Kies de bediening die je nodig hebt.', `<div class="${styles}__grid ${styles}__grid--2">
      ${tile(ctx, 'pin', 'Baanmodus', 'Scan een baan-QR voor solo of tegen elkaar. Score-invoer, schrijverovername en het 9:16-scherm delen de stand tussen apparaten.', actions(nav(ctx, 'baan', 'Open Baanmodus', 'gold')), badge('Gedeelde live stand', 'live'), true)}
      ${isOrganizer ? tile(ctx, 'camera', 'Schermstudio', 'Bedien zaalschermen, het publieksbeeld en OBS-scènes vanuit de gekozen speeldag.',
        actions(event && eventLink(ctx, event, 'venue-cast/studio', 'Open Schermstudio'), !event && sample && eventLink(ctx, sample, 'venue-cast/studio', `Bekijk demo · ${ctx.esc(sampleHost)}`)),
        badge('Browserdemo')) : tile(ctx, 'trophy', 'Geplande wedstrijd', 'Bekijk waar en wanneer je speelt. Meld je bij de baan die de wedstrijdleiding heeft toegewezen.', actions(nav(ctx, 'events', 'Bekijk evenementen')))}
    </div>`)}
    ${section('df-op-event', 'Speeldag en wedstrijdregie', 'Inschrijving, check-in en wedstrijdschema in de geselecteerde omgeving.',
      (event ? eventCard(ctx, event, counts, isOrganizer) : '') + operations + (sample ? `<div class="${styles}__note"><div><strong>Voorbeeldspeeldag · ${ctx.esc(sampleHost)}</strong><p>${ctx.esc(sample.name)} staat in een andere omgeving.</p></div>${eventLink(ctx, sample, 'venue', 'Open voorbeeldspeeldag')}</div>` : ''))}
    ${others.length ? section('df-op-other', 'Andere speeldagen', 'Open een andere speeldag in deze omgeving.', `<div class="${styles}__rows">${others.map(item => row(ctx.esc(item.name), eventStages[item.stage] || 'Speeldag', eventLink(ctx, item, 'venue', 'Open speeldag'))).join('')}</div>`) : ''}
  </div>`;
}
