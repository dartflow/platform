import {applyScore, checkout, createMatch, undo} from './marketing-scoring.js';

function setupModes() {
  const tablist = document.querySelector('[data-mode-tabs]');
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));

  function select(index, focus = false) {
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[position].hidden = !selected;
    });
    if (focus) tabs[index].focus();
  }

  tabs.forEach((tab, index) => {
    const panel = panels[index];
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      const positions = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      };
      if (!Object.hasOwn(positions, event.key)) return;
      event.preventDefault();
      select(positions[event.key], true);
    });
  });
  select(0);
  tablist.hidden = false;
}

function initialMatch() {
  let match = createMatch({id: 'sprint-demo', players: ['Rick', 'Mike'], legs: [1, 1]});
  for (const score of [140, 100, 113, 133, 100, 80]) {
    match = applyScore(match, score).match;
  }
  return {...match, history: []};
}

function ledgerRow(score, remaining) {
  const row = document.createElement('li');
  const scoreLabel = document.createElement('span');
  const value = document.createElement('b');
  scoreLabel.textContent = score;
  value.textContent = remaining;
  row.append(scoreLabel, value);
  return row;
}

function setupDemo() {
  const demo = document.querySelector('[data-score-demo]');
  const field = selector => demo.querySelector(selector);
  const form = field('[data-score-form]');
  const input = form.elements.score;
  const submit = form.querySelector('[type="submit"]');
  const quickScores = Array.from(form.querySelectorAll('[data-visit]'));
  const confirmation = field('[data-confirm]');
  const confirmButton = field('[data-finish-confirm]');
  const message = field('[data-score-message]');
  const undoButton = field('[data-undo]');
  let match = initialMatch();
  let pendingScore = null;

  function status(text, error = false) {
    message.textContent = text;
    message.toggleAttribute('data-error', error);
  }

  function draw() {
    const finished = match.status === 'finished';
    const leg = match.legs[0] + match.legs[1] + (finished ? 0 : 1);
    match.players.forEach((_, index) => {
      const remaining = match.remaining[index];
      const count = match.legs[index];
      field(`[data-player="${index}"]`).dataset.active = String(!finished && index === match.turn);
      field(`[data-remaining="${index}"]`).textContent = remaining;
      field(`[data-legs="${index}"]`).textContent = `${count} ${count === 1 ? 'leg' : 'legs'}`;
      field(`[data-finish="${index}"]`).textContent = finished ? 'Eindstand' : checkout(remaining) || 'Resterend';
      const rows = match.visits
        .filter(visit => visit.playerIndex === index && visit.leg === leg)
        .map(visit => ledgerRow(visit.bust ? 'Bust' : visit.score, visit.remainingAfter));
      field(`[data-ledger="${index}"]`).replaceChildren(...[ledgerRow('Start', match.startScore), ...rows].slice(-4));
    });
    field('[data-score-label]').textContent = finished ? 'Partij ' : 'Score voor ';
    field('[data-turn]').textContent = finished ? 'afgelopen' : match.players[match.turn];
    confirmation.hidden = pendingScore === null;
    input.disabled = finished;
    input.readOnly = pendingScore !== null;
    submit.disabled = finished || pendingScore !== null;
    quickScores.forEach(button => { button.disabled = submit.disabled; });
    undoButton.disabled = !match.history.length && pendingScore === null;
  }

  function enterScore(score, doubleConfirmed = false) {
    const player = match.players[match.turn];
    const result = applyScore(match, score, {doubleConfirmed});
    if (result.error) {
      status(result.error, true);
      return;
    }
    if (result.needsDouble) {
      pendingScore = score;
      input.value = score;
      status(`${player} kan deze leg uitgooien. Bevestig dat de laatste dart een dubbel was.`);
      draw();
      confirmButton.focus();
      return;
    }
    const focusWasInConfirmation = confirmation.contains(document.activeElement);
    pendingScore = null;
    match = result.match;
    input.value = '';
    draw();
    const nextPlayer = match.players[match.turn];
    if (result.winner) status(`${result.winner} wint de voorbeeldpartij met ${match.legs.join('–')} in legs.`);
    else if (result.legWon) status(`${player} wint de leg. ${nextPlayer} begint de volgende leg op 501.`);
    else if (result.bust) status(`Bust voor ${player}. De resterende score blijft staan. ${nextPlayer} is aan de beurt.`);
    else status(`${player} gooit ${score}. ${nextPlayer} is aan de beurt.`);
    if (focusWasInConfirmation) {
      if (input.disabled) field('[data-reset]').focus();
      else input.focus();
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (input.value !== '' && pendingScore === null) enterScore(input.valueAsNumber);
  });
  quickScores.forEach(button => button.addEventListener('click', () => enterScore(Number(button.dataset.visit))));
  confirmButton.addEventListener('click', () => enterScore(pendingScore, true));
  field('[data-finish-cancel]').addEventListener('click', () => {
    pendingScore = null;
    draw();
    status('Finish geannuleerd. Pas de score aan of probeer opnieuw.');
    input.focus();
    input.select();
  });
  undoButton.addEventListener('click', () => {
    if (pendingScore !== null) {
      pendingScore = null;
      status('De finish is geannuleerd.');
    } else {
      match = undo(match);
      status(`De vorige beurt is teruggedraaid. ${match.players[match.turn]} is aan de beurt.`);
    }
    input.value = '';
    draw();
    if (undoButton.disabled) input.focus();
  });
  field('[data-reset]').addEventListener('click', () => {
    match = initialMatch();
    pendingScore = null;
    input.value = '';
    draw();
    status('De voorbeeldpartij is hersteld. Rick is aan de beurt.');
  });
  draw();
  form.hidden = false;
}

setupModes();
setupDemo();
