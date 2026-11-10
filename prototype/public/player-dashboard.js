const playerId = 1;
const dateFormat = new Intl.DateTimeFormat('nl-NL', {day:'numeric', month:'short'});
const timeFormat = new Intl.DateTimeFormat('nl-NL', {hour:'2-digit', minute:'2-digit'});

function roomMeta(db, match) {
  return db.play.rooms?.[match.id] || {};
}

function belongsToScope(clubId, scope) {
  return String(clubId ?? '') === String(scope ?? '');
}

function parsedDate(value) {
  if (!value) return null;
  const hasTime = value.includes('T');
  const date = new Date(hasTime ? value : value + 'T12:00:00');
  return Number.isNaN(date.getTime()) ? null : {date, hasTime};
}

function programme(ctx, scope) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const {db} = ctx;
  const fixtures = (db.play.leagues || []).filter(league => belongsToScope(league.clubId, scope)).flatMap(league =>
    league.fixtures.filter(fixture => fixture.players.includes(playerId) && fixture.status !== 'finished' && !fixture.matchId).map(fixture => {
      const isProposal = fixture.status === 'proposed';
      const date = parsedDate(isProposal ? fixture.proposedTime : fixture.time);
      const opponent = fixture.players.find(id => id !== playerId);
      const future = date && date.date >= today;
      return {
        type:'league', id:league.id, icon:'calendar', title:opponent ? `Tegen ${ctx.P(opponent).name}` : 'Competitiewedstrijd',
        detail:league.name, date, priority:isProposal ? 0 : future ? 2 : 3,
        status:isProposal ? 'Tijdvoorstel' : future ? 'Gepland' : 'Speeltijd controleren',
        label:isProposal ? 'Bekijk voorstel' : 'Wedstrijdprogramma'
      };
    })
  );
  const tournaments = db.tournaments.filter(tournament => belongsToScope(tournament.clubId, scope) && ['open','active'].includes(tournament.status)).flatMap(tournament => {
    const date = parsedDate(tournament.date);
    const active = tournament.status === 'active';
    if (!active && date && date.date < today) return [];
    return [{
      type:'tournament', id:tournament.id, icon:'trophy', title:tournament.name,
      detail:tournament.location || 'Toernooi', date, priority:active ? 1 : 2,
      status:active ? 'Actief' : 'Inschrijving open', label:'Bekijk toernooi'
    }];
  });
  return [...fixtures, ...tournaments].sort((a,b) => a.priority - b.priority
    || (a.date?.date.getTime() ?? Infinity) - (b.date?.date.getTime() ?? Infinity));
}

function programmeRow(ctx, entry) {
  const {esc:e, icon, button, badge} = ctx;
  const {date} = entry;
  const when = date ? dateFormat.format(date.date) + (date.hasTime ? ' · ' + timeFormat.format(date.date) : '') : 'Datum volgt';
  return `<article class="df-workspace__row">
    <span class="df-workspace__icon">${icon(entry.icon)}</span>
    <div class="df-workspace__row-info"><strong>${e(entry.title)}</strong><small>${e(entry.detail)} · ${e(when)}</small></div>
    <div class="df-workspace__row-actions">${badge(entry.status, entry.priority <= 1 ? 'pending' : 'blue')}${button(entry.label,'portal-programme','ghost small',`data-kind="${entry.type}" data-id="${entry.id}"`)}</div>
  </article>`;
}

function actionTile(ctx, title, detail, icon, action) {
  return `<button type="button" class="df-workspace__tile df-workspace__action-tile" data-action="${action}">
    <span class="df-workspace__tile-head"><span class="df-workspace__icon">${ctx.icon(icon)}</span>${ctx.icon('right')}</span>
    <strong>${title}</strong><small>${detail}</small>
  </button>`;
}

export function openPlayerProgramme(ctx, kind, id) {
  const scope = ctx.scopeId();
  if (kind === 'league' && ctx.db.play.leagues.some(league => league.id === id && belongsToScope(league.clubId, scope))) {
    Object.assign(ctx.db.play, {selectedLeague:id, leagueTab:'fixtures', fixtureFilter:'mine'});
    ctx.save();
    ctx.go('leagues');
  } else if (kind === 'tournament' && ctx.db.tournaments.some(tournament => tournament.id === id && belongsToScope(tournament.clubId, scope))) {
    ctx.db.play.selectedHall = id;
    ctx.save();
    ctx.go('hall');
  }
}

export function renderPlayerDashboard(ctx, rows) {
  const {db, button:B, esc:e, icon:I} = ctx;
  const scope = ctx.scopeId();
  const scopeLabel = ctx.scopeName();
  const ownMatches = db.matches.filter(match => {
    const clubId = Object.hasOwn(match,'clubId') ? match.clubId : roomMeta(db,match).clubId;
    return match.players.includes(playerId) && belongsToScope(clubId,scope);
  });
  const live = ownMatches.filter(match => match.status === 'live').reverse();
  const current = live.find(match => roomMeta(db,match).phase !== 'lobby') || live[0];
  const toConfirm = ownMatches.filter(match => {
    const meta = roomMeta(db,match);
    return match.status === 'finished' && meta.confirmations && !meta.confirmations[match.players.indexOf(playerId)] && !meta.dispute;
  }).reverse();
  const attention = current || toConfirm[0];
  const otherLive = live.filter(match => match !== current);
  const otherResults = toConfirm.filter(match => match !== attention);
  const phase = current && roomMeta(db,current).phase;
  const actionLabel = current ? phase === 'lobby' ? 'Open wedstrijdlobby' : 'Hervat je partij' : attention ? 'Bevestig je uitslag' : 'Kies hoe je speelt';
  const matchNames = attention ? attention.players.map(id => ctx.P(id).name).join(' tegen ') : '';
  const subtitle = attention ? `${matchNames} · ${attention.legs.join('–')} in legs` : 'Begin een oefenpartij, sluit aan met een wedstrijdcode of open de QR van je dartbaan.';
  const primary = attention ? B(I('arrow')+' '+actionLabel,'open-match','gold',`data-id="${attention.id}"`) : B(I('target')+' Naar Spelen','nav-play','gold');
  const upcoming = programme(ctx,scope).slice(0,4);
  const friends = db.play.social.friends.filter(id => !db.play.social.blocked.includes(id)).slice(0,3);
  const requests = db.play.social.requests.filter(request => request.to === playerId && request.status === 'pending').length;
  const confirmed = ownMatches.filter(match => match.status === 'finished' && roomMeta(db,match).confirmations?.every(Boolean)).length;
  const training = db.play.training?.history?.length || 0;

  return `<div class="df-workspace">
    <section class="df-workspace__masthead" aria-labelledby="df-player-today">
      <div class="df-workspace__intro">
        <p class="df-workspace__kicker">Vandaag · ${e(scopeLabel)}</p>
        <h1 id="df-player-today">${actionLabel}</h1>
        <p>${e(subtitle)}</p>
        <div class="df-workspace__actions">${primary}${B(I('pin')+' Op locatie','nav-baan','ghost')}${attention ? B('Naar Spelen','nav-play','ghost') : ''}</div>
      </div>
      <img class="df-workspace__crest" src="assets/dartflow-icon.svg" alt="" aria-hidden="true">
    </section>
    <section class="df-workspace__section" aria-labelledby="df-player-quick">
      <div class="df-workspace__section-head"><h2 id="df-player-quick">Snel naar</h2></div>
      <div class="df-workspace__grid df-workspace__grid--3">
        ${actionTile(ctx,'Oefenen','Solo, Dartbot of een vrije wedstrijd.','target','nav-practice')}
        ${actionTile(ctx,'Wedstrijdcode invoeren','Sluit aan bij een open demowedstrijd.','link','room-join')}
        ${actionTile(ctx,'Mijn wedstrijden','Actieve partijen, uitslagen en historie.','calendar','nav-mymatches')}
      </div>
    </section>
    <div class="df-workspace__grid df-workspace__grid--2">
      <section class="df-workspace__panel df-workspace__programme" aria-labelledby="df-player-programme">
        <div class="df-workspace__section-head"><h2 id="df-player-programme">Op jouw programma</h2></div>
        ${upcoming.length ? `<div class="df-workspace__rows">${upcoming.map(entry => programmeRow(ctx,entry)).join('')}</div>` : '<p class="df-workspace__empty">Je hebt hier geen geplande partijen. Bekijk de competities en toernooien in deze omgeving.</p>'}
        <div class="df-workspace__actions">${B('Competities','nav-leagues','ghost small')}${B('Toernooien','nav-hall','ghost small')}${B('Geplande speeldag','nav-operations','ghost small')}</div>
      </section>
      <section class="df-workspace__panel" aria-labelledby="df-player-personal">
        <div class="df-workspace__section-head"><h2 id="df-player-personal">Mijn spel</h2></div>
        <div class="df-workspace__stats"><div class="df-workspace__stat"><strong>${confirmed}</strong><small>Bevestigde uitslagen hier</small></div><div class="df-workspace__stat"><strong>${training}</strong><small>Eigen trainingen</small></div></div>
        <p class="df-workspace__note">De 9:16-scorekaart en je baanhistorie open je via het eigen Baanmodus-profiel.</p>
        <div class="df-workspace__actions">${B('Solo & training','nav-training','ghost small')}</div>
      </section>
    </div>
    ${otherLive.length || otherResults.length ? `<section class="df-workspace__panel" aria-labelledby="df-player-other">
      <div class="df-workspace__section-head"><h2 id="df-player-other">Andere openstaande partijen</h2>${B('Mijn wedstrijden','nav-mymatches','ghost small')}</div>
      <div>${rows([...otherLive,...otherResults],4)}</div>
    </section>` : ''}
    <section class="df-workspace__panel" aria-labelledby="df-player-friends">
      <div class="df-workspace__section-head"><h2 id="df-player-friends">Dartmaatjes</h2>${B(requests ? `Verzoeken (${requests})` : 'Naar vrienden',requests?'portal-requests':'nav-friends','ghost small')}</div>
      ${friends.length ? `<div class="df-workspace__rows">${friends.map(id => `<article class="df-workspace__row">
        ${ctx.avatar(id)}<div class="df-workspace__row-info"><strong>${e(ctx.P(id).name)}</strong></div>
        <div class="df-workspace__row-actions">${B('Uitdagen','room-invite-friend','ghost small',`data-id="${id}"`)}</div>
      </article>`).join('')}</div>` : '<p class="df-workspace__empty">Voeg dartmaatjes toe om ze snel uit te dagen.</p>'}
    </section>
  </div>`;
}
