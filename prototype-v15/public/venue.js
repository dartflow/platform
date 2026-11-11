import {createVenueDemo, venueAction, venueBaanQuery, venueSnapshot, venueStandings, venueEligible} from './venue-engine.js';

const TAB_LABELS = {
  desk: 'Regietafel',
  entries: 'Inschrijving & check-in',
  boards: 'Borden',
  schedule: 'Poules & schema',
};
const MATCH_LABELS = {
  waiting: 'Wacht op een bord',
  called: 'Opgeroepen',
  playing: 'Aan het spelen',
  pending: 'Uitslag bevestigen',
  disputed: 'Betwist',
  confirmed: 'Afgerond',
};
const BOARD_LABELS = {
  free: 'Vrij', available: 'Vrij', called: 'Opgeroepen', playing: 'Live',
  pending: 'Uitslag bevestigen', disputed: 'Betwist', blocked: 'Geblokkeerd', reserved: 'Gereserveerd',
};

export function createVenue(ctx) {
  const {esc, icon, button, badge} = ctx;
  const draftScores = new Map();
  const draftDarts = new Map();
  const baanReads = new Set();
  let rosterFilter = 'all';

  function init() {
    ctx.db.venue ??= createVenueDemo();
    return ctx.db.venue;
  }
  const event = () => init();
  const viewerId = () => Number(ctx.venueViewerId?.()) || 1;
  const isOrganizer = () => ctx.venueCanOrganize?.() ?? (ctx.db.role === 'admin' || ctx.db.play?.space === 'organizer');
  const player = id => event().players.find(p => p.id === Number(id));
  const playerName = id => player(id)?.name || ctx.db.players?.find(p => p.id === Number(id))?.name || 'Nog te bepalen';
  const matchById = id => event().matches.find(m => String(m.id) === String(id));
  const boardById = id => event().boards.find(b => String(b.id) === String(id));
  const boardNumber = b => event().boards.indexOf(b) + 1;
  const boardRoute = b => `venue/board-${b.id}`;
  const resultRoute = m => `venue/result/${encodeURIComponent(m.id)}`;
  const eventHost = state => ctx.db.play?.clubs?.items?.find(c => Number(c.id) === Number(state.clubId))?.name || (Number(state.clubId) === 701 ? 'De Puinruimers' : 'Dartflow-platform');
  const matchTitle = m => `${playerName(m.players[0])} – ${playerName(m.players[1])}`;
  const matchLabel = m => m.label || (m.phase === 'pool' ? `Poule ${m.poolId}` : `Knock-out · ronde ${m.round}`);
  const route = () => String(ctx.routeParam?.() || '');
  const B = (label, action, style = 'ghost', attrs = '') => button(label, action, style, attrs);
  const attr = (key, value) => `data-${key}="${esc(value)}"`;
  const roomNotice = (message, className = '') => `<div class="notice vf-notice ${className}">${icon('info')}<span>${message}</span></div>`;
  const matchBadge = m => badge(MATCH_LABELS[m.status] || m.status, m.status === 'playing' ? 'live' : m.status === 'confirmed' ? 'approved' : m.status === 'disputed' ? 'red' : 'pending');
  const castLink = (label, target, style = 'ghost small') => `<a class="btn ${style}" href="#venue-cast/${target}" target="_blank" rel="noopener">${label}</a>`;
  const empty = (title, subtitle) => `<div class="vf-empty">${icon('target')}<strong>${title}</strong><p>${subtitle}</p></div>`;
  const nav = (label, to, style = 'ghost') => B(label, 'nav', style, attr('to', to));
  const timeFormat = new Intl.DateTimeFormat('nl-NL', {hour: '2-digit', minute: '2-digit'});
  const clockTime = t => Number.isFinite(t) ? timeFormat.format(new Date(t)) : '–';
  const canLinkBaan = m => Boolean(ctx.baanNewRoom && ctx.baanUrl && ctx.baanRead && isOrganizer()
    && m?.boardId && !m.realtimeRoom && ['called', 'playing'].includes(m.status)
    && !m.game?.visits?.length && !m.game?.legs?.some(Boolean) && !ctx.venueOffline?.());

  function baanLink(m, surface, label, secondary = false) {
    const room = m.realtimeRoom;
    const state = event();
    const query = venueBaanQuery(state, m, eventHost(state));
    if (secondary) query.device = '2';
    const url = ctx.baanUrl?.(surface, room.id, query);
    return url ? `<a class="btn ${surface === 'screen' ? 'gold' : 'ghost'} small" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>` : '';
  }

  function baanControl(m) {
    const room = m.realtimeRoom;
    return `<section class="panel vf-card"><div class="vf-card-header"><div><h2>Live Baanmodus</h2><p>Scores komen rechtstreeks van de gekoppelde telefoons op het 9:16-scherm.</p></div>${badge('Live baan', 'live')}</div>
      <p>Open het scherm bij de baan. ${esc(room.players[0])} scant de QR als eerste en zet de wedstrijd klaar. ${esc(room.players[1])} scant dezelfde QR en bevestigt. Speler 2 kan tijdens de partij de invoer overnemen.</p>
      <div class="vf-inline vf-wrap">${baanLink(m, 'screen', 'Open 9:16-scherm')}${baanLink(m, 'phone', 'Speler 1 openen')}${baanLink(m, 'phone', 'Speler 2 testen', true)}</div>
      ${isOrganizer() ? `<p class="subtle-label">Haal de uitslag op nadat beide spelers hebben bevestigd. Dartflow verwerkt de legs in de poule of knock-out en geeft het bord vrij.</p><div class="vf-inline vf-wrap">${B('Uitslag ophalen', 'vf-baan-import', 'gold small', attr('id', m.id))}${B('Koppeling beëindigen', 'vf-baan-unlink', 'ghost small', attr('id', m.id))}</div>` : ''}</section>`;
  }

  async function importBaan(m) {
    const roomId = m?.realtimeRoom?.id;
    if (!roomId || baanReads.has(roomId)) return;
    if (ctx.venueOffline?.()) return ctx.toast('Herstel eerst de verbinding van de regietafel.');
    const eventId = event().id;
    baanReads.add(roomId);
    try {
      const {state, error} = await ctx.baanRead(roomId);
      if (error || state?.id !== roomId) return ctx.toast(error || 'De live baan is tijdelijk onbereikbaar.');
      if (event().id !== eventId || matchById(m.id)?.realtimeRoom?.id !== roomId || !isOrganizer()) return;
      const imported = run('import-baan', {matchId: m.id, roomId, result: state.officialResult || state.match});
      if (!imported.error) ctx.go(resultRoute(m));
    } catch {
      ctx.toast('De live uitslag kon nog niet worden opgehaald.');
    } finally {
      baanReads.delete(roomId);
    }
  }

  function run(action, payload = {}, options = {}) {
    const oldState = event();
    const result = ctx.venueDispatch ? ctx.venueDispatch(action, payload) : venueAction(oldState, action, payload);
    if (!result) return {error: 'Actie kon niet worden uitgevoerd.'};
    if (result.error) {
      if (!options.inline) ctx.toast(result.error);
      return result;
    }
    if (result.needsDouble) return result;
    if (result.state && result.state !== oldState) {
      ctx.db.venue = result.state;
      ctx.save();
    }
    if (options.close) ctx.closeModal();
    if (!options.noRender) ctx.render();
    if (!options.quiet && result.message) ctx.toast(result.message);
    return result;
  }

  function view() {
    const state = event();
    const part = route();
    const boardMatch = /^board-(?:B)?(\d+)$/i.exec(part);
    if (boardMatch) {
      const b = boardById(`B${boardMatch[1]}`) || state.boards[Number(boardMatch[1]) - 1];
      return b ? boardView(b) : `<div class="vf-page">${ctx.header('Bord niet gevonden', 'Kies een bord uit de zaal.')}${nav('Alle borden', 'venue/boards', 'gold')}</div>`;
    }
    if (part.startsWith('result/')) {
      let id = part.slice(7);
      try { id = decodeURIComponent(id); } catch {}
      const match = matchById(id);
      const description = match ? esc(matchTitle(match)) : 'Ga terug naar de speeldag.';
      return `<div class="vf-page">${ctx.header('Wedstrijduitslag', description, nav(icon('left') + ' Speeldag', 'venue', 'ghost small'))}${match && ['pending','disputed','confirmed'].includes(match.status) ? resultView(match) : empty('Nog geen uitslag beschikbaar', 'De uitslag verschijnt als de wedstrijd klaar is.')}</div>`;
    }
    const selected = Object.hasOwn(TAB_LABELS, part) ? part : 'desk';
    const activeTabs = isOrganizer() ? Object.keys(TAB_LABELS) : ['desk', 'entries', 'schedule'];
    const effectiveTab = activeTabs.includes(selected) ? selected : 'desk';
    return `<div class="vf-page">
      ${hero(state)}
      <nav class="tabs vf-tabs" aria-label="Onderdelen van de speeldag">
        ${activeTabs.map(id => `<button type="button" class="tab ${effectiveTab === id ? 'active' : ''}" data-action="vf-tab" data-tab="${id}" ${effectiveTab === id ? 'aria-current="page"' : ''}>${TAB_LABELS[id]}</button>`).join('')}
      </nav>
      ${effectiveTab === 'entries' ? entriesView(state) : effectiveTab === 'boards' ? boardsView(state) : effectiveTab === 'schedule' ? scheduleView(state) : deskView(state)}
    </div>`;
  }

  function hero(state) {
    const signed = state.players.filter(p => p.signup === 'confirmed').length;
    const checked = state.players.filter(p => p.signup === 'confirmed' && p.checkedIn).length;
    const live = state.matches.filter(m => m.status === 'playing').length;
    const done = state.matches.filter(m => m.status === 'confirmed').length;
    return `<section class="vf-hero panel">
      <div class="vf-hero-copy">
        <div class="vf-inline vf-wrap">${badge('ZAALDEMO', 'pending')}${state.pausedAt != null ? badge('Oproepen gepauzeerd', 'pending') : badge('Speeldag', 'live')}</div>
        <h1>${esc(state.name)}</h1>
        <p>${esc(eventHost(state))} · Toernooi op locatie</p>
      </div>
      <div class="vf-inline vf-wrap vf-hero-actions">
        ${isOrganizer() ? nav(icon('eye') + ' Schermstudio', 'venue-cast/studio', 'gold') : ''}
        ${castLink(icon('target') + ' Zaalscherm', 'hall')}
        ${castLink('Volgpagina', 'public')}
        ${isOrganizer() ? B(icon('settings') + ' Instellingen', 'vf-settings', 'ghost small') : ''}
        ${isOrganizer() && ctx.createVenueEvent ? B(icon('plus') + ' Nieuwe speeldag', 'vf-new-event', 'ghost small') : ''}
        ${ctx.venueEvents?.().length > 1 && ctx.selectVenueEvent ? B('Speeldag wisselen', 'vf-switch-event', 'ghost small') : ''}
      </div>
      <div class="vf-kpis">
        ${[['Ingeschreven', `${signed}/${state.settings.capacity}`], ['Ingecheckt', checked], ['Live partijen', live], ['Uitslagen rond', done]].map(([label, value]) => `<div class="vf-kpi"><span>${label}</span><strong>${value}</strong></div>`).join('')}
      </div>
    </section>`;
  }

  function deskView(state) {
    const snap = venueSnapshot(state);
    const pending = state.matches.filter(m => m.status === 'pending' || m.status === 'disputed');
    const calls = state.matches.filter(m => m.status === 'called');
    const queue = state.matches.filter(m => m.status === 'waiting' && m.players.every(Boolean));
    const myMatches = state.matches.filter(m => m.players.includes(viewerId()) && ['called', 'playing', 'pending', 'disputed'].includes(m.status));
    const me = player(viewerId());
    const control = isOrganizer() ? `<section class="panel vf-card vf-control">
      <div class="vf-card-header"><div><h2>Oproepregie</h2><p>Verdeel speelklare partijen over beschikbare borden.</p></div>${badge(state.settings.autoSchedule ? 'Automatisch' : 'Handmatig', state.settings.autoSchedule ? 'approved' : 'pending')}</div>
      <div class="vf-inline vf-wrap">
        ${state.stage === 'registration' ? B(icon('shuffle') + ' Maak poules', 'vf-prepare', 'gold') : B(icon('shuffle') + ' Verdeel vrije borden', 'vf-schedule', 'gold', state.pausedAt != null ? 'disabled' : '')}
        ${B(state.settings.autoSchedule ? 'Automatisch uitzetten' : 'Automatisch aanzetten', 'vf-auto', 'ghost')}
        ${B(icon(state.pausedAt != null ? 'check' : 'clock') + (state.pausedAt != null ? ' Oproepen hervatten' : ' Oproepen pauzeren'), 'vf-pause-calls', 'ghost')}
      </div>
      <div class="vf-split"><span>${snap.readyMatches?.length || 0} partijen klaar voor een vrij bord</span><span>${snap.finishEstimateAt ? `Indicatie resterende speelronde tot ${clockTime(snap.finishEstimateAt)}` : 'Planning volgt na nieuwe oproepen'}</span></div>
      ${snap.warning ? roomNotice(esc(snap.warning)) : ''}
    </section>` : '';
    return `<div class="vf-stack">
      ${control}
      ${!isOrganizer() ? `<section class="panel vf-card"><div class="vf-card-header"><div><h2>Jouw speeldag</h2><p>${esc(playerName(viewerId()))}</p></div>${me ? signupBadge(me) : badge('Open inschrijving', 'pending')}</div><div class="vf-inline vf-wrap">${me ? playerButtons(me, false) : B(icon('plus') + ' Schrijf je in', 'vf-signup', 'gold')}</div>${myMatches.length ? myMatches.map(m => matchRow(m, true)).join('') : empty('Nog geen oproep voor jou', 'Meld je klaar als je er bent. Je volgende partij verschijnt hier.')}</section>` : ''}
      <div class="vf-grid vf-grid-2">
        <section class="panel vf-card"><div class="vf-card-header"><div><h2>Oproepen aan de oche</h2><p>Spelers bevestigen dat ze bij het bord zijn.</p></div>${badge(calls.length, 'pending')}</div>${calls.length ? calls.map(m => matchRow(m, false)).join('') : empty('Geen open oproepen', 'Nieuwe partijen verschijnen hier wanneer ze aan een bord zijn toegewezen.')}</section>
        <section class="panel vf-card"><div class="vf-card-header"><div><h2>Uitslagen & geschillen</h2><p>Bevestigde resultaten gaan door naar het schema.</p></div>${badge(pending.length, pending.some(m => m.status === 'disputed') ? 'red' : 'pending')}</div>${pending.length ? pending.map(m => matchRow(m, false)).join('') : empty('Alles bijgewerkt', 'Uitslagen wachten hier op de twee spelers of de wedstrijdleider.')}</section>
      </div>
      <section class="panel vf-card"><div class="vf-card-header"><div><h2>De zaal op dit moment</h2><p>Open het bord om de partij te schrijven of te volgen.</p></div>${isOrganizer() ? nav('Alle borden', 'venue/boards', 'ghost small') : castLink('Naar het zaalscherm', 'hall')}</div><div class="vf-board-grid">${state.boards.map(b => boardCard(b, false)).join('')}</div></section>
      <section class="panel vf-card"><div class="vf-card-header"><div><h2>Wachtrij</h2><p>De volgende speelbare partijen gaan naar vrije borden.</p></div>${badge(queue.length, 'pending')}</div>${queue.length ? queue.slice(0, 8).map(m => queueRow(state, m)).join('') : empty('Geen wachtende partijen', 'Nieuwe wedstrijden komen hier wanneer de volgende ronde bekend is.')}</section>
      ${isOrganizer() ? recentLog(state) : ''}
    </div>`;
  }

  function recentLog(state) {
    if (!state.log.length) return '';
    const rows = state.log.slice().sort((a, b) => (b.at || b.time || 0) - (a.at || a.time || 0)).slice(0, 8);
    return `<section class="panel vf-card"><div class="vf-card-header"><div><h2>Logboek</h2><p>Recente acties van de wedstrijdleiding.</p></div></div>${rows.map(entry => `<div class="vf-row"><div><strong>${esc(entry.message || entry.text || entry.type || 'Zaalactie')}</strong></div><small>${clockTime(entry.at || entry.time)}</small></div>`).join('')}</section>`;
  }

  function queueRow(state, m) {
    const ready = venueEligible(state, m);
    return `<div class="vf-row"><div><strong>${esc(matchTitle(m))}</strong><small>${esc(matchLabel(m))}${ready.writerId ? ` · Schrijver ${esc(playerName(ready.writerId))}` : ''}</small></div><span class="vf-status">${ready.eligible ? badge('Speelklaar', 'approved') : badge(ready.reason || 'Wacht', 'pending')}</span></div>`;
  }

  function matchRow(m, playerView) {
    const b = boardById(m.boardId);
    const count = m.confirmations?.filter(Boolean).length || 0;
    return `<div class="vf-row"><div><strong>${esc(matchTitle(m))}</strong><small>${esc(matchLabel(m))}${b ? ` · ${esc(b.name)}` : ''}${m.score ? ` · ${m.score.join('–')}` : ''}${m.status === 'pending' ? ` · ${count}/2 bevestigd` : ''}</small></div><div class="vf-row-actions">${matchBadge(m)}${['pending','disputed','confirmed'].includes(m.status) ? nav('Bekijk uitslag', resultRoute(m), 'ghost small') : b ? nav(m.status === 'playing' ? 'Bord openen' : 'Bekijk oproep', boardRoute(b), 'ghost small') : ''}${m.status === 'disputed' && isOrganizer() ? B('Afhandelen', 'vf-resolve', 'gold small', attr('id', m.id)) : ''}${playerView && m.status === 'called' && !m.accepted?.[m.players.indexOf(viewerId())] ? B('Ik ben bij het bord', 'vf-accept', 'gold small', `${attr('id', m.id)} ${attr('player', viewerId())}`) : ''}</div></div>`;
  }

  function signupBadge(p) {
    if (p.signup === 'waitlisted') return badge('Wachtlijst', 'pending');
    if (p.signup === 'withdrawn') return badge('Afgemeld', 'finished');
    if (!p.checkedIn) return badge('Ingeschreven', 'blue');
    if (p.needsReady) return badge('Opnieuw klaar melden', 'pending');
    if (p.holdUntil > Date.now()) return badge(`Oproep hervat om ${clockTime(p.holdUntil)}`, 'pending');
    if (p.restUntil > Date.now()) return badge(`Rust tot ${clockTime(p.restUntil)}`, 'pending');
    if (!p.available) return badge('Pauze', 'pending');
    return badge('Speelklaar', 'approved');
  }

  function playerButtons(p, includeWithdraw = true) {
    const attrs = attr('player', p.id);
    if (p.signup === 'withdrawn') return p.id === viewerId() ? B('Opnieuw inschrijven', 'vf-signup', 'gold small') : '';
    let out = '';
    if (p.signup === 'confirmed') {
      if (!p.checkedIn) out += B(icon('check') + ' Check-in', 'vf-checkin', 'gold small', attrs);
      else if (!p.available || p.needsReady) out += B(icon('check') + ' Klaar melden', 'vf-ready', 'gold small', attrs);
      else out += B(icon('clock') + ' Neem pauze', 'vf-break', 'ghost small', attrs);
    }
    if (includeWithdraw) out += B('Afmelden', 'vf-withdraw', 'ghost small', attrs);
    return out;
  }

  function entriesView(state) {
    const confirmed = state.players.filter(p => p.signup === 'confirmed');
    const waiting = state.players.filter(p => p.signup === 'waitlisted');
    const me = player(viewerId());
    const filter = p => rosterFilter === 'all' || (rosterFilter === 'checked' ? p.checkedIn && p.signup === 'confirmed' : p.signup === rosterFilter);
    const visible = (isOrganizer() ? state.players : state.players.filter(p => p.signup !== 'withdrawn' || p.id === viewerId())).filter(filter);
    const eligibility = {club: 'Clubleden', invite: 'Met uitnodigingscode', all: 'Iedereen'}[state.settings.eligibility];
    const started = state.matches.some(m => m.status !== 'waiting');
    const checkInQr = isOrganizer() ? ctx.venueQr?.('checkin') : null;
    return `<div class="vf-stack">
      <section class="panel vf-card"><div class="vf-card-header"><div><h2>Inschrijven voor de speeldag</h2><p>${esc(eligibility)} · ${confirmed.length}/${state.settings.capacity} plaatsen bezet · ${waiting.length} op de wachtlijst</p></div>${badge(state.settings.signupOpen === false ? 'Inschrijving gesloten' : 'Inschrijving open', state.settings.signupOpen === false ? 'finished' : 'approved')}</div>
      <div class="vf-inline vf-wrap">${!me || me.signup === 'withdrawn' ? B(icon('plus') + ' Schrijf je in', 'vf-signup', 'gold', state.settings.signupOpen === false ? 'disabled' : '') : `${signupBadge(me)}${playerButtons(me)}`}${isOrganizer() ? B(icon('plus') + ' Speler inschrijven', 'vf-signup-other', 'ghost', state.settings.signupOpen === false ? 'disabled' : '') : ''}</div>
      <p>${started ? 'Bij een lopend schema komen nieuwe inschrijvingen op de wachtlijst. Een speler zonder gespeelde of opgeroepen partij kan zijn pouleplek vrijgeven.' : 'Bij een volle zaal schuif je door naar de wachtlijst. Voor de start gaat een vrijgekomen plek naar de eerstvolgende wachtende speler.'}</p>${checkInQr ? `<div class="vf-inline vf-wrap"><img src="${esc(checkInQr)}" alt="QR-code voor inschrijving en check-in" width="94" height="94"><div><strong>Check-in bij de ingang</strong><p>Scan de code om je deelnamestatus te openen.</p></div></div>` : ''}</section>
      <section class="panel vf-card"><div class="vf-card-header"><div><h2>Deelnemers</h2><p>Check-in, beschikbaarheid en pauzes staan bij de spelers.</p></div></div>
      <div class="tabs vf-tabs" aria-label="Filter deelnemers">${[['all','Alle'],['confirmed','Ingeschreven'],['checked','Ingecheckt'],['waitlisted','Wachtlijst']].map(([id,label]) => `<button type="button" class="tab ${rosterFilter === id ? 'active' : ''}" data-action="vf-roster-filter" data-filter="${id}" aria-pressed="${rosterFilter === id}">${label}</button>`).join('')}</div>
      ${visible.length ? `<div class="vf-table-wrap"><table class="table vf-table"><thead><tr><th>Speler</th><th>Status</th><th>Aanwezig</th><th>Acties</th></tr></thead><tbody>${visible.map(p => `<tr><td><strong>${esc(p.name)}</strong>${p.id === viewerId() ? ' <small>Jij</small>' : ''}${p.signup === 'waitlisted' ? `<small> · plek ${waiting.indexOf(p) + 1}</small>` : ''}</td><td>${signupBadge(p)}</td><td>${p.checkedIn ? 'Ja' : '–'}</td><td><div class="vf-row-actions">${isOrganizer() || p.id === viewerId() ? playerButtons(p) : ''}</div></td></tr>`).join('')}</tbody></table></div>` : empty('Geen deelnemers in deze selectie', 'Kies een ander filter.')}</section>
    </div>`;
  }

  function boardCard(b, management) {
    const m = matchById(b.matchId);
    const status = b.blocked ? 'blocked' : m?.status || (b.reserved ? 'reserved' : 'free');
    const num = boardNumber(b);
    return `<article class="panel vf-board vf-board-${status}">
      <div class="vf-board-head"><strong>${esc(b.name)}</strong>${badge(BOARD_LABELS[status] || status, status === 'playing' ? 'live' : status === 'blocked' || status === 'disputed' ? 'red' : status === 'free' ? 'approved' : 'pending')}</div>
      ${m ? `<div class="vf-versus"><strong>${esc(playerName(m.players[0]))}</strong><span>${m.score?.join('–') || m.game?.legs?.join('–') || 'vs'}</span><strong>${esc(playerName(m.players[1]))}</strong></div><p class="vf-meta">${esc(matchLabel(m))}${m.writerId ? ` · Schrijver ${esc(playerName(m.writerId))}` : ''}</p>` : `<p class="vf-meta">${b.blocked ? 'Dit bord is buiten gebruik.' : b.reserved ? 'Gereserveerd voor handmatige toewijzing.' : 'Beschikbaar voor de volgende partij.'}</p>`}
      ${b.camera ? `<p class="vf-meta">${icon('eye')} ${typeof b.camera === 'string' ? esc(b.camera) : 'Camera beschikbaar'}</p>` : ''}${b.reservationReason ? `<p class="vf-meta">${esc(b.reservationReason)}</p>` : ''}
      <div class="vf-inline vf-wrap">${nav(m?.realtimeRoom ? 'Baanmodus beheren' : 'Bordtablet', boardRoute(b), 'gold small')}${m?.realtimeRoom ? baanLink(m, 'screen', 'Live 9:16-scherm') : castLink('Bordscherm', `board-${num}`)}${canLinkBaan(m) ? B('Koppel Baanmodus', 'vf-baan-link', 'ghost small', attr('id', m.id)) : ''}${management ? B('Bord beheren', 'vf-board-settings', 'ghost small', attr('board', b.id)) : ''}${management && !m && !b.blocked ? B('Partij toewijzen', 'vf-assign', 'ghost small', attr('board', b.id)) : ''}</div>
    </article>`;
  }

  function boardsView(state) {
    return `<div class="vf-stack"><section class="panel vf-card"><div class="vf-card-header"><div><h2>Fysieke borden</h2><p>Gebruik de tablet voor scores en het bordscherm voor publiek en oproepen.</p></div>${castLink('Zaalscherm openen', 'hall')}</div><div class="vf-board-grid">${state.boards.map(b => boardCard(b, isOrganizer())).join('')}</div></section>${roomNotice('Een gereserveerd bord wordt handmatig toegewezen. Blokkeren haalt een bord uit de planning.')}</div>`;
  }

  function scheduleView(state) {
    const knockout = state.matches.filter(m => m.phase === 'knockout');
    const rounds = [...new Set(knockout.map(m => m.round))];
    return `<div class="vf-stack"><section class="panel vf-card"><div class="vf-card-header"><div><h2>Poulestanden</h2><p>Definitieve uitslagen tellen mee voor de stand.</p></div><div class="vf-inline vf-wrap">${!state.pools.length && isOrganizer() ? B('Maak poules', 'vf-prepare', 'gold small') : ''}${castLink('Stand op zaalscherm', 'hall')}</div></div><div class="vf-grid vf-grid-2">${state.pools.map(pool => `<article class="panel vf-card"><h3>${esc(pool.name || `Poule ${pool.id}`)}</h3>${standingsTable(state, pool.id)}<details><summary>Wedstrijdprogramma</summary>${state.matches.filter(m => m.poolId === pool.id).map(m => matchRow(m, false)).join('')}</details></article>`).join('') || empty('Nog geen poules', 'Het programma verschijnt zodra de indeling klaar is.')}</div></section>
      <section class="panel vf-card"><div class="vf-card-header"><div><h2>Knock-outschema</h2><p>Een winnaar schuift door zodra de uitslag definitief is.</p></div></div><div class="vf-rounds">${rounds.map(r => `<div><h3>${esc(knockout.find(m => m.round === r)?.label || `Ronde ${r}`)}</h3>${knockout.filter(m => m.round === r).map(m => matchRow(m, false)).join('')}</div>`).join('') || empty('Knock-out volgt', 'Na de poules verschijnt hier de volgende ronde.')}</div></section></div>`;
  }

  function standingsTable(state, poolId) {
    const rows = venueStandings(state, poolId);
    return `<div class="vf-table-wrap"><table class="table vf-table"><thead><tr><th>#</th><th>Speler</th><th>G</th><th>W</th><th>Legs</th><th>Pnt</th></tr></thead><tbody>${rows.map(p => `<tr><td>${p.position}</td><td>${esc(p.name)}</td><td>${p.played}</td><td>${p.won}</td><td>${p.legsFor}–${p.legsAgainst}</td><td><strong>${p.points}</strong></td></tr>`).join('')}</tbody></table></div>`;
  }

  function boardView(b) {
    const m = matchById(b.matchId);
    const num = boardNumber(b);
    const state = event();
    const offline = !!ctx.venueOffline?.();
    const info = ctx.venueOfflineInfo?.();
    const count = Number(typeof info === 'number' ? info : info?.queued ?? info?.count ?? info?.pending) || 0;
    const title = m ? matchTitle(m) : 'Wacht op de volgende partij';
    return `<div class="vf-page vf-board-page">
      ${ctx.header(`${esc(b.name)} <em>· ${m?.realtimeRoom ? 'Baanmodus' : 'Bordtablet'}</em>`, esc(title), `<div class="vf-inline vf-wrap">${nav(icon('left') + ' Speeldag', 'venue', 'ghost small')}${m?.realtimeRoom ? '' : castLink('Bordscherm', `board-${num}`)}</div>`)}
      ${m ? `<div class="vf-inline vf-wrap vf-score-top">${matchBadge(m)}${badge(matchLabel(m))}${m.writerId ? badge(`Schrijver ${playerName(m.writerId)}`) : ''}${!m.realtimeRoom ? offline ? badge(`Offline · ${count} in wachtrij`, 'red') : badge('Verbonden', 'approved') : ''}${!m.realtimeRoom && ['playing','pending'].includes(m.status) && ctx.setVenueOffline ? B(offline ? 'Verbinding herstellen' : 'Verbinding simuleren', offline ? 'vf-online' : 'vf-offline', 'ghost small') : ''}${canLinkBaan(m) ? B('Koppel Baanmodus', 'vf-baan-link', 'gold small', attr('id', m.id)) : ''}</div>` : ''}
      ${offline ? roomNotice(`Je kunt op dit bord doorscoren. ${count} beurt${count === 1 ? ' wacht' : 'en wachten'} op synchronisatie. De zaalschermen volgen de laatst ontvangen stand.`, 'vf-offline') : ''}
      ${!m ? `<section class="panel vf-card">${empty(b.blocked ? 'Bord buiten gebruik' : 'Geen actieve partij', b.reserved ? 'Een wedstrijdleider wijst een partij handmatig toe.' : 'Een nieuwe oproep verschijnt hier zodra de partij aan dit bord hangt.')}${isOrganizer() && !b.blocked ? B('Partij toewijzen', 'vf-assign', 'gold', attr('board', b.id)) : ''}</section>` : m.realtimeRoom ? baanControl(m) : m.status === 'called' ? callView(state, m) : m.status === 'playing' ? scoringView(state, m, b, offline) : resultView(m)}
    </div>`;
  }

  function callView(state, m) {
    const now = state.pausedAt ?? Date.now();
    const seconds = Math.max(0, Math.ceil((m.callUntil - now) / 1000));
    return `<section class="panel vf-card vf-call"><div class="vf-card-header"><div><h2>Spelers naar het bord</h2><p>${state.pausedAt != null ? 'De oproeptijd staat stil.' : `Meld je binnen <span data-vf-call-until="${esc(m.callUntil)}">${Number.isFinite(seconds) ? seconds : '–'}</span> seconden bij het bord.`}</p></div>${badge(state.pausedAt != null ? 'Gepauzeerd' : 'Oproep actief', 'pending')}</div><div class="vf-grid vf-grid-2">${m.players.map((id, i) => `<div class="panel vf-card"><h3>${esc(playerName(id))}</h3>${badge(m.accepted[i] ? 'Aanwezig' : 'Nog onderweg', m.accepted[i] ? 'approved' : 'pending')}${(isOrganizer() || id === viewerId()) && !m.accepted[i] ? `<div class="vf-inline vf-wrap">${B(icon('check') + ' Aanwezig bij bord', 'vf-accept', 'gold', `${attr('id', m.id)} ${attr('player', id)}`)}${B('Niet beschikbaar', 'vf-cancel-player', 'ghost small', `${attr('id', m.id)} ${attr('player', id)}`)}</div>` : ''}</div>`).join('')}</div>${isOrganizer() ? `<div class="vf-inline vf-wrap">${B('Oproep intrekken', 'vf-cancel-call', 'ghost', attr('id', m.id))}${B('No-show afhandelen', 'vf-forfeit', 'ghost small', attr('id', m.id))}</div>` : ''}</section>`;
  }

  function scoringView(state, m, b, offline) {
    const game = ctx.venueGame?.(m) || m.game;
    if (!game) return `<section class="panel vf-card">${empty('Scorebord wordt klaargezet', 'De partij verschijnt zodra beide spelers aanwezig zijn.')}</section>`;
    const disabled = game.status === 'finished';
    const visits = game.visits || [];
    return `<div class="vf-score-layout">
      <section class="panel vf-card vf-score-stage">
        <div class="vf-card-header"><div><h2>${esc(matchLabel(m))}</h2><p>${game.startScore || state.settings.startScore} · Best of ${game.bestOf || state.settings.bestOf} · dubbel uit</p></div>${badge(offline ? 'Lokale stand' : 'Zaalstand', offline ? 'pending' : 'live')}</div>
        <div class="vf-score-players">${m.players.map((id, i) => `<div class="vf-score-player ${game.turn === i && !disabled ? 'active' : ''}"><div><strong>${esc(playerName(id))}</strong><small>${game.turn === i && !disabled ? 'AAN DE BEURT' : 'RESTEREND'}</small></div><b>${game.remaining[i]}</b><span>${game.legs[i]} ${game.legs[i] === 1 ? 'leg' : 'legs'}</span></div>`).join('')}</div>
        ${disabled ? roomNotice('De finish is lokaal genoteerd. Herstel de verbinding om de uitslag te bevestigen.') : `<div class="vf-score-turn">${icon('target')} <strong>${esc(playerName(m.players[game.turn]))} aan de beurt</strong></div>`}
        <details class="vf-visit-history"><summary>Laatste beurten (${visits.length})</summary>${visits.slice(-8).reverse().map(v => `<div class="vf-row"><span>${esc(playerName(v.player || m.players[v.playerIndex]))}</span><strong>${v.score}${v.bust ? ' · bust' : v.checkout ? ' · finish' : ''}</strong><span>${v.remainingAfter ?? '–'} over</span></div>`).join('') || '<p>Nog geen beurten ingevoerd.</p>'}</details>
      </section>
      <aside class="panel vf-card vf-score-aside">
        <h2>Beurt invoeren</h2>
        <form data-form="vf-score" class="vf-stack" data-board="${esc(b.id)}">
          <input type="hidden" name="matchId" value="${esc(m.id)}">
          <div class="vf-score-input"><label class="field">Score van de beurt<input class="input" id="vf-visit-score" name="score" inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" required autocomplete="off" placeholder="0–180" value="${esc(draftScores.get(String(m.id)) || '')}" ${disabled ? 'disabled' : ''}></label><label class="field">Aantal darts<select name="darts" id="vf-darts" ${disabled ? 'disabled' : ''}>${[3,2,1].map(n => `<option value="${n}" ${(draftDarts.get(String(m.id)) || 3) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
          <div class="keypad vf-keypad">${['1','2','3','4','5','6','7','8','9','back','0','ok'].map(key => key === 'ok' ? `<button type="submit" class="confirm" aria-label="Score bevestigen" ${disabled ? 'disabled' : ''}>OK</button>` : `<button type="button" data-action="vf-key" data-key="${key}" aria-label="${key === 'back' ? 'Laatste cijfer wissen' : key}" ${disabled ? 'disabled' : ''}>${key === 'back' ? icon('backspace') : key}</button>`).join('')}</div>
          <div class="vf-score-quick">${[26,60,100,180].map(score => B(String(score), 'vf-quick', 'ghost small', `${attr('value', score)} ${disabled ? 'disabled' : ''}`)).join('')}</div>
          <p class="inline-error" id="vf-score-error" role="alert"></p>
        </form>
        <div class="vf-score-actions">${B(icon('undo') + ' Beurt herstellen', 'vf-undo', 'ghost small', `${attr('id', m.id)} ${visits.length && !disabled ? '' : 'disabled'}`)}${isOrganizer() ? B('Legstand invoeren', 'vf-finalize', 'ghost small', `${attr('id', m.id)} ${offline ? 'disabled' : ''}`) : ''}${(isOrganizer() || m.players.includes(viewerId())) && !offline ? B('Meld een geschil', 'vf-dispute', 'ghost small', attr('id', m.id)) : ''}</div>
      </aside>
    </div>`;
  }

  function resultView(m) {
    const score = m.score || m.game?.legs || [0, 0];
    const decided = m.status === 'confirmed';
    const disputed = m.status === 'disputed';
    return `<section class="panel vf-card vf-result"><div class="vf-card-header"><div><h2>${decided ? 'Uitslag definitief' : disputed ? 'Uitslag in overleg' : 'Bevestig de uitslag'}</h2><p>${esc(matchLabel(m))}</p></div>${matchBadge(m)}</div><div class="vf-score-players">${m.players.map((id, i) => `<div class="vf-score-player"><strong>${esc(playerName(id))}</strong><b>${score[i]}</b><span>LEGS</span>${badge(decided && m.confirmedBy === 'organizer' ? 'Vastgesteld' : m.confirmations?.[i] ? 'Bevestigd' : 'Nog te bevestigen', decided || m.confirmations?.[i] ? 'approved' : 'pending')}${!decided && !disputed && !m.confirmations?.[i] && (isOrganizer() || id === viewerId()) ? B(icon('check') + ' Akkoord', 'vf-confirm', 'gold', `${attr('id', m.id)} ${attr('player', id)}`) : ''}</div>`).join('')}</div>
    ${disputed ? roomNotice(`Betwisting: ${esc(typeof m.dispute === 'string' ? m.dispute : m.dispute?.reason || 'De wedstrijdleider beoordeelt deze uitslag.')}`) : ''}
    <div class="vf-inline vf-wrap">${!decided && !disputed && (isOrganizer() || m.players.includes(viewerId())) ? B('Uitslag betwisten', 'vf-dispute', 'ghost', attr('id', m.id)) : ''}${!decided && isOrganizer() ? B(disputed ? 'Geschil afhandelen' : 'Uitslag vaststellen', 'vf-resolve', 'gold', attr('id', m.id)) : ''}${decided ? nav('Terug naar de speeldag', 'venue', 'gold') : ''}</div></section>`;
  }

  function modal(title, subtitle, type, body, submitLabel) {
    ctx.showModal(title, subtitle, `<form data-form="${type}">${body}<div class="inline-error" data-vf-error role="alert"></div><div class="modal-actions">${B('Annuleren', 'close-modal', 'ghost')}<button type="submit" class="btn gold">${submitLabel}</button></div></form>`);
  }

  function localDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    const date = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
  }

  function newEventModal() {
    if (!ctx.createVenueEvent) return;
    modal('Nieuwe speeldag', 'Begin met een lege inschrijving en stel daarna de poules samen.', 'vf-new-event', '<label class="field">Naam van de speeldag<input class="input" name="name" required minlength="3" maxlength="70" placeholder="Clubtoernooi november"></label><label class="field">Aantal deelnemers<input class="input" type="number" name="capacity" required min="2" max="64" value="16"></label>', 'Speeldag aanmaken');
  }

  function switchEventModal() {
    const events = ctx.venueEvents?.() || [];
    if (!events.length) return;
    modal('Kies een speeldag', 'Open de inschrijving, regie en uitslagen van het gekozen evenement.', 'vf-switch-event', `<label class="field">Speeldag<select name="eventId">${events.map(e => `<option value="${esc(e.id)}" ${String(e.id) === String(event().id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>`, 'Speeldag openen');
  }

  function prepareModal() {
    const count = event().players.filter(p => p.signup === 'confirmed').length;
    modal('Maak poules', `${count} deelnemers met een bevestigde inschrijving.`, 'vf-prepare', `<label class="field">Gewenst aantal poules<select name="poolCount"><option value="1">1 poule</option><option value="2">2 poules</option><option value="4" selected>4 poules</option><option value="8">8 poules</option></select></label><p class="subtle-label">De zaal verdeelt de deelnemers over poules en zet het knock-outschema klaar.</p>`, 'Poules aanmaken');
  }

  function settingsModal() {
    const s = event().settings;
    const options = (items, current) => items.map(([id,label]) => `<option value="${esc(id)}" ${String(current) === String(id) ? 'selected' : ''}>${esc(label)}</option>`).join('');
    modal('Speeldag instellen', 'Bepaal wie kan deelnemen en hoe de zaal partijen oproept.', 'vf-settings', `
      <div class="field-row vf-form-grid"><label class="field">Aantal plaatsen<input class="input" type="number" name="capacity" required min="2" max="64" value="${s.capacity}"></label><label class="field">Deelname<select name="eligibility">${options([['all','Iedereen'],['club','Clubleden'],['invite','Uitnodigingscode']], s.eligibility)}</select></label></div>
      <label class="field">Uitnodigingscode<input class="input" name="inviteCode" maxlength="30" value="${esc(s.inviteCode || '')}"></label>
      <div class="field-row vf-form-grid"><label class="field">Oproeptijd in seconden<input class="input" type="number" name="callSeconds" required min="15" max="600" value="${s.callSeconds}"></label><label class="field">Rust na een partij in seconden<input class="input" type="number" name="restSeconds" required min="0" max="1200" value="${s.restSeconds}"></label></div>
      <div class="field-row vf-form-grid"><label class="field">Wachttijd na gemiste oproep<input class="input" type="number" name="cooldownSeconds" required min="0" max="600" value="${s.cooldownSeconds}"></label><label class="field">Wedstrijdscore<select name="startScore">${options([[301,'301'],[501,'501'],[701,'701']], s.startScore)}</select></label></div>
      <div class="field-row vf-form-grid"><label class="field">Speelminuten per partij<input class="input" type="number" name="averageMinutes" min="1" max="120" required value="${s.averageMinutes || 9}"></label><label class="field">Geplande eindtijd<input class="input" type="datetime-local" name="deadlineAt" value="${localDateTime(s.deadlineAt)}"></label></div><label class="field">Best of<select name="bestOf">${options([1,3,5,7,9].map(n => [n,`${n} legs`]), s.bestOf)}</select></label>
      <div class="vf-stack"><label><input type="checkbox" name="signupOpen" ${s.signupOpen !== false ? 'checked' : ''}> Inschrijving open</label><label><input type="checkbox" name="requireWriter" ${s.requireWriter ? 'checked' : ''}> Aangewezen schrijver verplicht</label><label><input type="checkbox" name="autoSchedule" ${s.autoSchedule ? 'checked' : ''}> Automatisch toewijzen</label></div>`, 'Instellingen opslaan');
  }

  function clubIdsFor(id) {
    return (ctx.db.play?.clubs?.items || []).filter(c => c.members?.some(m => Number(m?.id ?? m) === id)).map(c => Number(c.id));
  }

  function signupModal(other = false) {
    const state = event();
    const candidates = (ctx.db.players || []).filter(p => p.status === 'approved' && !state.players.some(e => e.id === p.id && e.signup !== 'withdrawn'));
    const otherFields = `<label class="field">Bestaande speler<select name="playerId"><option value="">Kies een speler of vul een gastnaam in</option>${candidates.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">Gastnaam<input class="input" name="guestName" maxlength="50" placeholder="Voor- en achternaam"></label>`;
    modal(other ? 'Speler inschrijven' : 'Ik doe mee', state.name, 'vf-signup', `${other ? otherFields : `<input type="hidden" name="playerId" value="${viewerId()}"><p>Je schrijft je in als <strong>${esc(playerName(viewerId()))}</strong>.</p>`}${state.settings.eligibility === 'invite' ? '<label class="field">Uitnodigingscode<input class="input" name="inviteCode" maxlength="30" required autocomplete="off"></label>' : ''}<p class="subtle-label">Bij een volle zaal komt de inschrijving op de wachtlijst.</p>`, 'Inschrijving bevestigen');
  }

  function withdrawModal(p) {
    if (!p) return;
    modal('Afmelden voor de speeldag', 'Bij een volle zaal kan je plek naar iemand op de wachtlijst gaan.', 'vf-withdraw', `<input type="hidden" name="playerId" value="${p.id}"><p>Meld <strong>${esc(p.name)}</strong> af voor deze speeldag?</p>`, 'Afmelden');
  }

  function boardModal(b) {
    if (!b) return;
    const choices = event().matches.filter(m => m.status === 'waiting');
    modal('Bord beheren', esc(b.name), 'vf-board-settings', `<input type="hidden" name="boardId" value="${esc(b.id)}"><div class="vf-stack"><label><input type="checkbox" name="camera" ${b.camera ? 'checked' : ''}> Camera beschikbaar</label><label><input type="checkbox" name="blocked" ${b.blocked ? 'checked' : ''}> Bord blokkeren</label><label><input type="checkbox" name="reserved" ${b.reserved ? 'checked' : ''}> Alleen handmatig toewijzen</label></div><label class="field">Reserveer voor een specifieke partij<select name="reservedForMatchId"><option value="">Geen vaste partij</option>${choices.map(m => `<option value="${esc(m.id)}" ${m.id === b.reservedForMatchId ? 'selected' : ''}>${esc(matchLabel(m))} · ${esc(matchTitle(m))}</option>`).join('')}</select></label><label class="field">Reden voor reservering<input class="input" name="reservationReason" maxlength="120" value="${esc(b.reservationReason || '')}" placeholder="Bijvoorbeeld: voor de finale"></label>`, 'Bord opslaan');
  }

  function assignmentModal(b) {
    if (!b) return;
    const state = event();
    const waiting = state.matches.filter(m => m.status === 'waiting' && m.players.every(Boolean));
    const choices = waiting.map(m => ({m, ...venueEligible(state, m)}));
    if (!choices.length) {
      ctx.showModal('Geen partijen beschikbaar', esc(b.name), `${empty('Er wacht geen complete partij', 'Laat spelers inchecken of rond de vorige ronde af.')}<div class="modal-actions">${B('Sluiten','close-modal','gold')}</div>`);
      return;
    }
    modal('Partij toewijzen', esc(b.name), 'vf-assign', `<input type="hidden" name="boardId" value="${esc(b.id)}"><label class="field">Wedstrijd<select name="matchId" required>${choices.map(({m,eligible,reason}) => `<option value="${esc(m.id)}">${esc(matchTitle(m))} · ${esc(eligible ? 'Speelklaar' : reason || 'Wacht')}</option>`).join('')}</select></label><label class="field">Schrijver<select name="writerId"><option value="">Automatische keuze</option>${state.players.filter(p => p.signup === 'confirmed' && p.checkedIn && p.available).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><p class="subtle-label">De zaal controleert of beide spelers en de schrijver beschikbaar zijn.</p>`, 'Partij oproepen');
  }

  function scoreModal(m, resolve) {
    if (!m) return;
    const game = ctx.venueGame?.(m) || m.game;
    const bestOf = game?.bestOf || event().settings.bestOf;
    const target = Math.floor(bestOf / 2) + 1;
    const score = m.score || (game?.status === 'finished' ? game.legs : [target, 0]);
    modal(resolve ? 'Geschil afhandelen' : 'Legstand invoeren', esc(matchTitle(m)), resolve ? 'vf-resolve' : 'vf-finalize', `<input type="hidden" name="matchId" value="${esc(m.id)}"><div class="field-row vf-form-grid">${m.players.map((id, i) => `<label class="field">${esc(playerName(id))} · legs<input class="input" type="number" name="legs${i}" min="0" max="${target}" required value="${score[i]}"></label>`).join('')}</div><p class="subtle-label">${resolve ? 'Deze uitslag wordt definitief verwerkt door de wedstrijdleiding.' : 'Beide spelers bevestigen de ingevoerde uitslag op het bordtablet.'}</p>`, resolve ? 'Uitslag vastleggen' : 'Voorleggen aan spelers');
  }

  function forfeitModal(m) {
    modal('No-show afhandelen', esc(matchTitle(m)), 'vf-forfeit', `<input type="hidden" name="matchId" value="${esc(m.id)}"><label class="field">Afwezige speler<select name="playerId">${m.players.map(id => `<option value="${id}">${esc(playerName(id))}</option>`).join('')}</select></label><label class="field">Reden<input class="input" name="reason" maxlength="240" required placeholder="Bijvoorbeeld: afwezig na herhaalde oproep"></label><p class="subtle-label">De wedstrijdleiding kent de uitslag toe aan de aanwezige speler. Dit wordt direct verwerkt in de stand.</p>`, 'Beslissing vastleggen');
  }

  function disputeModal(m) {
    if (!m || !['playing','pending'].includes(m.status)) return;
    if (!isOrganizer() && !m.players.includes(viewerId())) return;
    const participant = isOrganizer() ? `<label class="field">Wie betwist de uitslag?<select name="playerId">${m.players.map(id => `<option value="${id}">${esc(playerName(id))}</option>`).join('')}</select></label>` : `<input type="hidden" name="playerId" value="${viewerId()}">`;
    modal('Uitslag betwisten', esc(matchTitle(m)), 'vf-dispute', `<input type="hidden" name="matchId" value="${esc(m.id)}">${participant}<label class="field">Toelichting<textarea class="input" name="reason" rows="3" minlength="3" maxlength="240" required placeholder="Welke score of situatie moet de wedstrijdleiding controleren?"></textarea></label>`, 'Naar wedstrijdleiding');
  }

  function applyVisit(matchId, score, darts, doubleConfirmed = false) {
    const result = run('score', {matchId, score, darts, doubleConfirmed}, {inline: true, noRender: true});
    if (result.error) {
      const node = document.getElementById('vf-score-error');
      if (node) node.textContent = result.error;
      if (doubleConfirmed || !node) ctx.toast(result.error);
      return;
    }
    if (result.needsDouble) {
      ctx.showModal('Dubbel geraakt?', 'Bevestig de laatste dart om de leg af te sluiten.', `<p>Beurt van <strong>${score}</strong> met ${darts} dart${darts === 1 ? '' : 's'}.</p><div class="modal-actions">${B('Aanpassen', 'close-modal', 'ghost')}${B(icon('check') + ' Dubbel bevestigd', 'vf-double', 'gold', `${attr('id', matchId)} ${attr('value', score)} ${attr('darts', darts)}`)}</div>`);
      return;
    }
    draftScores.delete(String(matchId));
    draftDarts.delete(String(matchId));
    if (doubleConfirmed) ctx.closeModal();
    const updated = matchById(matchId);
    if (updated?.status === 'pending') ctx.go(resultRoute(updated));
    else ctx.render();
  }

  function keypad(key, preset) {
    const field = document.getElementById('vf-visit-score');
    if (!field || field.disabled) return;
    const form = field.closest('form');
    const value = preset != null ? String(preset) : key === 'back' ? field.value.slice(0, -1) : (field.value + key).slice(0, 3);
    field.value = value;
    draftScores.set(String(form.elements.matchId.value), value);
    const error = document.getElementById('vf-score-error');
    if (error) error.textContent = '';
  }

  function handleAction(action, element) {
    if (!action.startsWith('vf-')) return false;
    const data = element.dataset;
    const match = data.id ? matchById(data.id) : null;
    const board = data.board ? boardById(data.board) : null;
    const playerId = Number(data.player);
    const organizer = isOrganizer();
    const mine = organizer || playerId === viewerId();
    switch (action) {
      case 'vf-tab':
        if (Object.hasOwn(TAB_LABELS, data.tab)) ctx.go(data.tab === 'desk' ? 'venue' : `venue/${data.tab}`);
        break;
      case 'vf-roster-filter':
        if (['all','confirmed','checked','waitlisted'].includes(data.filter)) rosterFilter = data.filter;
        ctx.render();
        break;
      case 'vf-settings': if (organizer) settingsModal(); break;
      case 'vf-new-event': if (organizer) newEventModal(); break;
      case 'vf-switch-event': switchEventModal(); break;
      case 'vf-prepare': if (organizer) prepareModal(); break;
      case 'vf-schedule': if (organizer) run('schedule'); break;
      case 'vf-auto': if (organizer) run('auto', {enabled: !event().settings.autoSchedule}); break;
      case 'vf-pause-calls': if (organizer) run('pause-calls', {paused: event().pausedAt == null}); break;
      case 'vf-signup': signupModal(); break;
      case 'vf-signup-other': if (organizer) signupModal(true); break;
      case 'vf-checkin': if (mine) run('checkin', {playerId}); break;
      case 'vf-ready': if (mine) run('ready', {playerId}); break;
      case 'vf-break': if (mine) run('break', {playerId}); break;
      case 'vf-withdraw': if (mine) withdrawModal(player(playerId)); break;
      case 'vf-board-settings': if (organizer) boardModal(board); break;
      case 'vf-baan-link':
        if (canLinkBaan(match)) {
          const linked = run('link-baan', {matchId: match.id, roomId: ctx.baanNewRoom()});
          if (!linked.error) ctx.go(boardRoute(boardById(match.boardId)));
        }
        break;
      case 'vf-baan-import': if (organizer) void importBaan(match); break;
      case 'vf-baan-unlink':
        if (organizer && match?.realtimeRoom) ctx.showModal('Live baan loskoppelen?', 'De toernooipartij gaat terug naar de wachtrij. Een eventuele stand op de live baan wordt niet overgenomen.', `<div class="modal-actions">${B('Annuleren', 'close-modal')}${B('Loskoppelen en terugzetten', 'vf-baan-confirm-unlink', 'gold', attr('id', match.id))}</div>`);
        break;
      case 'vf-baan-confirm-unlink': if (organizer && match?.realtimeRoom) run('unlink-baan', {matchId: match.id}, {close: true}); break;
      case 'vf-assign': if (organizer) assignmentModal(board); break;
      case 'vf-accept': if (match && mine) run('accept', {matchId: match.id, playerId}); break;
      case 'vf-cancel-player': if (match && mine) run('cancel-call', {matchId: match.id, playerId}); break;
      case 'vf-cancel-call': if (match && organizer) run('cancel-call', {matchId: match.id}); break;
      case 'vf-forfeit': if (match && organizer) forfeitModal(match); break;
      case 'vf-key': keypad(data.key); break;
      case 'vf-quick': keypad(null, data.value); break;
      case 'vf-double': if (match) applyVisit(match.id, Number(data.value), Number(data.darts), true); break;
      case 'vf-undo': if (match) run('undo', {matchId: match.id}); break;
      case 'vf-finalize': if (organizer) scoreModal(match, false); break;
      case 'vf-resolve': if (organizer) scoreModal(match, true); break;
      case 'vf-confirm': if (match && mine) run('confirm', {matchId: match.id, playerId}); break;
      case 'vf-dispute': disputeModal(match); break;
      case 'vf-offline':
      case 'vf-online': {
        const result = ctx.setVenueOffline?.(action === 'vf-offline');
        if (result?.error) ctx.toast(result.error);
        ctx.render();
        break;
      }
      default: return false;
    }
    return true;
  }

  function handleForm(form, fields) {
    const type = form.dataset.form;
    if (!type?.startsWith('vf-')) return false;
    const organizer = isOrganizer();
    const inline = message => {
      const error = form.querySelector('[data-vf-error]');
      if (error) error.textContent = message;
      else ctx.toast(message);
    };
    const send = (action, payload) => {
      const result = run(action, payload, {close: true, inline: true});
      if (result.error) inline(result.error);
      return result;
    };
    const m = fields.matchId ? matchById(fields.matchId) : null;
    switch (type) {
      case 'vf-new-event': {
        if (!organizer || !ctx.createVenueEvent) break;
        const name = String(fields.name || '').trim();
        if (name.length < 3) { inline('Vul een naam van minstens drie tekens in.'); break; }
        const result = ctx.createVenueEvent({name, clubId: ctx.scopeId?.() ?? null, settings: {capacity: Number(fields.capacity)}});
        if (result?.error) { inline(result.error); break; }
        ctx.save(); ctx.closeModal(); ctx.go('venue/entries');
        break;
      }
      case 'vf-switch-event': {
        if (!ctx.selectVenueEvent) break;
        const result = ctx.selectVenueEvent(fields.eventId);
        if (result?.error) { inline(result.error); break; }
        ctx.save(); ctx.closeModal(); ctx.go('venue');
        break;
      }
      case 'vf-prepare':
        if (organizer) send('prepare', {poolCount: Number(fields.poolCount)});
        break;
      case 'vf-settings':
        if (organizer) send('settings', {capacity: Number(fields.capacity), eligibility: fields.eligibility, inviteCode: fields.inviteCode, callSeconds: Number(fields.callSeconds), restSeconds: Number(fields.restSeconds), cooldownSeconds: Number(fields.cooldownSeconds), startScore: Number(fields.startScore), bestOf: Number(fields.bestOf), signupOpen: fields.signupOpen === 'on', requireWriter: fields.requireWriter === 'on', autoSchedule: fields.autoSchedule === 'on', averageMinutes: Number(fields.averageMinutes), deadlineAt: fields.deadlineAt || null});
        break;
      case 'vf-signup': {
        const guestName = organizer ? String(fields.guestName || '').trim() : '';
        const id = guestName ? Date.now() : Number(fields.playerId) || viewerId();
        if (!organizer && id !== viewerId()) break;
        const name = guestName || ctx.db.players?.find(p => p.id === id)?.name || player(id)?.name;
        if (!name) { inline('Kies een speler of vul een gastnaam in.'); break; }
        send('signup', {id, name, clubIds: clubIdsFor(id), inviteCode: String(fields.inviteCode || '').trim()});
        break;
      }
      case 'vf-withdraw': {
        const id = Number(fields.playerId);
        if (organizer || id === viewerId()) send('withdraw', {playerId: id});
        break;
      }
      case 'vf-board-settings':
        if (organizer) send('board', {boardId: fields.boardId, blocked: fields.blocked === 'on', reserved: fields.reserved === 'on', camera: fields.camera === 'on', reservedForMatchId: fields.reservedForMatchId || null, reservationReason: String(fields.reservationReason || '').trim()});
        break;
      case 'vf-assign':
        if (organizer) send('assign', {boardId: fields.boardId, matchId: m?.id || fields.matchId, writerId: Number(fields.writerId) || undefined});
        break;
      case 'vf-score':
        if (m && /^\d{1,3}$/.test(String(fields.score))) applyVisit(m.id, Number(fields.score), Number(fields.darts || 3));
        break;
      case 'vf-finalize':
      case 'vf-resolve': {
        if (m && organizer) {
          const result = send(type === 'vf-resolve' ? 'resolve' : 'finalize', {matchId: m.id, score: [Number(fields.legs0), Number(fields.legs1)]});
          if (!result.error && type === 'vf-finalize') ctx.go(resultRoute(m));
        }
        break;
      }
      case 'vf-forfeit': {
        if (m && organizer) {
          const result = send('forfeit', {matchId: m.id, playerId: Number(fields.playerId), reason: String(fields.reason || '').trim()});
          if (!result.error) ctx.go(resultRoute(m));
        }
        break;
      }
      case 'vf-dispute': {
        const id = Number(fields.playerId);
        if (m && (organizer || id === viewerId())) {
          const result = send('dispute', {matchId: m.id, playerId: id, reason: String(fields.reason || '').trim()});
          if (!result.error) ctx.go(resultRoute(m));
        }
        break;
      }
      default: return false;
    }
    return true;
  }

  document.addEventListener('input', event => {
    const field = event.target;
    if (field.id !== 'vf-visit-score') return;
    const form = field.closest('form');
    field.value = field.value.replace(/\D/g, '').slice(0, 3);
    draftScores.set(String(form.elements.matchId.value), field.value);
    const error = document.getElementById('vf-score-error');
    if (error) error.textContent = '';
  });

  document.addEventListener('change', event => {
    const field = event.target;
    if (field.id === 'vf-darts') draftDarts.set(String(field.closest('form').elements.matchId.value), Number(field.value));
  });

  function tick(now = Date.now()) {
    if (event().pausedAt != null) return;
    for (const node of document.querySelectorAll('[data-vf-call-until]')) {
      const until = Number(node.dataset.vfCallUntil);
      if (Number.isFinite(until)) node.textContent = String(Math.max(0, Math.ceil((until - now) / 1000)));
    }
  }

  return {init, view, handleAction, handleForm, tick, getEvent: event};
}
