import {MAIL_TEMPLATES, renderMail, initializeMail, resolveTemplate, createMailItem} from './mail-engine.js';

const TAB_NAMES = {templates:'Sjablonen', log:'Verzendlog', automations:'Automatiseringen', settings:'Instellingen'};
const STATUS_NAMES = {wired:'Gekoppeld aan actie', planned:'Klaar voor staging', provider:'Via inlogprovider'};
const scopeKey = id => String(id ?? 'global');
const previewLogoPattern = /(<img src=")https?:\/\/[^"<>]+\/assets\/dartflow-logo\.png(" alt="DartFlow")/;

export function createMail(ctx) {
  const {esc, icon} = ctx;
  let tab = 'templates', selectedId = null, category = 'all', query = '', logQuery = '', logStatus = 'all';
  let viewport = 'desktop', editorPanel = 'edit', draft = null, editorScope = null;
  let previewLogo = '', previewLogoRequested = false;
  const scope = () => ctx.scopeId();
  const access = () => ctx.db.role === 'admin';
  const mail = () => initializeMail(ctx.db) || ctx.db.mail;
  const currentScope = () => scopeKey(scope());
  const ownOutbox = () => (ctx.db.mail?.outbox || []).filter(item => scopeKey(item.scopeId) === currentScope());
  const btn = (text, action, type = 'ghost', attr = '') => `<button type="button" class="btn ${type}" data-action="mail-${action}" ${attr}>${text}</button>`;
  const badge = (text, cls = '') => `<span class="mail-badge ${cls}">${esc(text)}</span>`;
  const template = id => resolveTemplate(ctx.db, id, scope());
  const base = id => MAIL_TEMPLATES.find(item => item.id === id) || MAIL_TEMPLATES[0];
  const activeTemplate = () => template(selectedId || 'welcome');
  const providerOnly = value => value.status === 'provider';
  const readOnly = value => providerOnly(value) && scope() !== null;
  const changes = value => Object.fromEntries(['subject','preheader','title','body','cta'].map(key => [key, value[key] ?? '']));
  const config = id => {
    initializeMail(ctx.db);
    const all = ctx.db.mail.templates;
    all[currentScope()] ||= {};
    return all[currentScope()][id] ||= {};
  };
  const draftTemplate = () => ({...activeTemplate(), ...(draft || {})});
  const example = value => ({...base(value.id)?.example, ...(value.example || {}), clubName: scope() === null ? 'DartFlow Wereldwijd' : (ctx.scopeName?.() || value.example?.clubName || 'De Puinruimers')});
  const timestamp = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('nl-NL', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(date) : 'Zojuist';
  };
  function resetEditor(id = selectedId) {
    selectedId = id || 'welcome';
    editorScope = currentScope();
    const saved = config(selectedId);
    draft = changes(saved.draft || template(selectedId));
  }
  function init() {
    initializeMail(ctx.db);
    if (access() && (editorScope !== currentScope() || !selectedId)) resetEditor();
  }
  function visibleTemplates() {
    const term = query.trim().toLocaleLowerCase('nl-NL');
    return MAIL_TEMPLATES.filter(item => (category === 'all' || item.category === category) && (!term || [item.name, item.subject, item.trigger, item.category].join(' ').toLocaleLowerCase('nl-NL').includes(term)));
  }
  function metrics() {
    const outbox = ownOutbox();
    const active = MAIL_TEMPLATES.filter(item => template(item.id)?.enabled !== false).length;
    return `<div class="mail-metrics" aria-label="Mailoverzicht">
      <article><span>${icon('mail')} Sjablonen</span><strong>${MAIL_TEMPLATES.length}</strong><small>${active} ingeschakeld</small></article>
      <article><span>${icon('bolt')} Actiemomenten</span><strong>${MAIL_TEMPLATES.filter(item => item.status === 'wired').length}</strong><small>Gekoppeld in de demo</small></article>
      <article><span>${icon('check')} Testverzendingen</span><strong>${outbox.filter(item => item.status === 'simulated').length}</strong><small>In deze omgeving</small></article>
      <article><span>${icon('info')} Aandacht nodig</span><strong>${outbox.filter(item => item.status === 'failed').length}</strong><small>Mislukte tests</small></article>
    </div>`;
  }
  function render() {
    init();
    if (!access()) return `<div class="df-workspace"><section class="df-workspace__panel mail-empty">${icon('shield')}<h1>Mailbeheer</h1><p>Open de beheeromgeving om sjablonen en mailmomenten te beheren.</p>${ctx.button('Naar Vandaag', 'nav', 'gold', 'data-to="home"')}</section></div>`;
    const body = tab === 'templates' ? templatesView() : tab === 'log' ? logView() : tab === 'automations' ? automationsView() : settingsView();
    return `<div class="df-workspace mail-workspace">
      <header class="df-workspace__masthead mail-masthead">
        <div class="df-workspace__intro"><h1>Mailbeheer</h1><p>${esc(ctx.scopeName?.() || 'DartFlow')}</p></div>
        ${badge('Gesimuleerde verzending', 'amber')}
      </header>
      ${metrics()}
      <nav class="mail-tabs" aria-label="Mailbeheer">${Object.entries(TAB_NAMES).map(([id,label]) => `<button type="button" data-action="mail-tab" data-tab="${id}" aria-current="${id === tab ? 'page' : 'false'}" class="${id === tab ? 'active' : ''}">${icon({templates:'mail',log:'clipboard',automations:'bolt',settings:'settings'}[id])}<span class="mail-tab-label">${label}</span>${id === 'log' && ownOutbox().length ? `<span class="mail-tab-count">${ownOutbox().length}</span>` : ''}</button>`).join('')}</nav>
      ${body}
    </div>`;
  }
  function embedPreviewLogo(html) {
    return html.replace(previewLogoPattern, (_, before, after) => before + previewLogo + after);
  }
  function previewHtml(html) {
    if (typeof document === 'undefined' || !previewLogoPattern.test(html)) return html;
    if (previewLogo) return embedPreviewLogo(html);
    if (!previewLogoRequested) {
      previewLogoRequested = true;
      // Fetch in the app. A sandboxed preview can have restricted network access.
      fetch(new URL('./assets/dartflow-logo.svg', import.meta.url))
        .then(response => response.ok ? response.text() : '')
        .then(svg => {
          if (!svg) return;
          previewLogo = 'data:image/svg+xml,' + encodeURIComponent(svg);
          for (const frame of document.querySelectorAll('iframe[data-mail-preview]')) {
            if (previewLogoPattern.test(frame.srcdoc)) frame.srcdoc = embedPreviewLogo(frame.srcdoc);
          }
        })
        .catch(() => {});
    }
    return html;
  }
  function templatesView() {
    const all = visibleTemplates();
    const t = draftTemplate();
    const saved = config(t.id);
    const categoryNames = [...new Set(MAIL_TEMPLATES.map(item => item.category))];
    const variables = example(t);
    const preview = renderMail(t, variables);
    return `<section class="mail-studio" aria-label="Sjablonenstudio">
      <aside class="mail-library" aria-labelledby="mail-library-title">
        <header><h2 id="mail-library-title">Sjablonen</h2></header>
        <div class="mail-library-tools">
          <label class="mail-search">${icon('search')}<span class="mail-sr-only">Zoek sjablonen</span><input type="search" data-mail-input="template-search" placeholder="Zoek een sjabloon…" value="${esc(query)}"></label>
          <label class="mail-field"><span class="mail-sr-only">Categorie</span><select data-mail-input="category"><option value="all">Alle categorieën</option>${categoryNames.map(name => `<option value="${esc(name)}" ${category === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
        </div>
        <div id="mail-template-list" class="mail-template-list">${listHtml(all)}</div>
      </aside>
      <div class="mail-studio-main">
        <header class="mail-editor-head">
          <div>
            <p class="mail-eyebrow">${esc(t.category)}</p>
            <h2>${esc(t.name)}</h2>
            <div class="mail-inline-badges">
              ${badge(t.locked ? 'Inlogprovider' : saved.draft ? 'Concept opgeslagen' : 'Gepubliceerd', saved.draft ? 'amber' : 'green')}
              ${badge(`Versie ${saved.version || t.version || 1}`)}
              ${t.enabled === false ? badge('Uitgeschakeld') : ''}
            </div>
          </div>
          <div class="mail-inline-actions">
            ${btn(icon('download') + ' HTML downloaden', 'download', 'ghost', `data-id="${esc(t.id)}"`)}
            ${btn(icon(providerOnly(t) ? 'eye' : 'play') + (providerOnly(t) ? ' Voorbeeld' : ' Testmail'), 'test-open', 'ghost', `data-id="${esc(t.id)}"`)}
          </div>
        </header>
        <div class="mail-trigger-note">${icon('bolt')}<div><strong>${esc(t.trigger)}</strong><span>${esc(t.recipient)} · ${esc(t.timing)}</span></div></div>
        ${providerOnly(t) ? `<p class="mail-notice">Dit sjabloon wordt via de inlogprovider verstuurd. ${readOnly(t) ? 'Het platform beheert het ontwerp. Bekijk hier het voorbeeld.' : 'Bewerk en exporteer hier het ontwerp voor de provider.'} De getoonde code is fictief.</p>` : ''}
        <div class="mail-editor-tabs" role="group" aria-label="Sjabloonweergave">
          ${btn(readOnly(t) ? 'Inhoud' : 'Bewerken', 'editor-panel', 'ghost', `data-panel="edit" aria-pressed="${editorPanel === 'edit'}"`)}
          ${btn('Voorbeeld', 'editor-panel', 'ghost', `data-panel="preview" aria-pressed="${editorPanel === 'preview'}"`)}
        </div>
        <div class="mail-editor-grid" data-editor-panel="${editorPanel}">
          <form class="mail-edit-form" data-form="mail-template">
            <input type="hidden" name="templateId" value="${esc(t.id)}">
            <input type="hidden" name="scopeKey" value="${esc(currentScope())}">
            <div class="mail-section-label"><h3>Inhoud</h3><span id="mail-save-state">${saved.draft ? 'Opgeslagen concept' : 'Actieve versie'}</span></div>
            ${input('Onderwerp', 'subject', t.subject, readOnly(t), 'Bijvoorbeeld: {{name}}, je partij staat klaar')}
            ${input('Voorvertoning in inbox', 'preheader', t.preheader, readOnly(t))}
            ${input('Titel in de mail', 'title', t.title, readOnly(t))}
            <label class="mail-field"><span>Bericht</span><textarea name="body" rows="7" data-mail-input="editor" ${readOnly(t) ? 'disabled' : ''}>${esc(t.body)}</textarea><small>Een lege regel maakt een nieuwe alinea. Persoonlijke velden vul je met {{variabele}}.</small></label>
            ${input('Tekst op de actieknop', 'cta', t.cta, readOnly(t))}
            <div class="mail-variable-chips" aria-label="Beschikbare persoonlijke velden">${(t.variables || []).map(name => `<button type="button" data-action="mail-variable" data-variable="${esc(name)}" ${readOnly(t) ? 'disabled' : ''}>{{${esc(name)}}}</button>`).join('')}</div>
            ${!readOnly(t) ? `<div class="mail-edit-actions"><button type="submit" class="btn ghost">Concept opslaan</button>${btn('Publiceren', 'publish', 'gold', `data-id="${esc(t.id)}"`)}${btn(icon('undo') + ' Herstellen', 'revert', 'ghost', `data-id="${esc(t.id)}"`)}</div>` : ''}
          </form>
          <section class="mail-preview-panel" aria-label="Voorbeeldmail">
            <div class="mail-preview-toolbar">
              <h3>Voorbeeld</h3>
              <div class="mail-segment" role="group" aria-label="Voorbeeldformaat">
                ${btn('Desktop', 'viewport', 'ghost', `data-viewport="desktop" aria-pressed="${viewport === 'desktop'}"`)}
                ${btn('Mobiel', 'viewport', 'ghost', `data-viewport="mobile" aria-pressed="${viewport === 'mobile'}"`)}
              </div>
            </div>
            <div class="mail-inbox-preview"><span>Van</span><strong id="mail-preview-from">${esc(settings().senderName || 'DartFlow')}</strong><span>Onderwerp</span><strong id="mail-preview-subject">${esc(preview.subject)}</strong></div>
            <div class="mail-preview-canvas ${viewport === 'mobile' ? 'is-mobile' : ''}"><iframe id="mail-preview-frame" title="Voorbeeld van ${esc(t.name)}" sandbox="" data-mail-preview srcdoc="${esc(previewHtml(preview.html))}"></iframe></div>
            <details class="mail-example-data"><summary>Voorbeeldgegevens</summary><dl>${Object.entries(variables).filter(([name]) => (t.variables || []).includes(name)).map(([name,val]) => `<div><dt>{{${esc(name)}}}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl></details>
          </section>
        </div>
      </div>
    </section>`;
  }
  function input(label, name, value, disabled = false, placeholder = '') {
    return `<label class="mail-field"><span>${esc(label)}</span><input type="text" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" data-mail-input="editor" ${disabled ? 'disabled' : ''} maxlength="${name === 'subject' ? '180' : '400'}"></label>`;
  }
  function listHtml(items) {
    return items.length ? items.map(item => {
      const t = template(item.id), override = config(item.id);
      return `<button type="button" class="mail-template-item ${selectedId === item.id ? 'active' : ''}" data-action="mail-select" data-id="${esc(item.id)}" aria-pressed="${selectedId === item.id}"><span class="mail-template-icon">${icon(item.status === 'provider' ? 'shield' : 'mail')}</span><span><strong>${esc(item.name)}</strong><small>${esc(item.category)}${override.draft ? ' · Concept' : ''}</small></span><i class="mail-state-dot ${t.enabled === false ? 'off' : ''}" aria-label="${t.enabled === false ? 'Uitgeschakeld' : 'Ingeschakeld'}"></i></button>`;
    }).join('') : '<div class="mail-empty-small">Geen sjablonen gevonden.</div>';
  }
  function logView() {
    return `<section class="df-workspace__panel mail-log">
      <div class="mail-section-head"><div><h2>Verzendlog</h2><p>Gesimuleerde mails voor ${esc(ctx.scopeName?.() || 'deze omgeving')}.</p></div>${btn(icon('plus') + ' Voorbeelden laden', 'seed', 'ghost')}</div>
      <div class="mail-filter-bar">
        <label class="mail-search">${icon('search')}<span class="mail-sr-only">Zoek in verzendlog</span><input type="search" data-mail-input="log-search" value="${esc(logQuery)}" placeholder="Zoek op ontvanger of onderwerp…"></label>
        <label class="mail-field"><span class="mail-sr-only">Filter op resultaat</span><select data-mail-input="log-status">
          <option value="all" ${logStatus === 'all' ? 'selected' : ''}>Alle resultaten</option>
          <option value="simulated" ${logStatus === 'simulated' ? 'selected' : ''}>Test geslaagd</option>
          <option value="failed" ${logStatus === 'failed' ? 'selected' : ''}>Aandacht nodig</option>
        </select></label>
      </div>
      <div id="mail-log-entries">${logEntries()}</div>
    </section>`;
  }
  function logEntries() {
    const term = logQuery.toLowerCase();
    const items = ownOutbox().filter(item => (logStatus === 'all' || item.status === logStatus) && (!term || [item.subject,item.recipient?.name,item.recipient?.email].join(' ').toLowerCase().includes(term))).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (!items.length) {
      const filtered = term || logStatus !== 'all';
      return `<div class="mail-empty"><h3>${filtered ? 'Geen passende berichten' : 'Nog geen berichten'}</h3><p>${filtered ? 'Pas je zoekopdracht of filter aan.' : 'Maak een testmail vanuit Sjablonen of laad voorbeelden.'}</p></div>`;
    }
    return `<div class="mail-log-table-wrap"><table class="mail-log-table" role="table" aria-label="Gesimuleerde mails">
      <thead role="rowgroup"><tr role="row">
        <th scope="col" role="columnheader">Bericht</th>
        <th scope="col" role="columnheader">Ontvanger</th>
        <th scope="col" role="columnheader">Moment</th>
        <th scope="col" role="columnheader">Resultaat</th>
        <th scope="col" role="columnheader">Acties</th>
      </tr></thead>
      <tbody role="rowgroup">${items.map(item => {
        const kind = item.kind === 'example' ? 'Voorbeeld' : item.kind === 'test' ? (item.draft ? 'Concepttest' : 'Handmatige test') : 'Appactie';
        const failed = item.status === 'failed';
        const itemAttr = `data-id="${esc(item.id)}"`;
        return `<tr role="row">
          <td role="cell" class="mail-log-subject"><strong>${esc(item.subject || base(item.templateId)?.name || 'Bericht')}</strong><small>${esc(base(item.templateId)?.name || item.templateId)} · ${kind}</small></td>
          <td role="cell" class="mail-log-recipient">${esc(item.recipient?.name || 'Speler')}<small>${esc(item.recipient?.email || '')}</small></td>
          <td role="cell" class="mail-log-time">${esc(timestamp(item.createdAt))}</td>
          <td role="cell" class="mail-log-result">${badge(failed ? 'Test mislukt' : 'Test geslaagd', failed ? 'red' : 'green')}</td>
          <td role="cell" class="mail-log-actions"><div class="mail-inline-actions">${btn('Bekijk', 'log-open', 'ghost', itemAttr)}${failed ? btn('Opnieuw', 'retry', 'ghost', itemAttr) : ''}</div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }
  function automationsView() {
    const groups = [...new Set(MAIL_TEMPLATES.map(item => item.category))];
    return `<section class="mail-automations"><div class="mail-section-head"><div><h2>Automatiseringen</h2><p>Beheer welke appacties een mail aanmaken.</p></div></div>${groups.map(name => `<section class="df-workspace__panel mail-automation-group"><h3>${esc(name)}</h3><div class="mail-automation-list">${MAIL_TEMPLATES.filter(item => item.category === name).map(item => {
      const t = template(item.id);
      return `<article class="mail-automation-row"><div class="mail-automation-icon">${icon(item.status === 'provider' ? 'shield' : item.status === 'planned' ? 'clock' : 'bolt')}</div><div class="mail-automation-content"><strong>${esc(item.name)}</strong><p>${esc(item.trigger)}</p><small>${esc(item.recipient)} · ${esc(item.timing)}</small><span class="mail-automation-status">${badge(STATUS_NAMES[item.status] || 'Klaar voor staging', item.status === 'wired' ? 'green' : item.status === 'planned' ? 'amber' : '')}</span></div><div class="mail-automation-controls">${btn('Voorbeeld', 'automation-preview', 'ghost', `data-id="${esc(item.id)}"`)}<button type="button" class="mail-toggle" role="switch" aria-checked="${t.enabled !== false}" aria-label="${esc(item.name)} inschakelen" data-action="mail-toggle" data-id="${esc(item.id)}" ${t.locked ? 'disabled title="Inlogmails zijn altijd actief"' : ''}><span></span></button></div></article>`;
    }).join('')}</div></section>`).join('')}</section>`;
  }
  function settings() {
    initializeMail(ctx.db);
    const value=ctx.db.mail.settings[currentScope()] || {senderName:scope() === null ? 'DartFlow' : (ctx.scopeName?.() || 'DartFlow'),senderEmail:'meldingen@dartflow.test',replyTo:'support@dartflow.test',reminders:true,enabled:true};
    return {...value,boardMail:template('board-call')?.enabled === true};
  }
  function settingsView() {
    const value = settings();
    return `<div class="mail-settings-grid"><form class="df-workspace__panel mail-settings-form" data-form="mail-settings"><input type="hidden" name="scopeKey" value="${esc(currentScope())}"><div class="mail-section-head"><div><p class="mail-eyebrow">${esc(ctx.scopeName?.() || 'DartFlow')}</p><h2>Afzender en voorkeuren</h2></div></div><label class="mail-field"><span>Naam afzender</span><input name="senderName" value="${esc(value.senderName)}" required maxlength="100"></label><label class="mail-field"><span>E-mailadres afzender</span><input type="email" name="senderEmail" value="${esc(value.senderEmail)}" required><small>Op staging gebruiken we een geverifieerd maildomein.</small></label><label class="mail-field"><span>Antwoorden ontvangen op</span><input type="email" name="replyTo" value="${esc(value.replyTo)}" required></label><label class="mail-checkbox"><input type="checkbox" name="enabled" ${value.enabled !== false ? 'checked' : ''}><span><strong>Mails bij appacties inschakelen</strong><small>Uitnodigingen en bevestigingen volgen je instellingen. Handmatige tests blijven beschikbaar.</small></span></label><label class="mail-checkbox"><input type="checkbox" name="reminders" ${value.reminders !== false ? 'checked' : ''}><span><strong>Herinneringen aanbieden</strong><small>Wedstrijd- en toernooiherinneringen staan klaar voor planning op staging.</small></span></label><label class="mail-checkbox"><input type="checkbox" name="boardMail" ${value.boardMail ? 'checked' : ''}><span><strong>Bordoproepen ook per mail</strong><small>De oproep op telefoon en zaalscherm blijft de snelste route.</small></span></label><div class="mail-edit-actions"><button type="submit" class="btn gold">Voorkeuren opslaan</button></div></form><aside class="df-workspace__panel mail-settings-info"><h2>Verzendstatus</h2>${badge('Gesimuleerd', 'amber')}<p>Testmails worden bewaard in het verzendlog van deze omgeving. Inlogcodes worden door de inlogprovider beheerd.</p></aside></div>`;
  }
  function refreshPreview() {
    const t = draftTemplate(), output = renderMail(t,example(t));
    const frame = document.getElementById('mail-preview-frame');
    if (frame) frame.srcdoc = previewHtml(output.html);
    const subject = document.getElementById('mail-preview-subject');
    if (subject) subject.textContent = output.subject;
  }
  function ensureScope(value) {
    if (!access() || (value != null && String(value) !== currentScope())) { ctx.toast('Je omgeving is gewijzigd. Open Mailbeheer opnieuw.'); return false; }
    return true;
  }
  function showTest(id) {
    const t = id === selectedId ? draftTemplate() : template(id);
    if (providerOnly(t)) {
      ctx.showModal('Voorbeeld inlogmail', 'Fictieve code · wordt via de inlogprovider verstuurd', `<div class="mail-log-details"><iframe sandbox="" data-mail-preview title="Voorbeeld inlogmail" srcdoc="${esc(previewHtml(outputFor(t).html))}"></iframe><div class="modal-actions">${ctx.button('Sluiten','close-modal','gold')}</div></div>`);
      return;
    }
    ctx.showModal('Test je mail', t.name, `<form class="mail-test-form" data-form="mail-test"><input type="hidden" name="templateId" value="${esc(t.id)}"><input type="hidden" name="scopeKey" value="${esc(currentScope())}"><label class="mail-field"><span>Naam ontvanger</span><input name="name" value="Rick van Dijk" required maxlength="100"></label><label class="mail-field"><span>Testadres</span><input type="email" name="email" value="rick@voorbeeld.test" required></label><p class="mail-notice">De test wordt met voorbeeldgegevens als gesimuleerde mail in de verzendlog opgeslagen.</p><div class="modal-actions">${ctx.button('Annuleren','close-modal','ghost')}<button class="btn gold" type="submit">Testmail maken</button></div></form>`);
  }
  function outputFor(t, recipientName) {
    return renderMail(t,{...example(t), ...(recipientName ? {name:recipientName} : {})});
  }
  function download(html, name) {
    const url = URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function handleAction(action, button, event) {
    if (!action.startsWith('mail-')) return false;
    event?.preventDefault();
    if (!ensureScope()) return true;
    init();
    const id = button.dataset.id;
    switch (action) {
      case 'mail-tab': if (TAB_NAMES[button.dataset.tab]) {tab=button.dataset.tab;ctx.render();} break;
      case 'mail-select': {
        if (base(id)?.id !== id) break;
        const list = button.closest?.('.mail-template-list');
        const scroll = list?.scrollTop;
        resetEditor(id);
        ctx.render();
        if (list) {
          const currentList = document.getElementById('mail-template-list');
          currentList.scrollTop = scroll;
          currentList.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
        }
        break;
      }
      case 'mail-editor-panel': {
        editorPanel = button.dataset.panel === 'preview' ? 'preview' : 'edit';
        const studio = button.closest('.mail-studio-main');
        studio.querySelector('.mail-editor-grid').dataset.editorPanel = editorPanel;
        for (const control of studio.querySelectorAll('[data-action="mail-editor-panel"]')) {
          control.setAttribute('aria-pressed', String(control.dataset.panel === editorPanel));
        }
        break;
      }
      case 'mail-viewport': {
        viewport = button.dataset.viewport === 'mobile' ? 'mobile' : 'desktop';
        const panel = button.closest('.mail-preview-panel');
        panel.querySelector('.mail-preview-canvas').classList.toggle('is-mobile', viewport === 'mobile');
        for (const control of panel.querySelectorAll('[data-action="mail-viewport"]')) {
          control.setAttribute('aria-pressed', String(control.dataset.viewport === viewport));
        }
        break;
      }
      case 'mail-variable': {
        if (readOnly(activeTemplate())) break;
        const field = document.querySelector('.mail-edit-form textarea[name="body"]');
        if (!field || !(activeTemplate().variables || []).includes(button.dataset.variable)) break;
        const text = `{{${button.dataset.variable}}}`;
        const start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? start;
        field.setRangeText(text,start,end,'end'); draft.body=field.value;field.focus();refreshPreview();
        const saveState=document.getElementById('mail-save-state');if(saveState)saveState.textContent='Niet opgeslagen';
        break;
      }
      case 'mail-publish': {
        if (readOnly(activeTemplate()) || id !== selectedId) break;
        const output = outputFor(draftTemplate());
        if (output.missing.length) {ctx.toast('Vul eerst geldige variabelen in: ' + output.missing.join(', '));break;}
        const value=config(id);value.published=changes(draft);delete value.draft;value.version=(template(id).version || 1)+1;value.updatedAt=new Date().toISOString();ctx.save();ctx.render();ctx.toast('Het sjabloon is gepubliceerd voor deze omgeving.');break;
      }
      case 'mail-revert': if (!readOnly(activeTemplate()) && id === selectedId) {delete config(id).draft;resetEditor(id);ctx.save();ctx.render();ctx.toast('Het concept is hersteld naar de actieve versie.');} break;
      case 'mail-test-open': showTest(id);break;
      case 'mail-download': { const t=id === selectedId ? draftTemplate() : template(id);download(outputFor(t).html,`DartFlow-${t.id}.html`);ctx.toast('De voorbeeldmail is gedownload.');break; }
      case 'mail-toggle': {
        const t=template(id);if(t?.locked)break;const value=config(id);value.enabled=t.enabled === false;ctx.save();ctx.render();ctx.toast(value.enabled?'Mailmoment ingeschakeld.':'Mailmoment uitgeschakeld.');break;
      }
      case 'mail-automation-preview': resetEditor(id);editorPanel='preview';tab='templates';ctx.render();break;
      case 'mail-seed': {
        const stamp='example-'+currentScope()+'-';
        const picks=MAIL_TEMPLATES.filter(t=>!t.locked&&template(t.id).enabled!==false).slice(0,3);
        let count=0;
        picks.forEach(t=>{const eventId=stamp+t.id;if(!ownOutbox().some(item=>item.eventId===eventId)){createMailItem(ctx.db,{templateId:t.id,eventId,scopeId:scope(),recipient:{name:'Rick van Dijk',email:'rick@voorbeeld.test'},variables:example(t),kind:'example'});count++;}});
        ctx.save();ctx.render();ctx.toast(count?'Voorbeeldmails toegevoegd.':'Deze voorbeeldmails staan al in de verzendlog.');break;
      }
      case 'mail-log-open': {
        const item=ownOutbox().find(value=>String(value.id)===String(id));if(!item)break;
        ctx.showModal('Maildetails', item.subject, `<div class="mail-log-details"><dl><div><dt>Ontvanger</dt><dd>${esc(item.recipient?.name)} · ${esc(item.recipient?.email)}</dd></div><div><dt>Moment</dt><dd>${esc(timestamp(item.createdAt))}</dd></div><div><dt>Resultaat</dt><dd>${esc(item.status==='failed'?'Test mislukt':'Test geslaagd')} · ${item.draft ? 'Concept · basisversie' : 'Versie'} ${esc(item.version || 1)}</dd></div></dl>${item.missing?.length?`<p class="mail-notice">Ontbrekende velden: ${esc(item.missing.join(', '))}</p>`:''}<iframe sandbox="" data-mail-preview title="Bewaarde voorbeeldmail" srcdoc="${esc(previewHtml(item.html || ''))}"></iframe><div class="modal-actions">${ctx.button('Sluiten','close-modal','gold')}</div></div>`);break;
      }
      case 'mail-retry': {
        const item=ownOutbox().find(value=>String(value.id)===String(id));if(!item||item.status!=='failed')break;
        const output=renderMail(item.template || base(item.templateId),item.variables||{});if(item.missing?.includes('recipient.email'))output.missing.push('recipient.email');item.attempts=(item.attempts||1)+1;item.lastAttemptAt=new Date().toISOString();Object.assign(item,output,{status:output.missing.length?'failed':'simulated'});ctx.save();ctx.render();ctx.toast(output.missing.length?'Vul eerst de ontbrekende voorbeeldgegevens aan.':'De test is opnieuw uitgevoerd.');break;
      }
    }
    return true;
  }
  function handleForm(form, values) {
    if (!form.dataset.form?.startsWith('mail-')) return false;
    if (!ensureScope(values.scopeKey)) return true;
    init();
    switch(form.dataset.form) {
      case 'mail-template': {
        if (values.templateId !== selectedId || readOnly(activeTemplate())) return true;
        draft=changes(values);config(selectedId).draft=changes(draft);ctx.save();ctx.render();ctx.toast('Het concept is opgeslagen. Publiceer als het klaar is.');break;
      }
      case 'mail-test': {
        const t=values.templateId===selectedId?draftTemplate():template(values.templateId);
        if (providerOnly(t)) {ctx.closeModal();showTest(t.id);return true;}
        const item=createMailItem(ctx.db,{templateId:t.id,eventId:'test-'+crypto.randomUUID(),scopeId:scope(),recipient:{name:values.name.trim(),email:values.email.trim()},variables:{...example(t),name:values.name.trim()},kind:'test'});
        if(!item){ctx.toast('Dit mailmoment staat uit. Schakel het eerst in.');return true;}
        const output=outputFor(t,values.name.trim());if(item.missing?.includes('recipient.email'))output.missing.push('recipient.email');
        const active=template(t.id);const isDraft=Object.keys(changes(t)).some(key=>t[key]!==active[key]);
        Object.assign(item,output,{status:output.missing.length?'failed':'simulated',version:active.version||1,draft:isDraft,template:{...t,example:undefined}});
        ctx.save();ctx.closeModal();tab='log';ctx.render();ctx.toast('Je testmail staat in de verzendlog.');break;
      }
      case 'mail-settings': {
        ctx.db.mail.settings[currentScope()]={senderName:values.senderName.trim(),senderEmail:values.senderEmail.trim(),replyTo:values.replyTo.trim(),reminders:values.reminders==='on',enabled:values.enabled==='on'};config('board-call').enabled=values.boardMail==='on';ctx.save();ctx.render();ctx.toast('De mailvoorkeuren zijn opgeslagen.');break;
      }
    }
    return true;
  }
  function handleInput(target) {
    const type=target?.dataset?.mailInput;
    if(!type || !access())return false;
    if (editorScope !== currentScope()) {ctx.render();return true;}
    if(type==='editor'&&!readOnly(activeTemplate())){draft ||= changes(activeTemplate());draft[target.name]=target.value;refreshPreview();const state=document.getElementById('mail-save-state');if(state)state.textContent='Niet opgeslagen';}
    if(type==='template-search'){query=target.value;const list=document.getElementById('mail-template-list');if(list)list.innerHTML=listHtml(visibleTemplates());}
    if(type==='category'){category=target.value;const list=document.getElementById('mail-template-list');if(list)list.innerHTML=listHtml(visibleTemplates());}
    if(type==='log-search'){logQuery=target.value;const list=document.getElementById('mail-log-entries');if(list)list.innerHTML=logEntries();}
    if(type==='log-status'){logStatus=target.value;const list=document.getElementById('mail-log-entries');if(list)list.innerHTML=logEntries();}
    return true;
  }
  return {init,render,handleAction,handleForm,handleInput};
}
