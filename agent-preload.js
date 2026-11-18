const { contextBridge, ipcRenderer } = require('electron');

const USER_SEARCH_URL = 'https://bo.casinodrex.com/agents/user_search';
// Cerrar sesión DE VERDAD. Es el link "Salir" del menú lateral de Agentes. Ir a user_search con la
// cookie muerta sólo volvía a mostrar el cartel; /logout la tira y deja la pantalla de ingreso.
const LOGOUT_URL = 'https://bo.casinodrex.com/logout';
const DEFAULT_TIMEOUT = 18000; // antes 30s — si un elemento no aparece (ventana trabada), falla más rápido y libera
const STEP_DELAY = 180;

const SELECTORS = {
  searchButton: '#searchButton',
  noResults: '.crmpam_no_data_found',
  playerAlias: '[data-agenttree-user-type="player"], .agents-alias-text',
  amountInput: 'input[name="amount"]:not([disabled]):not([readonly])',
  password: 'input#password[name="password"], input[name="password"][type="password"]',
  passwordRepeat: 'input[name="pasword2"][type="password"], input[name="password2"][type="password"]'
};

function delay(ms = STEP_DELAY) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Freno REAL de operación (⛔ Cancelar) ─────────────────────────────────────
// El ⛔ del panel setea este flag (via abortarOperacion). Toda espera (waitFor) lo chequea y
// corta, y applyAmount frena en el ÚLTIMO punto seguro: ANTES del click en Aplicar. Después de
// Aplicar se IGNORA (la plata ya pudo moverse — hay que leer el resultado sí o sí).
let _abortOperacion = false;
function _chequearFreno(donde) {
  if (_abortOperacion) throw new Error('⛔ Operación frenada por el operador' + (donde ? ' (' + donde + ')' : '') + '. No se aplicó plata.');
}

// La sesión se puede morir EN MEDIO de una espera: el cartel aparece un instante y Drex deja la
// página inservible. Toda espera lo mira, así una búsqueda corta en un segundo con "hay que entrar
// de nuevo" en vez de agotar 3 × 18 s y terminar en "la consulta tardó demasiado" (Juan, 13/09).
// Después de apretar Aplicar NO se corta: ahí la plata ya pudo moverse y hay que leer el resultado.
let _yaAplico = false;
function _chequearSesionViva() {
  if (_yaAplico) return;
  if (!detectarModalSesionInvalida()) return;
  const err = new Error('Se cayó la sesión de Agentes (Drex mostró "session is invalid"). No se operó: hay que entrar de nuevo.');
  err.sesionInvalida = true;
  throw err;
}

function now() {
  return Date.now();
}

// ¿La ventana tiene layout calculado? La de Agentes se crea con show:false y Chromium puede
// saltear el layout mientras no se ve: ahí getBoundingClientRect() devuelve TODO en cero.
// backgroundThrottling:false mantiene el JS corriendo, pero no fuerza el layout.
function hayLayout() {
  try {
    const r = document.body ? document.body.getBoundingClientRect() : null;
    return !!(r && r.width > 0 && r.height > 0);
  } catch (_) { return true; }   // ante la duda, asumimos que sí (comportamiento de siempre)
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  // Sin layout, un rect en cero NO significa "está oculto": significa que nadie lo midió.
  // Medirlo igual hacía que las búsquedas no encontraran nada con la ventana en segundo plano
  // (mismo bug que se detectó en BET300: "no encuentra al usuario", que desaparecía al dejar
  // la ventana de Agentes abierta).
  if (!hayLayout()) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function visibleElements(selector, root = document) {
  return Array.from(root.querySelectorAll(selector)).filter(isVisible);
}

function firstVisible(selector, root = document) {
  return visibleElements(selector, root)[0] || null;
}

async function waitFor(predicate, timeout = DEFAULT_TIMEOUT, interval = 120) {
  const started = now();
  while (now() - started < timeout) {
    _chequearFreno(); // el ⛔ Cancelar corta cualquier espera en curso
    _chequearSesionViva(); // y si la sesión se murió, no tiene sentido seguir esperando
    const value = typeof predicate === 'function' ? predicate() : document.querySelector(predicate);
    if (value) return value;
    await delay(interval);
  }
  throw new Error('Tiempo de espera agotado esperando la página externa.');
}

function nativeSetValue(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
}

function setReactInputValue(input, value) {
  if (!input) throw new Error('No se encontró el input requerido.');
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const set = v => nativeSetter ? nativeSetter.call(input, v) : (input.value = v);
  input.click();
  input.focus();
  set('');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  set(String(value));
  input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: String(value), inputType: 'insertText' }));
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

// Inyecta valor + verifica que React lo aceptó. Si no, reintenta hasta `tries` veces.
// Devuelve true si el valor quedó seteado, false si no.
async function setReactInputAndVerify(input, value, tries = 4) {
  const target = String(value);
  for (let i = 0; i < tries; i++) {
    setReactInputValue(input, target);
    await delay(120); // ventana de verificación
    if (String(input.value || '') === target) return true;
  }
  return false;
}

function clickElement(el) {
  if (!el) throw new Error('No se encontró el elemento clickeable.');
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus();
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  el.click();
}

function clickButtonByIcon(iconName) {
  const isDeposit = /plus|deposit|carga/i.test(iconName);
  const isWithdraw = /minus|withdraw|retiro/i.test(iconName);
  const iconNames = isDeposit
    ? ['circle-plus', 'plus-circle', 'plus', 'add', 'deposit']
    : isWithdraw
      ? ['circle-minus', 'minus-circle', 'minus', 'remove', 'withdraw']
      : [iconName];

  let icon = null;
  for (const name of iconNames) {
    icon = firstVisible(`svg[data-icon="${name}"], [data-icon="${name}"], svg[class*="${name}"], [class*="${name}"]`);
    if (icon) break;
  }

  let button = icon ? (icon.closest('button, [role="button"], a') || icon.parentElement) : null;
  if (!button) {
    const buttons = visibleElements('button, [role="button"], a');
    const textRe = isDeposit ? /cargar|deposit|agregar|sumar|credito|credito|cr[eé]dito|\+/i
      : isWithdraw ? /retirar|retiro|extraer|debitar|quitar|descontar|-/i
      : new RegExp(iconName, 'i');
    button = buttons.find(btn => {
      const text = `${btn.textContent || ''} ${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''} ${btn.className || ''}`;
      return textRe.test(text);
    });
  }
  if (!button) {
    throw new Error(`No se encontro el boton de ${isDeposit ? 'carga' : isWithdraw ? 'retiro' : iconName}.`);
  }
  clickElement(button);
  return true;
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseMoney(value) {
  let s = String(value || '').replace(/[\u00a0\u202f\s]/g, '').replace(/[^\d,.]/g, '');
  if (!s) return 0;
  const lastDot   = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > lastComma)        s = s.replace(/,/g, '');
  else if (lastComma > lastDot)   s = s.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function findActiveModal() {
  const sels = '.ReactModal__Content, .MuiDialog-root, .MuiModal-root, [role="dialog"]';
  return firstVisible(sels);
}

// Saldo del USUARIO — busca inputs disabled con "ARS" en toda la página
// El saldo del agente es un SPAN (.hideUserBalance), nunca un input → sin conflicto
function readUserBalance() {
  const inputs = Array.from(document.querySelectorAll(
    'input.Mui-disabled, input[disabled], input[readonly]'
  )).filter(isVisible);
  const bal = inputs.find(el => /ARS/.test(el.value || '') && /\d/.test(el.value || ''));
  if (bal) return { raw: bal.value, value: parseMoney(bal.value) };
  return null;
}

// Saldo del AGENTE (operador) — span.hideUserBalance siempre visible en el backoffice
function readAgentBalance() {
  const span = firstVisible('span.hideUserBalance');
  if (span) {
    const raw = span.textContent || span.innerText || '';
    return { raw: raw.trim(), value: parseMoney(raw) };
  }
  // Fallback: input deshabilitado fuera de modales
  const modal = findActiveModal();
  const candidates = visibleElements('input:disabled, input[readonly], input[aria-disabled="true"]');
  const outside = modal ? candidates.filter(el => !modal.contains(el)) : candidates;
  const bal = outside.find(el => /ARS|\$/.test(el.value || ''));
  if (bal) return { raw: bal.value, value: parseMoney(bal.value) };
  return { raw: '', value: 0 };
}

// Mantengo readVisibleBalance como alias para compatibilidad — devuelve user balance
function readVisibleBalance() {
  return readUserBalance() || { raw: '', value: 0 };
}

function readBalanceFromPlayerRow(playerEl) {
  // Sube por el DOM hasta encontrar la fila (tr, li, o rol=row)
  let row = playerEl;
  for (let i = 0; i < 8; i++) {
    const tag  = (row.tagName || '').toLowerCase();
    const role = row.getAttribute?.('role') || '';
    if (tag === 'tr' || role === 'row' || tag === 'li') break;
    if (!row.parentElement) break;
    row = row.parentElement;
  }

  // Intenta inputs deshabilitados dentro de la fila (columna Cantidad)
  const inputs = Array.from(row.querySelectorAll('input:disabled, input[readonly], input[aria-disabled="true"]'));
  const balInput = inputs.find(el => /ARS|^\$|\d{2,}/.test(el.value || ''));
  if (balInput) return { raw: balInput.value, value: parseMoney(balInput.value) };

  // Intenta celdas de texto con formato de dinero
  const cells = Array.from(row.querySelectorAll('td, [role="cell"]'));
  for (const cell of cells) {
    const text = (cell.textContent || '').trim();
    if (/ARS\s*[\d.,]/.test(text) || /^\$\s*[\d.,]/.test(text)) {
      return { raw: text, value: parseMoney(text) };
    }
  }
  return null;
}

// Lee el saldo del jugador asumiendo que el modal de depósito YA está abierto.
// No abre ni cierra nada. Si no encuentra nada devuelve {raw:'', value:0}.
function _leerSaldoJugadorEnModalAbierto() {
  // ── Estrategia 1: buscar por label "Balance Jugador" / "Jugador" ──────────
  const allLabels = Array.from(document.querySelectorAll(
    'label, .MuiInputLabel-root, .MuiFormLabel-root, legend, [class*="InputLabel"], [class*="label"], p, span'
  )).filter(isVisible);

  for (const label of allLabels) {
    const text = (label.textContent || label.innerText || '').trim();
    if (!/jugador/i.test(text)) continue;
    const container = label.closest(
      '.MuiFormControl-root, .MuiTextField-root, .MuiOutlinedInput-root, fieldset, .form-group, .MuiInputBase-root'
    ) || label.parentElement;
    if (!container) continue;
    const inp = container.querySelector('input[disabled], input.Mui-disabled, input[readonly]');
    if (inp && isVisible(inp) && /ARS/.test(inp.value || '') && /\d/.test(inp.value || '')) {
      return { raw: inp.value, value: parseMoney(inp.value) };
    }
    const formControl = label.closest('.MuiFormControl-root') || label.parentElement?.closest('.MuiFormControl-root');
    if (formControl) {
      const inp2 = formControl.querySelector('input[disabled], input.Mui-disabled, input[readonly]');
      if (inp2 && isVisible(inp2) && /ARS/.test(inp2.value || '') && /\d/.test(inp2.value || '')) {
        return { raw: inp2.value, value: parseMoney(inp2.value) };
      }
    }
  }

  // ── Estrategia 2: ARS inputs → el de menor valor es el jugador ───────────
  // Exigir dígito: el preview de monto (value "ARS") NO es un saldo.
  const arsInputs = Array.from(document.querySelectorAll(
    'input[disabled], input.Mui-disabled, input[readonly]'
  ))
    .filter(isVisible)
    .filter(el => /ARS/.test(el.value || '') && /\d/.test(el.value || ''));

  if (arsInputs.length >= 2) {
    const sorted = arsInputs.slice().sort((a, b) => parseMoney(a.value) - parseMoney(b.value));
    return { raw: sorted[0].value, value: parseMoney(sorted[0].value) };
  }
  if (arsInputs.length === 1) {
    return { raw: arsInputs[0].value, value: parseMoney(arsInputs[0].value) };
  }
  return { raw: '', value: 0 };
}

// Detecta el modal "Resultado de la operación" que el casino muestra DESPUÉS de Aplicar.
// Trae el Balance Jugador REAL (post) y el texto "Operación correcta".
function _detectarModalResultado() {
  const cont = Array.from(document.querySelectorAll('.ReactModal__Content, [role="dialog"], .card-alert'));
  for (const m of cont) {
    if (!isVisible(m)) continue;
    const titulo = m.querySelector('.card-title-alert');
    if (titulo && /resultado de la operaci/i.test(titulo.textContent || '')) return m;
    if (/resultado de la operaci/i.test(m.textContent || '')) return m;
  }
  return null;
}

// Lee el "Balance Jugador" DENTRO de un modal específico (scopeado, no en todo el doc,
// porque el modal de carga también tiene un "Balance Jugador").
function _leerBalanceJugadorEnModal(modal) {
  if (!modal) return null;
  const labels = Array.from(modal.querySelectorAll('label, legend, .MuiInputLabel-root, span'));
  for (const lab of labels) {
    if (!/jugador/i.test(lab.textContent || '')) continue;
    const cont = lab.closest('.MuiFormControl-root, .MuiTextField-root, .col-md-6, .col-12, .MuiInputBase-root') || lab.parentElement;
    const inp = cont && cont.querySelector('input[disabled], input.Mui-disabled, input[readonly]');
    if (inp && isVisible(inp) && /\d/.test(inp.value || '')) {
      return { raw: inp.value, value: parseMoney(inp.value) };
    }
  }
  return null;
}

// Lee los DOS balances del jugador en el modal abierto (depósito o retiro).
// El modal de Bo tiene dos inputs disabled lado a lado:
//   - Input 0 (DOM order): saldo PREVIO / actual del jugador
//   - Input 1 (DOM order): saldo POSTERIOR (preview cuando hay monto tipeado, o
//                          actual después de Aplicar)
// Si hay un tercer input ARS (balance agente) lo descartamos por ser el más alto.
// Devuelve { pre, post }, cada uno con { raw, value } o null si no se encontró.
function _leerBalancesEnModalDeposito() {
  const inputs = Array.from(document.querySelectorAll(
    'input[disabled], input.Mui-disabled, input[readonly]'
  ))
    .filter(isVisible)
    // Exigir un DÍGITO: el preview de monto tiene value "ARS" (sin número) y NO es un saldo.
    .filter(el => /ARS/.test(el.value || '') && /\d/.test(el.value || ''));

  if (inputs.length === 0) return { pre: null, post: null };

  // El balance del AGENTE (su pool) está SIEMPRE presente en el modal y SIEMPRE supera al
  // de un jugador. Hay que excluirlo para quedarse con el del JUGADOR. Lo identificamos:
  //   1) por coincidir con el saldo del agente del backoffice (span.hideUserBalance), o
  //   2) si no, como el de MAYOR valor.
  // (El preview de monto ya se filtró arriba por no tener dígitos.)
  // OJO: hay que hacerlo con 2+ inputs, no solo con 3+ — si no, con [agente, jugador]
  // se agarraba el agente como "pre" (bug: daba el saldo del agente por válido).
  let candidates = inputs;
  if (inputs.length > 1) {
    const spanAgente = firstVisible('span.hideUserBalance');
    const agenteVal  = spanAgente ? parseMoney(spanAgente.textContent || spanAgente.innerText || '') : null;
    if (agenteVal) {
      const sinAgente = inputs.filter(el => Math.abs(parseMoney(el.value) - agenteVal) > 1);
      if (sinAgente.length) candidates = sinAgente;
    }
    if (candidates.length > 1) {
      const sorted = [...candidates].sort((a, b) => parseMoney(b.value) - parseMoney(a.value));
      candidates = candidates.filter(el => el !== sorted[0]); // saca el de mayor valor (agente)
    }
  }

  // Ordenar por posición en el DOM (input 0 = pre, input 1 = post)
  candidates.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
  });

  return {
    pre:  candidates[0] ? { raw: candidates[0].value, value: parseMoney(candidates[0].value) } : null,
    post: candidates[1] ? { raw: candidates[1].value, value: parseMoney(candidates[1].value) } : null
  };
}

// Abre el modal de depósito (circle-plus) y devuelve el saldo PRE del jugador.
// NO cierra el modal — el caller decide qué hacer.
async function abrirModalDepositoYLeerSaldo() {
  clickButtonByIcon('circle-plus');
  await delay(800);
  // Sello propio: el modal recién abierto es de DEPÓSITO (lo abrimos nosotros).
  try {
    const inp = firstVisible(SELECTORS.amountInput);
    const modal = inp && inp.closest('.ReactModal__Content, .MuiDialog-root, .MuiModal-root, [role="dialog"]');
    if (modal) modal.setAttribute('data-nodo-tipo', 'deposito');
  } catch (_) {}
  // Saldo PRE exacto, sin demorar de más (portado de NexoBetaChan — fix del auto-rechazo falso):
  //  - valor REAL (>0) pintado → se toma al INSTANTE
  //  - 0 PINTADO → se acepta a los 3s (casi siempre es un 0 real; 3s descartan el 0 transitorio)
  //  - campo VACÍO (sin pintar, proxy lento) → reintenta hasta 7s
  // ANTES leíamos UNA sola vez a los 800ms → en proxy lento leía 0 y auto-rechazaba retiros con saldo.
  let balances = _leerBalancesEnModalDeposito();
  const tCero = now() + 3000;
  const tFin  = now() + 7000;
  while (now() < tFin) {
    const pre = balances.pre;
    const pintado = pre && /\d/.test(pre.raw || '');
    if (pintado && pre.value > 0) break;
    if (pintado && pre.value === 0 && now() > tCero) break;
    await delay(250);
    balances = _leerBalancesEnModalDeposito();
  }
  return balances.pre || _leerSaldoJugadorEnModalAbierto();
}

// Versión completa: abre, lee, cierra. Mantiene el comportamiento histórico.
async function leerSaldoViaModal() {
  try {
    return await abrirModalDepositoYLeerSaldo();
  } catch (_) {
    return { raw: '', value: 0 };
  } finally {
    await cerrarModalActual();
  }
}

function findSearchInput() {
  // Primero: busca input con validationField (es el del usuario)
  const validationInput = firstVisible('input.validationField[type="text"]');
  if (validationInput && validationInput.name !== 'amount' && validationInput.id !== 'password') {
    return validationInput;
  }

  // Segundo: busca por legend/placeholder específico "Introduzca un término"
  const allInputs = visibleElements('input[type="text"]');
  const withLabel = allInputs.find(input => {
    const parent = input.closest('.MuiInputBase-root, .MuiOutlinedInput-root');
    if (!parent) return false;
    const legend = parent.querySelector('legend span');
    const placeholder = input.getAttribute('placeholder') || '';
    return (legend && legend.textContent.includes('Introduzca un término')) ||
           placeholder.includes('Introduzca un término') ||
           placeholder.includes('búsqueda');
  });
  if (withLabel && withLabel.name !== 'amount' && withLabel.id !== 'password') {
    return withLabel;
  }

  // Tercero: fallback a busca genérica pero excluyendo el casino
  const searchSelectors = [
    'input[id*="search"]',
    'input[name*="search"]',
    'input[placeholder*="Buscar"]',
    'input[placeholder*="buscar"]',
    'input[placeholder*="Usuario"]',
    'input[placeholder*="usuario"]',
    'input[aria-label*="Buscar"]',
    'input[aria-label*="buscar"]',
    'input[aria-label*="Usuario"]',
    'input[aria-label*="usuario"]',
    'input[type="search"]'
  ];

  for (const selector of searchSelectors) {
    const input = firstVisible(selector);
    if (input && input.name !== 'amount' && input.id !== 'password') return input;
  }

  const candidates = visibleElements('input[type="text"], input:not([type])');
  return candidates.find(input => input.name !== 'amount' && input.id !== 'password' && input.minLength >= 3)
    || candidates.find(input => input.name !== 'amount' && input.id !== 'password')
    || null;
}

// Detecta el modal de sesión inválida en cualquiera de sus variantes:
//  - .ReactModal__Content (versión vieja, texto "session is invalid")
//  - .ReactModalContent  (versión nueva, texto "Invalid session", botón "Cerrar")
//  - .card-alert         (fallback por si encapsula el modal)
function detectarModalSesionInvalida() {
  // TODOS los que coincidan, no el primero. Con el modal del jugador abierto (el del saldo) hay DOS
  // ReactModal: querySelector devolvía el del jugador, el texto no coincidía, y el de "session is
  // invalid" —que estaba encima— pasaba de largo. El panel seguía leyendo como si nada y el saldo
  // salía $0. Texto real del modal (Juan, 12/09): <h4>session is invalid</h4> "La session es
  // invalida, redireccionamos al login" + botón Aceptar.
  const selectores = ['.ReactModal__Content', '.ReactModalContent', '.card-alert', '[role="dialog"]'];
  const re = /invalid session|session is invalid|la sesi[oó]n es inv[aá]lida|la session es invalida/i;
  for (const sel of selectores) {
    for (const el of document.querySelectorAll(sel)) {
      if (re.test(el.textContent || '')) { try { _marcarSesionMuerta(); } catch (_) {} return el; }
    }
  }
  return null;
}

// ── La sesión MURIÓ y lo sabemos ────────────────────────────────────────────────────────────
// Cerrar el cartel "Invalid session" no revive nada: sin este recuerdo, la app montada de fondo
// pasaba por sesión viva. Se baja sólo con evidencia de sesión NUEVA: haber visto la pantalla de
// login y después la app (o un login que pasó). Una recarga arranca de cero, y si sigue muerta
// Drex lo vuelve a decir apenas carga ("session is invalid, redireccionamos al login").
let _sesionMuertaDesde = 0;
let _vioLoginTrasMuerte = false;
let _opsEnCurso = 0;          // operaciones del panel corriendo en esta página (ver el ipc de abajo)
let _recargaLoginEn = 0;
let _yaFuiAlLogin = false;    // una sola salida por caída: si no, navega encima del operador
let _loginEnCurso = false;    // el operador está entrando: NADA puede recargarle la página
let _intentosLogin = 0;       // salidas al ingreso desde esta caida (con tope: ver _irAlLogin)
const _MAX_INTENTOS_LOGIN = 3;
// Cierra la sesión y deja la pantalla de ingreso. Con la cookie muerta, recargar user_search sólo
// volvía a mostrar el cartel: se quedaba dando vueltas ahí.
// NUNCA navega si hay una operación corriendo o si se está iniciando sesión: la navegación descarga
// la página, la operación en curso no contesta nunca y el panel muestra "la página de Agentes se
// recargó durante la operación". El operador reintentaba y volvía a pasar: loop (D-101).
// diferido = navegar DESPUÉS de contestar. Lo usa el login: navegar en el momento se mata a sí
// mismo (el loop de D-101), pero no navegar nunca dejaba la ventana encerrada, sin ingreso ni app.
function _irAlLogin(motivo, diferido) {
  if (!diferido && (_opsEnCurso > 0 || _loginEnCurso)) return false;
  // Ya estamos EN la pagina de salida: volver a navegar a la MISMA url no cambia nada, y es
  // exactamente el loop. El /logout de Drex a veces no llega a dibujar el ingreso -- no puede
  // cargar su config (requireAuthentication, y el XHR a wallet.casinoenvivo.club lo corta CORS) --
  // y deja el mismo cartel "session is invalid". El vigia lo leia como "no estoy en el ingreso" y
  // la volvia a mandar ahi cada 25 s, para siempre. En la consola se ve clavado: el error sale de
  // logout:1 y el VM del preload sube en cada vuelta (Juan, 26/9).
  try {
    const _aqui = String(window.location.href || '').split('#')[0].split('?')[0];
    if (_aqui === LOGOUT_URL) return false;
  } catch (_) {}
  // Espaciada, no "una sola vez": si el primer intento no dejó la pantalla de ingreso, tiene que
  // haber un segundo. Lo que evita el loop es el espacio entre intentos, no prohibirlos (D-102).
  if (Date.now() - _recargaLoginEn < 25000) return false;
  // Pero CON TOPE. Si despues de unas cuantas salidas el ingreso no aparece, el problema no es
  // nuestro y seguir recargando no lo arregla: se deja la ventana quieta. La sesion queda marcada
  // como caida, asi que el panel sigue pidiendo el login y el operador entra a mano.
  if (_intentosLogin >= _MAX_INTENTOS_LOGIN) {
    if (_intentosLogin === _MAX_INTENTOS_LOGIN) {
      _intentosLogin++;   // avisar una sola vez
      console.warn('[agent] el ingreso no aparecio despues de ' + _MAX_INTENTOS_LOGIN
        + ' intentos: se deja de recargar la ventana. Hay que entrar a mano.');
    }
    return false;
  }
  _intentosLogin++;
  _recargaLoginEn = Date.now();
  _yaFuiAlLogin = true;
  console.warn('[agent] cerrando sesión de Agentes (' + (motivo || 'sesión caída') + ') → ' + LOGOUT_URL);
  if (diferido) {
    setTimeout(function () { try { window.location.assign(LOGOUT_URL); } catch (_) {} }, 400);
    return true;
  }
  try { window.location.assign(LOGOUT_URL); } catch (_) { return false; }
  return true;
}
function _marcarSesionMuerta() {
  if (!_sesionMuertaDesde) {
    _sesionMuertaDesde = Date.now();
    _yaFuiAlLogin = false;      // caída NUEVA: se permite una salida
    _intentosLogin = 0;         // y se reinicia el tope de salidas
    console.warn('[agent] sesión de Agentes caída: lo dijo un cartel "Invalid session"');
    // Aviso al panel en el momento (18/11): sin esto NODO se enteraba recien en la proxima operacion.
    try { ipcRenderer.send('drex:sesion-caida', { motivo: 'cartel' }); } catch (_) {}
  }
  _vioLoginTrasMuerte = false;
}
// Vigía. El cartel también aparece fuera de una operación (el operador tocó "Mostrar", una
// consulta de fondo): se anota igual. Y si la sesión está muerta, no hay nada corriendo y la
// página sigue mostrando la app, se la lleva a la pantalla de ingreso — que es lo que el operador
// hacía a mano refrescando. Una vez cada 30 s como mucho: sin loops de recarga.
setInterval(function () {
  try {
    detectarModalSesionInvalida();          // anota la muerte aunque el cartel dure un instante
    if (!_sesionMuertaDesde || _opsEnCurso > 0) return;
    if (_pantallaPideLogin()) return;       // ya estamos en el ingreso: no hay nada que hacer
    // Con el cartel a la vista o con la app montada da igual: la sesión está muerta y la única
    // forma de revivirla es cerrarla y volver a entrar.
    _irAlLogin('sesión caída sin operación en curso');
  } catch (_) {}
}, 1500);

// El cartel puede durar un instante: un observador lo agarra apenas se dibuja, aunque el vigía de
// cada 1,5 s no llegue a verlo ("aparece unos microsegundos", Juan 13/09).
try {
  const _obsSesion = new MutationObserver(function () {
    if (_sesionMuertaDesde) return;   // ya está anotado
    try { detectarModalSesionInvalida(); } catch (_) {}
  });
  const _arrancarObs = function () {
    try { if (document.body) _obsSesion.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
  };
  if (document.body) _arrancarObs();
  else document.addEventListener('DOMContentLoaded', _arrancarObs);
} catch (_) {}

// Detecta si la página es un ERROR del servidor/CDN (no la app de agentes):
// CloudFront 403/404/5xx, "Request blocked", "could not be satisfied", etc.
// Devuelve true SOLO si parece página de error Y no hay ningún elemento de la app
// (así una pantalla de login —que sí es válida— no se confunde con un error).
// Robusto: señal POSITIVA primero (cualquier elemento operable de la app → NO bloqueado),
// y señal negativa SOLO con frases específicas de CDN/WAF — nunca con un "error" o un número
// suelto (403/404) en el título/cuerpo, que marcaba páginas válidas como bloqueadas y abortaba
// operaciones buenas.
function pageIsBlocked() {
  try {
    const hasApp = !!(
      document.querySelector(SELECTORS.searchButton) ||
      document.querySelector(SELECTORS.amountInput) ||
      firstVisible(SELECTORS.playerAlias) ||
      firstVisible('span.hideUserBalance') ||
      document.querySelector('input[type="password"]') ||
      document.querySelector('input[name="alias"]')
    );
    if (hasApp) return false;
    const errRe = /request blocked|request could not be satisfied|generated by cloudfront|cloudfront|access denied|forbidden|not authorized|service unavailable|bad gateway|gateway timeout|just a moment|attention required|checking your browser|ray id|algo sali|cannot read propert|errorboundary/i;
    const body  = (document.body && (document.body.innerText || document.body.textContent) || '').slice(0, 3000);
    return errRe.test(body) || errRe.test(document.title || '');
  } catch (_) {
    return false;
  }
}

function pageNeedsLogin() {
  // Modal de sesión inválida (aparece cuando la sesión expira abruptamente)
  if (detectarModalSesionInvalida()) return true;
  const pideLogin = _pantallaPideLogin();
  if (_sesionMuertaDesde) {
    if (pideLogin) { _vioLoginTrasMuerte = true; return true; }
    // Pasó por el login y volvió la app: es una sesión nueva.
    if (_vioLoginTrasMuerte) { _sesionMuertaDesde = 0; _vioLoginTrasMuerte = false; _yaFuiAlLogin = false; _intentosLogin = 0; return false; }
    return true;   // se cerró el cartel pero la sesión sigue muerta
  }
  return pideLogin;
}

// ¿La PANTALLA pide login? (lo de siempre, sin la memoria de arriba)
function _pantallaPideLogin() {
  // Pantalla de login — h4 con clase loginTitle o texto "login agente"
  const allH4 = Array.from(document.querySelectorAll('h4'));
  const loginH4 = allH4.find(h => /login agente/i.test(h.textContent || ''));
  if (loginH4) return true;

  // URL apunta a una ruta de login
  if (/login|signin|sign-in/i.test(window.location.href)) return true;

  // /new_user: la página tiene un input[type=password] (clave del nuevo jugador),
  // pero NO es la pantalla de login. La reconocemos como página interna válida.
  if (/\/new_user/i.test(window.location.href)) {
    const tieneFormulario = document.querySelector('input[name="alias"]')
                         || document.querySelector('input[name="password"][type="password"]')
                         || /nuevo\s+jugador/i.test(document.body.textContent || '');
    if (tieneFormulario) return false;
  }

  // Botón "ENTRAR" visible sin botón de búsqueda = pantalla de login
  // El botón de búsqueda tiene que estar VISIBLE. Drex es una SPA: al mandarte al login puede dejar
  // la búsqueda montada pero oculta, y con un querySelector pelado el preload daba la sesión por
  // buena — el panel nunca abría el modal de ingreso aunque estuvieras en la pantalla de login
  // (reportado por Juan el 12/09). isVisible(null) da false, así que sin botón sigue igual.
  const hasSearch = isVisible(document.querySelector(SELECTORS.searchButton)) || firstVisible(SELECTORS.playerAlias);
  if (hasSearch) return false;

  const entrarBtn = Array.from(document.querySelectorAll('button')).find(btn => /entrar|ingresar|login|iniciar|sign in/i.test(btn.textContent || ''));
  const password  = document.querySelector('input[type="password"]');
  return Boolean(entrarBtn || password);
}

// Maneja el modal de sesión inválida. Estrategia:
//   1) Si el modal tiene un botón "Accept" / "Cerrar" / "OK" visible → lo clickea
//      (el modal mismo redirige al login del casino, mejor que recargar a mano)
//   2) Si no hay botón → fallback: navega a USER_SEARCH_URL para forzar el login screen
// Espera hasta que el modal desaparezca y que aparezca el form de login.
async function cerrarModalSesionInvalida() {
  const modal = detectarModalSesionInvalida();
  if (!modal) return false;

  // Buscar el botón dentro del modal: "Accept", "Cerrar", "OK" o el .btn-primary visible
  const buttons = Array.from(modal.querySelectorAll('button, [role="button"], input[type="submit"], a.btn'));
  const accept = buttons.find(b => {
    if (!isVisible(b)) return false;
    const t = ((b.textContent || b.value || '') + '').trim().toLowerCase();
    return /accept|aceptar|cerrar|close|ok/.test(t);
  }) || buttons.find(isVisible);

  // Se aprieta "Aceptar": el cartel dice "redireccionamos al login" y Drex lo hace solo. Navegar
  // ENCIMA de eso era pelearse con su propio redirect y, si había una operación corriendo, la
  // mataba (D-101). El /logout queda como último recurso y sólo si no hay nada en curso: _irAlLogin
  // se niega solo mientras el panel esté operando o el operador esté entrando.
  if (accept) { try { clickElement(accept); } catch (_) {} await delay(400); }
  else _irAlLogin('cartel de sesión inválida sin botón');
  const tFin = Date.now() + 8000;
  while (Date.now() < tFin) {
    await delay(200);
    if (document.querySelector('input[type="password"]') || _pantallaPideLogin()) break;
  }
  return true;
}

// ── Recuperación de flujo (retoma sin refrescar · portado de NexoBetaChan 1.0.82) ────────────
async function cerrarOverlaysColgados() {
  const overlays = visibleElements('.ReactModal__Overlay, .MuiBackdrop-root, .modal-backdrop, .MuiModal-backdrop');
  for (const ov of overlays) { try { ov.click(); } catch (_) {} }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  if (overlays.length) await delay(300);
  return overlays.length > 0;
}
function tapadoPorModal(el) {
  try {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    const top = document.elementFromPoint(x, y);
    if (!top || top === el || el.contains(top) || top.contains(el)) return false;
    return !!top.closest('.ReactModal__Overlay, .ReactModal__Content, .MuiBackdrop-root, .MuiModal-root, .modal-backdrop, [role="dialog"]');
  } catch (_) { return false; }
}
function leerCartelesVisibles() {
  const sels = '.card-alert, .card-title-alert, [role="alert"], .alert, .Toastify__toast, .MuiAlert-root, ' +
               '.ReactModal__Content h1, .ReactModal__Content h2, .ReactModal__Content h3, .ReactModal__Content h4, .ReactModal__Content h5, .modal-title';
  const textos = [];
  for (const el of visibleElements(sels)) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (t && !textos.includes(t)) textos.push(t);
    if (textos.length >= 4) break;
  }
  return textos;
}
function tipoDeModalMonto() {
  const input = firstVisible(SELECTORS.amountInput);
  if (!input) return null;
  const modal = input.closest('.ReactModal__Content, .MuiDialog-root, .MuiModal-root, [role="dialog"]');
  if (!modal) return null;
  const sello = modal.getAttribute('data-nodo-tipo');
  if (sello === 'deposito' || sello === 'retiro') return sello;
  const titulo = modal.querySelector('h1, h2, h3, h4, h5, .modal-title, .card-title, .card-title-alert');
  const texto = ((titulo && titulo.textContent) || modal.textContent || '').toLowerCase();
  const esRetiro   = /retir|withdraw|extraer|d[eé]bito/.test(texto);
  const esDeposito = /dep[oó]sit|carga|cr[eé]dito/.test(texto) || !!modal.querySelector('#btn_deposit');
  if (esRetiro && !esDeposito) return 'retiro';
  if (esDeposito && !esRetiro) return 'deposito';
  return null;
}
// Clasifica dónde quedó parado el flujo, para RETOMAR sin refrescar (cada refresh suma tráfico
// que el CDN castiga con 403).
function detectarEstadoFlujo() {
  if (pageIsBlocked()) return 'error';
  if (detectarModalSesionInvalida()) return 'sesion-invalida';
  if (_detectarModalResultado()) return 'modal-resultado';
  if (firstVisible(SELECTORS.amountInput)) return 'modal-monto';
  if (pageNeedsLogin()) return 'login';
  if (/\/new_user/i.test(window.location.href) && firstVisible('input[name="alias"]')) return 'alta-usuario';
  if (document.querySelector(SELECTORS.searchButton) || findSearchInput()) return 'busqueda';
  return 'desconocido';
}
// Retoma sobre la página YA cargada: cierra lo colgado de una operación anterior (resultado
// viejo, carga/retiro a medias, sesión inválida). Escala a Escape+Cancelar+backdrop si insiste.
async function recuperarFlujoPendiente() {
  let anterior = null;
  for (let i = 0; i < 4; i++) {
    const estado = detectarEstadoFlujo();
    const insistiendo = estado === anterior;
    anterior = estado;
    if (estado === 'modal-resultado') {
      const res = _detectarModalResultado();
      try {
        const btn = Array.from(res.querySelectorAll('button, [role="button"]'))
          .find(b => /^\s*aceptar\s*$/i.test((b.textContent || '').trim()));
        if (btn) clickElement(btn);
      } catch (_) {}
      if (insistiendo) { await cerrarModalActual(); await cerrarOverlaysColgados(); }
      await delay(400);
      continue;
    }
    if (estado === 'modal-monto') {
      await cerrarModalActual();
      if (insistiendo) await cerrarOverlaysColgados();
      await delay(200);
      continue;
    }
    if (estado === 'sesion-invalida') {
      await cerrarModalSesionInvalida();
      continue;
    }
    if (estado === 'busqueda') {
      const input = findSearchInput();
      if (input && tapadoPorModal(input)) {
        if (await cerrarOverlaysColgados()) continue;
        console.warn('[agent] input de búsqueda tapado por overlay no cerrable · carteles:', leerCartelesVisibles().join(' | '));
      }
      return estado;
    }
    return estado;
  }
  // Safeguard (nuestro): si tras 4 vueltas seguimos trabados en un modal que NO cierra, UN reload
  // controlado a user_search (diferido, como el fallback de sesión inválida) → pizarra limpia para
  // el reintento. El "sin refresh" se mantiene en el 99% de los casos (solo entra si quedó trabado).
  const _finalFlujo = detectarEstadoFlujo();
  if (_finalFlujo === 'modal-monto' || _finalFlujo === 'modal-resultado') {
    console.warn('[agent] flujo trabado en', _finalFlujo, '— reload de rescate a user_search');
    setTimeout(function () { try { window.location.assign(USER_SEARCH_URL); } catch (_) {} }, 150);
  }
  return _finalFlujo;
}

function status(extra = {}) {
  const pageError = pageIsBlocked();
  const needsLogin = !pageError && pageNeedsLogin();
  return {
    ok: !needsLogin && !pageError,
    needsLogin,
    pageError,
    flujo: detectarEstadoFlujo(),
    carteles: leerCartelesVisibles(),
    url: window.location.href,
    message: pageError
      ? 'La página de agentes respondió con un error del servidor (403/404/CDN). No se operó. Reintentá.'
      : needsLogin
      ? 'La página de agentes requiere iniciar sesión o no respondió con el módulo esperado. Iniciá sesión manualmente y volvé a intentar.'
      : 'Módulo de agentes disponible.',
    ...extra
  };
}

async function ensureUserSearchReady() {
  // Página de error del servidor/CDN → abortar antes de operar (no correr el script contra basura)
  if (pageIsBlocked()) return status();
  // RETOMA sobre la página cargada: cierra modales colgados de una operación anterior (resultado
  // viejo, carga/retiro a medias, sesión inválida) en vez de exigir un refresh. Sinérgico con
  // el reduce-refresh: una op perdida ya no obliga a recargar la página.
  await recuperarFlujoPendiente();
  if (pageNeedsLogin()) return status();
  try {
    await waitFor(() => document.querySelector(SELECTORS.searchButton) || firstVisible(SELECTORS.playerAlias));
  } catch (_) {
    // Si agotó el timeout, re-chequea login (puede haber redirigido)
    await cerrarModalSesionInvalida();
    return status();
  }
  return status();
}

// ⛔ FLUJO BLINDADO — NO MODIFICAR (parte del core de carga/retiro estable).
// La espera del resultado-que-coincide y la lectura de saldo pre/post están
// calibradas. Tag git: estable-flujo-carga.
// CORROBORA que el campo de búsqueda REALMENTE tenga el alias y, si React lo limpió, lo reescribe.
// (Mismo problema que en BET300: el input se vacía entre el tipeo y el click de buscar → se
// buscaba con la caja VACÍA y eso devolvía "no existe".)
async function _asegurarTextoBusquedaDrex(alias, tries = 3) {
  const target = String(alias).trim();
  for (let i = 0; i < tries; i++) {
    const input = findSearchInput();
    if (!input) { await delay(200); continue; }
    if (String(input.value || '').trim() === target) return input;
    await setReactInputAndVerify(input, target, 3);
    await delay(120);
    const chk = findSearchInput();
    if (chk && String(chk.value || '').trim() === target) return chk;
    await delay(150);
  }
  return null;
}
// Diario de fallas persistente → se consulta con window.__nodoBusquedaFallas
function _logFallaBusquedaDrex(datos) {
  try {
    const K = 'nodo_busqueda_fallas';
    const arr = JSON.parse(localStorage.getItem(K) || '[]');
    arr.push(Object.assign({ ts: new Date().toISOString(), backend: 'drex', url: location.href }, datos));
    localStorage.setItem(K, JSON.stringify(arr.slice(-40)));
  } catch (_e) {}
}
try {
  Object.defineProperty(window, '__nodoBusquedaFallas', {
    get() { try { return JSON.parse(localStorage.getItem('nodo_busqueda_fallas') || '[]'); } catch (_e) { return []; } }
  });
} catch (_e) {}

function _normAliasDrex(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

async function buscarUsuario(usuario, options = {}) {
  if (!usuario || String(usuario).trim().length < 3) {
    throw new Error('El usuario debe tener al menos 3 caracteres.');
  }

  const ready = await ensureUserSearchReady();
  if (ready.needsLogin) return ready;

  const wanted = String(usuario).trim();
  const wantedNorm = _normAliasDrex(wanted);
  const TIMEOUT = options.timeout || DEFAULT_TIMEOUT;
  const INTENTOS = 3;
  let matchedAlias = null;

  // ANTI-FALSO-NEGATIVO: solo se concluye "NO existe" cuando la página lo dice de verdad
  // (SELECTORS.noResults). Si el campo no aceptó el texto o la búsqueda no respondió, NO se afirma
  // nada: se REINTENTA y, si igual no se logra, se lanza ERROR TÉCNICO. Antes esos dos casos
  // devolvían exists:false → el panel decía "el usuario no existe" sin haber buscado nunca.
  for (let intento = 1; intento <= INTENTOS && !matchedAlias; intento++) {
    await waitFor(findSearchInput, TIMEOUT);
    const input = await _asegurarTextoBusquedaDrex(wanted, 3);
    if (!input) {
      _logFallaBusquedaDrex({ alias: wanted, intento: intento, motivo: 'campo-no-acepto-texto', inputAhora: ((findSearchInput() || {}).value || '') });
      console.warn('[buscar] intento ' + intento + '/' + INTENTOS + ': el campo no aceptó el alias — reintentando');
      await delay(400); continue;
    }

    clickElement(await waitFor(() => firstVisible(SELECTORS.searchButton), TIMEOUT));
    await delay(350);

    const inicioBusqueda = now();
    let huboNoResults = false;
    while (now() - inicioBusqueda < TIMEOUT) {
      await cerrarModalSesionInvalida();
      if (pageNeedsLogin()) return status();
      const match = visibleElements(SELECTORS.playerAlias).find(el => _normAliasDrex(normalizeText(el.textContent)) === wantedNorm);
      if (match) { matchedAlias = normalizeText(match.textContent); break; }
      if (firstVisible(SELECTORS.noResults)) {
        const m2 = visibleElements(SELECTORS.playerAlias).find(el => _normAliasDrex(normalizeText(el.textContent)) === wantedNorm);
        if (m2) { matchedAlias = normalizeText(m2.textContent); break; }
        huboNoResults = true; break;
      }
      await delay(180);
    }
    if (matchedAlias) break;

    // La página dijo explícitamente "sin resultados" → conclusión VÁLIDA: no existe.
    if (huboNoResults) {
      return { ok: true, exists: false, user: wanted, message: 'Sin resultados para ' + wanted, intentos: intento };
    }
    // Timeout sin veredicto de la página → falla TÉCNICA, no es "no existe".
    _logFallaBusquedaDrex({ alias: wanted, intento: intento, motivo: 'timeout-sin-veredicto', inputAhora: ((findSearchInput() || {}).value || ''), filas: visibleElements(SELECTORS.playerAlias).length });
    console.warn('[buscar] intento ' + intento + '/' + INTENTOS + ': la búsqueda no respondió (sin match ni "sin resultados") — reintentando');
    await delay(400);
  }

  if (!matchedAlias) {
    throw new Error('No se pudo ejecutar la búsqueda de "' + wanted + '" en Agentes tras ' + INTENTOS
      + ' intentos (el campo o la lista no respondieron). NO se concluye que el usuario no exista — reintenta.');
  }
  const playerAlias = matchedAlias;

  // Modos de lectura de balance:
  //   - options.skipBalance      → no leer (no abre modal)
  //   - options.keepDepositModalOpen → abrir modal, leer, DEJAR ABIERTO
  //     (el caller va a llamar cargarSaldo con modalAlreadyOpen y reusar el modal)
  //   - default                  → abrir, leer, cerrar
  let balance = null;
  let modalLeftOpen = false;
  if (options.skipBalance) {
    // nada
  } else if (options.keepDepositModalOpen) {
    balance = await abrirModalDepositoYLeerSaldo();
    modalLeftOpen = true;
  } else {
    balance = await leerSaldoViaModal();
  }

  // Si la sesión se cayó mientras se leía el saldo, ese saldo no vale: se avisa como sesión caída.
  if (pageNeedsLogin()) return status();
  return { ok: true, exists: true, user: playerAlias, balance, modalLeftOpen };
}

async function openMovementModal(iconName, options = {}) {
  const ready = await ensureUserSearchReady();
  if (ready.needsLogin || ready.pageError) return ready;

  // ESPERAR a que el botón/icono de carga aparezca antes de clickear.
  // Antes clickButtonByIcon buscaba UNA sola vez y, si el perfil del jugador
  // todavía no había renderizado el botón, tiraba error y rechazaba al instante
  // ("tarda y rechaza"). Ahora lo esperamos hasta el timeout.
  const iconSelector = `svg[data-icon="${iconName}"], [data-icon="${iconName}"]`;
  let icono;
  try {
    icono = await waitFor(() => firstVisible(iconSelector), options.timeout || DEFAULT_TIMEOUT);
  } catch (_) {
    // No apareció el botón de carga en el tiempo esperado → re-chequear sesión
    await cerrarModalSesionInvalida();
    if (pageNeedsLogin()) return status();
    throw new Error(`El botón de ${iconName === 'circle-plus' ? 'carga' : 'retiro'} no apareció (¿el perfil del jugador no cargó?).`);
  }
  const btnCarga = icono.closest('button, [role="button"], a') || icono.parentElement;
  clickElement(btnCarga);

  await delay(350);
  const amountInput = await waitFor(() => firstVisible(SELECTORS.amountInput), options.timeout || DEFAULT_TIMEOUT);
  return { ok: true, amountInput, balance: readVisibleBalance() };
}

function findActionButton(textPattern, root = document) {
  const buttons = visibleElements('button, [role="button"]', root);
  return buttons.find(btn => textPattern.test(btn.textContent || '')) || null;
}

async function cerrarModalActual() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  await delay(400);
  const cancelBtn = Array.from(visibleElements('button')).find(b => /cancelar|cancel|cerrar|close/i.test(b.textContent || ''));
  if (cancelBtn) { clickElement(cancelBtn); await delay(300); }
}

// ⛔ FLUJO BLINDADO — NO MODIFICAR (core de carga/retiro estable).
// Abre el modal UNA vez, lee saldo pre (input 0) y post (input 1). Tag: estable-flujo-carga.
async function applyAmount(iconName, amount, actionName, options = {}) {
  const numericAmount = Number(String(amount).replace(',', '.'));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('El monto debe ser un número mayor a cero.');
  }

  const opened = await openMovementModal(iconName, options);
  if (opened.needsLogin || opened.pageError) return opened;

  // Espera a que el modal termine de renderizar (React necesita tiempo)
  await delay(500);

  // El modal tiene DOS inputs disabled del jugador: pre y post.
  // Leemos ambos por orden DOM. El primero es el saldo actual (PRE).
  // Reintenta hasta ~2s (PCs lentas/con proxy tardan más en pintar el input) antes de
  // rendirse — un solo intento a los 500ms dejaba "pre" sin leer más seguido de lo debido,
  // y el panel terminaba mostrando saldo "—" (o, en versiones viejas, un negativo falso).
  let balancesAntes = _leerBalancesEnModalDeposito();
  const _tPreFin = now() + 2000;
  while (!balancesAntes.pre && now() < _tPreFin) {
    await delay(200);
    balancesAntes = _leerBalancesEnModalDeposito();
  }
  const _preLeido = balancesAntes.pre || _leerSaldoJugadorEnModalAbierto() || opened.balance || null;
  // Si de verdad no se pudo leer, NO inventamos un {value:0}: eso es indistinguible de un
  // saldo real de $0 y corrompe cálculos aguas abajo (saldo derivado negativo). Se marca
  // "unchanged"/sin dato — el panel ya sabe mostrar "—" en vez de un número falso.
  const balance = _preLeido || { raw:'', value:0, unchanged:true };

  // Para retiros: verifica saldo suficiente (sólo si hay un balance válido conocido)
  if (actionName === 'retiro' && balance && balance.value > 0) {
    if (balance.value < numericAmount) {
      await cerrarModalActual();
      return {
        ok: false,
        saldoInsuficiente: true,
        balance,
        message: `Saldo insuficiente: ${balance.raw.trim()} disponible, se solicitaron $${numericAmount.toLocaleString('es-AR')}.`
      };
    }
  }

  // Re-busca el input de monto (por si React reescribió el DOM al abrir el modal)
  const amountInput = firstVisible(SELECTORS.amountInput) || opened.amountInput;
  if (!amountInput) throw new Error('No se encontró el campo de monto.');
  setReactInputValue(amountInput, String(amount));
  await delay(400);

  // Busca el botón Aplicar — id específico primero, luego texto, luego clase
  const applyButton =
    firstVisible('button#btn_deposit') ||
    findActionButton(/^\s*aplicar\s*$/i) ||
    firstVisible('button.btn.btn-primary');
  if (!applyButton) throw new Error('No se encontró el botón "Aplicar".');
  if (applyButton.disabled) throw new Error('El botón "Aplicar" está deshabilitado (¿monto inválido?).');

  // Si quedó abierto un modal de "Resultado de la operación" de una operación ANTERIOR
  // (el cierre previo pudo haber fallado silenciosamente), cerrarlo ANTES de aplicar esta.
  // Si no, el poll de abajo puede agarrar ese resultado VIEJO como si fuera el de ESTA
  // operación — reportando éxito/saldo de la carga pasada, no la actual (fantasma real).
  const _staleRes = _detectarModalResultado();
  if (_staleRes) {
    try {
      const btnAceptStale = Array.from(_staleRes.querySelectorAll('button, [role="button"]'))
        .find(b => /^\s*aceptar\s*$/i.test((b.textContent || '').trim()));
      if (btnAceptStale) { clickElement(btnAceptStale); await delay(400); }
    } catch (_) {}
  }

  _chequearFreno('antes de aplicar'); // ÚLTIMO punto seguro: si el operador abortó, frena ANTES de mover plata
  clickElement(applyButton);
  _yaAplico = true;   // de acá en adelante la plata pudo moverse: ninguna espera corta sola

  // Tras Aplicar, el casino muestra el modal "Resultado de la operación" con el Balance
  // Jugador REAL (post) y el texto "Operación correcta". Esa es la FUENTE del saldo
  // posterior (no estimar pre±monto). Polleamos hasta ~8s esperando NO solo a que el modal
  // aparezca, sino a que el Balance Jugador esté POBLADO (a veces aparece con el input en
  // 0/vacío y, si leemos ahí, agarramos un 0 transitorio).
  let newBalance = null, exito = null, resultadoTexto = '', modalResRef = null;
  let postCero = null;           // último post leído == 0 (puede ser transitorio o real)
  let falsoDesde = null;         // momento en que empezamos a ver exito===false (posible transitorio)
  // Ventana de detección del modal "Resultado de la operación": tope 8s (antes 12s).
  // CLAVE para demanda alta: en cuanto el modal da el veredicto ("Operación correcta" → exito)
  // CORTAMOS, sin esperar a que se popule el balance. El balance queda best-effort (el renderer
  // lo estima pre±monto / lo deriva) y si exito no se vio, hace una lectura fresca como respaldo.
  // Así "Procesando" dura ~2-3s en el caso normal en vez de esperar a que pinte el saldo.
  const tFinRes = now() + 8000;
  const tCeroAceptable = now() + 2500;   // hasta acá un post 0 se trata como transitorio (retiros)
  const GRACIA_FALSO_MS = 1200;          // cuánto esperar desde que vemos exito===false por primera vez
  while (now() < tFinRes) {
    const modalRes = _detectarModalResultado();
    if (modalRes) {
      modalResRef = modalRes;
      resultadoTexto = (modalRes.textContent || '').replace(/\s+/g, ' ').trim();
      const _exitoAhora = /operaci[oó]n correcta/i.test(resultadoTexto);
      const post = _leerBalanceJugadorEnModal(modalRes); // Balance Jugador REAL del modal de resultado
      if (post && post.raw && /\d/.test(post.raw)) {
        // Un 0 suele ser que el campo todavía no pintó (transitorio, sobre todo en retiros).
        // Le damos una gracia corta (2.5s); pasada esa, un 0 se acepta como real (retiro total).
        if (post.value === 0 && now() < tCeroAceptable) { postCero = post; await delay(200); continue; }
        newBalance = post;
        exito = _exitoAhora;
        break;
      }
      if (_exitoAhora === true) { exito = true; break; } // éxito confirmado, no hace falta esperar más
      // exito===false: puede ser un RECHAZO real, o el modal recién apareciendo sin pintar
      // todavía el texto de "Operación correcta" (el mismo caso que el 0 transitorio de arriba,
      // pero para el texto). Si lo tomamos al toque, una carga que SÍ se aplicó terminaba en rojo
      // "rechazada" antes de que el modal pintara el texto real (visto en producción). Se le da
      // una gracia corta contada desde la PRIMERA vez que vimos false; si sigue en false pasada
      // la gracia, ahí sí es un rechazo real.
      exito = false;
      if (!falsoDesde) falsoDesde = now();
      if (now() - falsoDesde < GRACIA_FALSO_MS) { await delay(150); continue; }
      break;
    }
    await delay(150);
  }
  // Si salimos por timeout con un 0 leído (nunca se pobló otro valor), lo tomamos como real.
  if (!newBalance && postCero) newBalance = postCero;

  // Cerrar el modal de resultado con su botón "Aceptar" (vuelve a la pantalla inicial).
  if (modalResRef) {
    try {
      const btnAcept = Array.from(modalResRef.querySelectorAll('button, [role="button"]'))
        .find(b => /^\s*aceptar\s*$/i.test((b.textContent || '').trim()));
      if (btnAcept) { clickElement(btnAcept); await delay(400); }
    } catch (_) {}
  }

  // Si NO se pudo leer el post del modal de resultado, lo dejamos como "no leído"
  // (unchanged). IMPORTANTE: no leemos el modal de carga/retiro como fallback, porque su
  // preview de monto (value "ARS") se interpretaba como 0 → falso "duplicado". Mejor
  // sin dato (el panel muestra el esperado) que con un 0 falso.
  if (!newBalance) {
    newBalance = { raw: balance.raw, value: balance.value, unchanged: true };
  }

  return {
    ok: true,
    action: actionName,
    amount: numericAmount,
    previousBalance: balance,
    newBalance,
    exito,                 // true si el casino dijo "Operación correcta" (null si no se vio el modal)
    resultado: resultadoTexto,
    message: `${actionName} enviado. Saldo anterior: ${balance.raw?.trim() || '—'}${newBalance?.raw ? ' → ' + newBalance.raw.trim() : ''}.`
  };
}

function cargarSaldo(amount, options) {
  return applyAmount('circle-plus', amount, 'carga', options);
}

function retirarSaldo(amount, options) {
  return applyAmount('circle-minus', amount, 'retiro', options);
}

// Al terminar una operación: cerrar el modal de confirmación con "Aceptar" (o "OK"/
// "Cerrar") y limpiar el buscador (el alias escrito), dejando la página lista para la
// próxima operación SIN refrescar. Refrescar tras cada carga genera tráfico que dispara
// el 403 de CloudFront; esto evita ese refresh.
async function finalizarOperacionAgentes() {
  try {
    const modal = findActiveModal();
    const scope = modal || document;
    const btns = Array.from(scope.querySelectorAll('button, [role="button"], input[type="submit"], a.btn')).filter(isVisible);
    const aceptar = btns.find(b => /^\s*(aceptar|aceptar y cerrar|ok|cerrar|close|entendido|listo|continuar)\s*$/i.test((b.textContent || b.value || '').trim()));
    if (aceptar) { clickElement(aceptar); await delay(300); }
    else { await cerrarModalActual(); }
  } catch (_) {}
  try {
    const search = findSearchInput();
    if (search) setReactInputValue(search, '');
  } catch (_) {}
  return { ok: true };
}

async function cambiarClave(password, options = {}) {
  if (!password || String(password).length < 4) {
    throw new Error('La contraseña debe tener al menos 4 caracteres.');
  }

  const ready = await ensureUserSearchReady();
  if (ready.needsLogin) return ready;

  clickButtonByIcon('key');
  await delay(350);

  const pass1 = await waitFor(() => firstVisible(SELECTORS.password), options.timeout || DEFAULT_TIMEOUT);
  const pass2 = await waitFor(() => firstVisible(SELECTORS.passwordRepeat), options.timeout || DEFAULT_TIMEOUT);
  setReactInputValue(pass1, password);
  setReactInputValue(pass2, password);
  await delay();

  const changeButton = findActionButton(/cambiar/i);
  clickElement(changeButton);

  return { ok: true, action: 'cambio_clave', message: 'Cambio de clave enviado. Confirmá el resultado en la página externa.' };
}

function irABusquedaUsuarios() {
  // Navegaba sin mirar nada: en medio del login le descargaba la p�gina al operador y el
  // iniciarSesion en vuelo no contestaba nunca (D-101). El freno de _irAlLogin no cubr�a este
  // camino. Ojo: NO se puede mirar _opsEnCurso ac�  el ipc lo sube para TODOS los m�todos,
  // as� que ser�a siempre > 0 y esto no navegar�a nunca m�s.
  if (_loginEnCurso) return { ok: true, url: USER_SEARCH_URL, sinNavegar: true };
  if (window.location.href !== USER_SEARCH_URL) window.location.assign(USER_SEARCH_URL);
  return { ok: true, url: USER_SEARCH_URL };
}

// Crear usuario en el backoffice (URL: /agents/new_user)
async function crearUsuario(alias, password, options = {}) {
  if (!alias || String(alias).trim().length < 3) {
    throw new Error('El alias debe tener al menos 3 caracteres.');
  }
  if (!password || String(password).length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }
  if (!/^[a-zA-Z0-9]+$/.test(String(password))) {
    throw new Error('La contraseña sólo puede tener letras y números.');
  }

  await cerrarModalSesionInvalida();
  if (pageNeedsLogin()) return status();

  await delay(800);

  const aliasInput = await waitFor(() => firstVisible('input[name="alias"]'), options.timeout || DEFAULT_TIMEOUT);
  aliasInput.click(); await delay(150);
  const aliasOk = await setReactInputAndVerify(aliasInput, String(alias).trim(), 5);
  if (!aliasOk) throw new Error('No se pudo completar el campo alias (React no tomó el valor después de 5 intentos).');

  const passInput = await waitFor(() => firstVisible('input[name="password"][type="password"]'), options.timeout || DEFAULT_TIMEOUT);
  passInput.click(); await delay(150);
  const passOk = await setReactInputAndVerify(passInput, String(password), 5);
  if (!passOk) throw new Error('No se pudo completar el campo clave (React no tomó el valor después de 5 intentos).');

  const registrarBtn = findActionButton(/registrar/i);
  if (!registrarBtn) throw new Error('No se encontró el botón "Registrar".');
  await delay(200);
  clickElement(registrarBtn);

  // Tras clickear "Registrar" hay DOS caminos posibles:
  //   a) Aparece el error "ErrorDuplicated alias" → el alias ya existe
  //   b) Aparece un modal de CONFIRMACIÓN con los datos + botón "Guardar"
  // El texto "registrado correctamente" recién aparece DESPUÉS de Guardar, así que
  // NO podemos esperarlo acá. Esperamos: error duplicado O el botón Guardar.
  const TIMEOUT = options.timeout || DEFAULT_TIMEOUT;
  const buscarGuardar = function(){
    const btns = Array.from(document.querySelectorAll('button.btn.btn-primary, button')).filter(isVisible);
    return btns.find(b => /^guardar$/i.test((b.textContent || '').trim())) || null;
  };
  const esDuplicado = function(){
    return /ErrorDuplicated|duplicated alias|already exists|alias ya existe/i.test(document.body.textContent || '');
  };

  await waitFor(() => esDuplicado() || buscarGuardar(), TIMEOUT);

  // Dar un instante para que el modal (error o confirmación) termine de renderizar
  await delay(300);

  if (esDuplicado())
    return { ok: false, alias, error: 'duplicado', message: 'El alias ya existe.' };

  // Camino b): modal de confirmación → clickear "Guardar"
  const guardarBtn = buscarGuardar() || findActionButton(/^guardar$/i);
  if (!guardarBtn) {
    // No apareció ni el error duplicado ni el modal de confirmación → NO afirmar éxito en falso.
    console.warn('[crearUsuario] botón Guardar no encontrado tras Registrar');
    return { ok: false, alias, error: 'sin_confirmacion', message: 'No apareció la confirmación de creación. Verificá manualmente en el casino antes de cargar.' };
  }
  clickElement(guardarBtn);

  // Tras Guardar hay que ESPERAR la confirmación REAL de éxito ("registrado correctamente"),
  // o un error/duplicado tardío. Antes devolvíamos ok:true a ciegas → éxito en falso.
  const esExito = function(){
    return /registrad[oa] correctamente|cread[oa] correctamente|usuario creado|creaci[oó]n exitosa|success/i.test(document.body.textContent || '');
  };
  await waitFor(() => esExito() || esDuplicado(), TIMEOUT).catch(()=>{});
  await delay(250);

  if (esDuplicado())
    return { ok: false, alias, error: 'duplicado', message: 'El alias ya existe.' };
  if (esExito())
    return { ok: true, alias, password, message: 'Usuario creado correctamente.' };

  // Ni éxito ni duplicado confirmados → NO decir que se creó (evita el "no encontrado" posterior).
  return { ok: false, alias, error: 'sin_confirmacion', message: 'No se pudo confirmar la creación del usuario. Verificá en el casino antes de cargar.' };
}

// Devuelve el saldo del AGENTE (operador) sin tocar nada del usuario
async function obtenerSaldoAgente(options = {}) {
  await cerrarModalSesionInvalida();
  if (pageNeedsLogin()) return { ok: false, needsLogin: true };
  await waitFor(() => readAgentBalance().raw, options.timeout || 6000).catch(()=>{});
  return { ok: true, balance: readAgentBalance() };
}

// Inicia sesión en el backoffice de agentes inyectando usuario y clave.
// Si ya hay sesión activa devuelve {ok:true} inmediatamente.
// Si aparece el modal de "session is invalid" → clickea Accept, espera el redirect
// al login, y sigue con la inyección de credenciales en la misma pasada.
async function iniciarSesion(usuario, clave) {
  _loginEnCurso = true;
  try { return await _iniciarSesionInterno(usuario, clave); }
  finally { _loginEnCurso = false; }
}
async function _iniciarSesionInterno(usuario, clave) {
  // Modal de sesión inválida → cerrarlo (clickeando Accept) y esperar el form de login
  if (detectarModalSesionInvalida()) {
    await cerrarModalSesionInvalida();
    // Después del cierre puede tardar un instante en renderizar el form
    const t0 = now();
    while (now() - t0 < 5000) {
      await delay(200);
      if (document.querySelector('input[type="password"]')) break;
    }
  }

  // Ya logueado → nada que hacer
  if (!pageNeedsLogin()) {
    return { ok: true, message: 'Sesión ya activa.' };
  }

  // Buscar el formulario de login (con reintentos por si la página está montando)
  let userInput = null, passInput = null, entrarBtn = null;
  const tBusca = now();
  while (now() - tBusca < 6000) {
    userInput = document.querySelector('input[type="text"], input[name="username"], input[name="user"], input[autocomplete="username"]');
    passInput = document.querySelector('input[type="password"]');
    entrarBtn = Array.from(document.querySelectorAll('button')).find(btn =>
      /entrar|ingresar|login|iniciar|sign.?in/i.test(btn.textContent || '')
    );
    if (userInput && passInput && entrarBtn) break;
    await delay(250);
  }

  if (!userInput || !passInput || !entrarBtn) {
    // No hay formulario: o quedó el cartel tapando, o la app montada con la sesión muerta.
    // Acá NO se navega. Navegar en medio del login descarga la página, esta misma llamada no
    // contesta nunca y el panel muestra "la página de Agentes se recargó durante la operación" —
    // el operador reintenta y vuelve a pasar: loop (D-101). Se aprieta el "Aceptar" del cartel, que
    // es lo que hace que Drex redirija al login por su cuenta, y se espera el formulario.
    if (detectarModalSesionInvalida()) { try { await cerrarModalSesionInvalida(); }catch(_){} }
    const tSalida = now();
    while (now() - tSalida < 8000) {
      await delay(250);
      userInput = document.querySelector('input[type="text"], input[name="username"], input[name="user"], input[autocomplete="username"]');
      passInput = document.querySelector('input[type="password"]');
      entrarBtn = Array.from(document.querySelectorAll('button')).find(btn => /entrar|ingresar|login|iniciar|sign.?in/i.test(btn.textContent || ''));
      if (userInput && passInput && entrarBtn) break;
    }
    if (!userInput || !passInput || !entrarBtn) {
      // Ni formulario ni app: la ventana está encerrada. Se pide la salida DIFERIDA — navega recién
      // después de contestar esto, así no se mata la propia llamada (D-101) pero la próxima vez ya
      // hay pantalla de ingreso (D-102).
      _irAlLogin('login sin formulario', true);
      return { ok: false, needsLogin: true, message: 'La ventana de Agentes no mostraba el ingreso: la estoy llevando ahí. Tocá Conectar de nuevo en unos segundos.' };
    }
  }

  // Inyectar credenciales con disparo de eventos React
  setReactInputValue(userInput, usuario);
  await delay(200);
  setReactInputValue(passInput, clave);
  await delay(300);
  clickElement(entrarBtn);

  // Esperar hasta 15s a que desaparezca la pantalla de login
  const inicio = now();
  while (now() - inicio < 15000) {
    await delay(500);
    if (!pageNeedsLogin()) return { ok: true, message: 'Sesión iniciada.' };
  }

  return { ok: false, message: 'No se pudo iniciar sesión. Verificá usuario y contraseña.' };
}

// Lee el WhatsApp que la oficina publica en Agentes > Funcionalidades y permisos: es el numero
// que despues ve el jugador en el Portal. Solo mira la pantalla, no manda ningun formulario.
function _wsInput(doc) {
  var sels = [
    '#Form_WhatsappContact input[data-parsley-validate-whatsapp-phone]',
    '#Form_WhatsappContact input[autocomplete="phone"]',
    'input[data-parsley-validate-whatsapp-phone]',
    '#Form_WhatsappContact input[type="text"]'
  ];
  for (var i = 0; i < sels.length; i++) {
    var el = doc.querySelector(sels[i]);
    if (el) return el;
  }
  return null;
}

// El checkbox "Permite que tus jugadores te contacten por Whatsapp". Hay que leerlo aparte: un
// numero cargado con el checkbox apagado no se publica, asi que el numero solo no alcanza para
// decir que el jugador tiene como escribir.
function _wsHabilitado(doc) {
  var labels = Array.prototype.slice.call(doc.querySelectorAll('label'));
  for (var i = 0; i < labels.length; i++) {
    if (!/contacten\s+por\s+whatsapp/i.test(labels[i].textContent || '')) continue;
    var c = labels[i].querySelector('input[type="checkbox"]');
    if (c) return c.checked === true;
  }
  var uno = doc.querySelector('#Form_WhatsappContact');
  var caja = uno ? doc.querySelector('input[type="checkbox"]') : null;
  return caja ? caja.checked === true : null;
}

// 15/11: esto se leia con un iframe oculto y NUNCA funciono. Medido contra la pagina real: 21
// segundos y el iframe no entrega documento, el backoffice no se deja enmarcar. La lectura va
// derecho sobre la pantalla, igual que obtenerSaldoAgente, y a la pantalla la lleva main antes
// de llamar (automation.js), que es donde se puede navegar sin matar la llamada (D-101).
async function leerWhatsappOficina() {
  // Lo mismo que en irABusquedaUsuarios: NO se puede mirar _opsEnCurso aca. El ipc lo sube
  // para TODOS los metodos, incluido este, asi que siempre es > 0 y esto no leeria nunca.
  // Que no se cruce con una carga o un retiro lo asegura la cola del panel, que es la misma
  // que usa el watchdog para leer las fichas (renderer/extensions/oficina-whatsapp.js).
  if (_loginEnCurso) {
    return { ok: false, ocupado: true, message: 'La ventana de Agentes esta entrando a la sesion.' };
  }
  if (pageNeedsLogin()) {
    return { ok: false, needsLogin: true, message: 'Hay que entrar a Agentes antes de leer el WhatsApp.' };
  }
  if (String(window.location.href || '').indexOf('/agents/features') < 0) {
    // No se navega desde aca a proposito: quien navega es main, y solo cuando se le pide. Asi el
    // repaso de fondo no le mueve la pantalla al operador por ir a mirar un numero.
    return { ok: false, motivo: 'OTRA_PANTALLA',
             message: 'La ventana de Agentes no esta en Funcionalidades y permisos.' };
  }
  try {
    // La pantalla es React: puede estar montando. Se espera al campo, no a la carga.
    var el = _wsInput(document);
    var t0 = now();
    while (!el && now() - t0 < 12000) {
      await delay(250);
      if (pageNeedsLogin()) {
        return { ok: false, needsLogin: true, message: 'Agentes pidio ingresar de nuevo.' };
      }
      el = _wsInput(document);
    }
    if (!el) {
      return { ok: false, motivo: 'NO_APARECIO',
               message: 'La pantalla no mostro el campo de WhatsApp.' };
    }
    return { ok: true, numero: String(el.value || '').trim(),
             habilitado: _wsHabilitado(document), desde: 'pantalla' };
  } catch (e) {
    return { ok: false, motivo: 'ERROR', message: (e && e.message) ? e.message : String(e) };
  }
}

// Guarda el WhatsApp en Funcionalidades y permisos (Juan, 18/11: "NODO no hizo un carajo de cambio de
// numero en Drex"). No existia: el panel pedia guardarWhatsappOficina y este preload no lo tenia, asi que
// la orden moria en "Metodo no permitido". Pasos, como lo haria una persona: main ya navego a la pantalla
// (navegar:true) -> se espera a que el campo se dibuje y quede QUIETO (React lo completa despues) -> se
// escribe el numero -> Guardar -> se confirma (aviso de exito, o el campo sigue con el numero y sin error).
// El campo de Drex va en formato E.164 con el pais: "+541100000000". NODO manda el numero nacional.
async function guardarWhatsappOficina(args) {
  args = args || {};
  if (_loginEnCurso) return { ok: false, ocupado: true, message: 'La ventana de Agentes esta entrando a la sesion.' };
  if (pageNeedsLogin()) return { ok: false, needsLogin: true, message: 'Hay que entrar a Agentes antes de cambiar el WhatsApp.' };
  if (String(window.location.href || '').indexOf('/agents/features') < 0) {
    return { ok: false, motivo: 'OTRA_PANTALLA', message: 'La ventana de Agentes no esta en Funcionalidades y permisos.' };
  }
  var digitos = String(args.numero || '').replace(/[^0-9]/g, '');
  if (digitos.length > 10 && digitos.indexOf('54') === 0) digitos = digitos.slice(2);
  if (digitos.length === 11 && (digitos.charAt(0) === '9' || digitos.charAt(0) === '0')) digitos = digitos.slice(1);
  if (digitos.length < 7 || digitos.length > 10) return { ok: false, motivo: 'NUMERO_INVALIDO', message: 'El numero debe tener entre 7 y 10 digitos.' };
  try {
    // 1) Que se dibuje y quede quieto.
    var t0 = now(), el = null, ultimo = null, desde = 0;
    while (now() - t0 < 15000) {
      if (pageNeedsLogin()) return { ok: false, needsLogin: true, message: 'Agentes pidio ingresar de nuevo.' };
      el = _wsInput(document);
      if (el) {
        var v = String(el.value || '');
        if (v !== ultimo) { ultimo = v; desde = now(); }
        if (now() - desde >= 800 && (v !== '' || now() - t0 >= 5000)) break;
      }
      await delay(200);
    }
    if (!el) return { ok: false, motivo: 'NO_APARECIO', message: 'La pantalla no mostro el campo de WhatsApp.' };
    // 2) El pais que ya tiene la oficina: todo lo que esta antes de los ultimos 10 digitos (si no hay, +54).
    var actual = String(el.value || '').replace(/[^0-9+]/g, '');
    var pais = (/^\+\d{11,13}$/.test(actual)) ? actual.slice(0, actual.length - 10) : '+54';
    if (!/^\+\d{1,3}$/.test(pais)) pais = '+54';
    var nuevo = pais + digitos;
    if (actual === nuevo) return { ok: true, sinCambio: true, numero: nuevo, pais: pais, habilitado: _wsHabilitado(document), numeroValido: true };
    // 3) Escribir.
    if (!(await setReactInputAndVerify(el, nuevo, 5))) return { ok: false, motivo: 'NO_SE_ACTUALIZO', message: 'Agentes no tomo el numero escrito.' };
    // 4) Guardar: el boton de la misma seccion, debajo del formulario.
    var form = el.closest('#Form_WhatsappContact');
    var seccion = (form && form.parentElement) || document;
    var guardar = Array.prototype.slice.call(seccion.querySelectorAll('button')).filter(function (b) { return /^guardar$/i.test((b.textContent || '').trim()); })[0];
    if (!guardar) return { ok: false, motivo: 'NO_APARECIO', message: 'No encontre Guardar en la seccion de WhatsApp.' };
    var antes = leerCartelesVisibles().join(' | ');
    clickElement(guardar);
    // 5) Confirmar: un aviso nuevo (de exito o de error), o el error del propio campo (formato).
    var t1 = now(), aviso = '';
    while (now() - t1 < 8000) {
      await delay(250);
      var cart = leerCartelesVisibles().join(' | ');
      if (cart && cart !== antes) { aviso = cart; break; }
      var errCampo = document.querySelector('.parsley-errors-list li, .Mui-error .MuiFormHelperText-root');
      if (errCampo && (errCampo.textContent || '').trim()) {
        return { ok: false, motivo: 'RECHAZADO', message: 'Agentes no acepto el numero: ' + (errCampo.textContent || '').trim().slice(0, 120) };
      }
    }
    if (aviso && /error|no se pudo|invalid|incorrect|fall/i.test(aviso)) {
      return { ok: false, motivo: 'RECHAZADO', message: 'Agentes no guardo el numero: ' + aviso.slice(0, 120) };
    }
    var quedo = String((_wsInput(document) || {}).value || '').replace(/[^0-9+]/g, '');
    if (quedo !== nuevo) return { ok: false, motivo: 'VERIFICACION', message: 'Despues de guardar, Agentes muestra otro numero. Revisalo.' };
    // Sin aviso de exito no hay certeza: el panel vuelve a leer la pantalla recargada para confirmarlo.
    return { ok: true, numero: nuevo, pais: pais, habilitado: _wsHabilitado(document), numeroValido: true,
             confirmado: !!aviso, confirmarLeyendo: !aviso, mensaje: aviso || 'Guardado (sin aviso de la pagina).' };
  } catch (e) {
    return { ok: false, motivo: 'ERROR', message: (e && e.message) ? e.message : String(e) };
  }
}

const api = {
  leerWhatsappOficina,
  guardarWhatsappOficina,
  buscarUsuario,
  cargarSaldo,
  retirarSaldo,
  finalizarOperacionAgentes,
  cambiarClave,
  crearUsuario,
  obtenerSaldoAgente,
  irABusquedaUsuarios,
  iniciarSesion,
  estadoPagina: status,
  // ⛔ Cancelar real + recuperación de flujo (portado de NexoBetaChan 1.0.82)
  recuperarFlujo: async () => { const flujo = await recuperarFlujoPendiente(); return status({ flujo }); },
  abortarOperacion: () => { _abortOperacion = true; return { ok: true, message: 'Freno solicitado.' }; }
};
// Métodos de operación: al arrancar uno se limpia un freno viejo (para que un ⛔ anterior no mate
// la operación siguiente). recuperarFlujo/abortarOperacion/estadoPagina/obtenerSaldoAgente NO limpian.
const METODOS_OPERACION = new Set(['buscarUsuario', 'cargarSaldo', 'retirarSaldo', 'crearUsuario', 'cambiarClave']);

contextBridge.exposeInMainWorld('drexAutomation', api);

ipcRenderer.on('drex:automation:run', async (event, request = {}) => {
  const { requestId, method, args = [] } = request;
  try {
    if (!Object.prototype.hasOwnProperty.call(api, method)) {
      throw new Error(`Método no permitido: ${method}`);
    }
    if (METODOS_OPERACION.has(method)) _abortOperacion = false; // limpiar freno viejo al arrancar una operación
    _opsEnCurso++;
    _yaAplico = false;
    let result;
    try { result = await api[method](...args); }
    catch (e) {
      // La sesión se murió en medio y ANTES de mover plata: no es un error técnico ni un timeout,
      // es "hay que entrar de nuevo". Devuelto como estado, el panel abre el login en vez de
      // quedarse en "la consulta tardó demasiado" (Juan, 13/09).
      if (e && e.sesionInvalida) result = status({ message: e.message });
      else throw e;
    }
    finally { _opsEnCurso = Math.max(0, _opsEnCurso - 1); }
    ipcRenderer.send('drex:automation:result', { requestId, ok: true, result });
  } catch (error) {
    ipcRenderer.send('drex:automation:result', { requestId, ok: false, error: error.message || String(error) });
  }
});
// Canal separado para verificación de login (verifyWindow)
ipcRenderer.on('drex:verify:run', async (event, request = {}) => {
  const { requestId, method, args = [] } = request;
  try {
    if (!Object.prototype.hasOwnProperty.call(api, method)) {
      throw new Error('Método no permitido: ' + method);
    }
    const result = await api[method](...args);
    ipcRenderer.send('drex:verify:result', { requestId, ok: true, result });
  } catch (error) {
    ipcRenderer.send('drex:verify:result', { requestId, ok: false, error: error.message || String(error) });
  }
});

// Saludo a main: "ya estoy escuchando". Sin esto habia una carrera real  loadURL() es asincrono,
// asi que justo despues de crear la ventana isLoading() puede dar false, main daba la ventana por
// lista y mandaba la orden cuando de este lado todavia no habia ningun listener: el mensaje se
// perdia y la llamada moria en el timeout. Pasaba al pedir una busqueda o una carga mientras la
// ventana recien se levantaba (Juan, 26/9).
try { ipcRenderer.send('drex:preload-listo'); } catch (_) {}
