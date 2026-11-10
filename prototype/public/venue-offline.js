import {venueAction} from './venue-engine.js';

const outboxKey = 'dartflow-venue-score-outbox-v1';
const appKey = 'puinruimers-demo-v3';
const offlineActions = new Set(['score', 'undo']);

function readStore(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}

export function createVenueOffline(ctx) {
  let outbox = readStore(sessionStorage, outboxKey);

  function remember(value) {
    try {
      if (value) sessionStorage.setItem(outboxKey, JSON.stringify(value));
      else sessionStorage.removeItem(outboxKey);
      outbox = value;
      return true;
    } catch {
      return false;
    }
  }

  function findMatch(event, matchId) {
    return event?.matches.find(match => String(match.id) === String(matchId));
  }

  function officialEvent() {
    const stored = readStore(localStorage, appKey);
    const latest = stored?.venue;
    return latest?.id === ctx.db.venue?.id ? latest : ctx.db.venue;
  }

  function fail(error) {
    return {state: ctx.db.venue, error};
  }

  function dispatch(action, payload = {}, now = Date.now()) {
    const current = officialEvent();
    if (!outbox) return venueAction(current, action, payload, now);
    if (!offlineActions.has(action)) return fail('Herstel de verbinding om de uitslag of bordoproep te verwerken.');
    const localMatch = findMatch(outbox.local, payload.matchId);
    if (!localMatch || localMatch.id !== outbox.matchId || current.id !== outbox.local.id) {
      return fail('Dit tablet buffert beurten voor één partij. Herstel eerst de verbinding.');
    }
    const result = venueAction(outbox.local, action, payload, now);
    if (result.error || result.needsDouble) return {...result, state: ctx.db.venue};
    const next = {
      ...outbox,
      local: result.state,
      actions: [...outbox.actions, {action, payload, now}]
    };
    if (!remember(next)) return fail('De beurt kon niet op dit tablet worden bewaard.');
    return {...result, state: ctx.db.venue};
  }

  function reconnect() {
    const current = officialEvent();
    if (!outbox.actions.length || current.appliedOfflineBatches?.includes(outbox.id)) {
      remember(null);
      ctx.db.venue = current;
      return {ok: true, message: 'Verbinding hersteld.'};
    }
    const match = findMatch(current, outbox.matchId);
    if (current.id !== outbox.local.id || JSON.stringify(match?.game) !== outbox.baseGame || match?.status !== 'playing' || match.boardId !== outbox.boardId) {
      return {ok: false, message: 'De zaalstand is gewijzigd. De bewaarde beurten staan klaar voor controle.'};
    }

    let merged = current;
    for (const item of outbox.actions) {
      const result = venueAction(merged, item.action, item.payload, item.now);
      if (result.error || result.needsDouble) return {ok: false, message: 'Een bewaarde beurt vraagt controle van de wedstrijdleider.'};
      merged = result.state;
    }
    merged.appliedOfflineBatches = [...(current.appliedOfflineBatches || []), outbox.id].slice(-128);
    const count = outbox.actions.length;
    try {
      const latest = readStore(localStorage, appKey);
      const previous = latest?.version === ctx.db.version ? latest : ctx.db;
      localStorage.setItem(appKey, JSON.stringify({...previous, venue: merged}));
    } catch {
      return {ok: false, message: 'Opslaan lukt nog niet. De bewaarde beurten staan op dit tablet.'};
    }
    ctx.db.venue = merged;
    remember(null);
    return {ok: true, message: `${count} bewaarde ${count === 1 ? 'bewerking verwerkt' : 'bewerkingen verwerkt'}.`};
  }

  function setOffline(enabled) {
    if (enabled === Boolean(outbox)) return true;
    if (enabled) {
      const current = officialEvent();
      const route = String(ctx.routeParam());
      const board = current.boards.find(item => route === `board-${item.id}` || route === `board-${String(item.id).replace(/^B/, '')}`);
      const match = findMatch(current, board?.matchId);
      if (match?.realtimeRoom) {
        ctx.toast('Voor deze partij kunnen de twee spelers de live score-invoer op hun telefoons overnemen.');
        return false;
      }
      if (!match || match.status !== 'playing') {
        ctx.toast('Open een lopende wedstrijd op een schrijftablet.');
        return false;
      }
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      if (!remember({id, matchId: match.id, boardId: board.id, baseGame: JSON.stringify(match.game), local: current, actions: []})) {
        ctx.toast('De lokale scorebuffer is niet beschikbaar.');
        return false;
      }
      ctx.toast('Verbinding onderbroken. De schrijver kan lokaal doorscoren.');
      ctx.render();
      return true;
    }
    const result = reconnect();
    ctx.toast(result.message);
    ctx.render();
    if (!result.ok) showConflict();
    return result.ok;
  }

  function showConflict() {
    const lines = outbox.actions.map(({action, payload}) =>
      action === 'undo' ? 'Laatste beurt teruggedraaid' : `${payload.score} punten · ${payload.darts ?? 3} darts`);
    ctx.showModal('Scorebuffer controleren', 'De zaalstand en de lokale buffer lopen uiteen.', `
      <label class="field">Bewaarde bewerkingen
        <textarea class="input" readonly rows="5">${ctx.esc(lines.join('\n'))}</textarea>
      </label>
      <p>Geef de bewaarde scores door aan de wedstrijdleider. Daarna kun je dit tablet weer op de zaalstand zetten.</p>
      <div class="modal-actions">${ctx.button('Buffer bewaren','close-modal','ghost')}${ctx.button('Zaalstand gebruiken','venue-sync-discard','gold')}</div>`);
  }

  return {
    dispatch,
    setOffline,
    offline: () => Boolean(outbox),
    info: () => outbox?.actions.length || 0,
    game: match => outbox?.local.id === ctx.db.venue.id ? findMatch(outbox.local, match.id)?.game || match.game : match.game,
    discard() {
      if (!remember(null)) return ctx.toast('De lokale buffer kon niet worden gewist.');
      ctx.db.venue = officialEvent();
      ctx.closeModal();
      ctx.render();
      ctx.toast('Tablet volgt de zaalstand.');
    }
  };
}
