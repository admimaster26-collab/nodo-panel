// ============================================================
// NODO · PRELOAD DE AGENTES — BET300 (agentesbet.net)
// Versión PARALELA del backoffice. NO reemplaza a agent-preload.js (casinodrex).
// Plataforma: Vue + Vuetify + Material Design Icons (mdi-*).
// Mantiene el MISMO contrato que el preload actual (mismos métodos, mismos
// canales IPC drex:automation:run / drex:verify:run, mismo window.drexAutomation)
// para que main.js solo tenga que cambiar la AGENT_URL y qué preload carga.
// Mapa de selectores: BET300-preload-selectores.md
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

const BASE_URL = 'https://agentesbet.io/';
const CLAVE_ESTANDAR = '12345a';      // clave fija para crear jugador y blanquear (a pedido)
const DEFAULT_TIMEOUT = 18000;
const STEP_DELAY = 180;

function delay(ms = STEP_DELAY) { return new Promise(r => setTimeout(r, ms)); }
function now() { return Date.now(); }

// ── Freno real (⛔ Cancelar) ─────────────────────────────────────────────────
let _abortOperacion = false;
function _chequearFreno(donde) {
  if (_abortOperacion) throw new Error('⛔ Operación frenada por el operador' + (donde ? ' (' + donde + ')' : '') + '. No se aplicó plata.');
}

// ── Utilidades DOM ───────────────────────────────────────────────────────────
function isVisible(el) {
  if (!el) return false;
  const s = window.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
}
function visibleElements(sel, root = document) {
  return Array.from(root.querySelectorAll(sel)).filter(isVisible);
}
function firstVisible(sel, root = document) {
  return visibleElements(sel, root)[0] || null;
}
async function waitFor(predicate, timeout = DEFAULT_TIMEOUT, interval = 120) {
  const started = now();
  while (now() - started < timeout) {
    _chequearFreno();
    const v = typeof predicate === 'function' ? predicate() : document.querySelector(predicate);
    if (v) return v;
    await delay(interval);
  }
  throw new Error('Tiempo de espera agotado esperando la página de agentes (BET300).');
}
function normalizeText(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
function normAlias(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');
}
// Formato AR: punto = miles, coma = decimal → "10.425.821" = 10425821
function parseMoney(v) {
  let s = String(v || '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// Inyección Vue/Vuetify: native setter + eventos input/change (v-model escucha 'input').
function setFieldValue(input, value) {
  if (!input) throw new Error('No se encontró el campo requerido.');
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const set = v => setter ? setter.call(input, v) : (input.value = v);
  input.click(); input.focus();
  set('');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  set(String(value));
  input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: String(value), inputType: 'insertText' }));
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}
async function setFieldAndVerify(input, value, tries = 4) {
  const target = String(value);
  for (let i = 0; i < tries; i++) {
    setFieldValue(input, target);
    await delay(120);
    if (String(input.value || '') === target) return true;
  }
  return false;
}
function clickElement(el) {
  if (!el) throw new Error('No se encontró el elemento clickeable.');
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus?.();
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  el.click();
}

// Botón que contiene un ícono mdi (ej: 'mdi-cash-plus'). Opcionalmente scopeado a una fila/modal.
function iconBtn(mdiName, root = document) {
  const i = firstVisible('i.' + mdiName + ', .' + mdiName, root);
  if (!i) return null;
  return i.closest('button, .v-btn, [role="button"]') || i.parentElement;
}
// Elemento visible cuyo texto matchea (botón / item de menú / etc.)
function findByText(re, selector = 'button, .v-btn, [role="button"], .v-list-item, [role="option"]', root = document) {
  return visibleElements(selector, root).find(el => re.test(normalizeText(el.textContent)));
}

// Diálogo (modal) Vuetify activo. OJO: el snackbar TAMBIÉN es .v-overlay --> filtramos por .v-dialog.
function findActiveModal() {
  return firstVisible('.v-overlay--active.v-dialog');
}
async function cerrarModalActual() {
  const modal = findActiveModal();
  const scope = modal || document;
  const cerrar = findByText(/^(cerrar|cancelar|cancel|close)$/i, 'button, .v-btn', scope);
  if (cerrar) { clickElement(cerrar); await delay(300); return true; }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  await delay(300);
  return false;
}

// ── Toast de resultado (v-snackbar) ─────────────────────────────────────────
// Éxito: .v-snackbar__wrapper.bg-success (texto "balance_updated_successfully")
// Error: .v-snackbar__wrapper.bg-error   (texto "General Error -13", etc.)
function readSnackbar() {
  const w = firstVisible('.v-snackbar__wrapper');
  if (!w) return null;
  const txt = normalizeText((w.querySelector('.v-snackbar__content') || w).textContent);
  if (w.classList.contains('bg-success')) return { tipo: 'ok', texto: txt };
  if (w.classList.contains('bg-error')) return { tipo: 'error', texto: txt };
  return { tipo: '?', texto: txt };
}
async function waitForSnackbar(timeout = 9000) {
  const t = now() + timeout;
  while (now() < t) {
    const s = readSnackbar();
    if (s && s.tipo !== '?') return s;
    await delay(150);
  }
  return readSnackbar(); // lo que haya (o null)
}

// ── Captura de toast NUEVO (MutationObserver) ───────────────────────────────
// Leer el snackbar "a posteriori" es frágil: (a) puede quedar el de la operación
// ANTERIOR (Vuetify los deja ~5s) → falso ERROR_OPERATIVO; (b) uno breve se pierde
// entre pasos → caemos a verificaciones lentas. Solución: instalar el observer ANTES
// del click y quedarnos con el PRIMER snackbar que aparezca DESPUÉS.
function observarSnackbar() {
  const capt = { resultado: null, obs: null };
  try {
    capt.obs = new MutationObserver(muts => {
      if (capt.resultado) return;
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (!n || n.nodeType !== 1) continue;
          const el = (n.matches && n.matches('.v-snackbar__wrapper'))
            ? n
            : (n.querySelector && n.querySelector('.v-snackbar__wrapper'));
          if (!el) continue;
          const txt = normalizeText((el.querySelector('.v-snackbar__content') || el).textContent);
          if (el.classList.contains('bg-success')) { capt.resultado = { tipo: 'ok', texto: txt }; return; }
          if (el.classList.contains('bg-error'))   { capt.resultado = { tipo: 'error', texto: txt }; return; }
        }
      }
    });
    capt.obs.observe(document.body, { childList: true, subtree: true });
  } catch (_e) {}
  return capt;
}
async function esperarSnackbarCapturado(capt, timeout = 9000) {
  const t = now() + timeout;
  while (now() < t) {
    if (capt && capt.resultado) break;
    await delay(120);
  }
  try { if (capt && capt.obs) capt.obs.disconnect(); } catch (_e) {}
  return (capt && capt.resultado) || null;
}

// Tras "Guardar" (crear jugador / blanquear clave) BET300 muestra un modal extra
// "Confirmar creación..." con botón "Confirmar". Lo aceptamos si aparece.
async function confirmarModalFinal(timeout = 5000) {
  const t = now() + timeout;
  while (now() < t) {
    const btn = findByText(/^confirmar$/i, 'button, .v-btn');
    if (btn) { clickElement(btn); await delay(300); return true; }
    await delay(150);
  }
  return false;
}

// ── Login / estado de página ─────────────────────────────────────────────────
function pageNeedsLogin() {
  if (/\/login/i.test(location.href)) return true;
  const alias = document.querySelector('input[placeholder="Alias"]');
  const pass = document.querySelector('input[type="password"]');
  const btn = findByText(/iniciar sesi[oó]n/i, 'button, .v-btn');
  // Alias + password + botón "Iniciar sesión" juntos = pantalla de login
  return Boolean(alias && pass && btn && isVisible(pass));
}
function pageIsBlocked() {
  try {
    const hasApp = !!(
      document.querySelector('input[placeholder="Buscar usuario"]') ||
      document.querySelector('input[placeholder="Alias"]') ||
      firstVisible('.v-list-item') ||
      findActiveModal()
    );
    if (hasApp) return false;
    const errRe = /request blocked|access denied|forbidden|service unavailable|bad gateway|gateway timeout|just a moment|attention required|checking your browser|502|503|504/i;
    const body = (document.body && (document.body.innerText || document.body.textContent) || '').slice(0, 2500);
    return errRe.test(body) || errRe.test(document.title || '');
  } catch (_) { return false; }
}
function status(extra = {}) {
  const pageError = pageIsBlocked();
  const needsLogin = !pageError && pageNeedsLogin();
  return {
    ok: !needsLogin && !pageError,
    needsLogin,
    pageError,
    url: location.href,
    message: pageError
      ? 'La página de agentes (BET300) respondió con un error del servidor. No se operó. Reintentá.'
      : needsLogin
      ? 'BET300 requiere iniciar sesión. Iniciá sesión y volvé a intentar.'
      : 'Módulo de agentes BET300 disponible.',
    ...extra
  };
}

// Cierra menús/dropdowns de Vuetify colgados (ej. el de la lupa que queda abierto si una
// búsqueda anterior se cortó). NO son diálogos, así que findActiveModal no los agarra.
function cerrarMenusAbiertos() {
  const menus = visibleElements('.v-overlay--active.v-menu, .v-menu__content, .v-overlay--active .v-list');
  if (!menus.length) return false;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  const scrim = firstVisible('.v-overlay--active .v-overlay__scrim');
  if (scrim) { try { scrim.click(); } catch (_e) {} }
  return true;
}

// Cierra diálogos/menús/toasts colgados de una operación anterior (retoma sin refrescar).
async function recuperarFlujoPendiente() {
  for (let i = 0; i < 4; i++) {
    if (pageIsBlocked() || pageNeedsLogin()) return status();
    if (findActiveModal()) { await cerrarModalActual(); await delay(200); continue; }
    if (cerrarMenusAbiertos()) { await delay(200); continue; }
    break;
  }
  return status();
}
async function ensureReady() {
  if (pageIsBlocked()) return status();
  await recuperarFlujoPendiente();
  if (pageNeedsLogin() || pageIsBlocked()) return status();
  // Esperar a que la SPA esté OPERABLE (buscador presente o un modal abierto) antes de
  // actuar: después de un reload, Vue tarda en montar y se arrancaba demasiado temprano.
  await waitFor(() => findSearchInput() || findActiveModal(), 8000).catch(() => {});
  return status();
}

// ── Búsqueda ─────────────────────────────────────────────────────────────────
function findSearchInput() { return firstVisible('input[placeholder="Buscar usuario"]'); }

// Filas de jugador: .v-row con columna alias (.v-col-5) y acción de carga (mdi-cash-plus).
function filasJugador() {
  return Array.from(document.querySelectorAll('.v-row'))
    .filter(r => isVisible(r) && r.querySelector('.v-col-5') && r.querySelector('.mdi-cash-plus'));
}
function aliasDeFila(row) {
  const col = row.querySelector('.v-col-5');
  return normalizeText(col ? col.textContent : '');
}
function buscarFilaPorAlias(alias) {
  const want = normAlias(alias);
  return filasJugador().find(r => normAlias(aliasDeFila(r)) === want) || null;
}
function saldoDeFila(row) {
  const col = row.querySelector('.v-col-4');
  if (!col) return null;
  const raw = normalizeText(col.textContent);
  return { raw, value: parseMoney(raw) };
}

// "Firma" de la lista visible: sirve para saber si el resultado de la búsqueda YA llegó.
// BET300 deja en pantalla la lista ANTERIOR mientras la API responde, así que no se puede
// concluir "no existe" solo porque haya filas: hay que esperar a que la lista CAMBIE.
function firmaFilas() {
  return filasJugador().map(r => normAlias(aliasDeFila(r))).join('|');
}

// Selecciona "Todos los jugadores" del menú que abre la lupa. ROBUSTO: espera a que el
// item aparezca (el menú puede tardar más que una ventana corta), lo clickea, y CONFIRMA
// que el menú se cerró; si el menú no está abierto, lo reabre con la lupa. Devuelve true
// si logró elegirlo. (Este paso fallando = la ventana queda colgada con el dropdown abierto
// y la búsqueda nunca se ejecuta → era la causa del ERROR_OPERATIVO / timeout.)
async function elegirTodosLosJugadores(timeout = 6000) {
  const SEL = '.v-overlay__content .v-list-item, .v-list-item, [role="option"], .v-list-item__content';
  const buscarOpt = () => findByText(/^\s*todos\s+los\s+jugadores\s*$/i, SEL);
  const fin = now() + timeout;
  let vueltas = 0;
  while (now() < fin) {
    _chequearFreno('buscando');
    const opt = buscarOpt();
    if (opt) {
      clickElement(opt.closest('.v-list-item, [role="option"], li') || opt);
      await delay(300);
      if (!buscarOpt()) return true; // el menú se cerró → quedó seleccionado
    } else if (++vueltas % 10 === 0) {
      const lupa = iconBtn('mdi-magnify'); // menú cerrado → reabrir
      if (lupa) clickElement(lupa);
    }
    await delay(150);
  }
  return false;
}

// Ejecuta la búsqueda: escribe alias → lupa → "Todos los jugadores" → ESPERA el refresco.
// Devuelve true si detectó que la lista se refrescó (resultado real ya en pantalla).
async function ejecutarBusqueda(alias, timeout = DEFAULT_TIMEOUT) {
  const input = await waitFor(findSearchInput, timeout);
  const ok = await setFieldAndVerify(input, String(alias).trim(), 4);
  if (!ok) throw new Error('El campo de búsqueda no aceptó el alias.');

  const firmaAntes = firmaFilas(); // foto de la lista ANTES de buscar

  const lupa = iconBtn('mdi-magnify');
  if (lupa) clickElement(lupa);
  await delay(250);
  await elegirTodosLosJugadores(6000); // robusto: no deja el dropdown colgado

  // Esperar a que la lista se REFRESQUE (firma distinta) = llegó el resultado real.
  // Si no refresca en ~5s, reintentar la selección UNA vez (el menú a veces no dispara
  // la búsqueda a la primera). Tope total 12s.
  const inicio = now();
  let reintentado = false;
  while (now() - inicio < 12000) {
    _chequearFreno('buscando');
    if (firmaFilas() !== firmaAntes) { await delay(250); return true; }
    if (!reintentado && now() - inicio > 5000) {
      reintentado = true;
      const l2 = iconBtn('mdi-magnify');
      if (l2) clickElement(l2);
      await delay(250);
      await elegirTodosLosJugadores(4000);
    }
    await delay(150);
  }
  await delay(250);
  return false; // no se detectó refresco (puede que el resultado sea idéntico al previo)
}

// ⛔ Núcleo estable: busca y (opcional) lee saldo. Deja _currentUser para las operaciones.
let _currentUser = '';
async function buscarUsuario(usuario, options = {}) {
  if (!usuario || String(usuario).trim().length < 3) {
    throw new Error('El usuario debe tener al menos 3 caracteres.');
  }
  const ready = await ensureReady();
  if (ready.needsLogin || ready.pageError) return ready;

  const wanted = String(usuario).trim();
  const refresco = await ejecutarBusqueda(wanted, options.timeout || DEFAULT_TIMEOUT);

  // Esperar la fila que COINCIDE con el alias buscado.
  // ⚠ NO se concluye "no existe" por haber filas en pantalla: BET300 deja la lista
  // anterior mientras responde la API, y ese heurístico daba falsos ERROR_OPERATIVO.
  // Si la lista YA se refrescó, alcanza una ventana corta; si no, timeout completo.
  const VENTANA = refresco ? 6000 : (options.timeout || DEFAULT_TIMEOUT);
  const inicio = now();
  let fila = null;
  while (now() - inicio < VENTANA) {
    if (pageNeedsLogin()) return status();
    fila = buscarFilaPorAlias(wanted);
    if (fila) break;
    await delay(180);
  }
  if (!fila) {
    return { ok: true, exists: false, user: wanted, message: 'No apareció el usuario buscado en BET300.' };
  }

  _currentUser = aliasDeFila(fila);
  const balance = saldoDeFila(fila); // saldo del jugador (columna Cantidad)
  return { ok: true, exists: true, user: _currentUser, balance };
}

// ── Carga / Descarga ─────────────────────────────────────────────────────────
// Lee los balances del modal por ORDEN DOM: [0]=agente, [1]=jugador, [2]=cantidad, [3]=bono.
function leerModalMontos() {
  const modal = findActiveModal();
  if (!modal) return { modal: null, agente: null, jugador: null, cantidadInput: null, bonoInput: null, nInputs: 0 };
  const inputs = Array.from(modal.querySelectorAll('input.v-field__input')).filter(isVisible);
  return {
    modal,
    agente: inputs[0] ? { raw: inputs[0].value, value: parseMoney(inputs[0].value) } : null,
    jugador: inputs[1] ? { raw: inputs[1].value, value: parseMoney(inputs[1].value) } : null,
    cantidadInput: inputs[2] || null,   // editable — el monto
    bonoInput: inputs[3] || null,       // editable — bono (solo en carga)
    nInputs: inputs.length
  };
}

// tipo: 'carga' (mdi-cash-plus) | 'retiro' (mdi-cash-minus)
async function aplicarMonto(tipo, amount, options = {}) {
  const monto = Number(String(amount).replace(',', '.'));
  if (!Number.isFinite(monto) || monto <= 0) throw new Error('El monto debe ser un número mayor a cero.');

  const ready = await ensureReady();
  if (ready.needsLogin || ready.pageError) return ready;

  // Asegurar que la fila del usuario esté visible (re-buscar si hizo falta).
  let fila = _currentUser ? buscarFilaPorAlias(_currentUser) : null;
  if (!fila && _currentUser) {
    await ejecutarBusqueda(_currentUser, options.timeout || DEFAULT_TIMEOUT);
    fila = await waitFor(() => buscarFilaPorAlias(_currentUser), options.timeout || DEFAULT_TIMEOUT).catch(() => null);
  }
  if (!fila) throw new Error('No encuentro la fila del jugador para operar (¿se limpió la búsqueda?).');

  const iconName = tipo === 'carga' ? 'mdi-cash-plus' : 'mdi-cash-minus';
  // Esperamos el ícono (los botones de la fila pueden tardar en renderizar) y RE-buscamos
  // la fila en cada intento por si Vue re-renderizó la lista y el nodo quedó viejo.
  const btn = await waitFor(() => {
    const f = (_currentUser ? buscarFilaPorAlias(_currentUser) : null) || fila;
    return f ? iconBtn(iconName, f) : null;
  }, options.timeout || DEFAULT_TIMEOUT).catch(() => null);
  if (!btn) throw new Error(`No apareció el botón de ${tipo} en la fila del jugador.`);
  clickElement(btn);

  // Esperar el modal (con su input de Cantidad).
  await waitFor(() => { const m = leerModalMontos(); return m.modal && m.cantidadInput; }, options.timeout || DEFAULT_TIMEOUT);
  await delay(300);

  let m = leerModalMontos();
  const preJugador = m.jugador || { raw: '', value: 0, unchanged: true };

  // Retiro: chequear saldo suficiente (si el saldo leído es confiable).
  if (tipo === 'retiro' && preJugador && preJugador.value > 0 && preJugador.value < monto) {
    await cerrarModalActual();
    return {
      ok: false, saldoInsuficiente: true, balance: preJugador,
      message: `Saldo insuficiente: ${preJugador.raw} disponible, se solicitaron ${monto}.`
    };
  }

  // Cargar el monto en "Cantidad" y, en carga, Bono = 0.
  if (!m.cantidadInput) throw new Error('No se encontró el campo "Cantidad".');
  await setFieldAndVerify(m.cantidadInput, String(Math.round(monto)), 4);
  if (tipo === 'carga' && m.bonoInput && String(m.bonoInput.value || '').trim() !== '0') {
    setFieldValue(m.bonoInput, '0');
  }
  await delay(250);

  // Botón "Enviar" del modal.
  const enviar = findByText(/^enviar$/i, 'button, .v-btn', m.modal);
  if (!enviar) throw new Error('No se encontró el botón "Enviar".');
  if (enviar.disabled) throw new Error('El botón "Enviar" está deshabilitado (¿monto inválido?).');

  // Observer ANTES del click: solo cuenta el snackbar que aparezca DESPUÉS de enviar.
  // (Si leyéramos el snackbar visible, podríamos agarrar el de la operación anterior
  //  —Vuetify los deja ~5s— y reportar un ERROR_OPERATIVO falso.)
  const capt = observarSnackbar();
  _chequearFreno('antes de enviar'); // ÚLTIMO punto seguro antes de mover plata
  clickElement(enviar);

  // Resultado por toast NUEVO: bg-success = ok / bg-error = fallo.
  const snack = await esperarSnackbarCapturado(capt, 9000);
  const exito = snack ? (snack.tipo === 'ok') : null;

  // Saldo POST: BET300 no lo da en un modal → estimar pre ± monto.
  let newBalance = null;
  if (preJugador && !preJugador.unchanged) {
    const post = tipo === 'carga' ? preJugador.value + monto : preJugador.value - monto;
    newBalance = { raw: String(post), value: post, estimated: true };
  } else {
    newBalance = { raw: preJugador.raw, value: preJugador.value, unchanged: true };
  }

  // Cerrar el modal si quedó abierto (en éxito suele cerrarse solo).
  if (findActiveModal()) { await cerrarModalActual(); }

  return {
    ok: true,
    action: tipo,
    amount: monto,
    previousBalance: preJugador,
    newBalance,
    exito,                                   // true=ok / false=fallo / null=no se vio toast
    resultado: snack ? snack.texto : '',
    message: exito === false
      ? `${tipo} RECHAZADO por BET300: ${snack ? snack.texto : 'sin detalle'}.`
      : `${tipo} enviado. Saldo anterior: ${preJugador.raw || '—'} → ~${newBalance.raw}.`
  };
}
function cargarSaldo(amount, options) { return aplicarMonto('carga', amount, options); }
function retirarSaldo(amount, options) { return aplicarMonto('retiro', amount, options); }

// Cierra el modal/toast y limpia el buscador, listo para la próxima (sin refrescar).
async function finalizarOperacionAgentes() {
  try { if (findActiveModal()) await cerrarModalActual(); } catch (_) {}
  try {
    const limpiar = iconBtn('mdi-window-close');
    if (limpiar) { clickElement(limpiar); await delay(200); }
    else { const s = findSearchInput(); if (s) setFieldValue(s, ''); }
  } catch (_) {}
  return { ok: true };
}

// ── Cambiar clave (1 solo campo → CLAVE_ESTANDAR) ────────────────────────────
async function cambiarClave(_password, options = {}) {
  const ready = await ensureReady();
  if (ready.needsLogin || ready.pageError) return ready;

  let fila = _currentUser ? buscarFilaPorAlias(_currentUser) : null;
  if (!fila) throw new Error('No encuentro la fila del jugador para cambiar la clave.');

  const btn = iconBtn('mdi-key', fila);
  if (!btn) throw new Error('No apareció el botón de cambiar clave en la fila.');
  clickElement(btn);

  const modal = await waitFor(findActiveModal, options.timeout || DEFAULT_TIMEOUT);
  await delay(300);
  const campo = firstVisible('input.v-field__input', modal);
  if (!campo) throw new Error('No apareció el campo de nueva contraseña.');
  const ok = await setFieldAndVerify(campo, CLAVE_ESTANDAR, 5);
  if (!ok) throw new Error('No se pudo escribir la nueva contraseña.');

  const guardar = findByText(/^guardar$/i, 'button, .v-btn', modal);
  if (!guardar) throw new Error('No se encontró el botón "Guardar".');
  const captClave = observarSnackbar(); // observer ANTES: el toast puede salir durante el "Confirmar"
  clickElement(guardar);
  await confirmarModalFinal(); // BET300 pide un "Confirmar" extra

  const snack = await esperarSnackbarCapturado(captClave, 8000);
  if (findActiveModal()) await cerrarModalActual();
  return {
    ok: snack ? snack.tipo === 'ok' : true,
    action: 'cambio_clave',
    password: CLAVE_ESTANDAR,
    message: snack ? snack.texto : 'Cambio de clave enviado.'
  };
}

// ── Crear jugador (modal; clave → CLAVE_ESTANDAR) ────────────────────────────
async function crearUsuario(alias, _password, options = {}) {
  if (!alias || String(alias).trim().length < 3) throw new Error('El alias debe tener al menos 3 caracteres.');
  const ready = await ensureReady();
  if (ready.needsLogin || ready.pageError) return ready;

  const abrir = findByText(/^crear jugador$/i, 'button, .v-btn');
  if (!abrir) throw new Error('No se encontró el botón "Crear jugador".');
  clickElement(abrir);

  const modal = await waitFor(findActiveModal, options.timeout || DEFAULT_TIMEOUT);
  await delay(300);

  const aliasInput = firstVisible('input[placeholder="Alias"]', modal);
  if (!aliasInput) throw new Error('No apareció el campo Alias.');
  const aliasOk = await setFieldAndVerify(aliasInput, String(alias).trim(), 5);
  if (!aliasOk) throw new Error('No se pudo escribir el alias.');

  // Contraseña autogenerada (placeholder "password_placeholder") → forzar CLAVE_ESTANDAR.
  const passInput = firstVisible('input[placeholder="password_placeholder"]', modal)
    || Array.from(modal.querySelectorAll('input.v-field__input')).filter(isVisible)[1];
  if (passInput) await setFieldAndVerify(passInput, CLAVE_ESTANDAR, 5);

  const guardar = findByText(/^guardar$/i, 'button, .v-btn', modal);
  if (!guardar) throw new Error('No se encontró el botón "Guardar".');
  // Observer ANTES de Guardar: el toast de creación suele salir apenas se acepta el
  // "Confirmar", y leyéndolo después se perdía → caíamos siempre al fallback lento.
  const captCrear = observarSnackbar();
  clickElement(guardar);
  await confirmarModalFinal(); // BET300: acepta "Confirmar creación del jugador"

  const snack = await esperarSnackbarCapturado(captCrear, 7000);
  if (findActiveModal()) await cerrarModalActual();

  if (snack && snack.tipo === 'error') {
    return { ok: false, alias, error: 'rechazado', message: 'BET300 rechazó la creación: ' + snack.texto };
  }
  if (snack && snack.tipo === 'ok') {
    return { ok: true, alias, password: CLAVE_ESTANDAR, message: 'Jugador creado correctamente.' };
  }
  // Sin toast concluyente (a veces no se alcanza a leer el toast de éxito): VERIFICAMOS
  // buscando el alias — si ya figura en BET300, la creación fue correcta y NODO recibe el OK.
  try {
    await ejecutarBusqueda(String(alias).trim(), 8000);
    const fila = await waitFor(() => buscarFilaPorAlias(String(alias).trim()), 6000).catch(() => null);
    if (fila) {
      _currentUser = aliasDeFila(fila);
      return { ok: true, alias, password: CLAVE_ESTANDAR, message: 'Jugador creado (verificado por búsqueda).' };
    }
  } catch (_e) {}
  return { ok: false, alias, error: 'sin_confirmacion', message: 'No se pudo confirmar la creación. Verificá en BET300 antes de cargar.' };
}

// ── Saldo del agente (operador) ──────────────────────────────────────────────
function readAgentBalance() {
  // El saldo del agente está en un span propio, ej "9.148.320 ARS". OJO: el header tiene un
  // BADGE de notificación (ej "3") pegado al lado → si leemos el texto del PADRE, junta el badge
  // con el saldo (3 + 9.148.320 = 39.148.320, +30M falso). Por eso leemos SOLO el texto directo
  // (text nodes propios) de cada elemento y exigimos que sea EXACTAMENTE "<numero> ARS".
  const ownText = el => Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
  for (const el of visibleElements('span, div, p, b, strong')) {
    const t = normalizeText(ownText(el));
    if (/^\$?\s*[\d][\d.,]*\s*ARS$/i.test(t)) return { raw: t, value: parseMoney(t) };
  }
  return { raw: '', value: 0 };
}
async function obtenerSaldoAgente(options = {}) {
  if (pageNeedsLogin()) return { ok: false, needsLogin: true };
  await waitFor(() => readAgentBalance().value > 0, options.timeout || 6000).catch(() => {});
  return { ok: true, balance: readAgentBalance() };
}

function irABusquedaUsuarios() {
  if (!/agentesbet\.(net|io)/i.test(location.href) || pageNeedsLogin()) {
    try { location.assign(BASE_URL); } catch (_) {}
  }
  return { ok: true, url: BASE_URL };
}

// ── Login ────────────────────────────────────────────────────────────────────
async function iniciarSesion(usuario, clave) {
  if (!pageNeedsLogin()) return { ok: true, message: 'Sesión ya activa.' };

  let alias = null, pass = null, entrar = null;
  const t = now();
  while (now() - t < 6000) {
    alias = document.querySelector('input[placeholder="Alias"]');
    pass = document.querySelector('input[type="password"]');
    entrar = findByText(/iniciar sesi[oó]n/i, 'button, .v-btn');
    if (alias && pass && entrar) break;
    await delay(250);
  }
  if (!alias || !pass || !entrar) return { ok: false, message: 'No se encontró el formulario de login de BET300.' };

  setFieldValue(alias, usuario);
  await delay(200);
  setFieldValue(pass, clave);
  await delay(300);
  clickElement(entrar);

  const inicio = now();
  while (now() - inicio < 15000) {
    await delay(500);
    if (!pageNeedsLogin()) return { ok: true, message: 'Sesión iniciada.' };
  }
  return { ok: false, message: 'No se pudo iniciar sesión en BET300. Verificá usuario y contraseña.' };
}

// ── API expuesta (mismo shape que el preload de casinodrex) ──────────────────
const api = {
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
  recuperarFlujo: async () => { await recuperarFlujoPendiente(); return status(); },
  abortarOperacion: () => { _abortOperacion = true; return { ok: true, message: 'Freno solicitado.' }; }
};
const METODOS_OPERACION = new Set(['buscarUsuario', 'cargarSaldo', 'retirarSaldo', 'crearUsuario', 'cambiarClave']);

contextBridge.exposeInMainWorld('drexAutomation', api);

ipcRenderer.on('drex:automation:run', async (event, request = {}) => {
  const { requestId, method, args = [] } = request;
  try {
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`Método no permitido: ${method}`);
    if (METODOS_OPERACION.has(method)) _abortOperacion = false;
    const result = await api[method](...args);
    ipcRenderer.send('drex:automation:result', { requestId, ok: true, result });
  } catch (error) {
    ipcRenderer.send('drex:automation:result', { requestId, ok: false, error: error.message || String(error) });
  }
});
ipcRenderer.on('drex:verify:run', async (event, request = {}) => {
  const { requestId, method, args = [] } = request;
  try {
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error('Método no permitido: ' + method);
    const result = await api[method](...args);
    ipcRenderer.send('drex:verify:result', { requestId, ok: true, result });
  } catch (error) {
    ipcRenderer.send('drex:verify:result', { requestId, ok: false, error: error.message || String(error) });
  }
});
