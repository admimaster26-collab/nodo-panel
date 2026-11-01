const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const READ_KEY = 'nodo_chat_read_marks_v1';
const noop = () => {};
const at = minute => `2026-10-21T12:${String(minute).padStart(2, '0')}:00.000Z`;
const message = (minute, origen = 'USUARIO') => ({ origen, fecha: at(minute), mensaje: `${origen}-${minute}` });
const ticket = (usuario, thread, accepted = true) => ({ usuario, masterId: usuario, accepted, thread });

// DOM mínimo con nodos reales del harness: los marcadores se insertan/quitan y los
// textos se conservan entre refrescos. No se sustituye la función que pinta badges.
function element(className = '', textContent = '') {
  const node = {
    className, textContent, children: [], parentElement: null, style: {}, dataset: {}, value: '',
    id: '', attributes: new Map(), addEventListener: noop, removeEventListener: noop,
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
      }
    },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(value => value.trim());
      const matches = child => selectors.some(value => value === '*' || (value[0] === '.' && child.className.split(/\s+/).includes(value.slice(1))));
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  node.classList = {
    contains: name => node.className.split(/\s+/).includes(name),
    add: (...names) => { node.className = [...new Set([...node.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
    remove: (...names) => { node.className = node.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
    toggle(name, force) {
      const active = force === undefined ? !this.contains(name) : force;
      this[active ? 'add' : 'remove'](name);
      return active;
    }
  };
  let html = '';
  Object.defineProperty(node, 'innerHTML', {
    get: () => html,
    set: value => { html = String(value); node.children.forEach(child => { child.parentElement = null; }); node.children = []; }
  });
  Object.defineProperty(node, 'innerText', { get: () => node.textContent, set: value => { node.textContent = String(value); } });
  return node;
}

function harness(tickets = []) {
  const elements = new Map(), storage = new Map(), timers = [], events = new Map();
  const body = element(), head = element();
  function add(id, node = element()) { node.id = id; elements.set(id, node); body.appendChild(node); return node; }
  const badge = add('badgeChat'), stat = add('statChats'), nav = add('navChat'), list = add('chatList');
  const card = element(), subtitle = element('stat-sub');
  stat.remove(); card.appendChild(stat); card.appendChild(subtitle); body.appendChild(card);
  const document = {
    body, head, readyState: 'complete', hidden: false, visibilityState: 'visible', hasFocus: () => true,
    getElementById: id => elements.get(id) || [...head.children, ...body.querySelectorAll('*')].find(node => node.id === id) || null,
    createElement: () => element(), querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    addEventListener(name, callback) { events.set(name, [...(events.get(name) || []), callback]); }
  };
  const forbidden = () => { throw new Error('Esta prueba no permite conexiones de red'); };
  const sb = {
    document, console, localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)
    },
    sessionStorage: { getItem: () => null, setItem: noop },
    setTimeout(callback, delay) { timers.push({ callback, delay, once: true }); return timers.length; },
    setInterval(callback, delay) { timers.push({ callback, delay, once: false }); return timers.length; },
    clearTimeout: noop, clearInterval: noop, addEventListener: noop, removeEventListener: noop,
    fetch: forbidden, WebSocket: forbidden, rpc: forbidden, supabaseClient: { rpc: forbidden, from: forbidden },
    toast: noop, alert: noop, confirm: () => false,
    navigator: { userAgent: 'unit-test' }, matchMedia: () => ({ matches: false, addEventListener: noop }),
    requestAnimationFrame: noop, MutationObserver: class { observe() {} disconnect() {} },
    ticketsAgrupados: () => tickets,
    renderChatListStep2: noop, renderChatMensajes: noop,
    V154P: { solicitudes: [], chats: [], chatMensajes: [] }, solicitudes: [], chats: [],
    lastChatUnread: 0
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  function load(file) { new vm.Script(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file }).runInContext(sb); }
  function loadOwner() { load('renderer/chat/metrics.js'); load('renderer/chat/chat-no-leidos.js'); }
  function paintRows(names = tickets.map(t => t.usuario)) {
    list.innerHTML = '<div class="wq2-wrap"></div>';
    list.appendChild(element('wq2-tab', 'En espera'));
    list.appendChild(element('wq2-tab', 'Abiertos'));
    names.forEach(name => {
      const row = element('wq2-item');
      row.appendChild(element('wq2-name', name));
      row.appendChild(element('wq2-state', 'ABIERTO'));
      row.appendChild(element('wq2-meta'));
      list.appendChild(row);
    });
  }
  function row(name) { return list.querySelectorAll('.wq2-item').find(node => node.querySelector('.wq2-name').textContent === name); }
  function tick(delay) {
    const due = timers.filter(timer => timer.delay === delay && !timer.done);
    assert.ok(due.length, `debe existir un refresco registrado a ${delay} ms`);
    due.forEach(timer => { if (timer.once) timer.done = true; timer.callback(); });
  }
  function assertTotal(total) {
    assert.equal(String(badge.textContent), String(total), 'badge lateral');
    assert.equal(String(stat.textContent), String(total), 'estadística Inicio');
    assert.equal(badge.classList.contains('hidden'), total === 0, 'visibilidad badge');
  }
  return { sb, load, loadOwner, paintRows, row, tick, assertTotal, badge, stat, nav, list, subtitle, add };
}

test('sidebar, Inicio, pestaña y filas usan el mismo corte por operador y marca local', () => {
  const answered = ticket('respondido', [message(1), message(2, 'OPERADOR')]);
  const pending = ticket('pendiente', [message(1), message(2, 'OPERADOR'), message(3), message(4)]);
  const local = ticket('marcado', [message(1), message(3)]);
  const waiting = ticket('espera', [message(4)], false);
  const h = harness([answered, pending, local, waiting]);
  h.loadOwner();
  h.sb.localStorage.setItem(READ_KEY, JSON.stringify({ [h.sb.NodoChatMetrics.chatKey(local)]: at(1) }));
  h.paintRows();
  h.sb.nodoChatRefreshUnread();
  h.assertTotal(3);
  assert.equal(h.row('respondido').querySelector('.wq2-unread-final'), null);
  assert.equal(h.row('pendiente').querySelector('.wq2-unread-final').textContent, '2');
  assert.equal(h.row('marcado').querySelector('.wq2-unread-final').textContent, '1');
  assert.equal(h.row('espera').querySelector('.wq2-unread-final'), null);
  assert.match(h.list.querySelectorAll('.wq2-tab')[1].innerHTML, /background:#ef4444[^>]*>3</);
  assert.equal(h.sb.nodoChatUnreadSnapshot().total, 3);
});

test('refrescar actualiza el texto nuevo, no duplica marcadores y limpia todos al llegar a cero', () => {
  const t = ticket('demo', [message(1)]);
  const h = harness([t]); h.loadOwner(); h.paintRows();
  h.sb.nodoChatRefreshUnread();
  assert.match(h.row('demo').querySelector('.wq2-state').textContent, /1 nuevo/);
  t.thread.push(message(2));
  h.sb.nodoChatRefreshUnread(); h.sb.nodoChatRefreshUnread();
  h.assertTotal(2);
  assert.equal(h.row('demo').querySelectorAll('.wq2-unread-final').length, 1);
  assert.match(h.row('demo').querySelector('.wq2-state').textContent, /2 nuevos/);
  assert.doesNotMatch(h.row('demo').querySelector('.wq2-state').textContent, /1 nuevo/);
  h.sb.nodoChatMarkAllRead();
  h.assertTotal(0);
  assert.equal(h.row('demo').querySelector('.wq2-unread-final'), null);
  assert.equal(h.row('demo').querySelector('.wq2-state').textContent, 'ABIERTO');
  assert.equal(h.nav.style.boxShadow, '');
  assert.equal(h.subtitle.textContent, 'Consultas portal');
});

test('una página parcial conserva el total resuelto por servidor y excluye conversaciones cerradas', () => {
  const partial = { ...ticket('paginado', [message(1)]), _unreadServidor: 19 };
  const closed = { ...ticket('cerrado', [message(1)]), _unreadServidor: 8, cerrado: true };
  const h = harness([partial, closed]); h.loadOwner(); h.paintRows();
  h.sb.nodoChatRefreshUnread(); h.assertTotal(19);
  assert.equal(h.row('paginado').querySelector('.wq2-unread-final').textContent, '19');
  assert.equal(h.row('cerrado').querySelector('.wq2-unread-final'), null);
  assert.equal(h.sb.nodoChatUnreadSnapshot().accepted, 1);
});

test('un cero legítimo no resucita durante el refresco de estabilidad', () => {
  const h = harness([ticket('demo', [message(1)])]);
  h.loadOwner(); h.load('renderer/chat/chat-estabilidad.js'); h.paintRows();
  h.tick(800); h.assertTotal(1);
  h.sb.nodoChatMarkAllRead();
  // Disparar los callbacks realmente registrados por el render: el módulo de
  // estabilidad ya no necesita un segundo intervalo que compita con el dueño.
  h.sb.renderChatListStep2(); h.tick(40); h.tick(60); h.assertTotal(0);
  h.sb.renderChatListStep2(); h.assertTotal(0); // firma igual: camino sin repintado
  h.tick(4000); h.assertTotal(0);
  assert.equal(h.row('demo').querySelector('.wq2-unread-final'), null);
  assert.doesNotMatch(h.row('demo').querySelector('.wq2-state').textContent, /nuevo/);
});

test('cambiar la conversación leída conserva los no leídos de la otra y repintar recupera sus marcadores', () => {
  const one = ticket('uno', [message(1), message(2)]), two = ticket('dos', [message(3)]);
  const h = harness([one, two]); h.loadOwner(); h.paintRows(); h.sb.nodoChatRefreshUnread();
  h.sb.__nodoChatCurrentTicket = one;
  h.sb.nodoChatMarkReadCurrent(); h.assertTotal(1);
  assert.equal(h.row('uno').querySelector('.wq2-unread-final'), null);
  h.paintRows(['dos', 'uno']);
  h.sb.renderChatListStep2(); h.tick(40);
  assert.equal(h.row('dos').querySelector('.wq2-unread-final').textContent, '1');
  h.sb.__nodoChatCurrentTicket = two;
  h.sb.nodoChatMarkReadCurrent(); h.assertTotal(0);
  const marks = JSON.parse(h.sb.localStorage.getItem(READ_KEY));
  assert.equal(marks[h.sb.NodoChatMetrics.chatKey(one)], at(2));
  assert.equal(marks[h.sb.NodoChatMetrics.chatKey(two)], at(3));
});

for (const file of ['renderer/chat/chat-local.js', 'renderer/chat/chat-hilos.js']) {
  test(`el render ${path.basename(file)} no reemplaza mensajes nuevos por tickets en espera`, () => {
    const current = ticket('vigente', [message(1), message(2)]);
    const h = harness([current]);
    h.sb.V154P.solicitudes = [1, 2, 3].map(id => ({ ID: id, TIPO: 'SOPORTE', ESTADO: 'PENDIENTE', USUARIO: `espera${id}`, FECHA_CREACION: at(id) }));
    h.load('renderer/chat/message-model.js'); h.load(file);
    // El lector dueño puede provenir del canal nuevo: el render legacy todavía
    // tiene tres solicitudes en espera, pero ésas no son mensajes nuevos.
    h.sb.ticketsAgrupados = () => [current];
    h.loadOwner(); h.sb.nodoChatRefreshUnread(); h.assertTotal(2);
    h.sb.v15RenderChatList();
    h.assertTotal(2);
  });
}

test('watchdog conserva el contador del dueño aunque SIN_LEER legacy tenga otra cantidad', () => {
  const h = harness([ticket('demo', [message(1)])]);
  h.loadOwner(); h.load('renderer/core/avisos-y-watchdog.js');
  h.sb.chats = [{ SIN_LEER: 91 }]; h.sb.nodoChatRefreshUnread();
  h.sb.verificarChats(false); h.assertTotal(1);
});

test('cargar sesiones Portal conserva los badges del dueño frente a SIN_LEER del servidor', async () => {
  const h = harness([ticket('demo', [message(1)])]); h.loadOwner();
  const PortalChat = require('../renderer/portal/chat.js');
  let calls = 0;
  const portal = PortalChat.create({
    window: h.sb, document: h.sb.document, V154P: h.sb.V154P, chats: [],
    getCanal: async () => 'DEMO', normArr: value => Array.isArray(value) ? value : [],
    rpc: async () => { calls++; return { data: [{ id: 'test', sin_leer: 91, estado: 'ABIERTO' }], error: null }; },
    v15RenderChatList: noop, renderChatList: noop, alert: noop, setTimeout: noop
  });
  h.sb.nodoChatRefreshUnread(); await portal.cargarChatsPortal(true);
  assert.equal(calls, 1, 'sólo el fake de sesiones; el contador no agrega consultas');
  h.assertTotal(1);
});

test('envío beta persiste su clave antes del POST y reintenta desde disco con la misma identidad',async()=>{
  const h=harness(),calls=[];
  const current={id:'BETA_1',_beta:true,_canalNuevo:true,_betaPc:'DEMO',_chatId:'A-B',usuario:'demo',accepted:true};
  const requestId='01234567-89ab-4def-8123-456789abcdef';
  const storageKey='nodo_chat_local_beta_'+encodeURIComponent(JSON.stringify(['DEMO','A-B']));
  h.sb.pcOperativa='DEMO';h.sb.crypto={randomUUID:()=>requestId};
  h.sb.__nodoChatCurrentTicket=current;
  h.sb.NodoBetaChat={observeRendered:noop,enviar:async(id,msg)=>{
    const persisted=JSON.parse(h.sb.localStorage.getItem(storageKey));
    assert.equal(persisted[0].request_id,requestId,'la clave existe antes de la solicitud');
    calls.push({id,request:msg.request_id});
    if(calls.length===1)throw new Error('OFFLINE');
    return{id:'91',tipo_emisor:'OPERADOR',mensaje:msg.mensaje,created_at:at(5)};
  }};
  h.load('renderer/chat/message-model.js');h.load('renderer/chat/chat-hilos.js');
  h.add('chatInput').value='respuesta de ensayo';const body=h.add('chatBody');
  const first=await h.sb.enviarChat();assert.equal(first.ok,false);
  assert.match(body.innerHTML,/Confirmación pendiente/);
  // Reload the actual module: the retry is recovered from stored data, not the
  // in-memory object passed during the first send.
  h.load('renderer/chat/chat-hilos.js');
  const retry=await h.sb.nodoReintentarMensajeBeta(requestId);
  assert.equal(retry.ok,true);assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1]);
  assert.equal(JSON.parse(h.sb.localStorage.getItem(storageKey))[0].persisted,true);
  assert.doesNotMatch(body.innerHTML,/Confirmación pendiente/);
  h.sb.__nodoChatCurrentTicket={...current,_chatId:'A_B'};
  assert.equal((await h.sb.nodoReintentarMensajeBeta(requestId)).error,'BETA_PENDING_MESSAGE_MISSING','IDs distintos no comparten outbox');
});

test('Inicio muestra el mismo contador y alerta aunque haya otra cantidad de espera y SIN_LEER', () => {
  const h = harness([ticket('demo', [message(1), message(2)])]); h.loadOwner();
  const alerts = h.add('alertas');
  Object.assign(h.sb, {
    solicitudes: [], billeteras: [], chats: [{ SIN_LEER: 91 }], __wq2EnEspera: 53,
    _historialCargado: true, pcOperativa: 'DEMO', esPendiente: () => false,
    normalizar: value => String(value || '').toUpperCase(),
    setBox: (id, value) => { const node = h.sb.document.getElementById(id); if (node) node.textContent = String(value); }
  });
  h.load('renderer/core/vistas-y-billeteras.js');
  h.sb.renderFichasInicio = noop; h.sb.renderBillerasInicio = noop; h.sb.poblarManualBilletera = noop;
  h.sb.nodoChatRefreshUnread(); h.sb.renderInicio();
  h.assertTotal(2);
  assert.match(alerts.textContent, /Hay 2 mensaje/);
  assert.doesNotMatch(alerts.textContent, /91|53/);
});
