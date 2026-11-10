const LIVE_BOARD = 'duindorp-baan-1';
const MODES = {
  practice: 'Oefenpartij',
  local: 'Lokale wedstrijd',
  remote: 'Online wedstrijd',
  scheduled: 'Geplande wedstrijd',
};

const glyphs = {
  screen: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20h8m-4-4v4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>',
  share: '<circle cx="6" cy="12" r="2"/><circle cx="17.5" cy="5.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/><path d="m7.8 11 7.9-4.5m-7.9 6.5 7.9 4.5"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  fullscreen: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
};
const icon = name => `<svg class="bf-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`;
const logo = '<img class="bf-logo" src="/assets/dartflow-logo.svg" alt="Dartflow">';
const firstName = name => String(name || '').split(' ')[0];
const formatNumber = number => new Intl.NumberFormat('nl-NL', {maximumFractionDigits: 1}).format(number);
const bestOf = (n, singular, plural) => `Best of ${Number(n)} ${Number(n) === 1 ? singular : plural}`;
const headLabel = s => s === 'live' ? 'Live' : s === 'result' ? 'Uitslag' : s === 'waiting' ? 'Gereserveerd' : 'Vrij';

function club(escape, name = 'Duindorp SV') {
  const initials = name === 'Duindorp SV' ? 'DSV' : name.split(/\s+/).map(word => word[0]).join('').slice(0, 3).toUpperCase();
  return `<div class="bf-club"><span class="bf-club__mark" aria-hidden="true">${escape(initials)}</span><span class="bf-club__label"><b>${escape(name)}</b><small>Op locatie</small></span></div>`;
}

function pill(text, status) {
  return `<span class="bf-pill${status ? ` bf-pill--${status}` : ''}">${text}</span>`;
}

function actionLink(escape, label, url, iconName, gold = false, external = false) {
  return `<a class="bf-btn${gold ? ' bf-btn--gold' : ''}" href="${escape(url)}"${external ? ' target="_blank" rel="noopener"' : ''}>${iconName ? icon(iconName) : ''}${label}</a>`;
}

export function renderBaanHub(ctx) {
  const e = ctx.escape;
  const id = ctx.demoId();
  const demoScreen = ctx.url('screen', id);
  const demoPhone = ctx.url('phone', id);
  const demoPhone2 = ctx.url('phone', id, {device: 2});
  const boardScreen = ctx.url('screen', LIVE_BOARD);
  const boardPhone = ctx.url('phone', LIVE_BOARD);
  const state = ctx.state();
  const demoState = state?.id === id ? state.status : null;
  return `<div class="bf-hub">
    <section class="bf-hub__hero" aria-labelledby="bf-hub-title">
      <div class="bf-hub__headline">
        <p class="bf-kicker">Dartflow op locatie · 9:16</p>
        <h1 id="bf-hub-title">Scan en <em>speel.</em></h1>
        <p>Iedere dartbaan heeft een eigen QR. Spelers openen de partij op hun telefoon en het baanscherm volgt de stand live.</p>
        <div class="bf-hub__hero-cta">
          ${actionLink(e, 'Open demo-baanscherm', demoScreen, 'screen', true, true)}
          ${actionLink(e, 'Open telefoon 1', demoPhone, 'phone', false, true)}
        </div>
      </div>
      ${club(e)}
    </section>
    <section class="df-workspace__section" aria-labelledby="bf-board-picker">
      <div class="bf-hub__panel-head">
        <div><p class="bf-kicker">Baanmodus</p><h2 id="bf-board-picker">Kies je baanscherm</h2></div>
        ${pill('Live tussen apparaten', 'live')}
      </div>
      <div class="df-workspace__grid df-workspace__grid--2">
        <article class="df-workspace__panel bf-hub__board">
          <header><div><p class="bf-kicker">Eigen testbaan</p><h3>Probeer met twee telefoons</h3></div>${demoState ? pill(headLabel(demoState), demoState === 'live' ? 'live' : '') : ''}</header>
          <p>Open hetzelfde scorebord met twee apparaten. Je kunt telefoon 2 ook direct in een apart tabblad testen.</p>
          <div class="bf-hub__actions">
            ${actionLink(e, 'Telefoon 1', demoPhone, 'phone', false, true)}
            ${actionLink(e, 'Telefoon 2', demoPhone2, 'phone', false, true)}
            <button type="button" class="bf-btn bf-btn--ghost" data-action="baan-copy-link" data-url="${e(demoScreen)}">${icon('share')} Deel schermlink</button>
          </div>
        </article>
        <article class="df-workspace__panel bf-hub__board">
          <header><div><p class="bf-kicker">Vaste locatie</p><h3>Duindorp SV · Baan 1</h3></div>${pill('9:16')}</header>
          <p>Hang dit scherm bij baan 1. De QR opent altijd deze baan, ook wanneer de schermweergave van wachtruimte naar scorebord wisselt.</p>
          <div class="bf-hub__actions">
            ${actionLink(e, 'Baanscherm', boardScreen, 'screen', false, true)}
            ${actionLink(e, 'Open baan op telefoon', boardPhone, 'arrow', false, true)}
          </div>
        </article>
      </div>
    </section>
    <div class="df-workspace__grid df-workspace__grid--2">
      <section class="df-workspace__panel">
        <div class="bf-hub__heading"><p class="bf-kicker">Lokale partij testen</p><h2>Van QR naar eerste worp</h2></div>
        <ol class="bf-hub__steps">
          <li><strong>Open het baanscherm.</strong> Scan de QR met twee telefoons of open hierboven de twee telefoonweergaven.</li>
          <li><strong>Start een lokale partij.</strong> Speler 1 kiest de spelregels. Speler 2 opent dezelfde baan en bevestigt de partij.</li>
          <li><strong>Gooi en voer in.</strong> Speler 1 schrijft. Speler 2 kan via <em>Invoer overnemen</em> direct verdergaan. Op het scherm blijft de stand behouden.</li>
        </ol>
      </section>
      <section class="df-workspace__panel">
        <div class="bf-hub__heading"><p class="bf-kicker">Ook aan de oche</p><h2>Meer dan een losse partij</h2></div>
        <p class="bf-hub__fine">Train solo, stuur een online uitnodiging of gebruik de baan voor een geplande partij. Op de telefoon staat je partijhistorie.</p>
        <div class="bf-hub__actions">${actionLink(e, 'Naar toernooiregie', '#venue', 'arrow')}</div>
      </section>
    </div>
  </div>`;
}

function qr(ctx, id, compact = false, caption = 'Scan met je telefoon') {
  const e = ctx.escape;
  const image = ctx.qrUrl();
  if (!image) return '';
  return `<figure class="bf-display__qr${compact ? ' bf-display__qr--compact' : ''}">
    <a href="${e(ctx.phoneUrl?.() || ctx.url('phone', id))}" aria-label="${e(caption)}"><img src="${e(image)}" alt="QR-code voor deze dartbaan"></a>
    <figcaption>${e(caption)}</figcaption>
  </figure>`;
}

function intro(ctx, id, title, match, loading) {
  const e = ctx.escape;
  if (loading) {
    return `<section class="bf-display__main">
      <div class="bf-display__headline">${pill('Verbinden')}
      <p class="bf-kicker">${e(title)}</p><h1>Even <em>geduld.</em></h1><p>We halen de huidige stand van deze baan op.</p></div>
    </section>`;
  }
  const waiting = Boolean(match);
  const heading = !waiting ? 'Scan en <em>speel.</em>' :
    match.mode === 'scheduled' ? 'Meld je <em>aan.</em>' :
    match.players.length > 1 ? 'Klaar aan <em>de oche?</em>' : 'Wie daag <em>je uit?</em>';
  const summary = !waiting ? 'Begin een oefenpartij, speel samen op locatie of nodig iemand online uit.' :
    match.mode === 'remote' ? 'De online partij begint zodra je tegenstander de uitnodiging accepteert.' :
    match.mode === 'scheduled' ? 'De ingeplande spelers openen deze baan en bevestigen hun partij.' :
    match.players.length > 1 ? 'Open de baan op je telefoon om de partij te bevestigen.' :
    'De tweede speler scant dezelfde QR en sluit aan.';
  const waitingNames = waiting ? match.players.map(p => p.name) : [];
  if (waitingNames.length === 1 && match.scheduledOpponent) waitingNames.push(match.scheduledOpponent);
  return `<section class="bf-display__main">
    <div class="bf-display__headline">${pill(waiting ? 'Wacht op spelers' : 'Baan vrij', waiting ? '' : 'live')}
      <p class="bf-kicker">${e(title)}</p><h1>${heading}</h1><p>${summary}</p>
    </div>
    ${waiting ? `<div class="bf-display__waiting"><p>${e(match.scheduledLabel || MODES[match.mode] || 'Wedstrijd')}</p><strong>${waitingNames.map(e).join(' · ')}</strong></div>` : ''}
    ${qr(ctx, id, false, waiting ? 'Scan om mee te spelen' : 'Open deze baan met je telefoon')}
  </section>`;
}

function live(ctx, state, title) {
  const e = ctx.escape;
  const m = state.match;
  const active = m.players[m.turn];
  const writer = m.players.find(p => p.id === m.writerId);
  const rule = m.settings;
  const both = m.players.length === 2;
  const visit = m.lastVisit;
  const lastHighlight = visit?.checkout ? `Finish · ${Number(visit.score)}` : visit?.score === 180 && !visit.bust ? 'Laatste beurt · 180!' : '';
  return `<section class="bf-display__main bf-display__main--live">
    <div class="bf-display__live-head">
      <div><p class="bf-kicker">${e(m.scheduledLabel || MODES[m.mode] || 'Wedstrijd')}</p><h1 class="bf-display__board-title">${e(title)}</h1></div>
      ${pill('Live', ctx.online() ? 'live' : '')}
    </div>
    <div class="bf-display__rules" aria-label="Wedstrijdformaat">
      <span>${Number(rule.startScore)} · dubbel uit</span>
      ${both ? `<span>${bestOf(rule.bestOfLegs, 'leg', 'legs')}${rule.bestOfSets > 1 ? ' per set' : ''}</span>` : ''}
      ${both && rule.bestOfSets > 1 ? `<span>${bestOf(rule.bestOfSets, 'set', 'sets')}</span>` : ''}
    </div>
    <div class="bf-display__scoreboard${both ? '' : ' bf-display__scoreboard--solo'}" aria-label="Resterende score">
      ${m.players.map((p, index) => `<article class="bf-display__scorecard${m.turn === index ? ' is-turn' : ''}">
        <h2>${e(p.name)}</h2>
        <span class="bf-display__score">${m.remaining[index] ?? '–'}</span>
        <span class="bf-display__turn">${m.turn === index ? '● Aan de beurt' : 'Resterend'}</span>
      </article>`).join('')}
    </div>
    ${scorecard(ctx, m)}
    <div class="bf-display__live-details${m.checkout ? ' has-finish' : ''}">
      <div class="bf-display__tallies" aria-label="Set- en legstand">
        ${both && rule.bestOfSets > 1 ? tally(m.sets, 'Sets', both) : ''}
        ${tally(m.legs, both ? 'Legs' : 'Legs gespeeld', both)}
      </div>
      ${m.checkout ? `<aside class="bf-display__finish"><div><p class="bf-kicker">Finishsuggestie</p><small>${e(active?.name || '')}</small></div><strong>${e(m.checkout)}</strong></aside>` : ''}
    </div>
    <div class="bf-display__bottom"><p>${lastHighlight ? `<strong class="bf-display__highlight">${lastHighlight}</strong>` : ''}${writer ? `<strong>${e(writer.name)}</strong> voert de score in.` : 'Score-invoer via je telefoon.'}</p>${qr(ctx, state.id, true, 'Open deze baan op je telefoon')}</div>
  </section>`;
}

function scorecard(ctx, match) {
  const e = ctx.escape;
  const columns = match.players.map((_, index) => (match.currentLegVisits || []).filter(visit => visit.playerIndex === index));
  const rounds = Math.max(0, ...columns.map(column => column.length));
  const hidden = Math.max(0, rounds - 8);
  const game = match.settings;
  const leg = match.legNumber ?? (match.legs[0] || 0) + (match.legs[1] || 0) + 1;
  const set = match.setNumber ?? (match.sets[0] || 0) + (match.sets[1] || 0) + 1;

  return `<section class="bf-scorecard" aria-label="Scorekaart van de huidige leg">
    <header class="bf-scorecard__header"><h2>Scorekaart</h2><p>${game.bestOfSets > 1 ? `Set ${Number(set)} · ` : ''}Leg ${Number(leg)}</p></header>
    ${hidden ? `<p class="bf-scorecard__earlier">${hidden === 1 ? '1 eerdere speelronde' : `${hidden} eerdere speelrondes`}</p>` : ''}
    <div class="bf-scorecard__columns${columns.length === 1 ? ' bf-scorecard__columns--solo' : ''}">
      ${columns.map((visits, player) => `<table class="bf-scorecard__table" aria-label="${e(match.players[player].name)} · huidige leg">
        <thead><tr><th scope="col">Gegooid</th><th scope="col">Resterend</th></tr></thead>
        <tbody>
          <tr class="bf-scorecard__start"><td>Start</td><td>${Number(game.startScore)}</td></tr>
          ${Array.from({length: rounds - hidden}, (_, visible) => {
            const visit = visits[hidden + visible];
            if (!visit) return '<tr class="bf-scorecard__empty"><td>–</td><td>–</td></tr>';
            return `<tr${visit.bust ? ' class="bf-scorecard__bust"' : ''}>
              <td>${Number(visit.score)}${visit.bust ? ' <small>Bust</small>' : ''}</td>
              <td>${Number(visit.remainingAfter)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`).join('')}
    </div>
  </section>`;
}

function tally(scores, label, both) {
  return `<div class="bf-display__tally${both ? '' : ' bf-display__tally--solo'}"><strong>${scores?.[0] ?? 0}</strong><span>${label}</span>${both ? `<strong>${scores?.[1] ?? 0}</strong>` : ''}</div>`;
}

function result(ctx, state, title) {
  const e = ctx.escape;
  const m = state.match;
  const winner = m.players.find(p => p.id === m.winnerId);
  const both = m.players.length === 2;
  const setMatch = m.settings.bestOfSets > 1;
  const needsConfirmation = m.mode === 'scheduled' && !m.resultPublished;
  const fixtureClosed = m.mode === 'scheduled' && m.resultPublished && ctx.query?.('scheduled') === '1';
  const score = setMatch ? m.sets : m.legs;
  const stat = (label, key) => `<div class="bf-display__stat-row${both ? '' : ' bf-display__stat-row--solo'}">
    <strong>${m.stats?.[0]?.[key] == null ? '–' : formatNumber(m.stats[0][key])}</strong><span>${label}</span>
    ${both ? `<strong>${m.stats?.[1]?.[key] == null ? '–' : formatNumber(m.stats[1][key])}</strong>` : ''}
  </div>`;
  return `<section class="bf-display__main">
    <div class="bf-display__headline">${pill(needsConfirmation ? 'Uitslag bevestigen' : 'Afgerond')}<p class="bf-kicker">${e(title)} · ${e(m.scheduledLabel || MODES[m.mode] || 'Wedstrijd')}</p>
      <h1>${winner && both ? `<em>${e(firstName(winner.name))}</em> wint.` : 'Partij <em>afgerond.</em>'}</h1>
      <p>${m.players.map(p => e(p.name)).join(' tegen ')}</p>
    </div>
    ${both ? `<div class="bf-display__result-score">${score?.[0] ?? 0} – ${score?.[1] ?? 0}</div>` : ''}
    <div class="bf-display__stats" aria-label="Wedstrijdstatistieken">
      ${stat('3-dartsgemiddelde', 'average')}
      ${stat('Hoogste finish', 'highestFinish')}
      ${stat('180’s', 'oneEighties')}
    </div>
    <div class="bf-display__bottom"><p>${needsConfirmation ? 'Beide spelers bevestigen de uitslag op hun telefoon.' : fixtureClosed ? 'Uitslag bevestigd. De wedstrijdleiding roept de volgende partij op.' : 'Volgende speler? <strong>Scan deze baan.</strong>'}</p>${fixtureClosed ? '' : qr(ctx, state.id, true, 'Open deze baan op je telefoon')}</div>
  </section>`;
}

export function renderBaanScreen(ctx) {
  const state = ctx.state();
  const id = state?.id || ctx.demoId();
  const title = ctx.query?.('boardTitle')?.slice(0, 45) || state?.title || 'Baan 1';
  const e = ctx.escape;
  const online = ctx.online();
  const fixture = ctx.query?.('scheduled') === '1';
  const scheduledPreview = fixture ? {
    mode: 'scheduled',
    scheduledLabel: ctx.query('name')?.slice(0, 65),
    players: [ctx.query('first'), ctx.query('opponent')].filter(Boolean).map(name => ({name: name.slice(0, 40)})),
  } : null;
  const body = state?.status === 'live' && state.match ? live(ctx, state, title) :
    state?.status === 'result' && state.match ? result(ctx, state, title) :
    state?.status === 'idle' && fixture && state.officialResult ? result(ctx, {...state, match:state.officialResult}, title) :
    intro(ctx, id, title, state?.status === 'waiting' ? state.match : scheduledPreview, !state);
  return `<main id="baan-screen" class="bf-display" aria-label="Dartflow baanscherm">
    <div class="bf-display__frame"><div class="bf-display__content">
      <header class="bf-display__top">${logo}${club(e, ctx.query?.('venue')?.slice(0, 40) || state?.venue || 'Duindorp SV')}</header>
      ${body}
      <footer class="bf-display__foot">
        <span>${online ? 'Dartflow · Baanmodus' : pill(state ? 'Verbinding onderbroken' : 'Verbinden', state ? 'offline' : '')}</span>
        <div class="bf-display__foot-actions">
          <a href="${e(ctx.url('hub', id))}">Terug</a>
          <button type="button" class="bf-display__fullscreen" data-action="baan-fullscreen" aria-label="Volledig scherm" title="Volledig scherm">${icon('fullscreen')}</button>
        </div>
      </footer>
    </div></div>
  </main>`;
}
