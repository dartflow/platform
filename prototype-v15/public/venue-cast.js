import {venueAction, venueBaanQuery, venueSnapshot, venueStandings} from './venue-engine.js';
import {checkout} from './scoring.js';

const sceneLabels = {
  hall: 'Zaaloverzicht', board: 'Bordscore', '180': '180!', finish: 'Finish',
  result: 'Uitslag', next: 'Volgende partij', pause: 'Pauze',
};
const sceneIcons = {
  hall: 'users', board: 'target', '180': 'bolt', finish: 'check',
  result: 'trophy', next: 'bell', pause: 'pause',
};
const boardLabels = {
  free: 'Vrij', reserved: 'Gereserveerd', blocked: 'Buiten gebruik',
  called: 'Opgeroepen', playing: 'Live', pending: 'Uitslag controleren', disputed: 'Uitslag in bezwaar',
};
const badgeColors = {
  free: 'approved', reserved: 'pending', blocked: 'red',
  called: 'pending', playing: 'live', pending: 'pending', disputed: 'red',
};
const same = (a, b) => String(a) === String(b);

export function createVenueCast(ctx) {
  const {esc, icon, button, badge} = ctx;
  const state = () => ctx.getVenue?.() ?? ctx.db.venue;
  const canOrganize = () => ctx.venueCanOrganize?.() ?? (ctx.db.role === 'admin' || ctx.db.play?.space === 'organizer');
  const value = x => typeof x === 'function' ? x() : x;
  const route = () => String(value(ctx.routeParam) || globalThis.location?.hash.split('/').slice(1).join('/') || 'hall');
  const navigate = part => ctx.go(`venue-cast/${part}`);
  const person = (event, id) => event.players.find(player => same(player.id, id))?.name ?? 'Nog te bepalen';
  const names = (event, match) => match.players.map(id => person(event, id));
  const hasPlayer = (match, id) => match.players.some(playerId => same(playerId, id));
  const boardName = (event, id) => event.boards.find(board => same(board.id, id))?.name ?? 'Bord nog niet bekend';
  const points = match => match?.game?.remaining;
  const legs = match => match?.score ?? match?.game?.legs ?? [0, 0];
  const liveMatch = match => match?.status === 'playing';
  const phaseLabel = match => match.label || (match.phase === 'pool' ? `Poule ${match.poolId}` : 'Knock-out');
  const boardStatus = (board, match) => match?.status && ['called', 'playing', 'pending', 'disputed'].includes(match.status)
    ? match.status : board.blocked ? 'blocked' : board.reserved ? 'reserved' : 'free';

  function routeInfo() {
    const [page, query = ''] = route().split('?');
    return {page: page || 'hall', query: new URLSearchParams(query)};
  }

  function linkFor(target) {
    if (ctx.venueUrl) return ctx.venueUrl(target);
    return new URL(`#${target}`, globalThis.location?.href || 'https://example.invalid/').href;
  }

  function outputLink(part, label, options = {}) {
    const {className = 'btn ghost small', iconName = 'eye'} = options;
    return `<a class="${className}" href="${esc(linkFor(`venue-cast/${part}`))}" target="_blank" rel="noopener">${icon(iconName)} ${esc(label)}</a>`;
  }

  function writerLink(id, label = 'Schrijversscherm openen') {
    return `<a class="btn ghost small" href="${esc(linkFor(`venue/board-${id}`))}" target="_blank" rel="noopener">${icon('edit')} ${esc(label)}</a>`;
  }

  function defaultBoard(event) {
    return event.boards.find(board => event.matches.some(match => same(match.boardId, board.id) && liveMatch(match)))?.id
      ?? event.boards[0]?.id ?? null;
  }

  function settings(event) {
    const initial = {scene: 'board', boardId: defaultBoard(event), matchId: null, visitIndex: null};
    const cameraBoard = event.boards.find(board => board.camera && same(board.id, event.cast?.cameraBoardId))
      ?? event.boards.find(board => board.camera);
    return {
      preview: {...initial, scene: 'hall', ...event.cast?.preview},
      program: {...initial, ...event.cast?.program},
      cameraBoardId: cameraBoard?.id ?? null,
    };
  }

  function commitSettings(next) {
    const event = state();
    if (!event) return;
    event.cast = next;
    ctx.save();
    ctx.render();
  }

  function getBoard(event, routeId) {
    const id = String(routeId || '').replace(/^board-/i, '');
    return event.boards.find((board, index) => same(board.id, id) || same(board.id, `B${id}`) || same(index + 1, id));
  }

  function matchForBoard(event, board) {
    if (!board) return null;
    return event.matches.find(match => same(match.id, board.matchId)) ??
      event.matches.find(match => same(match.boardId, board.id) &&
        ['playing', 'called', 'pending', 'disputed'].includes(match.status)) ?? null;
  }

  function snapshot(event) {
    return venueSnapshot(event, Date.now());
  }

  function countdown(event, match) {
    const deadline = Number(match.callUntil);
    if (!deadline) return '';
    const now = event.pausedAt ?? Date.now();
    return `<time data-vf-cast-deadline="${deadline}" data-vf-cast-paused="${esc(event.pausedAt ?? '')}">${timeRemaining(deadline, now)}</time>`;
  }

  function timeRemaining(deadline, now) {
    const left = Math.max(0, Math.ceil((deadline - now) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }

  function tick() {
    for (const element of document.querySelectorAll('[data-vf-cast-deadline]')) {
      const now = element.dataset.vfCastPaused ? Number(element.dataset.vfCastPaused) : Date.now();
      const next = timeRemaining(Number(element.dataset.vfCastDeadline), now);
      if (element.textContent !== next) element.textContent = next;
    }
    const clock = document.querySelector('[data-vf-cast-clock]');
    if (clock) clock.textContent = clockText();
  }

  function clockText() {
    return new Date().toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'});
  }

  function screenHeader(event, type, label, preview = false) {
    return `<header class="vf-cast__header">
      <div class="vf-cast__brand">
        <img class="vf-cast__logo" src="assets/dartflow-logo.svg" alt="DartFlow" width="1916" height="496">
        <div class="vf-cast__context"><span>${esc(label)}</span><strong>${esc(event.name)}</strong></div>
      </div>
      <div class="vf-cast__time">
        ${event.pausedAt != null ? badge('Pauze', 'pending') : badge('DARTFLOW', 'live')}
        <time ${preview ? '' : 'data-vf-cast-clock'}>${clockText()}</time>
        ${preview || type === 'public' ? '' : button(icon('eye') + ' Scherm vullen', 'venue-cast-fullscreen', 'ghost small vf-cast__screen-toggle')}
      </div>
    </header>`;
  }

  function qr(target, alt) {
    const path = ctx.venueQr?.(target);
    return path ? `<img class="vf-cast__qr" src="${esc(path)}" alt="${esc(alt)}" width="108" height="108">` : '';
  }

  function sectionTitle(title, detail = '', heading = 'h2') {
    return `<div class="vf-cast__section-head"><${heading} class="vf-cast__title">${esc(title)}</${heading}>
      ${detail ? `<div class="vf-cast__section-meta">${detail}</div>` : ''}</div>`;
  }

  function score(event, match) {
    if (!match) return '';
    if (match.realtimeRoom) {
      const venue = ctx.db.play?.clubs?.items?.find(club => same(club.id, event.clubId))?.name
        ?? (same(event.clubId, 701) ? 'De Puinruimers' : 'Dartflow-platform');
      const url = ctx.baanUrl?.('screen', match.realtimeRoom.id, venueBaanQuery(event, match, venue));
      return `<div class="vf-cast__empty"><strong>${esc(names(event, match).join(' tegen '))}</strong>
        ${url ? `<a class="btn gold small" href="${esc(url)}" target="_blank" rel="noopener">${icon('eye')} Volg de live baan</a>` : '<span>Score loopt via Baanmodus.</span>'}</div>`;
    }
    const remaining = points(match);
    const currentLegs = legs(match);
    const sides = names(event, match);
    const hasPoints = Array.isArray(remaining) && liveMatch(match);
    return `<div class="vf-cast__score" aria-label="${esc(`${sides.join(' tegen ')}, ${currentLegs.join(' tegen ')} legs`)}">
      ${sides.map((name, index) => {
        const active = liveMatch(match) && match.game?.turn === index;
        return `${index ? '<span class="vf-cast__score-separator" aria-hidden="true">VS</span>' : ''}
          <div class="vf-cast__side ${active ? 'is-active' : ''}">
            <div class="vf-cast__side-name">${esc(name)}</div>
            ${hasPoints ? `<strong class="vf-cast__remaining">${remaining[index]}</strong>` : ''}
            <span class="vf-cast__legs">${currentLegs[index]} ${currentLegs[index] === 1 ? 'leg' : 'legs'}</span>
            ${active ? '<span class="vf-cast__label">Aan de beurt</span>' : ''}
          </div>`;
      }).join('')}
    </div>`;
  }

  function boardCard(event, board, showLink = false) {
    const match = matchForBoard(event, board);
    const status = boardStatus(board, match);
    return `<article class="vf-cast__board" data-status="${status}">
      <div class="vf-cast__board-top"><strong>${esc(board.name)}</strong>${badge(boardLabels[status], badgeColors[status])}</div>
      ${match ? `${score(event, match)}<div class="vf-cast__label">${esc(phaseLabel(match))}${status === 'called' ? ` · ${countdown(event, match)}` : ''}</div>` :
        `<div class="vf-cast__empty">${icon(board.camera ? 'camera' : 'target')}<span>${board.reserved ? 'Gereserveerd voor regie' : board.blocked ? 'Tijdelijk buiten gebruik' : 'Vrij voor de volgende partij'}</span></div>`}
      ${showLink ? outputLink(`board-${board.id}`, 'Bekijk bord') : ''}
    </article>`;
  }

  function calls(event) {
    return event.matches.filter(match => match.status === 'called').sort((a, b) => (a.callUntil || Infinity) - (b.callUntil || Infinity));
  }

  function readyMatches(event) {
    const ready = snapshot(event).readyMatches ?? [];
    return ready.map(entry => entry.match ?? (typeof entry === 'object' ? entry : event.matches.find(match => same(match.id, entry))))
      .filter(match => Array.isArray(match?.players));
  }

  function callHero(event, match, isNext = false) {
    const pair = names(event, match);
    const called = match.status === 'called';
    return `<article class="vf-cast__call ${called ? 'is-called' : ''}">
      <div><div class="vf-cast__label">${called ? 'Nu naar het bord' : isNext ? 'Hierna aan de oche' : 'Aanstaande partij'}</div>
      <h2>${esc(pair[0])} <em>vs</em> ${esc(pair[1])}</h2>
      <span>${esc(phaseLabel(match))}${match.writerId ? ` · ${esc(person(event, match.writerId))} schrijft` : ''}${called ? ' · Bevestig bij het bord' : ''}</span></div>
      <div class="vf-cast__call-number"><strong>${esc(called ? boardName(event, match.boardId) : 'Hierna')}</strong>${called ? countdown(event, match) : ''}</div>
    </article>`;
  }

  function queue(event, entries, limit = 5) {
    if (!entries.length) return '<div class="vf-cast__empty"><span>De volgende partij verschijnt zodra de spelers klaarstaan.</span></div>';
    return `<div class="vf-cast__queue">${entries.slice(0, limit).map(match => `<div class="vf-cast__queue-row">
      <span>${esc(names(event, match).join(' · '))}</span>
      <small>${esc(match.boardId ? boardName(event, match.boardId) : phaseLabel(match))}${match.status === 'playing' ? ' · live' : match.status === 'pending' ? ' · uitslag controleren' : ''}</small>
      ${match.status === 'called' ? countdown(event, match) : ''}
    </div>`).join('')}</div>`;
  }

  function hall(event, preview = false) {
    const tag = preview ? 'section' : 'main';
    const activeCalls = calls(event);
    const ready = readyMatches(event);
    const lead = activeCalls[0] ?? ready[0];
    const extra = activeCalls.length ? [...activeCalls.slice(1), ...ready] : ready.slice(1);
    const active = event.matches.filter(liveMatch).length;
    return `<${tag} class="vf-cast vf-cast--hall">${screenHeader(event, 'hall', 'Zaalscherm', preview)}
      <div class="vf-cast__body">
        ${event.pausedAt != null ? '<div class="vf-cast__highlight"><strong>Speelzaal gepauzeerd</strong><span>De regie hervat het programma.</span></div>' : ''}
        ${lead ? callHero(event, lead, true) :
          '<div class="vf-cast__hero"><span class="vf-cast__label">Oproepen</span><h1>Welkom aan de oche</h1><p>De eerstvolgende oproep verschijnt hier.</p></div>'}
        ${sectionTitle('Live borden', `${active} van ${event.boards.length} aan de oche`)}
        <div class="vf-cast__grid">${event.boards.map(board => boardCard(event, board)).join('')}</div>
        ${sectionTitle('Oproepen & hierna', `${activeCalls.length} oproepen · ${ready.length} klaar`)}
        ${queue(event, extra, preview ? 2 : 5)}
        ${preview ? '' : `<aside class="vf-cast__share">${qr('public', 'QR-code voor de Dartflow-volgpagina')}<div><strong>Volg de speelzaal</strong><p>Bekijk borden, oproepen en poulestanden op je telefoon.</p>${outputLink('public', 'Volgpagina openen')}</div></aside>`}
      </div></${tag}>`;
  }

  function boardScreen(event, board, preview = false) {
    const tag = preview ? 'section' : 'main';
    const match = matchForBoard(event, board);
    const status = boardStatus(board, match);
    const activeScore = liveMatch(match) && !match.realtimeRoom ? points(match)?.[match.game?.turn] : null;
    const finish = activeScore != null ? checkout(activeScore) : null;
    return `<${tag} class="vf-cast vf-cast--board">${screenHeader(event, 'board', board.name, preview)}
      <div class="vf-cast__body">
        ${sectionTitle(board.name, badge(boardLabels[status], badgeColors[status]), 'h1')}
        ${match?.status === 'called' ? callHero(event, match) : ''}
        ${match ? `<div class="vf-cast__hero"><div class="vf-cast__label">${esc(phaseLabel(match))}</div>
          ${score(event, match)}${finish ? `<p>${icon('target')} Finishsuggestie · ${esc(finish)}</p>` : ''}
          ${status === 'pending' ? '<p>Uitslag wacht op bevestiging.</p>' : ''}
          ${status === 'disputed' ? '<p>De regie behandelt de betwiste uitslag.</p>' : ''}
          </div>` : `<div class="vf-cast__hero vf-cast__empty">${icon('target')}<h2>${esc(boardLabels[status])}</h2>
            <p>${status === 'free' ? 'De volgende partij verschijnt automatisch.' : 'De regie wijst hier de volgende partij toe.'}</p></div>`}
        ${preview || match?.realtimeRoom ? '' : `<aside class="vf-cast__share">${qr(`board-${board.id}`, `QR-code voor het schrijversscherm van ${board.name}`)}<div>
          <strong>Schrijver aan ${esc(board.name)}</strong><p>Open het schrijversscherm voor oproep en score-invoer.</p>${writerLink(board.id)}</div></aside>`}
      </div></${tag}>`;
  }

  function standby(event, title, detail) {
    return `<main class="vf-cast vf-cast--board">${screenHeader(event, 'board', 'Bordscherm')}
      <div class="vf-cast__body"><div class="vf-cast__hero vf-cast__empty"><h1>${esc(title)}</h1><p>${esc(detail)}</p>${outputLink('hall', 'Open het zaalscherm')}</div></div>
    </main>`;
  }

  function listRecentCues(event) {
    const cues = [];
    for (const match of event.matches) {
      const visits = match.game?.visits ?? [];
      // A cue keeps its visit index, so the selected 180 or finish stays fixed on air.
      const lastIndices = {};
      for (const [index, visit] of visits.entries()) {
        if (visit.score === 180 && !visit.bust) lastIndices['180'] = index;
        if (visit.checkout) lastIndices.finish = index;
      }
      for (const [scene, visitIndex] of Object.entries(lastIndices)) {
        const visit = visits[visitIndex];
        cues.push({scene, boardId: match.boardId, matchId: match.id, visitIndex,
          label: `${person(event, match.players[visit.playerIndex])} · ${visit.score}`,
          order: match.history?.at(-1)?.at ?? match.updatedAt ?? 0});
      }
      if (match.status === 'confirmed' && match.score) {
        cues.push({scene: 'result', boardId: match.lastBoardId ?? match.boardId, matchId: match.id, visitIndex: null,
          label: `${names(event, match).join(' – ')} · ${match.score.join('–')}`,
          order: match.confirmedAt ?? match.history?.at(-1)?.at ?? 0});
      }
    }
    return cues.sort((a, b) => Number(b.order) - Number(a.order)).slice(0, 8);
  }

  function highlight(event, selection) {
    const {scene, matchId, visitIndex} = selection;
    if (scene === 'pause') return {kicker: 'DARTFLOW', title: 'Even pauze', detail: 'We gaan zo verder.'};
    if (scene === 'next') {
      const match = event.matches.find(item => same(item.id, matchId) && ['waiting', 'called'].includes(item.status))
        ?? calls(event)[0] ?? readyMatches(event)[0];
      return match
        ? {kicker: 'VOLGENDE PARTIJ', title: names(event, match).join(' vs '), detail: match.boardId ? boardName(event, match.boardId) : phaseLabel(match)}
        : {kicker: 'VOLGENDE PARTIJ', title: 'Binnenkort aan de oche', detail: 'De regie roept de volgende spelers op.'};
    }
    const cue = matchId != null ? selection : listRecentCues(event).find(item => item.scene === scene);
    const match = cue && event.matches.find(item => same(item.id, cue.matchId));
    if (match && scene === 'result' && match.status === 'confirmed' && match.score) {
      return {kicker: 'DEFINITIEVE UITSLAG', title: match.score.join(' – '), detail: names(event, match).join(' vs ')};
    }
    const visit = cue && match?.game?.visits?.[cue.visitIndex];
    if (visit && (scene === '180' ? visit.score === 180 && !visit.bust : visit.checkout)) {
      return {kicker: scene === '180' ? 'MAXIMUM SCORE' : 'CHECKOUT', title: String(visit.score), detail: person(event, match.players[visit.playerIndex])};
    }
    return {kicker: sceneLabels[scene]?.toUpperCase() ?? 'DARTFLOW', title: 'Wacht op het moment', detail: 'Een wedstrijdmoment verschijnt na invoer van de score.'};
  }

  function overlayScore(event, board, match) {
    const sides = names(event, match);
    if (match.realtimeRoom) return `<div class="vf-cast__obs-center"><span>${esc(sides.join(' · '))}</span><small>${esc(board.name)} · LIVE BAANMODUS</small></div>`;
    const remaining = points(match);
    const currentLegs = legs(match);
    const fields = sides.map((name, i) => `<div class="vf-cast__obs-team ${match.game?.turn === i && liveMatch(match) ? 'is-active' : ''}">
      <div><span>${esc(name)}</span><small>${currentLegs[i]} LEGS</small></div>
      <strong class="vf-cast__obs-number">${liveMatch(match) && remaining ? remaining[i] : currentLegs[i]}</strong>
    </div>`);
    return `<div class="vf-cast__obs-score">
      ${fields[0]}<div class="vf-cast__obs-center"><span>${esc(board.name)}</span><small>${liveMatch(match) ? 'LIVE' : esc(boardLabels[boardStatus(board, match)])}</small></div>${fields[1]}
    </div>`;
  }

  function overlay(event, selection, preview = false) {
    const tag = preview ? 'section' : 'main';
    const board = getBoard(event, selection.boardId) ?? getBoard(event, defaultBoard(event));
    const match = matchForBoard(event, board);
    const cue = ['hall', 'board'].includes(selection.scene) ? null : highlight(event, selection);
    return `<${tag} class="vf-cast vf-cast--obs" aria-label="Dartflow OBS Browser Source">
      ${cue ? `<div class="vf-cast__highlight"><span>${esc(cue.kicker)}</span><strong>${esc(cue.title)}</strong><small>${esc(cue.detail)}</small></div>` :
        match ? overlayScore(event, board, match) :
        `<div class="vf-cast__obs-center"><span>${esc(event.name)}</span><small>${esc(board?.name ?? 'DARTFLOW')} · WACHT OP PARTIJ</small></div>`}
    </${tag}>`;
  }

  function publicStandings(event, poolId) {
    const pool = event.pools.find(item => same(item.id, poolId)) ?? event.pools[0];
    if (!pool) return '<div class="vf-cast__empty">De poulestanden komen beschikbaar zodra de poules zijn ingedeeld.</div>';
    const rows = venueStandings(event, pool.id);
    return `<div class="vf-cast__standings"><table class="table"><thead><tr>
      <th scope="col">Speler</th><th scope="col">Gespeeld</th><th scope="col">Legs</th><th scope="col">Saldo</th><th scope="col">Punten</th>
      </tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${esc(row.name)}</th><td>${row.played}</td><td>${row.legsFor}–${row.legsAgainst}</td><td>${row.difference > 0 ? '+' : ''}${row.difference}</td><td><strong>${row.points}</strong></td></tr>`).join('')}</tbody></table></div>`;
  }

  function publicPage(event, query) {
    const playerId = query.get('follow') || '';
    const boardId = query.get('board') || '';
    const poolId = query.get('pool') || event.pools[0]?.id || '';
    const selectedPlayer = event.players.find(player => same(player.id, playerId));
    const selectedBoard = getBoard(event, boardId);
    const boardMatches = selectedBoard ? [selectedBoard] : event.boards;
    const relevant = match => !selectedPlayer || hasPlayer(match, selectedPlayer.id);
    const activeCalls = calls(event).filter(relevant);
    const next = readyMatches(event).filter(relevant);
    const upcoming = selectedPlayer ? event.matches.filter(match => relevant(match) && ['waiting', 'playing', 'pending'].includes(match.status)) : next;
    const results = event.matches.filter(match => relevant(match) && match.status === 'confirmed' && match.score)
      .sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0)).slice(0, 5);
    return `<main class="vf-cast vf-cast--public">${screenHeader(event, 'public', 'Volg de speelzaal')}
      <div class="vf-cast__body">
        <div class="vf-cast__hero"><span class="vf-cast__label">${esc(value(ctx.scopeName) || 'DARTFLOW LIVE')}</span><h1>${esc(event.name)}</h1>
          <p>Oproepen, scores en poulestanden op één plek. Deze demo toont de speelzaal in deze browser.</p></div>
        <div class="vf-cast__filters">
          <label>Speler volgen<select class="input" data-vf-follow-player aria-label="Speler volgen"><option value="">Alle spelers</option>
            ${event.players.filter(p => p.signup === 'confirmed').map(p => `<option value="${esc(p.id)}" ${same(p.id, playerId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></label>
          <label>Bord bekijken<select class="input" data-vf-follow-board aria-label="Bord bekijken"><option value="">Alle borden</option>
            ${event.boards.map(b => `<option value="${esc(b.id)}" ${selectedBoard && same(b.id, selectedBoard.id) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select></label>
          <label>Poule<select class="input" data-vf-follow-pool aria-label="Poule">${event.pools.map(p => `<option value="${esc(p.id)}" ${same(p.id, poolId) ? 'selected' : ''}>${esc(p.name ?? `Poule ${p.id}`)}</option>`).join('')}</select></label>
          ${button('Volgen', 'venue-cast-follow', 'gold small')}
        </div>
        ${activeCalls.length ? `${sectionTitle('Nu opgeroepen')}${activeCalls.slice(0, 3).map(match => callHero(event, match)).join('')}` : ''}
        ${sectionTitle(selectedBoard?.name ?? 'Borden', selectedPlayer ? badge(selectedPlayer.name) : '')}
        <div class="vf-cast__grid">${boardMatches.map(board => boardCard(event, board, true)).join('')}</div>
        ${sectionTitle(selectedPlayer ? `Programma van ${selectedPlayer.name}` : 'Hierna')}${queue(event, upcoming)}
        ${sectionTitle('Poulestanden')}${publicStandings(event, poolId)}
        ${sectionTitle('Laatste uitslagen')}
        ${results.length ? `<div class="vf-cast__queue">${results.map(match => `<div class="vf-cast__queue-row"><span>${esc(names(event, match).join(' vs '))}</span><strong>${match.score.join('–')}</strong></div>`).join('')}</div>` : '<div class="vf-cast__empty">Nog geen bevestigde uitslagen in deze selectie.</div>'}
      </div></main>`;
  }

  function monitor(event, selection, kind) {
    const board = getBoard(event, selection.boardId);
    const content = selection.scene === 'hall' ? hall(event, true) :
      selection.scene === 'board' && board ? boardScreen(event, board, true) : overlay(event, selection, true);
    return `<section class="vf-studio__monitor vf-studio__monitor--${kind}">
      <div class="vf-studio__head"><span>${kind === 'preview' ? 'VOORVERTONING' : 'PROGRAMMA'}</span><strong>${esc(sceneLabels[selection.scene])}</strong></div>
      <div class="vf-studio__preview">${content}</div>
    </section>`;
  }

  function shareRow(label, part, detail, qrTarget = '') {
    return `<div class="vf-studio__link">
      ${qrTarget ? qr(qrTarget, `QR-code voor ${label}`) : ''}
      <div><strong>${esc(label)}</strong><p>${esc(detail)}</p></div>
      <div>${outputLink(part, 'Open')}${button(icon('copy') + ' Kopieer link', 'venue-cast-copy', 'ghost small', `data-target="venue-cast/${esc(part)}"`)}</div>
    </div>`;
  }

  function studio(event) {
    if (!canOrganize()) {
      return ctx.header('Dartflow Studio', 'De wedstrijdleider bedient de scènes.', outputLink('public', 'Volg de speelzaal'), 'DARTFLOW · SCHERMREGIE');
    }
    const cast = settings(event);
    const cues = listRecentCues(event);
    const cameraBoard = getBoard(event, cast.cameraBoardId);
    const selected = getBoard(event, cast.preview.boardId) ?? getBoard(event, defaultBoard(event));
    return ctx.header('Dartflow Studio', 'Kies een scène, bekijk de voorvertoning en zet haar op programma.', button('Terug naar regie', 'nav', 'ghost', 'data-to="venue"'), 'DARTFLOW · SCHERMREGIE') +
      `<div class="vf-studio">
      <div class="vf-studio__grid">${monitor(event, cast.preview, 'preview')}${monitor(event, cast.program, 'program')}</div>
      <section class="panel vf-studio__control">
        <div class="vf-studio__bar"><div><h2>Scènes</h2><p class="subtle-label">Elke keuze verschijnt eerst in de voorvertoning.</p></div>
          ${button(icon('play') + ' Naar programma', 'venue-cast-take', 'gold')}</div>
        <div class="vf-studio__scenes">${Object.entries(sceneLabels).map(([key, label]) => button(
          `${icon(sceneIcons[key])} ${esc(label)}`, 'venue-cast-scene', `ghost vf-studio__scene ${cast.preview.scene === key ? 'is-selected' : ''}`,
          `data-scene="${key}" aria-pressed="${cast.preview.scene === key}"`)).join('')}</div>
        <div class="vf-studio__bar vf-studio__bar--fields"><label class="field">Bord voor score & overlay
          <select class="input" data-vf-cast-board aria-label="Bord voor score en overlay">${event.boards.map(board => `<option value="${esc(board.id)}" ${same(selected?.id, board.id) ? 'selected' : ''}>${esc(board.name)}${board.camera ? ' · camera' : ''}</option>`).join('')}</select>
          </label>${button('Bord kiezen', 'venue-cast-board', 'ghost small')}</div>
        <h3>Wedstrijdmomenten</h3>
        ${cues.length ? `<div class="vf-studio__scenes">${cues.map(cue => button(
          `${icon(sceneIcons[cue.scene])} ${esc(sceneLabels[cue.scene])} · ${esc(cue.label)}`, 'venue-cast-cue', 'ghost small vf-studio__cue',
          `data-scene="${cue.scene}" data-match="${esc(cue.matchId)}" data-visit="${cue.visitIndex ?? ''}"`)).join('')}</div>` :
          '<p class="subtle-label">Een 180, checkout of bevestigde uitslag verschijnt hier zodra die in een partij wordt vastgelegd.</p>'}
      </section>
      <section class="panel vf-studio__control">
        <div class="vf-studio__bar"><div><h2>Camerabord</h2><p class="subtle-label">Reserveer een camerabord voor de regie. Automatisch indelen slaat het bord dan over.</p></div></div>
        ${cameraBoard ? `<div class="vf-studio__bar vf-studio__bar--fields"><label class="field">Camerabord<select class="input" data-vf-cast-camera aria-label="Kies camerabord">
          ${event.boards.filter(board => board.camera).map(board => `<option value="${esc(board.id)}" ${same(cameraBoard.id, board.id) ? 'selected' : ''}>${esc(board.name)}${board.reserved ? ' · gereserveerd' : ''}</option>`).join('')}</select></label>
          ${button('Selectie bewaren', 'venue-cast-camera', 'ghost small')}
          ${button(cameraBoard.reserved ? 'Reservering vrijgeven' : 'Camerabord reserveren', 'venue-cast-reserve', cameraBoard.reserved ? 'ghost small' : 'gold small')}
          ${writerLink(cameraBoard.id)}</div>` : '<p class="subtle-label">Markeer een bord als camerabord bij Bordbeheer.</p>'}
      </section>
      <section class="panel vf-studio__links"><h2>Uitgangen</h2>
        <p class="subtle-label">Gebruik het zaalscherm als webpagina in VeyoCast en de transparante score-uitgang als Browser Source in OBS. Tabbladen in dezelfde browser volgen de regie. OBS, VeyoCast en andere apparaten openen de demo met hun eigen opslag.</p>
        ${shareRow('Zaalscherm · VeyoCast', 'hall', 'Oproepen, live borden en komende partijen.')}
        ${selected ? shareRow(`${selected.name} · bordscherm`, `board-${selected.id}`, 'Grote score, beurt, finish en schrijverstoegang.') : ''}
        ${shareRow('OBS Browser Source', 'obs', 'Transparante uitvoer die het gekozen programma volgt.')}
        ${shareRow('Volgpagina', 'public', 'Mobiele publieksweergave met filters, standen en uitslagen.', 'public')}
      </section></div>`;
  }

  function view() {
    const event = state();
    const {page, query} = routeInfo();
    if (!event) return '<div class="vf-output-shell"><main class="vf-cast vf-cast--board"><div class="vf-cast__empty"><h1>Geen Dartflow-speelzaal actief</h1><p>Open eerst een speelzaal in de regie.</p></div></main></div>';
    if (page === 'studio') return studio(event);
    const content = page === 'hall' ? hall(event) :
      page === 'public' ? publicPage(event, query) :
      page === 'obs' ? overlay(event, settings(event).program) :
      page.startsWith('board-') && getBoard(event, page) ? boardScreen(event, getBoard(event, page)) :
      standby(event, 'Scherm niet gevonden', 'Kies een beschikbaar bord in het zaalscherm.');
    return `<div class="vf-output-shell ${page === 'obs' ? 'vf-output-shell--obs' : ''}">${content}</div>`;
  }

  async function copy(target) {
    const url = linkFor(target);
    try {
      await navigator.clipboard.writeText(url);
      ctx.toast('Link gekopieerd.');
    } catch {
      ctx.showModal('Link delen', 'Kopieer deze link om het scherm te openen.',
        `<label class="field">Schermlink<input class="input" value="${esc(url)}" readonly data-vf-cast-share></label>
        <div class="modal-actions">${button('Sluiten', 'close-modal', 'ghost')}</div>`);
      requestAnimationFrame(() => document.querySelector('[data-vf-cast-share]')?.select());
    }
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      ctx.toast('Volledig scherm is niet beschikbaar in deze browser.');
    }
  }

  function reserveBoard(event, cast) {
    const board = getBoard(event, cast.cameraBoardId);
    if (!board?.camera) return;
    const payload = {
      boardId: board.id, reserved: !board.reserved, reservationReason: !board.reserved ? 'Studio' : '',
    };
    const response = ctx.venueDispatch ? ctx.venueDispatch('board', payload) : venueAction(event, 'board', payload);
    if (response?.error) {
      ctx.toast(response.error);
      return;
    }
    const next = response?.state ?? event;
    next.cast = cast;
    if (ctx.setVenue) ctx.setVenue(next);
    else ctx.db.venue = next;
    ctx.save();
    ctx.render();
    ctx.toast(board.reserved ? `${board.name} vrijgegeven.` : `${board.name} gereserveerd voor Studio.`);
  }

  function handleAction(action, element) {
    if (!action.startsWith('venue-cast-')) return false;
    const event = state();
    if (!event) return true;
    if (!['venue-cast-copy', 'venue-cast-fullscreen', 'venue-cast-follow'].includes(action) && !canOrganize()) {
      ctx.toast('De wedstrijdleider bedient de scènes.');
      return true;
    }
    const cast = settings(event);
    switch (action) {
      case 'venue-cast-copy':
        if (/^venue-cast\/(?:hall|public|obs|board-[\w-]+)$/.test(element.dataset.target || '')) copy(element.dataset.target);
        break;
      case 'venue-cast-fullscreen':
        fullscreen();
        break;
      case 'venue-cast-follow': {
        const filters = element.closest('.vf-cast__filters');
        const query = new URLSearchParams();
        const player = filters?.querySelector('[data-vf-follow-player]')?.value;
        const board = filters?.querySelector('[data-vf-follow-board]')?.value;
        const pool = filters?.querySelector('[data-vf-follow-pool]')?.value;
        if (player) query.set('follow', player);
        if (board) query.set('board', board);
        if (pool) query.set('pool', pool);
        navigate(`public${query.size ? `?${query}` : ''}`);
        break;
      }
      case 'venue-cast-scene': {
        const scene = element.dataset.scene;
        if (!Object.hasOwn(sceneLabels, scene)) break;
        commitSettings({...cast, preview: {...cast.preview, scene, matchId: null, visitIndex: null}});
        break;
      }
      case 'venue-cast-board': {
        const id = element.closest('.vf-studio__bar')?.querySelector('[data-vf-cast-board]')?.value;
        const board = getBoard(event, id);
        if (board) commitSettings({...cast, preview: {...cast.preview, scene: 'board', boardId: board.id, matchId: null, visitIndex: null}});
        break;
      }
      case 'venue-cast-take':
        commitSettings({...cast, program: {...cast.preview}});
        ctx.toast(`${sceneLabels[cast.preview.scene]} staat op programma.`);
        break;
      case 'venue-cast-cue': {
        const cue = listRecentCues(event).find(item => item.scene === element.dataset.scene &&
          same(item.matchId, element.dataset.match) && same(item.visitIndex ?? '', element.dataset.visit));
        if (cue) {
          const {scene, boardId, matchId, visitIndex} = cue;
          commitSettings({...cast, preview: {scene, boardId: boardId ?? cast.preview.boardId, matchId, visitIndex}});
        }
        break;
      }
      case 'venue-cast-camera': {
        const id = element.closest('.vf-studio__bar')?.querySelector('[data-vf-cast-camera]')?.value;
        const board = getBoard(event, id);
        if (board?.camera) commitSettings({...cast, cameraBoardId: board.id});
        break;
      }
      case 'venue-cast-reserve':
        reserveBoard(event, cast);
        break;
    }
    return true;
  }

  return {view, handleAction, tick};
}
