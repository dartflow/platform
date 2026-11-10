import {createBaanPhone} from './baan-phone.js';
import {renderBaanHub, renderBaanScreen} from './baan-screen.js';

const defaultRoom = 'duindorp-baan-1';
const boardPattern = /^(?:duindorp-baan-1|demo-[a-z0-9]{12,32})$/;
const routeSurfaces = {'baan': 'hub', 'baan-screen': 'screen', 'baan-phone': 'phone'};
const scheduledFields = ['scheduled','name','opponent','first','startScore','bestOfLegs','boardTitle','venue'];

export function newBaanRoom() {
  return 'demo-' + crypto.randomUUID().replaceAll('-', '').slice(0,24);
}

export function baanUrl(surface, id = defaultRoom, query = {}) {
  const url = new URL('/', location.origin);
  const params = new URLSearchParams(query).toString();
  const path = surface === 'hub' ? 'baan' : 'baan-' + surface + '/' + id;
  url.hash = path + (params ? '?' + params : '');
  return url.href;
}

async function api(path, {body, token, signal} = {}) {
  const requestController = signal ? null : new AbortController();
  const timeout = requestController && setTimeout(() => requestController.abort(), 6000);
  const headers = {Accept: 'application/json'};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch('/api/baan/' + path, {
      method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body),
      cache: 'no-store', signal: signal || requestController.signal
    });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Verbinding met de baan lukt niet.');
    const result = await response.json();
    if (!response.ok && !result.error) throw new Error('Verbinding met de baan lukt niet.');
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export function baanRead(id) {
  if (!boardPattern.test(id)) return Promise.resolve({error:'Deze baan bestaat niet.'});
  return api(id);
}

export function createBaan({render, toast, escape}) {
  let routeKey = '', surface = '', roomId = defaultRoom, query = new URLSearchParams();
  let state = null, revision = 0, actor = null, history = [], connected = false;
  let generation = 0, timer, controller, token = '', deviceKey = '', pending = null, busy = false;
  let demoRoom = newBaanRoom();

  try {
    const stored = sessionStorage.getItem('dartflow-baan-demo');
    if (stored && boardPattern.test(stored)) demoRoom = stored;
    else sessionStorage.setItem('dartflow-baan-demo', demoRoom);
  } catch {}

  function session(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key) || '';
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {}
    return '';
  }

  function refreshView() {
    const field = document.activeElement;
    const parent = field?.closest?.('form[data-form]');
    const formName = parent?.dataset.form;
    const fieldName = field?.name;
    const selection = field?.selectionStart == null ? null : [field.selectionStart, field.selectionEnd];
    render();
    if (!formName || !fieldName) return;
    const target = document.querySelector(`form[data-form="${CSS.escape(formName)}"] [name="${CSS.escape(fieldName)}"]`);
    target?.focus({preventScroll:true});
    if (selection) target?.setSelectionRange?.(...selection);
  }

  function update(result) {
    if (!result.state || result.revision < revision) return false;
    const changed = !connected || result.revision !== revision ||
      result.state.status !== state?.status || result.state.match?.id !== state?.match?.id ||
      result.actor?.id !== actor?.id || JSON.stringify(result.history || []) !== JSON.stringify(history);
    state = result.state;
    revision = result.revision;
    actor = result.actor || null;
    history = result.history || [];
    connected = true;
    return changed;
  }

  function markOffline() {
    if (connected) {
      connected = false;
      refreshView();
    }
  }

  function queuePoll(current) {
    if (current !== generation || !['screen','phone'].includes(surface)) return;
    const interval = document.hidden ? 5000 : !connected ? 1200 : state?.status === 'idle' ? 1350 : 700;
    timer = setTimeout(() => poll(current), interval);
  }

  async function poll(current) {
    if (current !== generation) return;
    if (busy) { queuePoll(current); return; }
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 5000);
    try {
      const result = await api(roomId, {token, signal: request.signal});
      if (current !== generation || busy) return;
      if (result.error) markOffline();
      else if (update(result)) refreshView();
    } catch {
      if (current === generation) markOffline();
    } finally {
      clearTimeout(timeout);
      if (current === generation) controller = null;
      queuePoll(current);
    }
  }

  function scheduledParams() {
    return Object.fromEntries(scheduledFields.filter(key => query.has(key)).map(key => [key, query.get(key).slice(0,120)]));
  }

  function setRoute(next, param = '') {
    const nextKey = routeSurfaces[next] ? next + '/' + param : '';
    if (nextKey === routeKey) return;
    routeKey = nextKey;
    surface = routeSurfaces[next] || '';
    const [id, options] = param.split('?');
    query = new URLSearchParams(options);
    roomId = boardPattern.test(id || '') ? id : defaultRoom;
    deviceKey = 'dartflow-baan-profile-' + (query.get('device') === '2' ? '2' : '1');
    token = surface === 'phone' ? session(deviceKey) : '';
    state = null;
    revision = 0;
    actor = null;
    history = [];
    connected = false;
    pending = null;
    busy = false;
    generation++;
    clearTimeout(timer);
    controller?.abort();
    if (surface === 'screen' || surface === 'phone') void poll(generation);
  }

  async function login(name) {
    const current = generation;
    try {
      const result = await api('profile', {body:{name}});
      if (current !== generation || result.error) return result;
      token = result.token;
      session(deviceKey, token);
      actor = result.actor;
      history = [];
      clearTimeout(timer);
      controller?.abort();
      generation++;
      void poll(generation);
      refreshView();
      return result;
    } catch {
      return {error:'Aanmelden lukt even niet. Probeer het opnieuw.'};
    }
  }

  function logout() {
    session(deviceKey, '');
    token = '';
    actor = null;
    history = [];
    pending = null;
    clearTimeout(timer);
    controller?.abort();
    generation++;
    void poll(generation);
    refreshView();
  }

  async function send(action) {
    if (!actor) return {error:'Maak eerst een spelersprofiel aan.'};
    if (busy) return {error:'Je vorige actie wordt verwerkt.'};
    busy = true;
    const current = generation;
    const key = JSON.stringify(action);
    if (!pending || pending.key !== key) pending = {
      key, data: {action, revision, requestId: crypto.randomUUID()}
    };
    try {
      const result = await api(roomId, {token, body:pending.data}).catch(() => api(roomId, {token, body:pending.data}));
      if (current !== generation) return {error:'De baankoppeling is gewijzigd.'};
      pending = null;
      update(result);
      refreshView();
      return result;
    } catch {
      if (current === generation) markOffline();
      return {error:'Geen bevestiging ontvangen. Controleer de stand en probeer dezelfde actie opnieuw.'};
    } finally {
      if (current === generation) busy = false;
    }
  }

  async function copy(value) {
    try { await navigator.clipboard.writeText(value); return true; }
    catch { return false; }
  }

  const ctx = {
    state:() => state, actor:() => actor, history:() => history, online:() => connected,
    id:() => roomId, query:key => query.get(key), inviteToken:() => query.get('invite'),
    demoId:() => demoRoom, url:baanUrl, phoneUrl:() => baanUrl('phone', roomId, scheduledParams()),
    qrUrl:() => '/api/baan/qr/' + roomId + '?' + new URLSearchParams(scheduledParams()),
    render:refreshView, escape, toast, copy, send, login, logout
  };
  const phone = createBaanPhone(ctx);

  function refreshConnection() {
    if (!['screen','phone'].includes(surface) || busy || controller) return;
    clearTimeout(timer);
    void poll(generation);
  }
  window.addEventListener('online', refreshConnection);
  window.addEventListener('offline', markOffline);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshConnection();
  });

  return {
    setRoute,
    view() {
      if (surface === 'screen') return renderBaanScreen(ctx);
      if (surface === 'phone') return phone.view();
      return renderBaanHub(ctx);
    },
    action(button) {
      if (button.dataset.action === 'baan-fullscreen') {
        if (document.fullscreenElement) void document.exitFullscreen?.();
        else void document.getElementById('app').requestFullscreen?.().catch(() => toast('Open het schermvullend via je browser.'));
        return true;
      }
      if (button.dataset.action === 'baan-copy-link') {
        void copy(button.dataset.url).then(success => toast(success ? 'Link gekopieerd.' : 'Kopiëren is hier niet beschikbaar.'));
        return true;
      }
      return surface === 'phone' && phone.handleAction(button);
    },
    form(form, fields) { return surface === 'phone' && phone.handleForm(form, fields); },
    input(event) { if (surface === 'phone') phone.handleInput?.(event); },
    change(event) { if (surface === 'phone') phone.handleChange?.(event); }
  };
}
