const playerId = 1;
const dateFormat = new Intl.DateTimeFormat('nl-NL', {day:'numeric', month:'short'});
const timeFormat = new Intl.DateTimeFormat('nl-NL', {hour:'2-digit', minute:'2-digit'});
const todayFormat = new Intl.DateTimeFormat('nl-NL', {
  weekday:'long', day:'numeric', month:'long', timeZone:'Europe/Amsterdam'
});

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
  return `<article class="df-workspace__row df-today-programme-row">
    <span class="df-workspace__icon">${icon(entry.icon)}</span>
    <div class="df-workspace__row-info">
      <strong>${e(entry.title)}</strong><small>${e(entry.detail)} · ${e(when)}</small>
      <div>${badge(entry.status, entry.priority === 0 ? 'pending' : entry.priority === 1 ? 'live' : 'blue')}</div>
    </div>
    ${button(entry.label,'portal-programme','ghost small',`data-kind="${entry.type}" data-id="${entry.id}"`)}
  </article>`;
}

function quickAction(ctx, title, detail, icon, action) {
  return `<button type="button" class="df-today-shortcut" data-action="${action}">
    <span class="df-workspace__icon">${ctx.icon(icon)}</span>
    <span class="df-today-shortcut__copy"><strong>${title}</strong><small>${detail}</small></span>
    ${ctx.icon('right')}
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
  const {db, button:B, badge, esc:e, icon:I} = ctx;
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
  const actionLabel = current ? phase === 'lobby' ? 'Open wedstrijdlobby' : 'Hervat je partij' : 'Bevestig je uitslag';
  const primary = attention ? B(I('arrow')+' '+actionLabel,'open-match','gold',`data-id="${attention.id}"`) : B(I('target')+' Naar Spelen','nav-play','gold');
  const upcoming = programme(ctx,scope).slice(0,4);
  const friends = db.play.social.friends.filter(id => !db.play.social.blocked.includes(id)).slice(0,3);
  const requests = db.play.social.requests.filter(request => request.to === playerId && request.status === 'pending').length;
  const confirmed = ownMatches.filter(match => match.status === 'finished' && roomMeta(db,match).confirmations?.every(Boolean)).length;
  const training = db.play.training?.history?.length || 0;

  const matchStatus = current ? phase === 'lobby' ? 'Lobby' : phase === 'paused' ? 'Gepauzeerd' : 'Bezig' : 'Akkoord nodig';
  const matchFormat = attention && [attention.startScore, attention.legLimit ? `${attention.legLimit} legs` : attention.bestOf ? `Best of ${attention.bestOf}` : '', attention.mode].filter(Boolean).join(' · ');
  const matchScore = attention ? `<div class="df-today-score" role="group" aria-label="Stand in legs">
    ${attention.players.map((id, index) => `<div class="df-today-score__player">
      <span class="df-today-score__avatar" aria-hidden="true">${ctx.avatar(id)}</span><strong>${e(ctx.P(id).name)}</strong>
      <span class="df-today-score__legs"><b>${e(attention.legs[index] ?? 0)}</b><small>legs</small></span>
    </div>`).join('')}
  </div>` : '<p class="df-workspace__empty">Je hebt hier geen openstaande partij.</p>';

  return `<div class="df-workspace df-today df-workspace--polished">
    <header class="df-workspace__masthead" aria-labelledby="df-player-today">
      <div class="df-workspace__intro">
        <h1 id="df-player-today">Vandaag</h1>
        <p class="df-today-date">${e(todayFormat.format(new Date()))} <span>· ${e(scopeLabel)}</span></p>
      </div>
    </header>
    <div class="df-today-grid">
      <section class="df-workspace__panel df-today-match df-graphic df-graphic--board" aria-labelledby="df-player-match">
        <div class="df-workspace__section-head">
          <div><h2 id="df-player-match">${current ? 'Actieve wedstrijd' : attention ? 'Uitslag bevestigen' : 'Wedstrijden'}</h2>
            ${matchFormat ? `<p class="df-today-match__format">${e(matchFormat)}</p>` : ''}
          </div>
          ${attention ? badge(matchStatus, matchStatus === 'Bezig' ? 'live' : 'pending') : ''}
        </div>
        ${matchScore}
        <div class="df-workspace__actions">${primary}${B('Mijn wedstrijden','nav-mymatches','ghost')}</div>
      </section>
      <section class="df-workspace__panel df-today-play" aria-labelledby="df-player-quick">
        <div class="df-workspace__section-head"><h2 id="df-player-quick">Direct spelen</h2></div>
        <div class="df-today-shortcuts">
          ${quickAction(ctx,'Oefenwedstrijd','Speel lokaal of online','target','nav-practice')}
          ${quickAction(ctx,'Wedstrijdcode invoeren','Sluit aan bij een partij','link','room-join')}
          ${quickAction(ctx,'Baanmodus op locatie','Scoren op je telefoon','pin','nav-baan')}
        </div>
      </section>
    </div>
    <div class="df-today-grid">
      <section class="df-workspace__panel df-workspace__programme" aria-labelledby="df-player-programme">
        <div class="df-workspace__section-head"><h2 id="df-player-programme">Programma</h2>${B('Alle evenementen','nav-events','ghost small')}</div>
        ${upcoming.length ? `<div class="df-workspace__rows">${upcoming.map(entry => programmeRow(ctx,entry)).join('')}</div>` : '<p class="df-workspace__empty">Geen geplande partijen in deze omgeving.</p>'}
      </section>
      <section class="df-workspace__panel df-today-personal df-graphic df-graphic--lanes" aria-labelledby="df-player-personal">
        <div class="df-workspace__section-head"><h2 id="df-player-personal">Mijn spel</h2>${B('Training','nav-training','ghost small')}</div>
        <div class="df-workspace__stats">
          <div class="df-workspace__stat">${I('clipboard')}<strong>${confirmed}</strong><small>Bevestigde uitslagen</small></div>
          <div class="df-workspace__stat">${I('target')}<strong>${training}</strong><small>Trainingen</small></div>
        </div>
      </section>
    </div>
    ${otherLive.length || otherResults.length ? `<section class="df-workspace__panel" aria-labelledby="df-player-other">
      <div class="df-workspace__section-head"><h2 id="df-player-other">Openstaande partijen</h2>${B('Mijn wedstrijden','nav-mymatches','ghost small')}</div>
      <div>${rows([...otherLive,...otherResults],4)}</div>
    </section>` : ''}
    <section class="df-workspace__panel" aria-labelledby="df-player-friends">
      <div class="df-workspace__section-head"><h2 id="df-player-friends">Dartmaatjes</h2>${B(requests ? `Verzoeken (${requests})` : 'Alle vrienden',requests?'portal-requests':'nav-friends','ghost small')}</div>
      ${friends.length ? `<div class="df-workspace__rows df-today-friends">${friends.map(id => `<article class="df-workspace__row df-today-friend">
        ${ctx.avatar(id)}<div class="df-workspace__row-info"><strong>${e(ctx.P(id).name)}</strong></div>
        ${B('Uitdagen','room-invite-friend','ghost small',`data-id="${id}"`)}
      </article>`).join('')}</div>` : '<p class="df-workspace__empty">Voeg een dartmaatje toe om elkaar uit te dagen.</p>'}
    </section>
  </div>`;
}
