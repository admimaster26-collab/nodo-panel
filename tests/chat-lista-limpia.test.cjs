const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// La lista de chats, sin ruido.
//
// Lo que se reclamó (Juan): arriba de la lista del chat había tres botones sin formato que nadie
// entendía y que estaban mal integrados; lo que se le muestra al operador tiene que ser
// información reducida, sin códigos ni textos técnicos; y el chat "detecta mensajes que no
// existen" (un total en pantalla sin ninguna fila que lo explicara).
//
// Estas pruebas corren el CÓDIGO REAL (metrics, canal nuevo, lista, globitos y cliente beta) sobre
// un DOM mínimo; no leen los archivos como texto. Cargan las fuentes y no el bundle generado, así
// que no dependen de haber corrido `npm run panel:build`.

const RAIZ = path.join(__dirname, '..');
const noop = () => {};
const Metrics = require('../renderer/chat/metrics.js');
const SIN_CONEXION = 'Sin conexión con el chat. Reintentando…';

function cargar(sb, archivo) {
  new vm.Script(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), { filename: archivo }).runInContext(sb);
}

// Deja correr lo que quedó esperando (las promesas del canal y los repintados que vienen después).
async function reposo() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((listo) => setImmediate(listo));
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

// ══════════════════════════════════════════════════════════════════════════════
// 1 · Los números: la fila muestra lo mismo que suma el total
// ══════════════════════════════════════════════════════════════════════════════

test('un chat en espera cuenta lo que dice el servidor; uno cerrado, nunca', () => {
  const espera = { usuario: 'nuevo', accepted: false, thread: [], _unreadServidor: 10 };
  assert.equal(Metrics.unreadForTicket(espera, {}), 10, 'el total del servidor lo cuenta: la fila tiene que mostrarlo');
  assert.equal(Metrics.unreadForTicket({ ...espera, cerrado: true }, {}), 0);
  assert.equal(Metrics.unreadForTicket({ ...espera, _unreadServidor: undefined }, {}), 0,
    'sin número del servidor, uno que nadie aceptó no suma nada');
  assert.equal(Metrics.unreadForTicket({ usuario: 'x', accepted: true, thread: [], _unreadServidor: 0 }, {}), 0);
});

test('el snapshot trae los mismos tickets con los que sacó la cuenta', () => {
  const tickets = [
    { usuario: 'a', id: 'T1', accepted: true, thread: [], _unreadServidor: 5 },
    { usuario: 'b', id: 'T2', accepted: false, thread: [], _unreadServidor: 10 },
    { usuario: 'c', id: 'T3', accepted: true, cerrado: true, thread: [], _unreadServidor: 8 }
  ];
  const foto = Metrics.snapshot(tickets, {});
  assert.equal(foto.total, 15, 'espera suma, cerrado no');
  assert.equal(foto.tickets.length, 3);
  // `unread` tiene por clave el OBJETO: sólo sirve preguntarle con los objetos de esta foto.
  assert.deepEqual(foto.tickets.map((t) => foto.unread.get(t)), [5, 10, 0]);
  assert.ok(foto.tickets.every((t, i) => t === tickets[i]));
});

function entornoGlobitos() {
  // DOM de verdad en memoria: los globitos se agregan y se quitan de nodos reales.
  function elemento(clase = '', texto = '') {
    const nodo = {
      className: clase, textContent: texto, children: [], parentElement: null, style: {}, dataset: {}, value: '', id: '',
      addEventListener: noop, removeEventListener: noop,
      appendChild(hijo) { hijo.parentElement = this; this.children.push(hijo); return hijo; },
      remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter((h) => h !== this); this.parentElement = null; } },
      setAttribute: noop, getAttribute: () => null,
      querySelectorAll(selector) {
        const clases = selector.split(',').map((s) => s.trim());
        const coincide = (h) => clases.some((s) => s === '*' || (s[0] === '.' && h.className.split(/\s+/).includes(s.slice(1))));
        return this.children.flatMap((h) => [...(coincide(h) ? [h] : []), ...h.querySelectorAll(selector)]);
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
    nodo.classList = {
      contains: (n) => nodo.className.split(/\s+/).includes(n),
      add: (...ns) => { nodo.className = [...new Set([...nodo.className.split(/\s+/).filter(Boolean), ...ns])].join(' '); },
      remove: (...ns) => { nodo.className = nodo.className.split(/\s+/).filter((n) => !ns.includes(n)).join(' '); }
    };
    let html = '';
    Object.defineProperty(nodo, 'innerHTML', {
      get: () => html,
      set: (v) => { html = String(v); nodo.children.forEach((h) => { h.parentElement = null; }); nodo.children = []; }
    });
    return nodo;
  }
  const cuerpo = elemento(), cabeza = elemento(), lista = elemento(), insignia = elemento('hidden', '0');
  lista.id = 'chatList'; insignia.id = 'badgeChat';
  cuerpo.appendChild(lista); cuerpo.appendChild(insignia);
  const doc = {
    body: cuerpo, head: cabeza, readyState: 'complete',
    getElementById: (id) => (id === 'chatList' ? lista : [...cabeza.children, ...cuerpo.querySelectorAll('*')].find((n) => n.id === id) || null),
    createElement: () => elemento(), querySelector: (s) => cuerpo.querySelector(s), querySelectorAll: (s) => cuerpo.querySelectorAll(s),
    addEventListener: noop
  };
  const almacen = new Map(), avisos = [];
  // Los tickets que devuelve el sistema real son OBJETOS NUEVOS en cada llamada. Una prueba que
  // devolvía siempre los mismos nunca pudo ver el defecto de las filas sin globito.
  let base = [];
  const beta = { activo: true, total: 0, cuentas: {} };
  const sb = {
    document: doc, console, localStorage: {
      getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, String(v)), removeItem: (k) => almacen.delete(k)
    },
    sessionStorage: { getItem: () => null, setItem: noop },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout: noop, clearInterval: noop, addEventListener: noop,
    toast: (texto, color) => avisos.push({ texto, color }),
    ticketsAgrupados: () => base.map((t) => ({ ...t, thread: [...(t.thread || [])] })),
    NodoBetaChat: {
      active: () => beta.activo, total: () => beta.total, count: (id) => beta.cuentas[id], status: () => ({ enabled: true, code: '' }),
      flushVisible: async () => {}
    }
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  cargar(sb, 'renderer/chat/metrics.js');
  cargar(sb, 'renderer/chat/chat-no-leidos.js');
  function pintarFilas(tickets) {
    lista.innerHTML = '<div class="wq2-wrap"></div>';
    lista.appendChild(elemento('wq2-tab', 'En espera'));
    lista.appendChild(elemento('wq2-tab', 'Abiertos'));
    tickets.forEach((t) => {
      const fila = elemento('wq2-item');
      fila.dataset.ticketId = t.id;
      fila.appendChild(elemento('wq2-name', t.usuario));
      fila.appendChild(elemento('wq2-meta', '11:00'));
      lista.appendChild(fila);
    });
  }
  const filaDe = (usuario) => lista.querySelectorAll('.wq2-item').find((f) => f.querySelector('.wq2-name').textContent === usuario);
  const globito = (usuario) => filaDe(usuario).querySelector('.wq2-unread-final');
  return { sb, beta, avisos, lista, insignia, pintarFilas, filaDe, globito, poner: (tickets) => { base = tickets; } };
}

const betaTicket = (id, usuario, extra = {}) => ({
  id: 'BETA_' + id, usuario, _beta: true, _chatId: id, _betaPc: 'P1', accepted: true, thread: [], ...extra
});

test('cada fila muestra su número y la suma de las filas es el total del costado', () => {
  const e = entornoGlobitos();
  // El total del servidor (15) sale de estas tres: 5 de uno abierto, 10 de uno que espera. El
  // cerrado trae 8 pero no cuenta. Con la cuenta vieja las filas quedaban todas sin globito.
  const tickets = [
    betaTicket('A', 'abierto'), betaTicket('B', 'al_dia'),
    betaTicket('C', 'espera', { accepted: false }), betaTicket('D', 'cerrado', { cerrado: true, accepted: false })
  ];
  e.poner(tickets);
  e.beta.cuentas = { A: 5, B: 0, C: 10, D: 8 };
  e.beta.total = 15;
  e.pintarFilas(tickets);
  e.sb.nodoChatRefreshUnread();

  assert.equal(e.globito('abierto').textContent, '5');
  assert.equal(e.globito('espera').textContent, '10', 'el que espera suma al total, así que la fila lo dice');
  assert.equal(e.globito('al_dia'), null, 'cero no pinta globito');
  assert.equal(e.globito('cerrado'), null, 'cerrado no cuenta');

  const sumaDeFilas = ['abierto', 'espera'].reduce((n, u) => n + Number(e.globito(u).textContent), 0);
  assert.equal(sumaDeFilas, e.sb.nodoChatUnreadSnapshot().total, 'lo que se ve en las filas explica el total');
});

test('la foto de los no leídos expone sus tickets y la fila los busca ahí', () => {
  const e = entornoGlobitos();
  const tickets = [betaTicket('A', 'uno'), betaTicket('B', 'dos')];
  e.poner(tickets);
  e.beta.cuentas = { A: 2, B: 3 }; e.beta.total = 5;
  const foto = e.sb.nodoChatUnreadSnapshot();
  assert.deepEqual(Array.from(foto.tickets, (t) => t.usuario), ['uno', 'dos']);
  assert.deepEqual(Array.from(foto.tickets, (t) => foto.unread.get(t)), [2, 3]);

  e.pintarFilas(tickets);
  e.sb.nodoChatRefreshUnread();
  assert.equal(e.globito('uno').textContent, '2');
  assert.equal(e.globito('dos').textContent, '3');
  // Y cambia con el servidor: se actualiza el mismo globito, no se duplica.
  e.beta.cuentas = { A: 0, B: 4 }; e.beta.total = 4;
  e.sb.nodoChatRefreshUnread();
  assert.equal(e.globito('uno'), null);
  assert.equal(e.globito('dos').textContent, '4');
  assert.equal(e.filaDe('dos').querySelectorAll('.wq2-unread-final').length, 1);
});

test('cada solapa cuenta lo de sus filas; el total de la oficina queda en el costado', () => {
  const e = entornoGlobitos();
  // Antes "Abiertos" mostraba el total de TODA la oficina (18): los mensajes de los chats que
  // esperan aparecían en la solapa equivocada y las filas no sumaban lo que decía el número.
  const tickets = [
    betaTicket('A', 'abierto1'), betaTicket('B', 'abierto2'),
    betaTicket('C', 'espera1', { accepted: false }), betaTicket('D', 'espera2', { accepted: false })
  ];
  e.poner(tickets);
  e.beta.cuentas = { A: 5, B: 2, C: 10, D: 1 };
  e.beta.total = 18;
  e.pintarFilas(tickets);
  e.sb.nodoChatRefreshUnread();

  const [espera, abiertos] = e.lista.querySelectorAll('.wq2-tab');
  const rojo = (solapa) => (solapa.innerHTML.match(/background:#ef4444[^>]*>(\d+)</) || [])[1];
  assert.equal(rojo(espera), '11', 'En espera: 10 + 1');
  assert.equal(rojo(abiertos), '7', 'Abiertos: 5 + 2');
  assert.match(espera.innerHTML, /^En espera <span class="wq2-count">2<\/span>/, 'dos chats esperando');
  assert.match(abiertos.innerHTML, /^Abiertos <span class="wq2-count">2<\/span>/, 'dos abiertos');
  assert.equal(e.insignia.textContent, '18', 'el total de la oficina sigue en el costado');
  assert.equal(Number(rojo(espera)) + Number(rojo(abiertos)), 18, 'las solapas reparten el total sin sobrar ni faltar');

  // Sin nada sin leer, ninguna solapa pinta rojo.
  e.beta.cuentas = { A: 0, B: 0, C: 0, D: 0 }; e.beta.total = 0;
  e.sb.nodoChatRefreshUnread();
  assert.equal(rojo(espera), undefined);
  assert.equal(rojo(abiertos), undefined);
});

test('"Marcar leídas" avisa igual con el chat nuevo y sin él', () => {
  const e = entornoGlobitos();
  e.sb.nodoChatMarkAllRead();
  assert.deepEqual(e.avisos.at(-1), { texto: '✓ Todas marcadas como leídas', color: 'green' });
  e.beta.activo = false;
  e.sb.nodoChatMarkAllRead();
  assert.equal(e.avisos.at(-1).texto, '✓ Todas marcadas como leídas', 'sin chat nuevo sigue como siempre');
});

// ══════════════════════════════════════════════════════════════════════════════
// 2 · La lista de verdad: sin botones sueltos, con un solo buscador
// ══════════════════════════════════════════════════════════════════════════════

const CATALOGO = [
  { chat_id: 'A', sesion_id: '11', usuario: 'ana', estado: 'ABIERTO', ultimo_mensaje: 'hola', sin_leer: 3 },
  { chat_id: 'B', sesion_id: '12', usuario: 'beto', estado: 'ABIERTO', ultimo_mensaje: 'buenas', sin_leer: 0 },
  { chat_id: 'Z', sesion_id: '99', usuario: 'zeta', estado: 'ABIERTO', ultimo_mensaje: 'ayuda', sin_leer: 7 }
];

function entornoLista(opciones = {}) {
  const pidenAlServidor = [], avisos = [], timers = [];
  const estado = { enabled: true, code: '' };
  const fallas = { lista: null, mas: null, mensajes: null };
  let hayMas = opciones.hayMas === true;

  // ── DOM mínimo, con lo que importa acá: el innerHTML destruye el cuadro de búsqueda ──
  const cuerpo = { classList: { contains: () => false, add: noop, remove: noop }, appendChild: noop };
  const doc = { activeElement: cuerpo, body: cuerpo, hidden: false, readyState: 'complete', addEventListener: noop };
  const estilos = [];
  doc.head = { appendChild: (el) => { estilos.push(el); return el; } };
  doc.createElement = () => ({ id: '', textContent: '', style: {}, setAttribute: noop });
  const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  function entradaNueva(valor) {
    const el = {
      id: 'wq2Search', value: valor, selectionStart: valor.length, selectionEnd: valor.length, selectionDirection: 'none',
      focus() { doc.activeElement = el; },
      setSelectionRange(a, b, d) { el.selectionStart = a; el.selectionEnd = b; el.selectionDirection = d || 'none'; }
    };
    return el;
  }
  const caja = {
    id: 'chatList', scrollTop: 0, _html: '', entrada: null, envoltorio: { scrollTop: 0 },
    get innerHTML() { return this._html; },
    set innerHTML(valor) {
      this._html = String(valor);
      const viejo = this.entrada;
      const m = this._html.match(/<input id="wq2Search"[^>]*?value="([^"]*)"/);
      this.entrada = m ? entradaNueva(desescapar(m[1])) : null;
      this.envoltorio = { scrollTop: 0 };            // lo que se había bajado se pierde
      this.scrollTop = 0;
      if (viejo && doc.activeElement === viejo) doc.activeElement = cuerpo;   // y el foco también
    },
    querySelector(selector) { return selector === '.wq2-wrap' ? this.envoltorio : null; },
    querySelectorAll() { return []; }
  };
  doc.getElementById = (id) => (id === 'chatList' ? caja : id === 'wq2Search' ? caja.entrada : null);

  // ── El servidor del chat nuevo: la primera página trae a ana y beto; zeta sólo si se la busca ──
  const NodoBetaChat = {
    active: () => true, ready: async () => true, status: () => ({ ...estado }), count: () => undefined, total: () => undefined,
    flushVisible: async () => {},
    async lista(op = {}) {
      pidenAlServidor.push({ usuario: op.usuario ?? null, antesDe: op.beforeId ?? null });
      if (op.beforeId && fallas.mas) throw fallas.mas;
      if (!op.beforeId && fallas.lista) throw fallas.lista;
      const rows = (op.usuario ? CATALOGO.filter((r) => r.usuario === String(op.usuario).toLowerCase()) : CATALOGO.slice(0, 2))
        .map((r) => ({ ...r, fecha_ultimo: '2026-10-21T12:00:00.000Z', updated_at: '2026-10-21T12:00:00.000Z' }));
      return { rows, has_more: !op.usuario && !op.beforeId && hayMas, next_before_id: '10', total: rows.length, unread_total: 3 };
    }
  };

  const almacen = new Map();
  const sb = {
    document: doc, console, pcOperativa: 'P1',
    localStorage: { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, String(v)), removeItem: (k) => almacen.delete(k) },
    sessionStorage: { getItem: () => null, setItem: noop },
    setTimeout(fn, ms) { const t = { id: timers.length + 1, fn, ms, vivo: true }; timers.push(t); return t.id; },
    clearTimeout(id) { const t = timers.find((x) => x.id === id); if (t) t.vivo = false; },
    setInterval(fn, ms) { const t = { id: timers.length + 1, fn, ms, vivo: true, repite: true }; timers.push(t); return t.id; },
    clearInterval: noop, addEventListener: noop,
    toast: (texto, color) => avisos.push({ texto, color }),
    NodoBetaChat, V154P: { solicitudes: [] }, solicitudes: []
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  cargar(sb, 'renderer/chat/message-model.js');
  cargar(sb, 'renderer/chat/metrics.js');
  cargar(sb, 'renderer/chat/chat-canal-nuevo.js');
  cargar(sb, 'renderer/chat/chat-hilos.js');
  // ana ya fue aceptada por este operador (queda en "Abiertos"); beto espera.
  almacen.set('nodo_chat_accepted_users_v2', JSON.stringify({ ANA: { accepted: true, masterId: null, at: new Date().toISOString() } }));

  const esperaDeBusqueda = () => timers.filter((t) => t.vivo && !t.repite && t.ms === 400);
  return {
    sb, caja, doc, avisos, estado, fallas, pidenAlServidor, estilos, timers,
    html: () => caja.innerHTML,
    pintar: () => sb.renderChatListStep2(),
    // Escribe en el cuadro como lo haría el operador (con el cuadro en pantalla y con el foco).
    escribir(texto, { inicio, fin } = {}) {
      const cuadro = caja.entrada;
      cuadro.value = texto;
      cuadro.selectionStart = inicio ?? texto.length; cuadro.selectionEnd = fin ?? texto.length;
      cuadro.focus();
      sb.wq2Buscar();
    },
    esperaDeBusqueda,
    // Pasan los 400 ms sin que se escriba nada más.
    async pasan400() { esperaDeBusqueda().forEach((t) => { t.vivo = false; t.fn(); }); await reposo(); },
    vacioDeLaLista: () => (caja.innerHTML.match(/<div class="wq2-empty">([^<]*)<\/div>/) || [])[1],
    nombresEnPantalla: () => [...caja.innerHTML.matchAll(/<div class="wq2-name">([^<]*)<\/div>/g)].map((m) => m[1]),
    async arrancar() { await sb._chatCanalNuevo.cargar(true); sb.renderChatListStep2(); },
    hayMas: (v) => { hayMas = v; }
  };
}

test('arriba de la lista no quedan botones sueltos ni textos técnicos', async () => {
  const e = entornoLista();
  await e.arrancar();
  const html = e.html();

  for (const sobra of ['Diagnóstico de integraciones', 'NodoSalud', 'Buscar usuario exacto', 'Ver todos',
    'Chat conectado', 'Conexión pendiente', 'Conectando chat', 'historial antiguo', 'nodoBuscarChatBeta']) {
    assert.ok(!html.includes(sobra), 'no puede aparecer "' + sobra + '"');
  }
  // Todo botón que queda es de la lista (tienen clase): ninguno "crudo", sin formato.
  const botones = html.match(/<button\b[^>]*>/g) || [];
  assert.ok(botones.length >= 3, 'las solapas siguen estando');
  assert.deepEqual(botones.filter((b) => !/class="/.test(b)), [], 'ningún botón sin estilo');

  // Mientras anda bien la línea de estado existe pero está vacía: no ocupa lugar.
  assert.match(html, /<div id="nodoBetaChatEstado" class="wq2-estado" role="status"><\/div>/);
  assert.match(html, /id="wq2Search"/, 'el buscador de siempre');
  assert.deepEqual(e.nombresEnPantalla(), ['beto'], 'beto espera; ana está en Abiertos');
});

test('con un problema hay una sola línea corta y nunca un código', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.estado.code = 'BETA_RPC_FAILED';
  e.pintar();
  const linea = (e.html().match(/<div id="nodoBetaChatEstado"[^>]*>([^<]*)<\/div>/) || [])[1];
  assert.equal(linea, SIN_CONEXION);
  assert.ok(!e.html().includes('BETA_RPC_FAILED'), 'el código queda en el semáforo, no en la pantalla');
  assert.equal((e.html().match(/id="nodoBetaChatEstado"/g) || []).length, 1, 'una sola línea');

  e.estado.code = '';
  e.pintar();
  assert.match(e.html(), /<div id="nodoBetaChatEstado" class="wq2-estado" role="status"><\/div>/, 'vuelve a quedar vacía');
});

test('el estilo de la línea de estado y de "Cargar más" va dentro del ensureCss de la lista', async () => {
  const e = entornoLista();
  await e.arrancar();
  const css = e.estilos.map((s) => s.textContent).join('\n');
  assert.match(css, /\.wq2-estado\{/);
  assert.match(css, /\.wq2-estado:empty\{display:none\}/, 'vacía no ocupa lugar');
  assert.match(css, /\.wq2-mas\{/);
});

test('"Cargar más conversaciones" es el botón de las solapas, centrado al pie', async () => {
  const e = entornoLista({ hayMas: true });
  await e.arrancar();
  assert.match(e.html(), /<div class="wq2-mas"><button class="wq2-tab" onclick="nodoMasChatsBeta\(\)">Cargar más conversaciones<\/button><\/div>/);

  // Sin más páginas no se ofrece.
  const sin = entornoLista({ hayMas: false });
  await sin.arrancar();
  assert.ok(!sin.html().includes('Cargar más'));
});

test('mientras carga, el botón lo dice y no se puede apretar dos veces', async () => {
  const e = entornoLista({ hayMas: true });
  await e.arrancar();
  let liberar;
  e.sb.NodoBetaChat.lista = (op) => { e.pidenAlServidor.push({ usuario: op.usuario ?? null, antesDe: op.beforeId ?? null }); return new Promise((ok) => { liberar = () => ok({ rows: [], has_more: false }); }); };
  const primera = e.sb.nodoMasChatsBeta();
  await reposo();
  assert.match(e.html(), /<button class="wq2-tab" onclick="nodoMasChatsBeta\(\)" disabled>Cargando…<\/button>/);
  await e.sb.nodoMasChatsBeta();                       // segundo toque: no hace nada
  assert.equal(e.pidenAlServidor.filter((p) => p.antesDe).length, 1);
  liberar(); await primera;
  assert.ok(!e.html().includes('Cargando…'));
});

// ── Foco, cursor y posición de la lista ─────────────────────────────────────────────────────

test('al repintar, el cuadro conserva el foco, el cursor y el texto tal cual se escribió', async () => {
  const e = entornoLista();
  await e.arrancar();
  const viejo = e.caja.entrada;
  e.escribir('Ana Pe ', { inicio: 2, fin: 5 });        // mayúscula, espacio al final y un tramo elegido
  const nuevo = e.doc.getElementById('wq2Search');
  assert.notEqual(nuevo, viejo, 'el innerHTML rehízo el cuadro');
  assert.equal(e.doc.activeElement, nuevo, 'el foco sigue en el cuadro');
  assert.equal(nuevo.value, 'Ana Pe ', 'ni se pasa a minúsculas ni se recorta el espacio de la derecha');
  assert.deepEqual([nuevo.selectionStart, nuevo.selectionEnd], [2, 5], 'la selección queda donde estaba');

  // Lo mismo cuando repinta solo (el reloj de la lista, los mensajes que entran).
  e.doc.getElementById('wq2Search').setSelectionRange(1, 1);
  e.pintar();
  assert.equal(e.doc.activeElement, e.doc.getElementById('wq2Search'));
  assert.deepEqual([e.caja.entrada.selectionStart, e.caja.entrada.selectionEnd], [1, 1]);
});

test('repintar no le roba el foco a quien está escribiendo en otro lado', async () => {
  const e = entornoLista();
  await e.arrancar();
  const otroCampo = { id: 'chatInput' };
  e.doc.activeElement = otroCampo;
  e.pintar();
  assert.equal(e.doc.activeElement, otroCampo);
});

test('al repintar la lista no vuelve arriba de todo', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.caja.envoltorio.scrollTop = 240; e.caja.scrollTop = 36;
  e.pintar();
  assert.equal(e.caja.envoltorio.scrollTop, 240);
  assert.equal(e.caja.scrollTop, 36);
});

// ── El buscador de siempre hace todo ───────────────────────────────────────────────────────

test('escribir filtra lo que ya está y no molesta al servidor', async () => {
  const e = entornoLista();
  await e.arrancar();
  const antes = e.pidenAlServidor.length;
  e.escribir('bet');                                    // beto está en la lista
  assert.deepEqual(e.nombresEnPantalla(), ['beto']);
  await e.pasan400();
  assert.equal(e.pidenAlServidor.length, antes, 'si se ve acá, no hace falta ir al servidor');
});

test('con 3 letras o más y nada acá, a los 400 ms busca sólo en el servidor y repinta', async () => {
  const e = entornoLista();
  await e.arrancar();
  const antes = e.pidenAlServidor.length;

  e.escribir('zeta');
  assert.equal(e.pidenAlServidor.length, antes, 'todavía no: espera a que deje de escribir');
  assert.equal(e.esperaDeBusqueda().length, 1, 'hay UNA espera de 400 ms');
  assert.equal(e.vacioDeLaLista(), 'Buscando…', 'y mientras tanto la lista lo dice');

  await e.pasan400();
  assert.deepEqual(e.pidenAlServidor.slice(antes), [{ usuario: 'zeta', antesDe: null }]);
  assert.deepEqual(e.nombresEnPantalla(), ['zeta'], 'aparece el usuario que no estaba cargado');
  assert.equal(e.vacioDeLaLista(), undefined);
  assert.equal(e.doc.getElementById('wq2Search').value, 'zeta', 'el texto sigue en el cuadro');
});

test('seguir escribiendo antes de los 400 ms reinicia la espera: una sola búsqueda', async () => {
  const e = entornoLista();
  await e.arrancar();
  const antes = e.pidenAlServidor.length;
  e.escribir('zet'); e.escribir('zeta');
  assert.equal(e.esperaDeBusqueda().length, 1, 'la espera vieja se cancela');
  await e.pasan400();
  assert.deepEqual(e.pidenAlServidor.slice(antes), [{ usuario: 'zeta', antesDe: null }]);
});

test('sin resultados dice "No encontramos a ese usuario." y no queda en "Buscando…"', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.escribir('nadie');
  assert.equal(e.vacioDeLaLista(), 'Buscando…');
  await e.pasan400();
  assert.equal(e.vacioDeLaLista(), 'No encontramos a ese usuario.');
  assert.equal(e.pidenAlServidor.at(-1).usuario, 'nadie');
});

test('con menos de 3 letras no se pregunta al servidor', async () => {
  const e = entornoLista();
  await e.arrancar();
  const antes = e.pidenAlServidor.length;
  e.escribir('zz');
  assert.equal(e.vacioDeLaLista(), 'No encontramos a ese usuario.', 'no hay nada que esperar');
  await e.pasan400();
  assert.equal(e.pidenAlServidor.length, antes);
});

test('si está en otra solapa lo dice, en vez de afirmar que no existe', async () => {
  const e = entornoLista();
  await e.arrancar();
  const antes = e.pidenAlServidor.length;
  e.escribir('ana');                                    // ana está en Abiertos y la solapa es En espera
  assert.equal(e.vacioDeLaLista(), 'Nada en esta solapa. Hay resultados en: Abiertos (1).');
  await e.pasan400();
  assert.equal(e.pidenAlServidor.length, antes, 'ya la tiene cargada: no va al servidor');
});

test('vaciar el cuadro vuelve a la lista de siempre', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.escribir('zeta'); await e.pasan400();
  assert.deepEqual(e.nombresEnPantalla(), ['zeta']);
  assert.equal(e.sb._chatCanalNuevo.consulta(), 'zeta');

  e.escribir('');
  await e.pasan400();
  assert.deepEqual(e.pidenAlServidor.at(-1), { usuario: null, antesDe: null }, 'buscarUsuario("") pide la lista normal');
  assert.equal(e.sb._chatCanalNuevo.consulta(), '');
  assert.deepEqual(e.nombresEnPantalla(), ['beto']);
});

test('cambiar a otra búsqueda vuelve antes a la lista de siempre y recién ahí pregunta', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.escribir('zeta'); await e.pasan400();
  const marca = e.pidenAlServidor.length;
  e.escribir('omega'); await e.pasan400();
  assert.deepEqual(e.pidenAlServidor.slice(marca), [
    { usuario: null, antesDe: null },
    { usuario: 'omega', antesDe: null }
  ]);
  assert.equal(e.vacioDeLaLista(), 'No encontramos a ese usuario.');
});

test('achicar el texto a menos de 3 letras suelta el filtro del servidor', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.escribir('zeta'); await e.pasan400();
  e.escribir('be');                                    // 2 letras: se filtra lo local, sobre la lista normal
  await e.pasan400();
  assert.equal(e.sb._chatCanalNuevo.consulta(), '');
  assert.deepEqual(e.nombresEnPantalla(), ['beto']);
});

test('si la lista queda filtrada con el cuadro vacío, se arregla sola (sin insistir cada pasada)', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.escribir('zeta'); await e.pasan400();
  // Se pierde el texto sin pasar por el cuadro (por ejemplo, la vista se rearma).
  e.caja.entrada.value = '';
  const marca = e.pidenAlServidor.length;
  e.pintar(); await reposo();
  assert.deepEqual(e.pidenAlServidor.slice(marca), [{ usuario: null, antesDe: null }]);
  assert.equal(e.sb._chatCanalNuevo.consulta(), '');
  e.pintar(); e.pintar(); await reposo();
  assert.equal(e.pidenAlServidor.length, marca + 1, 'ya volvió: no se pide otra vez');
});

// ── Cuando el servidor falla: frases cortas, sin el motivo técnico ─────────────────────────

test('si falla la búsqueda, el operador lee una frase corta y no el motivo técnico', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.fallas.lista = new Error('BETA_RPC_FAILED: 57014 canceling statement due to statement timeout');
  e.escribir('zeta'); await e.pasan400();
  assert.deepEqual(e.avisos.at(-1), { texto: 'No pudimos buscar. Probá de nuevo en un momento.', color: 'red' });
  assert.ok(!/BETA_|57014|timeout|RPC/.test(e.avisos.map((a) => a.texto).join('|')));
  assert.equal(e.vacioDeLaLista(), 'No encontramos a ese usuario.', 'no queda colgado en "Buscando…"');
  assert.equal(e.avisos.length, 1, 'un solo aviso');
});

test('si falla "cargar más", el aviso es corto y el botón vuelve', async () => {
  const e = entornoLista({ hayMas: true });
  await e.arrancar();
  e.fallas.mas = new Error('BETA_INVALID_LIST');
  await e.sb.nodoMasChatsBeta();
  assert.deepEqual(e.avisos.at(-1), { texto: 'No pudimos cargar más conversaciones. Probá de nuevo en un momento.', color: 'red' });
  assert.ok(!e.avisos.at(-1).texto.includes('BETA_'));
  assert.match(e.html(), />Cargar más conversaciones</, 'se puede reintentar');
});

test('si fallan los mensajes anteriores, el aviso es corto', async () => {
  const e = entornoLista();
  await e.arrancar();
  e.sb.__nodoChatCurrentTicket = { _beta: true, _chatId: 'A' };
  e.sb._chatCanalNuevo.paginaMensajes = () => ({ has_more: true, next_before_id: '3' });
  e.sb._chatCanalNuevo.mensajesDe = async () => { throw new Error('BETA_INVALID_MESSAGES'); };
  await e.sb.nodoMasMensajesBeta();
  assert.deepEqual(e.avisos.at(-1), { texto: 'No pudimos cargar los mensajes anteriores. Probá de nuevo en un momento.', color: 'red' });
});

test('buscar no deja la bandeja en blanco mientras espera la respuesta', async () => {
  const e = entornoLista();
  await e.arrancar();
  const canal = e.sb._chatCanalNuevo;
  let liberar;
  e.sb.NodoBetaChat.lista = () => new Promise((ok) => { liberar = () => ok({ rows: [], has_more: false }); });
  const buscando = canal.buscarUsuario('zeta');
  await reposo();
  assert.equal(canal.crudas().length, 2, 'la lista de siempre sigue ahí hasta que llega la respuesta');
  liberar(); await buscando;
  assert.equal(canal.crudas().length, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3 · El texto de estado que escribe el cliente del chat nuevo
// ══════════════════════════════════════════════════════════════════════════════

function clienteBeta(respuestas = {}) {
  const { create } = require('../renderer/chat/beta-chat.js');
  const nodo = { textContent: '' };
  const CONTRATO = 'nodo.beta.v1';
  const raiz = {
    pcOperativa: 'DEMO', innerHeight: 600, innerWidth: 800,
    requestAnimationFrame: noop, setTimeout: () => 1, clearTimeout: noop, addEventListener: noop,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    document: { hidden: false, visibilityState: 'visible', hasFocus: () => true, body: { classList: { contains: () => true } },
      addEventListener: noop, getElementById: (id) => (id === 'nodoBetaChatEstado' ? nodo : null) },
    panelAPI: {
      getContext: async () => ({ beta: { enabled: true, offices: ['DEMO'], build: 'test' } }),
      rpc: async (fn, args) => {
        if (respuestas[fn]) return respuestas[fn](args);
        if (fn === 'nodo_beta_capacidades_v1') return { data: { ok: true, contract: CONTRATO, scope: { pc_codigo: 'DEMO' }, capabilities: ['chat.list.v1', 'chat.messages.v1', 'chat.read.v1'], active: args.p_activate, build: 'test' } };
        if (fn === 'nodo_beta_chat_lista_v1') return { data: { ok: true, contract: CONTRATO, rows: [{ chat_id: 'A', sin_leer: 1 }], total: 1, unread_total: 1 } };
        if (fn === 'nodo_beta_chat_mensajes_v1') return { data: { ok: true, contract: CONTRATO, chat_id: args.p_chat_id, rows: [{ id: '9', tipo_emisor: 'USUARIO' }], counts: { unread: 1 }, legacy_thread: respuestas.antiguo || [] } };
        throw new Error('RPC inesperada ' + fn);
      }
    }
  };
  return { api: create(raiz), nodo };
}

test('el cliente del chat no escribe nada cuando anda, ni códigos cuando falla', async () => {
  let cae = false;
  const c = clienteBeta({ nodo_beta_chat_lista_v1: async () => (cae ? { error: { code: 'OFFLINE_57014' } }
    : { data: { ok: true, contract: 'nodo.beta.v1', rows: [{ chat_id: 'A', sin_leer: 1 }], total: 1, unread_total: 1 } }) });
  await c.api.lista();
  assert.equal(c.nodo.textContent, '', 'andando: nada, ni "Chat conectado"');

  cae = true;
  await assert.rejects(c.api.lista());
  assert.equal(c.nodo.textContent, SIN_CONEXION);
  assert.ok(!/OFFLINE|57014/.test(c.nodo.textContent), 'sin códigos');

  cae = false;
  await c.api.lista();
  assert.equal(c.nodo.textContent, '', 'vuelve a quedar vacío');
});

test('el historial antiguo sin identidad ya no se le cuenta al operador en la lista', async () => {
  const c = clienteBeta({ antiguo: [{ origen: 'USUARIO', mensaje: 'anterior', portal_key: 'legacy:1:1' }] });
  await c.api.lista();
  await c.api.mensajes('A');
  assert.equal(c.api.status().stage, 'DEGRADED', 'el estado técnico se conserva para el semáforo');
  assert.equal(c.nodo.textContent, '');
  assert.ok(!/historial|antiguo|identidad/i.test(c.nodo.textContent));
});
