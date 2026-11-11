
const phoneIcons = {
  target: 'M22 12a10 10 0 1 1-10-10m-2 2 9 1-1 9M20 4l-8 8m1-6a6 6 0 1 0 5 5',
  user: 'M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4m-2-12a4 4 0 0 1 0 8m-4-4a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM2 12h20M12 2c5 6 5 14 0 20-5-6-5-14 0-20Z',
  trophy: 'M8 3h8v8a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 3v6m-4 0h8',
  right: 'm9 5 7 7-7 7',
  left: 'm15 5-7 7 7 7',
  check: 'm4 12 5 5L20 6',
  pencil: 'm15 4 5 5M4 20l1-6L17 2l5 5L10 19Z',
  transfer: 'M3 8h17m-5-5 5 5-5 5M21 16H4m5-5-5 5 5 5',
  undo: 'M3 4v6h6M3 10a9 9 0 1 1 1 8',
  copy: 'M8 8h13v13H8ZM3 16V3h13',
  monitor: 'M2 3h20v14H2ZM8 21h8m-4-4v4',
  clock: 'M12 7v5l3 3m7-3a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  history: 'M3 12a9 9 0 1 1 3 7m-3-2v-5h5m4-5v5l3 2',
  remove: 'M7 6h14v12H7l-5-6Zm3 3 6 6m0-6-6 6',
  wifi: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a5 5 0 0 1 8 0m-4 4h.01',
};
const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${phoneIcons[name] || phoneIcons.target}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character]));
const eq = (left, right) => left != null && right != null && String(left) === String(right);
const firstName = player => String(player?.name || 'Speler').split(' ')[0];
const nameKey = name => String(name || '').trim().normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
const names = {practice: 'Oefenpartij', local: 'Lokale wedstrijd', remote: 'Online wedstrijd', scheduled: 'Geplande wedstrijd'};
const button = (label, action, style = 'ghost', attributes = '') => `<button class="bf-btn bf-btn--${style}" type="button" data-action="baan-phone-${action}" ${attributes}>${label}</button>`;

function statusStrip(label, title, detail = '', iconName = 'target') {
  return `<div class="bf-phone-status"><span class="bf-phone-status-icon">${icon(iconName)}</span><div><small>${label}</small><strong>${title}</strong>${detail ? `<p>${detail}</p>` : ''}</div></div>`;
}

function playerTag(player, index, isTurn, remaining, legs, sets, compact = false) {
  const avatar = (player?.name || '?').trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
  return `<article class="bf-phone-player-score${isTurn ? ' is-turn' : ''}" aria-label="${esc(player?.name || 'Speler ' + (index + 1))}${isTurn ? ' aan de beurt' : ''}">
    <div class="bf-phone-player-title">${compact ? '' : `<span class="bf-phone-avatar">${esc(avatar)}</span>`}<strong>${esc(player?.name || 'Speler ' + (index + 1))}</strong></div>
    <span class="bf-phone-score">${remaining ?? '—'}</span>
    <small>${isTurn ? 'AAN DE BEURT' : 'RESTEREND'}</small>
    ${legs != null ? `<span class="bf-phone-score-meta">${legs} ${legs === 1 ? 'leg' : 'legs'}${sets != null ? ` · ${sets} ${sets === 1 ? 'set' : 'sets'}` : ''}</span>` : ''}
  </article>`;
}

function scheduledRequest() {
  const hashQuery = new URLSearchParams((globalThis.location?.hash || '').split('?')[1] || '');
  const searchQuery = new URLSearchParams(globalThis.location?.search || '');
  const value = key => hashQuery.get(key) || searchQuery.get(key) || '';
  if (value('scheduled') !== '1') return {};
  return {scheduled: true, first: value('first'), opponent: value('opponent'), name: value('name'), boardTitle: value('boardTitle'), venue: value('venue'), startScore: Number(value('startScore')), bestOfLegs: Number(value('bestOfLegs')), second: value('device') === '2'};
}

function modeTile(mode, iconName, heading, detail, meta = '') {
  return `<button type="button" class="bf-phone-mode" data-action="baan-phone-mode" data-mode="${mode}">
    <span class="bf-phone-mode-icon">${icon(iconName)}</span><span class="bf-phone-mode-text">${meta ? `<small>${meta}</small>` : ''}<strong>${heading}</strong><span>${detail}</span></span><span class="bf-phone-chevron">${icon('right')}</span>
  </button>`;
}

export function createBaanPhone(ctx) {
  let selectedMode = '';
  let setup = {startScore: 501, bestOfLegs: 3, bestOfSets: 1};
  let draft = '';
  let darts = 3;
  let notice = '';
  let problem = '';
  let busy = false;
  let pendingDouble = null;
  let confirmingTakeover = false;
  let confirmingCancel = false;
  let matchKey = '';
  let previousWriter = '';
  let scorePosition = '';
  let historyOpen = false;
  let profileDraft = '';

  const board = () => ctx.state();
  const me = () => ctx.actor();
  const match = () => board()?.match;
  const playerIndex = () => match()?.players.findIndex(player => eq(player?.id, me()?.id)) ?? -1;
  const writer = () => !!match() && eq(match().writerId, me()?.id);
  const enabled = () => !busy && ctx.online();
  const inactive = () => enabled() ? '' : 'disabled';
  const format = settings => `${settings?.startScore || 501} · Dubbel uit · Best of ${settings?.bestOfLegs || 1} legs${settings?.bestOfSets > 1 ? ` per set · Best of ${settings.bestOfSets} sets` : ''}`;
  const status = () => `${ctx.online() ? '<i></i> Live verbonden' : 'Verbinding herstellen…'}`;
  const screenLink = state => ctx.url('screen', state.id, Object.fromEntries(['boardTitle', 'venue'].map(key => [key, ctx.query?.(key)]).filter(([,value]) => value)));

  function syncMatch(state) {
    const current = `${state?.id || ''}:${state?.match?.id || ''}`;
    const currentMatch = state?.match;
    const currentPosition = JSON.stringify([currentMatch?.turn, currentMatch?.remaining, currentMatch?.legs, currentMatch?.sets, currentMatch?.lastVisit]);
    const currentWriter = `${currentMatch?.writerId || ''}:${currentMatch?.writerChangedAt || ''}`;
    const matchChanged = matchKey !== current;
    const writerChanged = previousWriter !== currentWriter;
    if (matchChanged || writerChanged || scorePosition !== currentPosition) {
      draft = '';
      darts = 3;
      pendingDouble = null;
      scorePosition = currentPosition;
    }
    if (matchChanged || writerChanged) {
      confirmingTakeover = false;
      confirmingCancel = false;
      if (matchChanged) selectedMode = '';
      matchKey = current;
      previousWriter = currentWriter;
    }
  }

  function feedback(compact = false) {
    return `${problem ? `<div class="bf-phone-feedback is-error" role="alert">${esc(problem)}</div>` : ''}${notice ? `<div class="${compact ? 'bf-phone-a11y' : 'bf-phone-feedback'}" role="status">${esc(notice)}</div>` : ''}${!ctx.online() && board() ? `<div class="bf-phone-feedback is-error" role="status">${compact ? 'Je ziet de laatst ontvangen stand. Invoer komt terug zodra de verbinding herstelt.' : 'De laatst ontvangen stand blijft zichtbaar. Wacht op verbinding om scores in te voeren of over te nemen.'}</div>` : ''}`;
  }

  function header(state) {
    return `<header class="bf-phone-head">
      <a class="bf-phone-brand" href="#home" aria-label="DartFlow-overzicht"><img src="/assets/dartflow-logo.svg" alt="DartFlow" width="1916" height="496"></a>
      <span class="bf-phone-live${ctx.online() ? ' is-online' : ''}" role="status">${status()}</span>
    </header>
      <div class="bf-phone-context"><div><span class="bf-phone-kicker">${esc(state?.venue || scheduledRequest().venue || 'DARTFLOW BAANMODUS')}</span><strong>${esc(state?.title || scheduledRequest().boardTitle || 'Baanmodus')}</strong></div>${state ? `<a class="bf-btn bf-btn--ghost bf-phone-screen-link" href="${esc(screenLink(state))}" target="_blank" rel="noopener" aria-label="Open het zaalscherm in een nieuw tabblad">${icon('monitor')} <span>Zaalscherm</span></a>` : ''}</div>`;
  }

  function hero(kicker, title, detail) {
    return `<section class="bf-phone-hero"><span class="bf-phone-kicker">${kicker}</span><h1 class="bf-phone-title">${title}</h1><p>${detail}</p></section>`;
  }

  function profile() {
    const invite = ctx.inviteToken();
    const request = scheduledRequest();
    const expectedName = request.second ? request.opponent : request.first;
    return `${hero(invite ? 'UITNODIGING GEOPEND' : 'BAAN GEOPEND', invite ? 'Speel je mee?' : 'Jouw volgende leg.', 'Open je spelerprofiel en ga verder op deze baan. Je voortgang blijft bewaard op dit toestel.')}
      <section class="bf-phone-panel"><h2>Jouw spelersnaam</h2><p>Vul een naam in voor je demoprofiel. Dat profiel gebruiken we voor je wedstrijdhistorie.</p>
        <form class="bf-phone-form" data-form="baan-phone-profile">
          <label class="bf-phone-field">Naam<input name="name" autocomplete="nickname" minlength="2" maxlength="40" required value="${esc(profileDraft || expectedName)}" placeholder="Bijvoorbeeld Sam"></label>
          <button type="submit" class="bf-btn bf-btn--primary" ${inactive()}>${icon('user')} Open mijn profiel</button>
        </form>
      </section>`;
  }

  function playerStrip() {
    return `<div class="bf-phone-account"><span>${icon('user')} <span>Je speelt als <strong>${esc(me()?.name)}</strong></span></span>${playerIndex() === -1 || board()?.status === 'result' ? button('Wisselen', 'logout', 'ghost') : ''}</div>`;
  }

  function setupFields() {
    const select = (name, label, values, display = value => value) => `<label class="bf-phone-field">${label}<select name="${name}">${values.map(value => `<option value="${value}" ${Number(setup[name]) === value ? 'selected' : ''}>${display(value)}</option>`).join('')}</select></label>`;
    return `<div class="bf-phone-form-grid">${select('startScore', 'Startscore', [501, 301, 701])}${select('bestOfLegs', 'Legs per set', [1, 3, 5, 7, 9], value => 'Best of ' + value)}${select('bestOfSets', 'Sets', [1, 3, 5], value => value === 1 ? '1 set' : 'Best of ' + value)}</div>`;
  }

  function idle() {
    if (ctx.inviteToken()) return `${hero('UITNODIGING', 'Geen open uitnodiging.', 'Vraag de organisator van de partij om een nieuwe link. Vanuit dit scherm kun je zelf een wedstrijd starten.')}<a class="bf-btn bf-btn--primary" href="${esc(ctx.url('phone', board().id))}">${icon('left')} Spel kiezen</a>`;
    if (selectedMode) {
      const start = {practice: 'Oefenpartij starten', local: 'Wachtplek openen', remote: 'Uitnodiging aanmaken', scheduled: 'Geplande partij klaarzetten'};
      const detail = {practice: 'Speel X01 solo. Je sessie verschijnt in je persoonlijke oefenhistorie.', local: 'Na het klaarzetten scant je tegenstander de QR op hetzelfde scherm en bevestigt de spelregels.', remote: 'Deel de persoonlijke uitnodigingslink met je tegenstander. De partij begint zodra die de spelregels bevestigt.', scheduled: 'Zet de geplande partij op dit bord klaar. De tweede speler scant dezelfde QR en meldt zich met de naam uit de planning.'};
      return `${hero('WEDSTRIJD INSTELLEN', names[selectedMode], detail[selectedMode])}<section class="bf-phone-panel"><h2>Spelregels</h2><form class="bf-phone-form" data-form="baan-phone-start">${setupFields()}<p>Een leg eindigt op een dubbel.</p><button type="submit" class="bf-btn bf-btn--primary" ${inactive()}>${icon('target')} ${start[selectedMode]}</button>${button(`${icon('left')} Andere spelvorm`, 'back', 'ghost')}</form></section>`;
    }
    const request = scheduledRequest();
    if (request.scheduled) {
      const canPrepare = !request.first || nameKey(request.first) === nameKey(me()?.name);
      return `${hero('GEPLANDE PARTIJ', esc(request.name || 'Wedstrijd op afspraak.'), canPrepare ? 'Controleer de gegevens en zet de geplande partij klaar voor de tweede speler.' : `Wacht tot ${esc(request.first)} deze partij klaarzet. Deze pagina gaat vanzelf verder zodra de reservering verschijnt.`)}${canPrepare ? modeTile('scheduled', 'trophy', 'Partij klaarzetten', 'Bekijk de wedstrijdvorm en open de bordoproep.') : ''}`;
    }
    return `${hero('VRIJE BAAN', 'Wat gaan we spelen?', 'Kies een spelvorm. Zodra de partij begint, toont het baanscherm jullie actuele stand.')}
      <div class="bf-phone-mode-list">
        ${modeTile('practice', 'target', 'Oefenpartij', 'Speel solo en bewaar je oefenstatistieken.', 'TRAINING')}
        ${modeTile('local', 'users', 'Lokale wedstrijd', 'Je tegenstander scant dezelfde QR op de baan.', 'SAMEN AAN DE BAAN')}
        ${modeTile('remote', 'globe', 'Online wedstrijd', 'Nodig een speler uit die op afstand gooit.', 'SPEEL OP AFSTAND')}
      </div>`;
  }

  function waiting(state, current, index) {
    const joined = index >= 0;
    const owner = index === 0;
    const accepted = current.accepted?.[index];
    const opponentsReady = current.players.length >= 2 && current.players.filter(Boolean).length >= 2;
    const remote = current.mode === 'remote';
    const scheduled = current.mode === 'scheduled';
    const invitation = ctx.inviteToken();
    const invitationUrl = owner && current.inviteToken ? ctx.url('phone', state.id, {invite: current.inviteToken}) : null;
    const demoInviteUrl = invitationUrl && remote && state.id.startsWith('demo-')
      ? ctx.url('phone', state.id, {invite: current.inviteToken, device: ctx.query?.('device') === '2' ? 1 : 2}) : '';
    const ownerName = esc(firstName(current.players[0]));
    const scheduledCanJoin = (!current.inviteRequired || !!invitation) && (!current.scheduledOpponent || nameKey(current.scheduledOpponent) === nameKey(me()?.name));
    const remoteCanJoin = !!invitation;
    let details = `${ownerName} staat klaar op deze baan. Bekijk de spelregels en doe mee.`;
    if (joined && (opponentsReady || scheduled)) {
      details = accepted ? 'Jij bent klaar. De wedstrijd start zodra de tweede speler de spelregels bevestigt.' : 'Controleer de spelregels en meld je klaar op je telefoon.';
    } else if (joined) {
      details = remote ? 'Deel de wedstrijdlink met je tegenstander. Die tikt na deelname op Ik ben klaar.' : 'Laat je tegenstander de QR op het baanscherm scannen en de spelregels bevestigen.';
    } else if (scheduled) {
      details = scheduledCanJoin ? 'Meld je bij deze geplande wedstrijd en bevestig je aanwezigheid.' : `Deze baan wacht op ${esc(current.scheduledOpponent)}.`;
    } else if (remote && !remoteCanJoin) {
      details = 'Vraag je tegenstander om de wedstrijdlink om deel te nemen.';
    }
    return `${hero(names[current.mode] || 'WEDSTRIJD', scheduled ? 'Jouw bordoproep.' : joined ? (opponentsReady ? 'Klaar om te gooien?' : 'Wachten op je tegenstander.') : `Meedoen met ${ownerName}?`, details)}
      <section class="bf-phone-panel"><span class="bf-phone-kicker">AFGESPROKEN SPELVORM</span><h2>${format(current.settings)}</h2>
        ${current.players.map((player, position) => player ? statusStrip(`SPELER ${position + 1}`, esc(player.name), current.accepted?.[position] ? 'Klaar' : 'Wacht op akkoord', 'user') : '').join('')}
        ${invitationUrl && !opponentsReady ? `<div class="bf-phone-invite"><label class="bf-phone-field">Wedstrijdlink<input readonly value="${esc(invitationUrl)}" aria-label="Wedstrijdlink"></label><div class="bf-phone-actions">${button(`${icon('copy')} Kopieer uitnodiging`, 'copy-invite', 'ghost')}${demoInviteUrl ? `<a class="bf-btn bf-btn--ghost" href="${esc(demoInviteUrl)}" target="_blank" rel="noopener">${icon('users')} Test als tegenstander</a>` : ''}</div></div>` : ''}
        <div class="bf-phone-actions">${joined && (opponentsReady || scheduled) && !accepted ? button(`${icon('check')} Ik ben klaar`, 'accept', 'primary', inactive()) : joined && accepted ? '<span class="bf-phone-chip">✓ Jij bent klaar</span>' : ''}
          ${!joined && (!remote || remoteCanJoin) && (!scheduled || scheduledCanJoin) && !opponentsReady ? button(`${icon('users')} ${scheduled ? 'Meld mij bij deze partij' : 'Doe mee'}`, 'join', 'primary', inactive()) : ''}
          ${owner ? button(scheduled ? 'Reservering intrekken' : 'Uitnodiging intrekken', 'cancel', 'ghost', inactive()) : ''}</div>
      </section>`;
  }

  function scoreboard(current, index) {
    const checkout = Array.isArray(current.checkout) ? current.checkout[current.turn] : current.checkout;
    return `<section class="bf-phone-panel bf-phone-match" aria-label="Actuele stand"><span class="bf-phone-kicker">${esc(current.scheduledLabel || names[current.mode])}</span><p class="bf-phone-metadata">${format(current.settings)}</p>
      <div class="bf-phone-score-pair${current.players.length < 2 ? ' is-solo' : ''}">${current.players.map((player, position) => playerTag(player, position, board()?.status === 'live' && position === current.turn, current.remaining?.[position], current.legs?.[position], current.settings?.bestOfSets > 1 ? current.sets?.[position] : null)).join('')}</div>
      ${checkout ? `<div class="bf-phone-finish" aria-label="Finishsuggestie">${icon('target')} <span>Finishsuggestie <strong>${esc(checkout)}</strong></span></div>` : ''}
      ${current.lastVisit?.score != null ? `<p class="bf-phone-last">Laatste beurt <strong>${esc(current.lastVisit.score)}${current.lastVisit.bust ? ' · Bust' : ''}</strong></p>` : ''}
      ${index < 0 ? '<p class="bf-phone-last">Je kijkt live mee.</p>' : ''}
    </section>`;
  }

  function scoringControls(current) {
    const formatted = draft === '' ? '—' : esc(draft);
    const disabled = inactive();
    const keys = [1,2,3,4,5,6,7,8,9,'delete',0,'commit'];
    if (pendingDouble) return `<section class="bf-phone-confirm" aria-labelledby="bf-phone-checkout"><h2 id="bf-phone-checkout">Dubbel geraakt?</h2><p>Bevestig ${pendingDouble.score} met ${pendingDouble.darts} ${pendingDouble.darts === 1 ? 'dart' : 'darts'} om de leg af te sluiten.</p><div class="bf-phone-actions">${button('Terug naar invoer', 'back-double', 'ghost', disabled)}${button(`${icon('check')} Dubbel bevestigd`, 'double', 'primary', disabled)}</div></section>`;
    if (confirmingCancel) return `<section class="bf-phone-confirm" aria-labelledby="bf-phone-abandon"><h2 id="bf-phone-abandon">Deze partij afbreken?</h2><p>De baan komt vrij en de partij krijgt geen uitslag.</p><div class="bf-phone-actions">${button('Verder spelen', 'back-cancel', 'ghost', disabled)}${button('Ja, baan vrijgeven', 'cancel', 'primary', disabled)}</div></section>`;
    return `<section class="bf-phone-score-tools" aria-label="Beurtscore">
      <form class="bf-phone-form" data-form="baan-phone-score" aria-busy="${busy}">
        <div class="bf-phone-entry"><label class="bf-phone-field">Beurtscore<input name="score" maxlength="3" inputmode="none" autocomplete="off" value="${esc(draft)}" placeholder="0–180" ${disabled}></label>
        <label class="bf-phone-field">Aantal darts<select name="darts" ${disabled}>${[3,2,1].map(value => `<option value="${value}" ${darts === value ? 'selected' : ''}>${value} ${value === 1 ? 'dart' : 'darts'}</option>`).join('')}</select></label></div>
        <div class="bf-phone-keypad" aria-label="Scoretoetsen">${keys.map(key => key === 'commit' ? `<button type="submit" class="bf-btn bf-btn--primary" aria-label="Score opslaan" ${disabled}>${busy ? '…' : 'OK'}</button>` : button(key === 'delete' ? icon('remove') : key, 'key', 'ghost', `data-key="${key}" aria-label="${key === 'delete' ? 'Wis laatste cijfer' : key}" ${disabled}`)).join('')}</div>
      </form>
      <div class="bf-phone-quick" aria-label="Veelgebruikte scores">${[26, 45, 60, 100, 180].map(score => button(score, 'quick', 'ghost', `data-score="${score}" ${disabled}`)).join('')}</div>
      <div class="bf-phone-console-tools">${button(`${icon('undo')} Laatste beurt terug`, 'undo', 'ghost', `${(current.visits?.length || current.lastVisit) && !disabled ? '' : 'disabled'}`)}${current.mode !== 'scheduled' ? button('Partij afbreken', 'ask-cancel', 'ghost', disabled) : ''}</div>
      <span class="bf-phone-a11y" aria-live="polite">Invoer ${formatted}</span>
    </section>`;
  }

  function live(state, current, index) {
    const canWrite = writer();
    const currentWriter = current.players.find(player => eq(player?.id, current.writerId));
    const writerName = esc(currentWriter?.name || 'De schrijver');
    const screen = esc(screenLink(state));
    return `<div class="bf-phone bf-phone--console">
      <header class="bf-phone-head"><img class="bf-phone-console-logo" src="/assets/dartflow-logo.svg" alt="DartFlow" width="1916" height="496"><span class="bf-phone-live${ctx.online() ? ' is-online' : ''}" role="status">${status()}</span><a class="bf-btn bf-btn--ghost" href="${screen}" target="_blank" rel="noopener" aria-label="Open Sprint op een apart scherm" title="Open Sprint op een apart scherm">${icon('monitor')}</a></header>
      <main class="bf-phone-main">
        <div class="bf-phone-console-heading"><h1>${canWrite ? 'Score invoeren' : 'Resterende scores'}</h1><span>${esc(state.title || 'DartFlow-baan')}</span></div>
        <div class="bf-phone-score-pair${current.players.length < 2 ? ' is-solo' : ''}" aria-label="Resterende scores">${current.players.map((player, position) => playerTag(player, position, position === current.turn, current.remaining?.[position], null, null, true)).join('')}</div>
        ${feedback(true)}
        ${canWrite ? scoringControls(current) : `<section class="bf-phone-console-observer"><p>${icon('pencil')} <strong>${writerName}</strong> voert de scores in.</p>${index >= 0 ? confirmingTakeover ? `<div class="bf-phone-confirm"><h2>Score-invoer overnemen?</h2><p>Jouw telefoon schrijft verder vanaf de huidige stand.</p><div class="bf-phone-actions">${button('Annuleren', 'back-takeover', 'ghost', inactive())}${button(`${icon('transfer')} Ja, ik neem over`, 'take-over', 'primary', inactive())}</div></div>` : button(`${icon('transfer')} Score-invoer overnemen`, 'ask-takeover', 'primary', inactive()) : ''}</section>`}
      </main>
    </div>`;
  }

  function statNumbers(stats = {}) {
    const avg = Number(stats.average || 0).toLocaleString('nl-NL', {minimumFractionDigits: 1, maximumFractionDigits: 1});
    return `<div class="bf-phone-stats"><div><strong>${avg}</strong><small>3-dartsgem.</small></div><div><strong>${stats.highestFinish || '–'}</strong><small>Hoogste finish</small></div><div><strong>${stats.oneEighties || 0}</strong><small>180’s</small></div><div><strong>${stats.darts || 0}</strong><small>Darts</small></div></div>`;
  }

  function result(current, index) {
    const champion = current.players.find(player => eq(player?.id, current.winnerId));
    const title = current.mode === 'practice' ? 'Oefenpartij afgerond.' : champion ? `${esc(firstName(champion))} wint.` : 'Partij afgerond.';
    const confirmations = current.confirmations || [];
    const needsConfirmation = current.mode === 'scheduled' && !current.resultPublished;
    return `${hero('AFGELOPEN', title, needsConfirmation ? 'Beide spelers bevestigen de uitslag voordat die wordt vastgelegd.' : 'De eindstand en statistieken staan klaar.')}
      ${scoreboard(current, index)}
      <section class="bf-phone-panel"><span class="bf-phone-kicker">PARTIJ IN CIJFERS</span><h2>Statistieken</h2>
        ${current.players.map((player, position) => `<div class="bf-phone-result-row"><strong>${esc(player.name)}${position === index ? ' · jij' : ''}</strong>${statNumbers(current.stats?.[position])}</div>`).join('')}
      </section>
      ${index >= 0 ? `<div class="bf-phone-actions">${needsConfirmation ? !confirmations[index] ? button(`${icon('check')} Uitslag bevestigen`, 'confirm', 'primary', inactive()) : '<span class="bf-phone-chip">Jij hebt bevestigd</span>' : button(`${icon('check')} Baan vrijgeven`, 'release', 'primary', inactive())}</div>` : ''}`;
  }

  function history() {
    const records = ctx.history?.() || board()?.history || [];
    return `<details class="bf-phone-panel bf-phone-history" ${historyOpen ? 'open' : ''}><summary data-action="baan-phone-history">${icon('history')} <strong>Jouw wedstrijdhistorie</strong><span>${records.length}</span></summary>
      ${records.length ? records.slice(0, 6).map(record => {
        const index = record.players?.findIndex(player => eq(player?.id, me()?.id)) ?? -1;
        const opponent = record.opponent || record.players?.find(player => !eq(player?.id, me()?.id))?.name;
        const stats = Array.isArray(record.stats) ? record.stats[index] : record.stats;
        const name = record.scheduledLabel || record.name || names[record.mode] || 'Wedstrijd';
        const outcome = record.outcome || (record.mode === 'practice' ? 'practice' : record.winnerId ? eq(record.winnerId, me()?.id) ? 'won' : 'lost' : '');
        const outcomeLabel = {won: 'Gewonnen', lost: 'Verloren', practice: 'Oefenen'};
        return `<div class="bf-phone-result-row"><div><strong>${esc(name)}</strong>${opponent ? `<span> · ${esc(opponent)}</span>` : ''}${outcomeLabel[outcome] ? `<small>${outcomeLabel[outcome]}</small>` : ''}</div>${statNumbers(stats)}</div>`;
      }).join('') : '<p>Je afgeronde partijen verschijnen hier.</p>'}</details>`;
  }

  function view() {
    const state = board();
    syncMatch(state);
    if (state?.status === 'live' && state.match && me()) return live(state, state.match, playerIndex());
    let main;
    if (!state) main = hero('BAANMODUS', 'Baan openen…', 'We halen de status van deze baan op.');
    else if (!me()) main = profile();
    else {
      const current = state.match;
      const index = playerIndex();
      const screen = !current || state.status === 'idle' ? idle()
        : state.status === 'waiting' ? waiting(state, current, index) : result(current, index);
      main = playerStrip() + screen + history();
    }
    return `<div class="bf-phone">${header(state)}<main class="bf-phone-main">${feedback()}${main}<footer class="bf-phone-footer"><a href="${esc(ctx.url('hub'))}">${icon('left')} Terug naar Baanmodus</a><span>DARTFLOW · SPELEN OP LOCATIE</span></footer></main></div>`;
  }

  function clearFeedback() {
    notice = '';
    problem = '';
  }

  function showProblem(message) {
    notice = '';
    problem = message;
    ctx.render();
  }

  async function run(type, values = {}) {
    if (!enabled()) return;
    clearFeedback();
    busy = true;
    ctx.render();
    try {
      const outcome = await ctx.send({type, ...values, matchId: match()?.id});
      if (outcome?.needsDouble) {
        pendingDouble = {score: values.score, darts: values.darts};
      } else if (outcome?.error) {
        problem = outcome.error;
      } else {
        notice = outcome?.message || '';
        if (type === 'score' || type === 'undo') {
          draft = '';
          darts = 3;
          pendingDouble = null;
        }
        confirmingTakeover = false;
        confirmingCancel = false;
      }
    } catch {
      problem = 'De verbinding reageerde niet. Controleer de bijgewerkte stand en probeer opnieuw.';
    } finally {
      busy = false;
      ctx.render();
    }
  }

  async function openProfile(name) {
    if (!enabled()) return;
    clearFeedback();
    busy = true;
    profileDraft = name;
    ctx.render();
    try {
      const response = await ctx.login(name);
      if (response?.error) problem = response.error;
      else profileDraft = '';
    } catch {
      problem = 'Je profiel kon nog niet geopend worden. Probeer opnieuw.';
    } finally {
      busy = false;
      ctx.render();
    }
  }

  function updateScore(target) {
    const container = target.closest('.bf-phone');
    const scoreField = container?.querySelector('input[name="score"]');
    const liveField = container?.querySelector('.bf-phone-a11y');
    if (scoreField) scoreField.value = draft;
    if (liveField) liveField.textContent = 'Invoer ' + (draft || 'leeg');
    if (pendingDouble || problem || notice) {
      pendingDouble = null;
      clearFeedback();
      ctx.render();
    }
  }

  function handleAction(target) {
    const element = target?.closest?.('[data-action^="baan-phone-"]');
    const action = element?.dataset.action?.slice('baan-phone-'.length);
    if (!action) return false;
    if (element.disabled) return true;
    switch (action) {
      case 'mode': {
        selectedMode = element.dataset.mode;
        setup = {startScore: 501, bestOfLegs: 3, bestOfSets: 1};
        if (selectedMode === 'scheduled') {
          const request = scheduledRequest();
          if ([301, 501, 701].includes(request.startScore)) setup.startScore = request.startScore;
          if ([1, 3, 5, 7, 9].includes(request.bestOfLegs)) setup.bestOfLegs = request.bestOfLegs;
        }
        clearFeedback();
        ctx.render();
        break;
      }
      case 'back':
        selectedMode = '';
        clearFeedback();
        ctx.render();
        break;
      case 'history':
        historyOpen = !element.parentElement.open;
        element.parentElement.open = historyOpen;
        break;
      case 'logout':
        if (busy) break;
        ctx.logout();
        selectedMode = '';
        clearFeedback();
        ctx.render();
        break;
      case 'copy-invite': {
        const invite = match()?.inviteToken;
        if (invite) void Promise.resolve(ctx.copy(ctx.url('phone', board().id, {invite}))).then(copied => {
          if (!copied) showProblem('Selecteer de wedstrijdlink en kopieer die handmatig.');
          else ctx.toast?.('Wedstrijdlink gekopieerd.');
        }).catch(() => showProblem('Selecteer de wedstrijdlink en kopieer die handmatig.'));
        break;
      }
      case 'join':
        void run('join', {inviteToken: ctx.inviteToken() || undefined});
        break;
      case 'accept':
      case 'confirm':
      case 'cancel':
      case 'release':
      case 'undo':
      case 'take-over':
        void run(action);
        break;
      case 'ask-cancel':
        confirmingCancel = true;
        clearFeedback();
        ctx.render();
        break;
      case 'back-cancel':
        confirmingCancel = false;
        ctx.render();
        break;
      case 'ask-takeover':
        confirmingTakeover = true;
        clearFeedback();
        ctx.render();
        break;
      case 'back-takeover':
        confirmingTakeover = false;
        ctx.render();
        break;
      case 'quick':
        draft = element.dataset.score;
        updateScore(element);
        break;
      case 'key':
        draft = element.dataset.key === 'delete' ? draft.slice(0, -1) : draft.length < 3 ? `${draft}${element.dataset.key}` : draft;
        updateScore(element);
        break;
      case 'double':
        if (pendingDouble) void run('score', {...pendingDouble, doubleConfirmed: true});
        break;
      case 'back-double':
        pendingDouble = null;
        ctx.render();
        break;
      default: return false;
    }
    return true;
  }

  function handleForm(form, fields = new FormData(form)) {
    const value = key => typeof fields.get === 'function' ? fields.get(key) : fields[key];
    switch (form.dataset.form) {
      case 'baan-phone-profile': {
        const name = String(value('name') || '').trim();
        if (name.length < 2 || name.length > 40) showProblem('Kies een spelersnaam van 2 tot 40 tekens.');
        else void openProfile(name);
        return true;
      }
      case 'baan-phone-start': {
        const options = {mode: selectedMode, startScore: Number(value('startScore')), bestOfLegs: Number(value('bestOfLegs')), bestOfSets: Number(value('bestOfSets'))};
        if (selectedMode === 'scheduled') {
          const request = scheduledRequest();
          if (!request.first || nameKey(request.first) === nameKey(me()?.name)) void run('prepare', {...options, name: request.name, label: request.name, opponent: request.opponent, boardTitle: request.boardTitle, venue: request.venue});
        } else if (selectedMode in names) void run('start', options);
        return true;
      }
      case 'baan-phone-score': {
        if (!writer() || board()?.status !== 'live') return true;
        const raw = String(value('score') ?? '').trim();
        if (!/^\d{1,3}$/.test(raw) || Number(raw) > 180) showProblem('Vul een score van 0 tot 180 in.');
        else void run('score', {score: Number(raw), darts: Number(value('darts')) || 3, doubleConfirmed: false});
        return true;
      }
      default: return false;
    }
  }

  function handleInput(event) {
    const input = event.target;
    const form = input?.form?.dataset.form;
    if (form === 'baan-phone-profile' && input.name === 'name') profileDraft = input.value;
    else if (form === 'baan-phone-score' && input.name === 'score') {
      draft = input.value.replace(/\D/g, '').slice(0, 3);
      if (draft !== input.value) input.value = draft;
      pendingDouble = null;
    } else return false;
    return true;
  }

  function handleChange(event) {
    const input = event.target;
    const form = input?.form?.dataset.form;
    if (form === 'baan-phone-start' && Object.hasOwn(setup, input.name)) setup[input.name] = Number(input.value);
    else if (form === 'baan-phone-score' && input.name === 'darts') {
      darts = Number(input.value);
      pendingDouble = null;
    } else return false;
    return true;
  }

  return {view, handleAction, handleForm, handleInput, handleChange};
}
