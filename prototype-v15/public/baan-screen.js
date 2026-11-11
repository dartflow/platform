
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
const firstName = name => String(name || '').split(' ')[0];
const numberFormat = new Intl.NumberFormat('nl-NL', {maximumFractionDigits: 1});
const formatNumber = number => numberFormat.format(number);
const bestOf = (n, singular, plural) => `Best of ${Number(n)} ${Number(n) === 1 ? singular : plural}`;
const headLabel = s => s === 'live' ? 'Live' : s === 'result' ? 'Uitslag' : s === 'waiting' ? 'Gereserveerd' : 'Vrij';

function club(escape, name = 'Duindorp SV') {
  const initials = name === 'Duindorp SV' ? 'DSV' : name.split(/\s+/).map(word => word[0]).join('').slice(0, 3).toUpperCase();
  return `<div class="bf-club"><span class="bf-club__mark" aria-hidden="true">${escape(initials)}</span><span class="bf-club__label"><b>${escape(name)}</b><small>Op locatie</small></span></div>`;
}

function pill(text, status) {
  return `<span class="bf-pill${status ? ` bf-pill--${status}` : ''}">${text}</span>`;
}

function actionLink(escape, label, url, iconName, primary = false, external = false) {
  return `<a class="bf-btn${primary ? ' bf-btn--primary' : ''}" href="${escape(url)}"${external ? ' target="_blank" rel="noopener"' : ''}>${iconName ? icon(iconName) : ''}${label}</a>`;
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
        <p class="bf-kicker">DartFlow op locatie · 9:16</p>
        <h1 id="bf-hub-title">Scan en <em>speel.</em></h1>
        <p>Iedere dartbaan heeft een eigen QR. Spelers voeren beurten in op hun telefoon. Sprint toont de stand en de scorekaart live op het baanscherm.</p>
        <div class="bf-hub__hero-cta">
          ${actionLink(e, 'Open Sprint-baanscherm', demoScreen, 'screen', true, true)}
          ${actionLink(e, 'Open telefoon 1', demoPhone, 'phone', false, true)}
        </div>
      </div>
      ${club(e)}
    </section>
    <section class="df-workspace__section" aria-labelledby="bf-board-picker">
      <div class="bf-hub__panel-head">
        <div><p class="bf-kicker">Sprint · Baanmodus</p><h2 id="bf-board-picker">Kies je baanscherm</h2></div>
        ${pill('Live tussen apparaten', 'live')}
      </div>
      <div class="df-workspace__grid df-workspace__grid--2">
        <article class="df-workspace__panel bf-hub__board">
          <header><div><p class="bf-kicker">Eigen testbaan</p><h3>Probeer met twee telefoons</h3></div>${demoState ? pill(headLabel(demoState), demoState === 'live' ? 'live' : '') : ''}</header>
          <p>Open Sprint op een scherm en verbind beide telefoons met deze testbaan. Na het starten van de partij zie je op de telefoon de invoer en de resterende scores.</p>
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
          <li><strong>Open het Sprint-baanscherm.</strong> Scan de QR met twee telefoons of open hierboven de twee telefoonweergaven.</li>
          <li><strong>Start een lokale partij.</strong> Speler 1 kiest de spelregels. Speler 2 opent dezelfde baan en bevestigt de partij.</li>
          <li><strong>Gooi en voer in.</strong> Speler 1 schrijft. Speler 2 kan via <em>Invoer overnemen</em> direct verdergaan. Sprint werkt de stand en de scorekaart bij.</li>
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

function sprintPlayer(ctx, player, stats) {
  const e = ctx.escape;
  const parts = player.name.trim().split(/\s+/).map(word => Array.from(word));
  const initials = parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0].slice(0, 2).join('');
  return `<div class="sprint-player">
    <span class="sprint-avatar" aria-hidden="true">${e(initials.toUpperCase())}</span>
    <h2 class="sprint-player-name" title="${e(player.name)}">${e(player.name)}</h2>
    <dl class="sprint-stats">
      <div><dt title="3-dartsgemiddelde">AVG</dt><dd>${formatNumber(stats?.average ?? 0)}</dd></div>
      <div><dt title="Hoogste finish">H. FIN</dt><dd>${stats?.highestFinish || '–'}</dd></div>
      <div><dt>180’s</dt><dd>${stats?.oneEighties ?? 0}</dd></div>
    </dl>
  </div>`;
}

function sprintScorecard(ctx, match) {
  const e = ctx.escape;
  const [left, right] = match.players.map((_, index) => match.currentLegVisits.filter(visit => visit.playerIndex === index));
  const columns = right ? [left, right] : [left];
  const roundCount = Math.max(...columns.map(column => column.length));
  const start = Number(match.settings.startScore);
  const rows = Array.from({length: Math.max(5, roundCount)}, (_, index) => {
    const cells = columns.map((column, side) => {
      const visit = column[index];
      const score = visit ? Number(visit.score) : '';
      const thrown = `<td class="sprint-throw"${visit?.bust ? ` data-bust="true" aria-label="${score}, bust"` : ''}>${score}</td>`;
      const rest = `<td class="sprint-rest"${visit && index === column.length - 1 ? ' data-latest="true"' : ''}>${visit ? Number(visit.remainingAfter) : ''}</td>`;
      return side === 0 ? thrown + rest : rest + thrown;
    }).join('');
    return `<tr${index >= roundCount ? ' aria-hidden="true"' : ''}>${cells}</tr>`;
  }).join('');
  const leftName = e(match.players[0].name);
  const rightName = right ? e(match.players[1].name) : '';
  return `<section class="sprint-countdown" aria-labelledby="sprint-scorecard-title">
    <header class="sprint-card-heading">
      <h2 id="sprint-scorecard-title">Scorekaart</h2><p>Set ${Number(match.setNumber)} · Leg ${Number(match.legNumber)}</p>
    </header>
    <div class="sprint-scroll" tabindex="0" role="region" aria-label="Beurten in deze leg" data-sprint-scroll>
      <table class="sprint-table" aria-label="Scorekaart van ${leftName}${right ? ` en ${rightName}` : ''}">
        <colgroup><col class="sprint-col-throw"><col class="sprint-col-rest">${right ? '<col class="sprint-col-rest"><col class="sprint-col-throw">' : ''}</colgroup>
        <thead>
          <tr class="sprint-labels"><th scope="col" aria-label="Worp ${leftName}">Worp</th><th scope="col" aria-label="Rest ${leftName}">Rest</th>${right ? `<th scope="col" aria-label="Rest ${rightName}">Rest</th><th scope="col" aria-label="Worp ${rightName}">Worp</th>` : ''}</tr>
          <tr class="sprint-start"><td>–</td><td>${start}</td>${right ? `<td>${start}</td><td>–</td>` : ''}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function sprintLive(ctx, state, title, venue) {
  const e = ctx.escape;
  const m = state.match;
  const solo = m.players.length === 1;
  const rule = m.settings;
  const multiSets = rule.bestOfSets > 1;
  const active = m.players[m.turn];
  const writer = m.players.find(player => player.id === m.writerId);
  const visit = m.lastVisit;
  const online = ctx.online();
  const format = `${Number(rule.startScore)} · Dubbel uit · ${bestOf(rule.bestOfLegs, 'leg', 'legs')}${multiSets ? ` per set · ${bestOf(rule.bestOfSets, 'set', 'sets')}` : ''}`;
  const insightLabel = m.checkout ? 'Finishroute' : visit?.checkout ? 'Leg uitgespeeld' : visit?.score === 180 ? 'Maximum' : 'Laatste beurt';
  const insightValue = m.checkout || (visit ? `${Number(visit.score)} punten${visit.bust ? ' · bust' : ''}` : 'Nog geen worpen');
  const insightMeta = m.checkout ? `${Number(m.remaining[m.turn])} uit` : m.players[visit?.playerIndex]?.name || '';
  return `<main id="baan-screen" class="bf-display sprint-display" aria-label="DartFlow Sprint-baanscherm">
    <div class="bf-display__frame sprint-frame">
      <section class="sprint-board" data-solo="${solo}" aria-label="Sprint live scorebord">
        <header class="sprint-head">
          <div class="sprint-top">
            <img src="/assets/dartflow-logo.svg" alt="DartFlow" width="1916" height="496">
            <h1 title="${e(title)}">${e(title)}</h1>
            <span class="sprint-status" data-online="${online}">${online ? 'Live' : 'Offline'}</span>
          </div>
          <div class="sprint-context"><span>${e(m.scheduledLabel || MODES[m.mode] || 'Wedstrijd')}</span><span>${e(venue)}</span></div>
        </header>
        <div class="sprint-roster">
          ${m.players.map((player, index) => sprintPlayer(ctx, player, m.stats?.[index])).join('')}
        </div>
        <div class="sprint-scores" aria-label="Resterende score">
          ${m.players.map((player, index) => `<div class="sprint-score" data-active="${index === m.turn}" aria-label="${e(player.name)}">
            <span class="sprint-caption">Resterend</span>
            <strong class="sprint-number">${Number(m.remaining[index])}</strong>
            <span class="sprint-turn">${index === m.turn ? '● Aan de beurt' : 'Wacht'}</span>
          </div>`).join('')}
        </div>
        ${sprintScorecard(ctx, m)}
        <div class="sprint-tally" aria-label="Set- en legstand">
          ${m.players.map((player, index) => `${index === 1 ? '<span class="sprint-vs" aria-hidden="true">VS</span>' : ''}
            <div class="sprint-tally-side" aria-label="${e(player.name)}">
              <span><b>${Number(m.legs[index])}</b> ${solo ? 'Legs gespeeld' : 'Legs'}</span>
              ${multiSets ? `<span><b>${Number(m.sets[index])}</b> Sets</span>` : ''}
            </div>`).join('')}
        </div>
        <aside class="sprint-insight" aria-label="Laatste wedstrijdinformatie">
          <span>${insightLabel}</span><strong>${e(insightValue)}</strong><small title="${e(insightMeta)}">${e(insightMeta)}</small>
        </aside>
        <footer class="sprint-foot">
          <div class="sprint-foot-copy">
            <p class="sprint-format">${format}</p>
            <p class="sprint-writer" title="${e(writer?.name || '')}">${writer ? `<strong>${e(writer.name)}</strong> voert in` : 'Invoer via telefoon'}${active ? ` · ${e(firstName(active.name))} gooit` : ''}</p>
          </div>
          <div class="bf-display__foot-actions">
            <a href="${e(ctx.url('hub', state.id))}">Terug</a>
            ${fullscreen()}
          </div>
          ${qr(ctx, state.id, true, 'Open de score-invoer op je telefoon')}
        </footer>
      </section>
    </div>
  </main>`;
}

function fullscreen() {
  return `<button type="button" class="bf-display__fullscreen" data-action="baan-fullscreen" aria-label="Volledig scherm" title="Volledig scherm">${icon('fullscreen')}</button>`;
}

export function afterSprintRender(root) {
  const scorecard = root.querySelector('[data-sprint-scroll]');
  if (scorecard) scorecard.scrollTop = scorecard.scrollHeight;
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
  const venue = ctx.query?.('venue')?.slice(0, 40) || state?.venue || 'Duindorp SV';
  const e = ctx.escape;
  const online = ctx.online();
  const fixture = ctx.query?.('scheduled') === '1';
  const scheduledPreview = fixture ? {
    mode: 'scheduled',
    scheduledLabel: ctx.query('name')?.slice(0, 65),
    players: [ctx.query('first'), ctx.query('opponent')].filter(Boolean).map(name => ({name: name.slice(0, 40)})),
  } : null;
  if (state?.status === 'live' && state.match) return sprintLive(ctx, state, title, venue);
  const body = state?.status === 'result' && state.match ? result(ctx, state, title) :
    state?.status === 'idle' && fixture && state.officialResult ? result(ctx, {...state, match:state.officialResult}, title) :
    intro(ctx, id, title, state?.status === 'waiting' ? state.match : scheduledPreview, !state);
  return `<main id="baan-screen" class="bf-display" aria-label="DartFlow baanscherm">
    <div class="bf-display__frame"><div class="bf-display__content">
      <header class="bf-display__top">
        <img class="bf-logo" src="/assets/dartflow-logo.svg" alt="DartFlow" width="1916" height="496">
        ${club(e, venue)}
      </header>
      ${body}
      <footer class="bf-display__foot">
        <span>${online ? 'DartFlow · Baanmodus' : pill(state ? 'Verbinding onderbroken' : 'Verbinden', state ? 'offline' : '')}</span>
        <div class="bf-display__foot-actions">
          <a href="${e(ctx.url('hub', id))}">Terug</a>
          ${fullscreen()}
        </div>
      </footer>
    </div></div>
  </main>`;
}
