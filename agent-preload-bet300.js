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
let _navegandoAInicio = false;  // true mientras el preload navega al INICIO post-login → una carga forzada espera a que termine
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
async function waitFor(predicate, timeout = DEFAULT_TIMEOUT, interval = 120, label) {
  const started = now();
  while (now() - started < timeout) {
    _chequearFreno();
    const v = typeof predicate === 'function' ? predicate() : document.querySelector(predicate);
    if (v) {
      // [perf] detección de demoras: logueamos solo las esperas LENTAS (>700ms) para ver dónde se traba.
      const el = now() - started;
      if (el > 700) console.log('%c[perf] waitFor'+(label?' ['+label+']':'')+' resolvió en '+el+'ms', 'color:#eab308');
      return v;
    }
    await delay(interval);
  }
  console.warn('[perf] waitFor'+(label?' ['+label+']':'')+' TIMEOUT tras '+(now()-started)+'ms');
  throw new Error('Tiempo de espera agotado esperando la página de agentes (BET300).'+(label?' ['+label+']':''));
}
// [perf] Timer por operación (buscar/carga/retiro/crear/login): mide el total y avisa si tarda mucho.
// Se usa desde el dispatcher de drexAutomation → sale UN log por operación con su duración real.
function _perfWrap(nombre, fn) {
  return async function (...args) {
    const t0 = now();
    try { return await fn.apply(this, args); }
    finally {
      const ms = now() - t0;
      const col = ms > 6000 ? '#ef4444' : (ms > 3000 ? '#eab308' : '#22c55e');
      console.log('%c[perf] '+nombre+' → '+ms+'ms'+(ms>3000?'  ⚠ LENTO':''), 'color:'+col+';font-weight:700');
    }
  };
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

// Cierra RÁPIDO cualquier banner/modal de creación de usuario: botón "Cerrar" (repetido) + modal
// activo + menús. Se usa al detectar "user_create_successfully"/"Duplicated alias" para agilizar la
// cola (no esperar a que el modal se cierre solo, que es más lento que el banner).
async function _cerrarTodoBet300() {
  try {
    for (let i = 0; i < 3; i++) {
      const cerrar = findByText(/^cerrar$/i, 'button, .v-btn');
      if (!cerrar) break;
      clickElement(cerrar);
      await delay(140);
    }
    if (findActiveModal()) { try { await cerrarModalActual(); } catch (_e) {} }
    try { cerrarMenusAbiertos(); } catch (_e) {}
  } catch (_e) {}
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
          // Banners de creación de usuario que a veces NO traen bg-success/bg-error (vienen neutros
          // / bg-secondary): los capturamos por TEXTO — es MÁS RÁPIDO que esperar a que el modal se
          // cierre solo. Estos textos solo aparecen al crear usuario, no en cargas.
          if (/duplicated\s*alias/i.test(txt))                           { capt.resultado = { tipo: 'error', texto: txt, dup: true };    return; }
          if (/user_?create_?successfully|create_?successfully/i.test(txt)) { capt.resultado = { tipo: 'ok', texto: txt, creado: true }; return; }
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
  // Si otro flujo ya está navegando al inicio, ESPERAMOS a que termine (una carga forzada no se
  // borra ni falla a mitad de la navegación, queda encolada).
  if (_navegandoAInicio) await waitFor(() => !_navegandoAInicio, 25000, 200, 'esperar-nav-inicio').catch(() => {});
  // Verificar la PÁGINA: si NO estamos en la búsqueda/inicio ni con un modal abierto (p.ej. quedamos
  // en Estadísticas post-login), vamos al inicio SIN recargar. Si ya estamos ahí, no hace nada → no
  // se recarga al pedo.
  if (!findSearchInput() && !findActiveModal()) { try { await _asegurarInicio(); } catch (_e) {} }
  // Esperar a que la SPA esté OPERABLE (buscador o modal) antes de actuar: Vue tarda en montar.
  await waitFor(() => findSearchInput() || findActiveModal(), 12000, 120, 'ensureReady-operable').catch(() => {});
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

// ── Diario de fallas de búsqueda (persistente) ──────────────────────────────
// La traba es INTERMITENTE: no se puede estar mirando la consola justo cuando pasa. Guardamos cada
// fallo en localStorage de la ventana de Agentes para poder revisarlo después:
//   window.__nodoBusquedaFallas   → últimas 40 fallas con su contexto
function _logFallaBusqueda(datos) {
  try {
    const K = 'nodo_busqueda_fallas';
    const arr = JSON.parse(localStorage.getItem(K) || '[]');
    arr.push(Object.assign({ ts: new Date().toISOString(), url: location.href }, datos));
    localStorage.setItem(K, JSON.stringify(arr.slice(-40)));
  } catch (_e) {}
}
try {
  Object.defineProperty(window, '__nodoBusquedaFallas', {
    get() { try { return JSON.parse(localStorage.getItem('nodo_busqueda_fallas') || '[]'); } catch (_e) { return []; } }
  });
} catch (_e) {}

// ¿La lista en pantalla CORRESPONDE a esta búsqueda? Señal mucho más fiable que "la firma cambió":
//   · lista vacía  → BET300 ya respondió "no hay resultados" (buscar un alias inexistente)
//   · todas las filas visibles matchean el término → la lista YA está filtrada por esta búsqueda
// Sin esto, buscar un usuario inexistente (vacío→vacío) o re-buscar al mismo (misma firma) parecían
// "la búsqueda no se ejecutó" → 3 reintentos y error, aunque el resultado estuviera en pantalla.
function _listaCorrespondeA(alias) {
  const want = normAlias(alias);
  if (!want) return false;
  const filas = filasJugador();
  if (!filas.length) return true;
  return filas.every(r => normAlias(aliasDeFila(r)).indexOf(want) >= 0);
}

// CORROBORA que el input REALMENTE tenga el alias escrito y, si no, lo reescribe.
// Vuetify re-renderiza la lista y a veces limpia/pisa el campo (o el menú le roba el foco):
// escribíamos una vez, no volvíamos a mirar, y se buscaba con el campo VACÍO → "no existe" falso.
async function _asegurarTextoBusqueda(alias, tries = 3) {
  const want = normAlias(alias);
  for (let i = 0; i < tries; i++) {
    const input = findSearchInput();
    if (!input) { await delay(200); continue; }
    if (normAlias(input.value) === want) return input;          // ya está escrito
    await setFieldAndVerify(input, String(alias).trim(), 3);
    await delay(120);
    const chk = findSearchInput();
    if (chk && normAlias(chk.value) === want) return chk;        // verificado post-escritura
    await delay(150);
  }
  return null;
}

// Ejecuta la búsqueda: escribe alias (verificado) → Enter → lupa/"Todos los jugadores" → espera refresco.
// Devuelve { refresco, textoOk } — `refresco` es la ÚNICA prueba de que el resultado en pantalla es real.
async function ejecutarBusqueda(alias, timeout = DEFAULT_TIMEOUT) {
  const wanted = String(alias).trim();
  await waitFor(findSearchInput, timeout, 120, 'input-busqueda');

  // 1) Escribir Y VERIFICAR (antes: si no aceptaba, tiraba error y cortaba todo el flujo).
  let input = await _asegurarTextoBusqueda(wanted, 3);
  if (!input) return { refresco: false, textoOk: false };

  const firmaAntes = firmaFilas(); // foto de la lista ANTES de buscar

  // 2) Disparar con ENTER (el camino más confiable, no depende del menú) y, si no dispara,
  //    recién ahí el camino lupa → "Todos los jugadores".
  try {
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      input.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    });
  } catch (_) {}
  await delay(350);

  if (firmaFilas() === firmaAntes) {
    const lupa = iconBtn('mdi-magnify');
    if (lupa) clickElement(lupa);
    await delay(250);
    input = (await _asegurarTextoBusqueda(wanted, 2)) || input;  // el menú pudo limpiar el campo
    await elegirTodosLosJugadores(6000);                          // robusto: no deja el dropdown colgado
  }

  // 3) Esperar a que la lista se REFRESQUE (firma distinta) = llegó el resultado real.
  //    A los 5s reintenta el disparo UNA vez, re-verificando el texto antes. Tope 12s.
  const inicio = now();
  let reintentado = false;
  while (now() - inicio < 12000) {
    _chequearFreno('buscando');
    // Refresco = la lista cambió O ya corresponde a lo buscado (vacía / todas matchean).
    if (firmaFilas() !== firmaAntes || _listaCorrespondeA(wanted)) { await delay(250); return { refresco: true, textoOk: true }; }
    if (!reintentado && now() - inicio > 5000) {
      reintentado = true;
      input = (await _asegurarTextoBusqueda(wanted, 2)) || input;
      const l2 = iconBtn('mdi-magnify');
      if (l2) clickElement(l2);
      await delay(250);
      await elegirTodosLosJugadores(4000);
    }
    await delay(150);
  }
  await delay(250);
  // Último chequeo antes de rendirnos: puede que la lista ya corresponda a lo buscado aunque la
  // firma nunca haya cambiado (lista vacía, o el mismo usuario que ya estaba en pantalla).
  if (_listaCorrespondeA(wanted)) return { refresco: true, textoOk: true };
  console.warn('[buscar] sin refresco tras 12s · filas en pantalla: ' + filasJugador().length + ' · input="' + ((findSearchInput() || {}).value || '') + '"');
  return { refresco: false, textoOk: true }; // no hubo refresco → NO se puede concluir nada
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
  const INTENTOS = 3;

  // ⚠ REGLA ANTI-FALSO-NEGATIVO: solo se concluye "NO existe" si la lista SE REFRESCÓ de verdad
  // (firma distinta) y aun así el alias no apareció. Si la búsqueda no se ejecutó (campo vacío,
  // menú colgado, API sin responder), NO se afirma nada: se REINTENTA, y si igual no se logra,
  // se lanza ERROR TÉCNICO. Antes cualquiera de esas fallas devolvía exists:false → el panel
  // decía "el usuario no existe" cuando en realidad nunca se llegó a buscar.
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const r = await ejecutarBusqueda(wanted, options.timeout || DEFAULT_TIMEOUT);

    // Esperar la fila que COINCIDE con el alias buscado. BET300 deja la lista anterior mientras
    // responde la API, así que no alcanza con "hay filas": esperamos la fila exacta.
    const VENTANA = (r && r.refresco) ? 6000 : 4000;
    const inicio = now();
    let fila = null;
    while (now() - inicio < VENTANA) {
      if (pageNeedsLogin()) return status();
      fila = buscarFilaPorAlias(wanted);
      if (fila) break;
      await delay(180);
    }

    if (fila) {
      _currentUser = aliasDeFila(fila);
      return { ok: true, exists: true, user: _currentUser, balance: saldoDeFila(fila), intentos: intento };
    }

    // Lista refrescada + texto verificado y NO está el alias → NO existe (conclusión válida).
    if (r && r.refresco && r.textoOk) {
      return { ok: true, exists: false, user: wanted, message: 'No apareció el usuario buscado en BET300.', intentos: intento };
    }

    // Falla técnica → reintentar desde el inicio de la pantalla de carga.
    console.warn('[buscar] intento ' + intento + '/' + INTENTOS + ' sin resultado confiable (texto '
      + (r && r.textoOk ? 'OK' : 'NO SE ESCRIBIÓ') + ', refresco ' + (r && r.refresco ? 'sí' : 'NO') + ') — reintentando');
    _logFallaBusqueda({
      alias: wanted, intento: intento, de: INTENTOS,
      textoOk: !!(r && r.textoOk), refresco: !!(r && r.refresco),
      inputAhora: ((findSearchInput() || {}).value || ''),
      filasVisibles: filasJugador().length,
      modalAbierto: !!findActiveModal(),
      necesitaLogin: pageNeedsLogin(), bloqueada: pageIsBlocked()
    });
    if (intento < INTENTOS) {
      try { await _asegurarInicio(); } catch (_) {}
      await delay(400);
    }
  }

  // Agotados los intentos sin poder confirmar: se informa ERROR, NUNCA "no existe".
  throw new Error('No se pudo ejecutar la búsqueda de "' + wanted + '" en BET300 tras ' + INTENTOS
    + ' intentos (el campo o la lista no respondieron). NO se concluye que el usuario no exista — reintentá.');
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

  // D (ESTRICTO): apenas figura "user_create_successfully" damos por creado y CERRAMOS TODO ya —
  // nodo ya copió usuario+clave, el banner/modal final no se necesita (ni lo ve el operador). Si
  // NO se detecta el banner, seguimos con el flujo de abajo como antes (no es absoluto).
  if (snack && (snack.creado || /create_?successfully/i.test(snack.texto || ''))) {
    await _cerrarTodoBet300();
    return { ok: true, alias, password: CLAVE_ESTANDAR, message: 'Jugador creado (banner user_create_successfully).' };
  }
  // C: "Duplicated alias" → alias duplicado. Cerramos RÁPIDO con "Cerrar" para agilizar la cola
  // (p.ej. si hay una carga esperando detrás mientras se intentaba crear).
  if (snack && (snack.dup || /duplicated\s*alias/i.test(snack.texto || ''))) {
    await _cerrarTodoBet300();
    return { ok: false, alias, error: 'duplicado', message: 'El alias ya existe en BET300 (Duplicated alias).' };
  }

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
// Item del menú lateral cuyo texto matchea (navegación IN-PAGE por el router de Vue, sin recargar).
function findMenuItem(re) {
  return visibleElements('.v-list-item, [role="option"], a, .v-btn').find(el => re.test(normalizeText(el.textContent))) || null;
}
// ── Balance de fichas del agente desde /agents/tokens-report ("Reporte de carga y descarga") ──
// El header muestra el saldo del agente CON ERROR. La fuente confiable es esa página: lista cada
// operación con su BALANCE de fichas; la fila MÁS RECIENTE (primera de datos, saltando "Totales")
// tiene el balance ACTUAL. Columnas: Fecha | Tipo | Estado | Cantidad | Alias | Balance.
function leerBalanceFichasReporte() {
  const filas = visibleElements('table tbody tr, .v-table tbody tr, tbody tr, tr');
  for (const tr of filas) {
    const tds = Array.from(tr.querySelectorAll('td')).filter(isVisible);
    if (tds.length < 6) continue;
    const c0 = normalizeText(tds[0].textContent);
    if (/totales/i.test(c0)) continue;                      // saltar la fila de Totales
    if (!/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c0)) continue;     // fila de datos = empieza con fecha
    const balTxt = normalizeText(tds[tds.length - 1].textContent); // última columna = Balance
    if (/\d/.test(balTxt)) return { raw: balTxt, value: parseMoney(balTxt) };
  }
  return null;
}
// Navega a tokens-report (menú in-page o URL directa) y, si la tabla está vacía, clickea "Filtrar"
// (la página tiene filtro de fecha + botón "Filtrar" con rango por defecto → sin eso, tabla vacía).
async function irAReporteFichas(timeout = 12000) {
  if (leerBalanceFichasReporte()) return true;
  const t = now() + timeout;
  let usedUrl = false;
  while (now() < t) {
    _chequearFreno('yendo a reporte de fichas');
    if (leerBalanceFichasReporte()) return true;
    if (!/tokens-report/i.test(location.href)) {
      const it = findMenuItem(/reporte de carga|carga y descarga|tokens.?report/i);
      if (it) { clickElement(it); }
      else if (!usedUrl) { usedUrl = true; try { location.assign(BASE_URL + 'agents/tokens-report'); } catch (_e) {} }
    } else if (!leerBalanceFichasReporte()) {
      const filtrar = findByText(/^filtrar$/i, 'button, .v-btn');
      if (filtrar) clickElement(filtrar);
    }
    const t2 = now() + 3000;
    while (now() < t2) { if (leerBalanceFichasReporte()) return true; await delay(150); }
  }
  return !!leerBalanceFichasReporte();
}
// Vuelve a la sección con el buscador (tras leer fichas) por el menú, in-page.
async function volverABusqueda(timeout = 8000) {
  if (findSearchInput()) return true;
  const cands = [/control de agentes/i, /agentes y jugadores/i, /agentes/i, /jugadores/i];
  const t = now() + timeout;
  while (now() < t) {
    if (findSearchInput()) return true;
    for (const re of cands) {
      const it = findMenuItem(re);
      if (it) { clickElement(it); const t2 = now() + 2500; while (now() < t2) { if (findSearchInput()) return true; await delay(150); } }
    }
    await delay(250);
  }
  return !!findSearchInput();
}
async function obtenerSaldoAgente(options = {}) {
  if (pageNeedsLogin()) return { ok: false, needsLogin: true };
  let result = null;
  // BET300: el header trae el saldo con error → leemos la fila MÁS RECIENTE de tokens-report.
  try {
    await irAReporteFichas(options.timeout || 12000);
    const bal = leerBalanceFichasReporte();
    if (bal && bal.value > 0) result = { ok: true, balance: bal, fuente: 'tokens-report' };
  } catch (_e) {}
  if (!result) {
    // Fallback: header (puede estar mal, pero es mejor que nada si el reporte no cargó).
    await waitFor(() => readAgentBalance().value > 0, 4000).catch(() => {});
    result = { ok: true, balance: readAgentBalance(), fuente: 'header' };
  }
  // VOLVER a la búsqueda tras leer las fichas — si no, quedaba colgado en el reporte.
  try { if (!findSearchInput()) await volverABusqueda(8000); } catch (_e) {}
  return result;
}

function irABusquedaUsuarios() {
  if (!/agentesbet\.(net|io)/i.test(location.href) || pageNeedsLogin()) {
    try { location.assign(BASE_URL); } catch (_) {}
  }
  return { ok: true, url: BASE_URL };
}

// Verifica en qué página estamos y va al INICIO (Control de agentes / búsqueda = pantalla de carga)
// SOLO si no estamos ya ahí — así no se recarga al pedo. Navega por el MENÚ (no recarga la SPA);
// location.assign(BASE_URL) es último recurso. Lo llama ensureReady antes de cada operación.
async function _asegurarInicio() {
  if (findSearchInput()) return true;   // ya estamos en la pantalla de carga → no tocar nada
  _navegandoAInicio = true;             // avisar el recorrido → una carga forzada espera a que termine
  try {
    // esperar a que monte el layout (venimos de un login recién / de otra vista como Estadísticas)
    await waitFor(() => findSearchInput() || findMenuItem(/control de agentes/i) || firstVisible('.v-list-item'), 10000, 150, 'inicio-mount').catch(() => {});
    if (findSearchInput()) return true;
    // ir a "Control de agentes" por el menú (sin recargar); si no está el menú, recién ahí por URL
    const item = findMenuItem(/control de agentes/i) || findByText(/control de agentes/i, '.v-list-item, a, button, [role="option"]');
    if (item) { clickElement(item); await delay(400); }
    else { try { location.assign(BASE_URL); } catch (_) {} }
    await waitFor(findSearchInput, 12000, 150, 'inicio-buscador').catch(() => {});
    return !!findSearchInput();
  } finally { _navegandoAInicio = false; }
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
    // (NO forzamos navegación acá: cada operación, vía ensureReady, verifica la página y va al inicio
    //  SOLO si no está en la pantalla de carga — así no se recarga al pedo.)
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
    // [perf] cronometrar las operaciones (buscar/carga/retiro/crear/clave) → un log por operación.
    const _fn = api[method];
    const result = METODOS_OPERACION.has(method) ? await _perfWrap(method, _fn)(...args) : await _fn(...args);
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
