import { createMatch, applyScore, undo, checkout } from './scoring.js';

// Training owns its records. These sessions never enter db.matches or a rating.
export function createTraining(ctx) {
  const modes = {
    solo: { title: 'Solo x01', icon: 'target', tag: 'JOUW TEMPO', text: 'Speel een leg 301, 501 of 701 en werk aan je gemiddelde.' },
    bot: { title: 'Speel tegen Dartbot', icon: 'bolt', tag: 'EEN PASSENDE UITDAGING', text: 'Kies het doelgemiddelde van je digitale tegenstander.' },
    doubles: { title: 'Doubles around the board', icon: 'crown', tag: 'MAAK DE DUBBEL', text: 'Drie darts per dubbel. Van D1 tot en met de bull.' },
    challenge: { title: 'De 170-challenge', icon: 'trophy', tag: 'NEGEN DARTS. ÉÉN FINISH.', text: 'Gooi 170 uit binnen negen darts. Elke poging telt.' }
  };
  let inputText = '', pendingFinish = null, pendingNew = null;
  const B = (...args) => ctx.button(...args);
  const E = value => ctx.esc(value);
  const now = () => new Date().toISOString();
  const unique = () => `training-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  function init() {
    ctx.db.play ||= {};
    ctx.db.play.training ||= {
      screen: 'home', active: null,
      history: [
        { id: 'sample-doubles', kind: 'doubles', title: 'Doubles around the board', date: '2026-11-03T19:35:00Z', attempts: 63, hits: 19, percent: 30.2, completed: true, sample: true },
        { id: 'sample-solo', kind: 'solo', title: 'Solo 501', date: '2026-11-02T18:20:00Z', darts: 24, total: 501, avg: 62.6, highest: 100, finish: 58, remaining: 0, completed: true, sample: true },
        { id: 'sample-challenge', kind: 'challenge', title: '170-challenge', date: '2026-11-01T20:10:00Z', darts: 9, total: 118, avg: 39.3, remaining: 52, completed: true, success: false, sample: true }
      ]
    };
    const t = ctx.db.play.training;
    t.history ||= [];
    t.screen ||= 'home';
    return t;
  }
  const state = () => init();
  function persist() { ctx.save(); }
  function rerender() { persist(); ctx.render(); }
  function formatDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Zojuist' : new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  }
  function dartsUsed(a) { return a.match?.stats?.[0]?.darts || 0; }
  function stats(a) {
    if (a.kind === 'doubles') {
      const rounds = a.rounds || [];
      const attempts = rounds.length * 3;
      const hits = rounds.reduce((sum, r) => sum + r.hits, 0);
      return { attempts, hits, percent: attempts ? Math.round(hits / attempts * 1000) / 10 : 0 };
    }
    const m = a.match, first = m.stats[0];
    return {
      darts: first.darts, total: first.total,
      avg: first.darts ? Math.round(first.total / first.darts * 30) / 10 : 0,
      highest: Math.max(0, ...m.visits.filter(v => !v.bust).map(v => v.score)),
      finish: first.highestFinish,
      remaining: m.remaining[0]
    };
  }
  function record(a, completed = a.completed) {
    const hasData = a.kind === 'doubles' ? a.rounds.length > 0 : a.match.visits.length > 0;
    if (!hasData) return;
    const item = {
      id: a.id, kind: a.kind, date: now(), title: a.kind === 'solo' ? `Solo ${a.startScore}` : a.kind === 'doubles' ? modes.doubles.title : '170-challenge',
      ...stats(a), completed: !!completed, success: a.kind === 'challenge' ? a.match.status === 'finished' : undefined, sample: false
    };
    const t = state();
    t.history = [item, ...t.history.filter(s => s.id !== a.id)].slice(0, 40);
    a.recorded = true;
  }
  function unrecord(a) {
    state().history = state().history.filter(s => s.id !== a.id);
    a.recorded = false;
  }
  function begin(kind, options = {}, replace = false) {
    const t = state();
    if (!replace && t.active && !t.active.completed && (t.active.kind === 'doubles' ? t.active.rounds.length : t.active.match.visits.length)) {
      pendingNew = { kind, options };
      ctx.showModal('Een andere training starten?', 'Je huidige sessie wordt bewaard bij je trainingen.', `<div class="modal-actions">${B('Verder trainen', 'close-modal', 'ghost')}${B('Bewaren en opnieuw starten', 'training-replace', 'gold')}</div>`);
      return;
    }
    if (replace && t.active) record(t.active, t.active.completed);
    const id = unique();
    if (kind === 'doubles') {
      t.active = { id, kind, started: now(), index: 0, rounds: [], completed: false, recorded: false };
    } else {
      const startScore = kind === 'challenge' ? 170 : [301, 501, 701].includes(Number(options.startScore)) ? Number(options.startScore) : 501;
      t.active = {
        id, kind, startScore, started: now(), completed: false, recorded: false,
        match: createMatch({ id, players: [1, 900], startScore, bestOf: 1, mode: 'Training', board: 1 })
      };
    }
    t.screen = kind;
    inputText = ''; pendingFinish = null; pendingNew = null;
    ctx.closeModal(); rerender();
    ctx.toast(kind === 'doubles' ? 'Richt je op D1. Drie darts per beurt.' : kind === 'challenge' ? 'De 170-challenge staat klaar. Je hebt negen darts.' : `Je leg ${t.active.startScore} staat klaar.`);
  }
  function showError(message) {
    const el = document.getElementById('training-error');
    if (el) el.textContent = message;
    else ctx.toast(message);
  }
  function submitVisit(value, darts, doubleConfirmed = false) {
    const a = state().active;
    if (!a || a.kind === 'doubles' || a.completed) return;
    if (!/^\d{1,3}$/.test(String(value))) return showError('Vul een hele score van 0 tot en met 180 in.');
    if (!Number.isInteger(darts) || darts < 1 || darts > 3) return showError('Kies 1, 2 of 3 gegooide darts.');
    if (a.kind === 'challenge' && dartsUsed(a) + darts > 9) return showError(`Je hebt nog ${9 - dartsUsed(a)} dart${9 - dartsUsed(a) === 1 ? '' : 's'} in deze poging.`);
    const before = a.match;
    const result = applyScore({ ...before, turn: 0 }, Number(value), { darts, doubleConfirmed });
    if (result.error) return showError(result.error);
    if (result.needsDouble) {
      pendingFinish = { id: a.id, visits: a.match.visits.length, score: Number(value), darts };
      ctx.showModal('De dubbel geraakt?', 'Een finish telt als de laatste dart in een dubbel of de bull zit.', `<div class="checkout"><small>FINISH VANAF ${a.match.remaining[0]}</small>${E(checkout(a.match.remaining[0]) || 'Dubbel uit')}</div><p class="subtle-label">Je gooit ${Number(value)} uit in ${darts} dart${darts === 1 ? '' : 's'}. Klopt dat?</p><div class="modal-actions">${B('Nog niet', 'close-modal', 'ghost')}${B(ctx.icon('check') + ' Ja, dubbel geraakt', 'training-confirm-finish', 'gold')}</div>`);
      return;
    }
    a.match = { ...result.match, turn: 0 };
    a.completed = a.match.status === 'finished' || (a.kind === 'challenge' && dartsUsed(a) >= 9);
    if (a.completed) record(a, true);
    inputText = ''; pendingFinish = null;
    ctx.closeModal(); rerender();
    ctx.toast(a.match.status === 'finished' ? a.kind === 'challenge' ? '170 uit! Mooie finish.' : 'Leg gewonnen. Je training is opgeslagen.' : a.completed ? 'Negen darts gegooid. Probeer het nog eens!' : result.bust ? 'Bust. Je eerdere score blijft staan.' : `${Number(value)} genoteerd.`);
  }
  function submitDoubles(hits) {
    const a = state().active;
    if (!a || a.kind !== 'doubles' || a.completed || !Number.isInteger(hits) || hits < 0 || hits > 3) return;
    a.rounds.push({ target: a.index < 20 ? `D${a.index + 1}` : 'Bull', hits });
    a.index += 1;
    a.completed = a.index >= 21;
    if (a.completed) record(a, true);
    rerender();
    if (a.completed) ctx.toast('Alle doubles getraind. Je sessie is opgeslagen.');
    else ctx.toast(`${hits} van 3 raak. Nu ${a.index < 20 ? `D${a.index + 1}` : 'de bull'}.`);
  }
  function historyHTML() {
    const t = state();
    return `<section class="panel dr-training-history" style="margin-top:22px">${ctx.sectionHeading('Jouw trainingsboek', '', '')}<p class="dr-meta">Voorbeeldsessies en jouw eigen trainingen. Deze resultaten tellen niet mee in de competitieve ranglijst.</p>${t.history.length ? `<div class="full-table" style="padding:0"><table class="table"><thead><tr><th>Training</th><th>Resultaat</th><th>Darts</th><th>Moment</th><th></th></tr></thead><tbody>${t.history.slice(0, 10).map(s => `<tr><td><strong>${E(s.title)}</strong><div class="dr-meta">${s.sample ? 'Voorbeeldsessie' : s.completed ? 'Afgerond' : 'Tussentijds bewaard'}</div></td><td class="stat-gold">${s.kind === 'doubles' ? `${s.hits}/${s.attempts} raak · ${s.percent}%` : s.kind === 'challenge' ? s.success ? '170 uitgegooid' : `${s.remaining} over` : `${s.remaining === 0 ? 'Uitgegooid' : `${s.remaining} over`} · Ø ${s.avg.toFixed(1)}`}</td><td>${s.kind === 'doubles' ? s.attempts : s.darts}</td><td class="dr-meta">${E(formatDate(s.date))}</td><td>${B(ctx.icon('eye'), 'training-session-detail', 'small ghost', `data-id="${E(s.id)}" aria-label="Bekijk training ${E(s.title)}"`)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="subtle-label">Je eerste trainingssessie verschijnt hier zodra je een beurt hebt bewaard.</p>`}</section>`;
  }
  function homeHTML() {
    const t = state();
    const active = t.active && !t.active.completed;
    return `${active ? `<div class="notice">${ctx.icon('clock')}Je hebt een training lopen: ${E(modes[t.active.kind].title)}. ${B('Verder trainen', 'training-resume', 'small ghost')}</div>` : ''}<div class="dr-grid dr-grid-2">${Object.entries(modes).map(([kind, m]) => `<article class="panel dr-card dr-training-card"><div class="dr-inline"><span class="tour-icon">${ctx.icon(m.icon)}</span>${ctx.badge(m.tag)}</div><h2>${E(m.title)}</h2><p class="dr-meta">${E(m.text)}</p>${B('Kies deze training ' + ctx.icon('arrow'), 'training-mode', 'gold small', `data-mode="${kind}"`)}</article>`).join('')}</div>${historyHTML()}`;
  }
  function configHTML(kind) {
    if (kind === 'bot') return `<section class="panel dr-card" style="max-width:760px"><div class="dr-inline"><span class="tour-icon">${ctx.icon('bolt')}</span>${ctx.badge('JOUW NIVEAU. JOUW UITDAGING.')}</div><h2>Een tegenstander die bij je past.</h2><p class="dr-meta">Dartbot gooit gesimuleerde beurten. Het gekozen gemiddelde is een doel; iedere partij blijft anders. De wedstrijd telt als oefenen.</p><form data-form="training-bot"><div class="field-row"><label class="field">Doelgemiddelde Dartbot<select name="level">${[30, 40, 50, 60, 70, 80, 90].map(n => `<option value="${n}" ${n === 50 ? 'selected' : ''}>Gemiddeld ${n} per 3 darts</option>`).join('')}</select></label><label class="field">Startscore<select name="score"><option>501</option><option>301</option><option>701</option></select></label></div><div class="field-row"><label class="field">Best of<select name="bestOf"><option value="3">3 legs</option><option value="5">5 legs</option><option value="7">7 legs</option></select></label><label class="field">Jouw voorkeur<select name="camera"><option value="off">Zonder camera</option><option value="optional">Eigen camera optioneel</option></select></label></div><button class="btn gold">${ctx.icon('bolt')} Start tegen Dartbot</button></form></section>`;
    if (kind === 'solo') return `<section class="panel dr-card" style="max-width:760px"><div class="dr-inline"><span class="tour-icon">${ctx.icon('target')}</span>${ctx.badge('ÉÉN SPELER · DUBBEL UIT')}</div><h2>Focus op jouw volgende dart.</h2><p class="dr-meta">Gooi een volledige leg op je eigen bord. Je voert de beurtscore in; Dartflow rekent je resterende score en gemiddelde uit.</p><form data-form="training-solo"><label class="field" style="max-width:300px">Startscore<select name="startScore"><option>501</option><option>301</option><option>701</option></select></label><button class="btn gold">${ctx.icon('arrow')} Start solo training</button></form></section>`;
    if (kind === 'doubles') return `<section class="panel dr-card" style="max-width:760px"><div class="dr-inline"><span class="tour-icon">${ctx.icon('crown')}</span>${ctx.badge('21 DOELEN · 63 DARTS')}</div><h2>De basis van elke mooie finish.</h2><p class="dr-meta">Je gooit drie darts op D1, daarna drie op D2, tot en met D20 en de bull (50). Geef na elke beurt aan hoeveel darts het doel raakten. Alleen het gevraagde doel telt.</p>${B('Start doubles training ' + ctx.icon('arrow'), 'training-start-doubles', 'gold')}</section>`;
    return `<section class="panel dr-card" style="max-width:760px"><div class="dr-inline"><span class="tour-icon">${ctx.icon('trophy')}</span>${ctx.badge('170 OVER · MAXIMAAL 9 DARTS')}</div><h2>Drie beurten naar een grote finish.</h2><p class="dr-meta">Begin met 170. Probeer binnen negen darts precies op nul te eindigen, met een dubbel. Ook een bust telt mee voor het aantal gegooide darts.</p><div class="checkout"><small>DE KLASSIEKER</small>T20 · T20 · Bull</div><div style="margin-top:18px">${B('Start 170-challenge ' + ctx.icon('arrow'), 'training-start-challenge', 'gold')}</div></section>`;
  }
  function visitsHTML(a) {
    return `<section class="panel"><h2>Beurt voor beurt</h2>${a.match.visits.length ? `<div class="turn-history">${a.match.visits.slice().reverse().map((v, i) => `<div class="turn-row"><small>${a.match.visits.length - i}</small><span>${v.checkout ? 'Finish' : v.bust ? 'Bust' : `${v.darts} dart${v.darts === 1 ? '' : 's'}`}</span><b>${v.score}</b><span>${v.remainingAfter}</span></div>`).join('')}</div>` : `<p class="dr-meta">Je eerste beurt verschijnt hier zodra je een score invoert.</p>`}</section>`;
  }
  function activeX01HTML(a) {
    const m = a.match, s = stats(a), challenge = a.kind === 'challenge';
    const dartsLeft = challenge ? Math.max(0, 9 - s.darts) : 3;
    const finished = m.status === 'finished';
    return `<div class="dr-grid dr-grid-2"><section class="panel dr-card dr-training-play"><div class="dr-inline">${ctx.badge(challenge ? '170-CHALLENGE' : `SOLO ${a.startScore}`)}${ctx.badge(a.completed ? finished ? 'Uitgegooid' : 'Poging afgerond' : 'Jij bent aan zet', a.completed ? 'finished' : 'live')}</div><div class="dr-training-score"><span class="subtle-label">${a.completed ? finished ? 'MOOIE FINISH' : 'RESTEREND NA 9 DARTS' : 'RESTEREND'}</span><strong style="display:block;font-family:var(--display);font-size:78px;line-height:1.2;color:var(--gold)">${m.remaining[0]}</strong></div>${challenge ? `<div class="progress-label"><span>${s.darts} van 9 darts gegooid</span><span>${dartsLeft} over</span></div><div class="progress" style="margin-bottom:18px"><span style="width:${Math.min(100, s.darts / 9 * 100)}%"></span></div>` : ''}<div class="checkout"><small>${checkout(m.remaining[0]) ? 'FINISHSUGGESTIE' : a.completed ? 'JOUW RESULTAAT' : 'JOUW VOLGENDE BEURT'}</small>${a.completed ? finished ? `${s.darts} darts · Ø ${s.avg.toFixed(1)}` : 'Een nieuwe poging staat zo weer klaar.' : E(checkout(m.remaining[0]) || 'Speel jezelf naar een finish.')}</div>${!a.completed ? `<form data-form="training-score" style="margin-top:18px"><div class="field-row"><label class="field">Beurtscore<input id="training-score" name="score" class="input" type="text" inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" autocomplete="off" aria-label="Trainingsscore" placeholder="0–180" value="${E(inputText)}" required></label><label class="field">Gegooide darts<select name="darts" id="training-darts">${[3, 2, 1].filter(n => !challenge || n <= dartsLeft).map(n => `<option value="${n}">${n} dart${n === 1 ? '' : 's'}</option>`).join('')}</select></label></div><div class="quick-scores">${[26, 60, 100, 180].map(n => B(String(n), 'training-quick', '', `data-score="${n}"`)).join('')}</div><div id="training-error" class="inline-error" role="alert"></div><button class="btn gold block">${ctx.icon('check')} Score noteren</button></form>` : `<div class="notice" style="margin:18px 0 0">${ctx.icon(finished ? 'trophy' : 'info')}${finished ? challenge ? '170 uitgegooid! Deze poging staat in je trainingsboek.' : 'Je leg is opgeslagen in je trainingsboek.' : 'Deze poging is opgeslagen. Train verder met een nieuwe poging.'}</div><div style="margin-top:15px">${B(challenge ? 'Nog een poging' : 'Nieuwe solo leg', 'training-again', 'gold block')}</div>`}<div class="dr-inline" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:15px">${B(ctx.icon('undo') + ' Laatste beurt terug', 'training-undo', 'ghost small', m.history.length ? '' : 'disabled')}${B(a.completed ? 'Trainingsoverzicht' : 'Stop en bewaar', 'training-stop', 'ghost small')}</div></section><div class="dr-room-aside"><section class="panel"><h2>Jouw worpen in cijfers</h2><div class="profile-stats"><div><b>${s.avg.toFixed(1)}</b><small>GEMIDDELDE</small></div><div><b>${s.darts}</b><small>DARTS</small></div><div><b>${s.highest}</b><small>BESTE BEURT</small></div></div><div class="stat-compare"><b>${m.stats[0].oneEighties}</b><span>180’ers / hoogste finish</span><b>${s.finish || '–'}</b></div><p class="dr-meta">Alleen jouw invoer uit deze sessie. Deze cijfers veranderen je competitieve rating niet.</p></section>${visitsHTML(a)}</div></div>`;
  }
  function activeDoublesHTML(a) {
    const s = stats(a), target = a.index < 20 ? `D${a.index + 1}` : 'Bull';
    return `<div class="dr-grid dr-grid-2"><section class="panel dr-card"><div class="dr-inline">${ctx.badge('DOUBLES AROUND THE BOARD')}${ctx.badge(a.completed ? 'Afgerond' : `Doel ${a.index + 1} / 21`, a.completed ? 'finished' : 'live')}</div><div class="dr-training-score"><span class="subtle-label">${a.completed ? 'JOUW RAAKPERCENTAGE' : 'JOUW DOEL VOOR DRIE DARTS'}</span><strong style="display:block;font-family:var(--display);font-size:78px;line-height:1.2;color:var(--gold)">${a.completed ? `${s.percent}%` : target}</strong></div><div class="progress-label"><span>${Math.min(a.index, 21)} van 21 doelen getraind</span><span>${s.hits}/${s.attempts} raak</span></div><div class="progress" style="margin-bottom:22px"><span style="width:${Math.min(a.index, 21) / 21 * 100}%"></span></div>${a.completed ? `<p class="dr-meta">Je hebt alle doubles en de bull getraind. De sessie staat in je trainingsboek.</p>${B('Nog een doubles training', 'training-again', 'gold block')}` : `<p class="dr-meta">Gooi drie darts op <strong>${target === 'Bull' ? 'de bull (50)' : target}</strong>. Hoeveel zaten in het gevraagde doel?</p><div class="dr-grid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">${[0, 1, 2, 3].map(n => B(`${n} raak`, 'training-double-hit', n === 3 ? 'gold' : 'ghost', `data-hits="${n}"`)).join('')}</div>`}<div class="dr-inline" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:20px">${B(ctx.icon('undo') + ' Vorig doel terug', 'training-undo', 'ghost small', a.rounds.length ? '' : 'disabled')}${B(a.completed ? 'Trainingsoverzicht' : 'Stop en bewaar', 'training-stop', 'ghost small')}</div></section><section class="panel"><h2>Jouw doubles</h2><div class="profile-stats"><div><b>${s.hits}</b><small>RAAK</small></div><div><b>${s.attempts}</b><small>DARTS</small></div><div><b>${s.percent}%</b><small>RAAKPERCENTAGE</small></div></div>${a.rounds.length ? `<div class="turn-history">${a.rounds.slice().reverse().map(r => `<div class="turn-row"><span>${E(r.target)}</span><b>${r.hits}/3</b><span>${r.hits === 3 ? 'Perfect' : r.hits ? 'Raak' : 'Gemist'}</span></div>`).join('')}</div>` : `<p class="dr-meta">Je voortgang verschijnt hier na de eerste drie darts.</p>`}<p class="dr-meta" style="margin-top:18px">Een dart telt alleen als hij in het gevraagde dubbelvak of de gevraagde bull (50) zit.</p></section></div>`;
  }
  function view() {
    const t = state(), screen = t.screen;
    const menu = `<div class="tabs dr-tabs">${[['home', 'Overzicht'], ['solo', 'Solo x01'], ['bot', 'Dartbot'], ['doubles', 'Doubles'], ['challenge', '170-challenge']].map(([id, label]) => `<button type="button" class="tab ${screen === id ? 'active' : ''}" data-action="training-mode" data-mode="${id}">${label}</button>`).join('')}</div>`;
    const body = screen === 'home' ? homeHTML() : t.active?.kind === screen ? t.active.kind === 'doubles' ? activeDoublesHTML(t.active) : activeX01HTML(t.active) : configHTML(screen);
    return ctx.header('Elke dart. <em>Een beetje beter.</em>', 'Train op je eigen bord, op jouw tempo. Je oefenresultaten blijven apart van competitie en ranking.', B(ctx.icon('target') + ' Vrije wedstrijd', 'training-friendly', 'ghost')) + menu + body;
  }
  function handleAction(action, el) {
    if (!action.startsWith('training-')) return false;
    const t = state(), a = t.active;
    switch (action) {
      case 'training-mode': {
        const mode = el.dataset.mode;
        if (mode === 'home' || modes[mode]) { t.screen = mode; inputText = ''; rerender(); }
        break;
      }
      case 'training-resume': if (a) { t.screen = a.kind; rerender(); } break;
      case 'training-start-doubles': begin('doubles'); break;
      case 'training-start-challenge': begin('challenge'); break;
      case 'training-friendly': ctx.createGame({ opponentId: 2, startScore: 501, bestOf: 5, setup: 'remote', type: 'practice', cameraRequired: false }); break;
      case 'training-replace': if (pendingNew) begin(pendingNew.kind, pendingNew.options, true); break;
      case 'training-quick': {
        const field = document.getElementById('training-score');
        if (field && !a?.completed) { inputText = String(el.dataset.score); field.value = inputText; field.focus(); const error = document.getElementById('training-error'); if (error) error.textContent = ''; }
        break;
      }
      case 'training-confirm-finish': {
        if (pendingFinish && a?.id === pendingFinish.id && a.match.visits.length === pendingFinish.visits) submitVisit(pendingFinish.score, pendingFinish.darts, true);
        else { pendingFinish = null; ctx.closeModal(); ctx.toast('De training is veranderd. Controleer je score opnieuw.'); }
        break;
      }
      case 'training-double-hit': submitDoubles(Number(el.dataset.hits)); break;
      case 'training-undo': {
        if (!a) break;
        if (a.kind === 'doubles') { if (!a.rounds.length) break; unrecord(a); a.rounds.pop(); a.index = a.rounds.length; a.completed = false; }
        else { if (!a.match.history.length) break; unrecord(a); a.match = { ...undo(a.match), turn: 0 }; a.completed = false; }
        pendingFinish = null; inputText = ''; rerender(); ctx.toast('De laatste invoer is teruggedraaid.');
        break;
      }
      case 'training-again': if (a) begin(a.kind, { startScore: a.startScore }, true); break;
      case 'training-stop': if (a) { record(a, a.completed); t.active = null; t.screen = 'home'; inputText = ''; pendingFinish = null; rerender(); ctx.toast('Je training is bewaard.'); } break;
      case 'training-session-detail': {
        const s = t.history.find(x => x.id === el.dataset.id);
        if (!s) break;
        ctx.showModal(E(s.title), `${s.sample ? 'Voorbeeldsessie' : 'Jouw training'} · ${E(formatDate(s.date))}`, `<div class="profile-stats">${s.kind === 'doubles' ? `<div><b>${s.hits}</b><small>RAAK</small></div><div><b>${s.attempts}</b><small>DARTS</small></div><div><b>${s.percent}%</b><small>RAAKPERCENTAGE</small></div>` : `<div><b>${s.darts}</b><small>DARTS</small></div><div><b>${s.avg.toFixed(1)}</b><small>GEMIDDELDE</small></div><div><b>${s.remaining}</b><small>RESTEREND</small></div>`}</div><div class="notice">${ctx.icon('info')}Trainingen tellen niet mee voor je competitieve rating of de clubranglijst.</div><div class="modal-actions">${B('Sluiten', 'close-modal', 'gold')}</div>`);
        break;
      }
    }
    return true;
  }
  function handleForm(form, values) {
    const type = form.dataset.form;
    if (!type.startsWith('training-')) return false;
    if (type === 'training-solo') begin('solo', { startScore: Number(values.startScore) });
    if (type === 'training-bot') {
      const level = Math.max(30, Math.min(90, Number(values.level) || 50));
      const startScore = [301, 501, 701].includes(Number(values.score)) ? Number(values.score) : 501;
      const bestOf = [3, 5, 7].includes(Number(values.bestOf)) ? Number(values.bestOf) : 3;
      ctx.createGame({ opponentId: 900, botLevel: level, startScore, bestOf, setup: 'localone', type: 'practice', cameraRequired: false });
    }
    if (type === 'training-score') submitVisit(values.score, Number(values.darts));
    return true;
  }
  return { init, view, handleAction, handleForm };
}
