// ============================================================
// NODO · PRELOAD DE AGENTES — ADMINONLINE (www.adminonline.me)
// BORRADOR 16/11/2026 · NO PROBADO EN PRODUCCIÓN. Para cotejar con el que arma el colega.
// Backoffice nuevo (marca BET300, front-end Nuxt/Vue + Tailwind + menús Radix), distinto de
// agentesbet.io (Vuetify) y de bo.casinodrex.com. NO reemplaza a los otros preloads.
// Mantiene el MISMO contrato que agent-preload-bet300.js (mismos métodos, mismos canales IPC
// drex:automation:run / drex:verify:run, mismo window.drexAutomation): main solo cambia la URL y el preload.
// Mapa de selectores y capturas: borradores/ADMINONLINE_mapa_inicial.md y borradores/adminonline/*.json
//
// DIFERENCIAS CLAVE con BET300 (ver el mapa):
//  · Sin Vuetify: no hay .v-btn / .v-dialog / .v-snackbar ni íconos mdi. Los botones se buscan por TEXTO,
//    los campos por PLACEHOLDER, los menús por aria-label, los modales por [role=dialog].
//  · Los menús Radix (acciones de la fila, opciones de la lupa) NO abren con .click(): hace falta la
//    secuencia pointerdown → mousedown → pointerup → mouseup → click.
//  · Los avisos son de Notivue: ol[data-notivue-align] > li[data-notivue-item]. NO traen clase de tipo:
//    éxito/error se distinguen por el TEXTO ("Balance actualizado exitosamente." / "No se pudo actualizar el saldo.").
//  · El campo Monto se reformatea solo (10000 → "10.000"): se compara NUMÉRICAMENTE.
//  · Login: input#alias, input#password y botón type=submit "Iniciar sesión".
// ============================================================
// ---- ELECTRON-BEGIN
const { contextBridge, ipcRenderer } = require('electron');
// ---- ELECTRON-END

const BASE_URL = 'https://www.adminonline.me/';
const CONTROL_URL = BASE_URL + 'agents/control';
const CONFIG_SOCIALS_PATH = '/config/socials';
// Clave de blanqueo y de alta cuando nadie eligió otra. 12345a quedó obsoleta: AdminOnline exige 8 o más
// caracteres y la rechazaba (Juan, 16/11: "para blanqueo de clave en el nuevo panel se usa 1a2b3c4d").
const CLAVE_ESTANDAR = '1a2b3c4d';
const CLAVE_MINIMA = 8;
// La que pidió el jugador o eligió el operador; si no vino ninguna, la estándar. Antes se ignoraba y se
// escribía siempre la estándar: el jugador pedía "holapepe" y NODO le decía que quedó "holapepe".
function claveParaAgente(pedida) {
  const c = String(pedida == null ? '' : pedida).trim();
  return c || CLAVE_ESTANDAR;
}
// Lo que el modal escribe debajo del campo cuando no acepta la clave
// ("La contraseña debe tener 8 caractes mínimo."). No sale como aviso: hay que leerlo del modal.
function errorDelModal(modal) {
  if (!modal) return '';
  const textos = Array.from(modal.querySelectorAll('p, span, small, div')).filter(isVisible)
    .filter(el => !el.querySelector('input, button'))
    .map(el => normalizeText(el.textContent))
    .filter(t => t && /debe|m[ií]nimo|caracte|inv[aá]lid|requerid|obligatori/i.test(t));
  return textos.sort((a, b) => a.length - b.length)[0] || '';
}
const DEFAULT_TIMEOUT = 18000;
const STEP_DELAY = 300;
// Retiro: pausa A LA VISTA antes de confirmar (también es margen real para el ⛔ Cancelar).
const PAUSA_ANTES_DE_ENVIAR_RETIRO = 1200;

function delay(ms = STEP_DELAY) { return new Promise(r => setTimeout(r, ms)); }
function now() { return Date.now(); }

// ── Freno real (⛔ Cancelar) ────────────────────────────────────────────────
let _abortOperacion = false;
let _navegandoAInicio = false;
function _chequearFreno(donde) {
  if (_abortOperacion) throw new Error('⛔ Operación frenada por el operador' + (donde ? ' (' + donde + ')' : '') + '. No se aplicó plata.');
}

// ── Utilidades DOM ───────────────────────────────────────────────────────────
function hayLayout() {
  try { const r = document.body ? document.body.getBoundingClientRect() : null; return !!(r && r.width > 0 && r.height > 0); }
  catch (_) { return true; }
}
function isVisible(el) {
  if (!el) return false;
  const s = window.getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none') return false;
  if (!hayLayout()) return true;   // ventana sin layout (show:false): un rect en cero no significa "oculto"
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function visibleElements(sel, root = document) { return Array.from(root.querySelectorAll(sel)).filter(isVisible); }
function firstVisible(sel, root = document) { return visibleElements(sel, root)[0] || null; }
async function waitFor(predicate, timeout = DEFAULT_TIMEOUT, interval = 120, label) {
  const started = now();
  while (now() - started < timeout) {
    _chequearFreno();
    const v = typeof predicate === 'function' ? predicate() : document.querySelector(predicate);
    if (v) {
      const el = now() - started;
      if (el > 700) console.log('%c[perf] waitFor' + (label ? ' [' + label + ']' : '') + ' resolvió en ' + el + 'ms', 'color:#eab308');
      return v;
    }
    await delay(interval);
  }
  console.warn('[perf] waitFor' + (label ? ' [' + label + ']' : '') + ' TIMEOUT tras ' + (now() - started) + 'ms');
  throw new Error('Tiempo de espera agotado esperando la página de agentes (adminonline).' + (label ? ' [' + label + ']' : ''));
}
function _perfWrap(nombre, fn) {
  return async function (...args) {
    const t0 = now();
    try { return await fn.apply(this, args); }
    finally {
      const ms = now() - t0;
      const col = ms > 6000 ? '#ef4444' : (ms > 3000 ? '#eab308' : '#22c55e');
      console.log('%c[perf] ' + nombre + ' → ' + ms + 'ms' + (ms > 3000 ? '  ⚠ LENTO' : ''), 'color:' + col + ';font-weight:700');
    }
  };
}
function normalizeText(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
function normAlias(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ''); }
// Formato AR: punto = miles, coma = decimal → "10.425.821" = 10425821
function parseMoney(v) {
  let s = String(v || '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// Inyección Vue: setter nativo + eventos input/change (v-model escucha 'input').
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
// Campos de PLATA: el sitio los reformatea ("10000" → "10.000"), así que se comparan los NÚMEROS.
async function setMontoYVerificar(input, valor, tries = 4) {
  const objetivo = Math.round(Number(valor) || 0);
  for (let i = 0; i < tries; i++) {
    setFieldValue(input, String(objetivo));
    await delay(120);
    if (Math.round(parseMoney(input.value)) === objetivo) return true;
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
// Menús Radix: abren con la secuencia completa de punteros (un .click() solo NO los abre).
function clickRadix(el) {
  if (!el) throw new Error('No se encontró el elemento (menú).');
  el.scrollIntoView({ block: 'center', inline: 'center' });
  for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = ev.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(ev, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', view: window }));
  }
}
// Elemento visible cuyo texto matchea (botón / ítem de menú / enlace)
function findByText(re, selector = 'button, [role="button"], [role="menuitem"], a', root = document) {
  return visibleElements(selector, root).find(el => re.test(normalizeText(el.textContent)));
}
function botonDeshabilitado(btn) {
  if (!btn) return true;
  if (btn.disabled === true) return true;
  if (btn.getAttribute && (btn.getAttribute('aria-disabled') === 'true' || btn.getAttribute('data-disabled') !== null)) return true;
  return false;
}

// Modal activo: [role=dialog] (Radix). El menú y los avisos NO son dialog.
function findActiveModal() { return firstVisible('[role="dialog"]'); }
async function cerrarModalActual() {
  const modal = findActiveModal();
  const scope = modal || document;
  const cerrar = findByText(/^(close|cerrar|cancelar|cancel)$/i, 'button', scope);
  if (cerrar) { clickElement(cerrar); await delay(300); return true; }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  await delay(300);
  return false;
}
function cerrarMenusAbiertos() {
  const menus = visibleElements('[role="menu"], [data-radix-popper-content-wrapper]');
  if (!menus.length) return false;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  return true;
}

// ── Avisos (Notivue) ─────────────────────────────────────────────────────────
// Éxito: "Balance actualizado exitosamente."  ·  Error: "No se pudo actualizar el saldo. Probá de nuevo."
// No hay clase de tipo: se clasifica por TEXTO. Los textos de crear jugador / cambiar clave no se
// capturaron todavía: se aceptan variantes y, si no concluye, el llamador VERIFICA por búsqueda.
const RE_TOAST_OK = /exitosamente|correctamente|con [eé]xito|creado|actualizad[oa]|guardad[oa]|success/i;
const RE_TOAST_ERROR = /no se pudo|prob[aá] de nuevo|error|fall[oó]|inv[aá]lid|ya existe|existe|duplic|insuficiente|rechaz/i;
function _clasificarToast(txt) {
  if (RE_TOAST_ERROR.test(txt)) return { tipo: 'error', texto: txt, dup: /ya existe|existe|duplic/i.test(txt) };
  if (RE_TOAST_OK.test(txt)) return { tipo: 'ok', texto: txt, creado: /creado/i.test(txt) };
  return { tipo: '?', texto: txt };
}
// AdminOnline usa DOS librerias de avisos: notivue en las operaciones y sonner (ol[data-sonner-toaster])
// en Personalizar pagina. Mirando solo notivue, "Configuracion guardada exitosamente" no se veia nunca.
const SEL_TOAST_ITEM = 'li[data-notivue-item], li[data-sonner-toast]';
function _itemsToast(root) {
  if (root.matches && root.matches(SEL_TOAST_ITEM)) return [root];
  const dentro = root.closest && root.closest(SEL_TOAST_ITEM);   // el texto puede llegar despues que el aviso
  if (dentro) return [dentro];
  return Array.from(root.querySelectorAll ? root.querySelectorAll(SEL_TOAST_ITEM) : []);
}
function _clasificarItemToast(li) {
  const txt = normalizeText(li.textContent);
  const c = _clasificarToast(txt);
  if (c.tipo !== '?') return c;
  const tipo = li.getAttribute && li.getAttribute('data-type');   // sonner marca success / error
  if (tipo === 'success') return { tipo: 'ok', texto: txt };
  if (tipo === 'error') return { tipo: 'error', texto: txt };
  return c;
}
function readToast() {
  const li = Array.from(document.querySelectorAll('ol[data-notivue-align] li[data-notivue-item], ol[data-sonner-toaster] li[data-sonner-toast]')).filter(isVisible).pop();
  if (!li) return null;
  return _clasificarItemToast(li);
}
// Observer ANTES del click: nos quedamos con el PRIMER aviso que aparezca DESPUÉS (no el de la operación anterior).
function observarToast() {
  const capt = { resultado: null, obs: null };
  try {
    capt.obs = new MutationObserver(muts => {
      if (capt.resultado) return;
      for (const m of muts) {
        // Si el aviso ya estaba y le llega el texto despues, el cambio es DENTRO del aviso.
        const base = m.target && (m.target.nodeType === 1 ? m.target : m.target.parentElement);
        const dentro = base && base.closest && base.closest(SEL_TOAST_ITEM);
        if (dentro) { const c0 = _clasificarItemToast(dentro); if (c0.tipo !== '?') { capt.resultado = c0; return; } }
        for (const n of m.addedNodes) {
          if (!n || n.nodeType !== 1) continue;
          const lis = _itemsToast(n);
          const cand = lis.length ? lis : (n.matches && n.matches('ol[data-notivue-align], ol[data-sonner-toaster]') ? Array.from(n.querySelectorAll('li')) : []);
          for (const li of cand) {
            const txt = normalizeText(li.textContent);
            if (!txt) continue;
            const c = _clasificarItemToast(li);
            if (c.tipo !== '?') { capt.resultado = c; return; }
          }
        }
      }
    });
    capt.obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch (_e) {}
  return capt;
}
async function esperarToastCapturado(capt, timeout = 9000) {
  const t = now() + timeout;
  while (now() < t) {
    if (capt && capt.resultado) break;
    await delay(120);
  }
  try { if (capt && capt.obs) capt.obs.disconnect(); } catch (_e) {}
  return (capt && capt.resultado) || null;
}

// ── Login / estado de página ─────────────────────────────────────────────────
function _loginFields() {
  return { alias: document.querySelector('input#alias'), pass: document.querySelector('input#password'),
           entrar: findByText(/^iniciar sesi[oó]n$/i, 'button') };
}
function pageNeedsLogin() {
  if (/\/login/i.test(location.href)) return true;
  const f = _loginFields();
  return Boolean(f.alias && f.pass && f.entrar && isVisible(f.pass));
}
function pageIsBlocked() {
  try {
    const hasApp = !!(findSearchInput() || findActiveModal() || document.querySelector('input#alias') ||
                      document.querySelector('a[href*="/agents/control"]'));
    if (hasApp) return false;
    const errRe = /request blocked|access denied|forbidden|service unavailable|bad gateway|gateway timeout|just a moment|attention required|checking your browser/i;
    const body = (document.body && (document.body.innerText || document.body.textContent) || '').slice(0, 2500);
    return errRe.test(body) || errRe.test(document.title || '');
  } catch (_) { return false; }
}
let _opsEnCurso = 0;
let _ultimaNavegacion = 0;
let _loginEnCurso = false;
function _navegarA(url, motivo) {
  if (_opsEnCurso > 0) { console.warn('[adminonline] NO se recarga (' + motivo + '): hay una operación en curso'); return false; }
  if (_loginEnCurso) { console.warn('[adminonline] NO se recarga (' + motivo + '): el operador está entrando'); return false; }
  if (now() - _ultimaNavegacion < 25000) { console.warn('[adminonline] NO se recarga (' + motivo + '): ya se recargó hace menos de 25 s'); return false; }
  _ultimaNavegacion = now();
  console.warn('[adminonline] recargando la ventana (' + motivo + ') → ' + url);
  try { location.assign(url); } catch (_) { return false; }
  return true;
}
function _resumenPantalla() {
  try {
    const p = [String(location.pathname || '/').slice(0, 40)];
    if (findSearchInput()) p.push('buscador');
    if (findActiveModal()) p.push('modal abierto');
    if (document.querySelector('input#alias')) p.push('formulario de login');
    if (findMenuItem(/control de agentes/i)) p.push('menú');
    const t = (document.title || '').trim();
    if (t) p.push('«' + t.slice(0, 30) + '»');
    return p.join(' · ');
  } catch (_) { return 'no se pudo leer la pantalla'; }
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
      ? 'La página de agentes (adminonline) respondió con un error del servidor. No se operó. Reintentá.'
      : needsLogin
      ? 'adminonline requiere iniciar sesión. Iniciá sesión y volvé a intentar.'
      : 'Módulo de agentes adminonline disponible.',
    pantalla: _resumenPantalla(),
    ...extra
  };
}
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
  if (pageIsBlocked()) {
    await waitFor(() => !pageIsBlocked() || pageNeedsLogin(), 8000, 200, 'ensureReady-montar').catch(() => {});
    if (pageIsBlocked()) return status();
  }
  await recuperarFlujoPendiente();
  if (pageNeedsLogin() || pageIsBlocked()) return status();
  if (_navegandoAInicio) await waitFor(() => !_navegandoAInicio, 25000, 200, 'esperar-nav-inicio').catch(() => {});
  if (!findSearchInput() && !findActiveModal()) { try { await _asegurarInicio(); } catch (_e) {} }
  await waitFor(() => findSearchInput() || findActiveModal(), 12000, 120, 'ensureReady-operable').catch(() => {});
  return status();
}

// ── Búsqueda ─────────────────────────────────────────────────────────────────
function findSearchInput() { return firstVisible('input[placeholder="Buscar por alias o ID"]'); }
function findLupa() { return firstVisible('button[aria-label="Opciones de búsqueda"]'); }
function _esFilaDeTabla(tr) { return tr.querySelector('span[title]') && tr.querySelector('button[aria-label^="Acciones "]'); }
// Filas de JUGADOR (la tabla también lista agentes, con la etiqueta "Agente").
function filasJugador() {
  return Array.from(document.querySelectorAll('tr')).filter(tr => {
    if (!isVisible(tr) || !_esFilaDeTabla(tr)) return false;
    const etiqueta = tr.querySelector('span[class*="uppercase"]');
    return !etiqueta || /jugador|player/i.test(normalizeText(etiqueta.textContent));
  });
}
function aliasDeFila(row) {
  const s = row.querySelector('span[title]');
  return normalizeText(s ? (s.getAttribute('title') || s.textContent) : '');
}
function buscarFilaPorAlias(alias) {
  const want = normAlias(alias);
  return filasJugador().find(r => normAlias(aliasDeFila(r)) === want) || null;
}
// Saldo del jugador = 2ª columna de la fila.
function saldoDeFila(row) {
  const tds = row.querySelectorAll('td');
  if (tds.length < 2) return null;
  const raw = normalizeText(tds[1].textContent);
  return { raw, value: parseMoney(raw) };
}
function botonDeFila(row, re) {
  return Array.from(row.querySelectorAll('button')).find(b => re.test(normalizeText(b.textContent)) && isVisible(b)) || null;
}
function menuAccionesDeFila(row) { return row.querySelector('button[aria-label^="Acciones "]'); }
function firmaFilas() { return filasJugador().map(r => normAlias(aliasDeFila(r))).join('|'); }

// Opción del menú de la lupa que deja JUGADORES de toda la red. Primero "Todos los jugadores";
// si no está, cualquiera que hable de jugadores (menos las que los esconden).
function _esOpcionTodosJugadores(texto) { return /^todos los jugadores$/i.test(String(texto || '').replace(/\s+/g, ' ').trim()); }
function _esOpcionJugadores(texto) {
  const t = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > 60) return false;
  if (!/jugador/.test(t)) return false;
  if (/\bsin\b|ocultar|esconder|excluir|^no /.test(t)) return false;
  return true;
}
async function elegirTodosLosJugadores(timeout = 6000) {
  const items = () => visibleElements('[role="menu"] [role="menuitem"], [data-radix-popper-content-wrapper] [role="menuitem"]');
  const buscarOpt = () => {
    const its = items();
    return its.find(el => _esOpcionTodosJugadores(normalizeText(el.textContent))) || its.find(el => _esOpcionJugadores(normalizeText(el.textContent)));
  };
  const fin = now() + timeout;
  let vueltas = 0;
  while (now() < fin) {
    _chequearFreno('buscando');
    const opt = buscarOpt();
    if (opt) {
      clickElement(opt);
      await delay(300);
      if (!buscarOpt()) return true;          // el menú se cerró → quedó elegida
    } else if (vueltas++ % 8 === 0) {
      const lupa = findLupa();                 // menú cerrado → abrirlo (Radix: secuencia de punteros)
      if (lupa) clickRadix(lupa);
    }
    await delay(150);
  }
  return false;
}
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
function _listaCorrespondeA(alias) {
  const want = normAlias(alias);
  if (!want) return false;
  const filas = filasJugador();
  if (!filas.length) return true;
  return filas.every(r => normAlias(aliasDeFila(r)).indexOf(want) >= 0);
}
async function _asegurarTextoBusqueda(alias, tries = 3) {
  const want = normAlias(alias);
  for (let i = 0; i < tries; i++) {
    const input = findSearchInput();
    if (!input) { await delay(200); continue; }
    if (normAlias(input.value) === want) return input;
    await setFieldAndVerify(input, String(alias).trim(), 3);
    await delay(120);
    const chk = findSearchInput();
    if (chk && normAlias(chk.value) === want) return chk;
    await delay(150);
  }
  return null;
}
async function esperarListaEstable(wanted, tope) {
  const t0 = now();
  let ult = null, iguales = 0;
  while (now() - t0 < tope) {
    _chequearFreno('esperando la lista');
    if (buscarFilaPorAlias(wanted)) return true;
    const f = firmaFilas();
    if (f === ult) iguales++; else { iguales = 0; ult = f; }
    if (iguales >= 3 && filasJugador().length > 0) return true;
    await delay(180);
  }
  return (filasJugador().length === 0 && iguales >= 3);
}
// ¿Está elegido el ámbito "jugadores"? Queda un chip bajo el buscador ("Todos los jugadores").
function _chipJugadores() {
  const chip = Array.from(document.querySelectorAll('button[aria-label="Quitar opción de búsqueda"]'))[0];
  const cont = chip && (chip.parentElement || chip);
  return !!(cont && /jugador/i.test(normalizeText(cont.textContent)));
}
async function ejecutarBusqueda(alias, timeout = DEFAULT_TIMEOUT) {
  const wanted = String(alias).trim();
  await waitFor(findSearchInput, timeout, 120, 'input-busqueda');
  let input = await _asegurarTextoBusqueda(wanted, 3);
  if (!input) return { refresco: false, textoOk: false, vistaOk: false };
  const firmaAntes = firmaFilas();
  try {
    ['keydown', 'keypress', 'keyup'].forEach(t => input.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })));
  } catch (_) {}
  await delay(350);
  let vistaOk = filasJugador().length > 0 || _chipJugadores();
  if (firmaFilas() === firmaAntes) {
    const lupa = findLupa();
    if (lupa) clickRadix(lupa);
    await delay(250);
    input = (await _asegurarTextoBusqueda(wanted, 2)) || input;
    if (await elegirTodosLosJugadores(6000)) vistaOk = true;
  }
  const inicio = now();
  let reintentado = false;
  while (now() - inicio < 12000) {
    _chequearFreno('buscando');
    if (firmaFilas() !== firmaAntes || _listaCorrespondeA(wanted)) {
      const estable = await esperarListaEstable(wanted, 8000);
      await delay(150);
      return { refresco: true, textoOk: true, estable, vistaOk: vistaOk || filasJugador().length > 0 };
    }
    if (!reintentado && now() - inicio > 5000) {
      reintentado = true;
      input = (await _asegurarTextoBusqueda(wanted, 2)) || input;
      const l2 = findLupa();
      if (l2) clickRadix(l2);
      await delay(250);
      if (await elegirTodosLosJugadores(4000)) vistaOk = true;
    }
    await delay(150);
  }
  await delay(250);
  if (_listaCorrespondeA(wanted)) {
    const estable = await esperarListaEstable(wanted, 4000);
    return { refresco: true, textoOk: true, estable, vistaOk: vistaOk || filasJugador().length > 0 };
  }
  console.warn('[buscar] sin refresco tras 12s · filas en pantalla: ' + filasJugador().length + ' · input="' + ((findSearchInput() || {}).value || '') + '"');
  return { refresco: false, textoOk: true, estable: false, vistaOk };
}
// "No existe" solo se concluye con las CUATRO condiciones (lista movida, texto escrito, lista quieta, vista de jugadores).
function _puedeConcluirQueNoExiste(r) { return !!(r && r.refresco && r.textoOk && r.estable && r.vistaOk); }

let _currentUser = '';
async function buscarUsuario(usuario, options = {}) {
  if (!usuario || String(usuario).trim().length < 3) throw new Error('El usuario debe tener al menos 3 caracteres.');
  let ready = await ensureReady();
  if (ready.pageError && !ready.needsLogin) {
    try { await _asegurarInicio(); } catch (_) {}
    await delay(600);
    ready = await ensureReady();
  }
  if (ready.needsLogin || ready.pageError) return ready;

  const wanted = String(usuario).trim();
  const INTENTOS = 3;
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const r = await ejecutarBusqueda(wanted, options.timeout || DEFAULT_TIMEOUT);
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
    if (_puedeConcluirQueNoExiste(r)) {
      return { ok: true, exists: false, user: wanted, message: 'No apareció el usuario buscado en adminonline.', intentos: intento };
    }
    console.warn('[buscar] intento ' + intento + '/' + INTENTOS + ' sin resultado confiable (texto ' + (r && r.textoOk ? 'OK' : 'NO SE ESCRIBIÓ')
      + ', refresco ' + (r && r.refresco ? 'sí' : 'NO') + ') — reintentando');
    if (r && r.estable && !r.vistaOk) {
      console.warn('[buscar] la lista quedó quieta y vacía, pero nunca se llegó a la vista de JUGADORES: no se puede concluir que el usuario no exista · ' + _resumenPantalla());
    }
    _logFallaBusqueda({
      alias: wanted, intento, de: INTENTOS, textoOk: !!(r && r.textoOk), refresco: !!(r && r.refresco), vistaOk: !!(r && r.vistaOk),
      inputAhora: ((findSearchInput() || {}).value || ''), filasVisibles: filasJugador().length,
      modalAbierto: !!findActiveModal(), necesitaLogin: pageNeedsLogin(), bloqueada: pageIsBlocked()
    });
    if (intento < INTENTOS) { try { await _asegurarInicio(); } catch (_) {} await delay(400); }
  }
  throw new Error('No se pudo ejecutar la búsqueda de "' + wanted + '" en adminonline tras ' + INTENTOS
    + ' intentos (el campo o la lista no respondieron). NO se concluye que el usuario no exista — reintentá.');
}

// ── Carga / Descarga ─────────────────────────────────────────────────────────
// Modal de depositar/retirar: campos por PLACEHOLDER ("Balance agente", "Balance jugador", "Monto", "Bono").
function leerModalMontos() {
  const modal = findActiveModal();
  if (!modal) return { modal: null, agente: null, jugador: null, cantidadInput: null, bonoInput: null, nInputs: 0 };
  const inp = ph => firstVisible('input[placeholder="' + ph + '"]', modal);
  const a = inp('Balance agente'), j = inp('Balance jugador');
  return {
    modal,
    agente: a ? { raw: a.value, value: parseMoney(a.value) } : null,
    jugador: j ? { raw: j.value, value: parseMoney(j.value) } : null,
    cantidadInput: inp('Monto'),
    bonoInput: inp('Bono'),
    nInputs: visibleElements('input', modal).length
  };
}
// Botón de confirmar: el ÚNICO type=submit del modal ("Cargar balance" / "Descargar balance").
function botonConfirmar(modal) {
  return firstVisible('button[type="submit"]', modal)
    || findByText(/^(cargar|descargar) balance$/i, 'button', modal);
}
// tipo: 'carga' (botón "Depositar") | 'retiro' (botón "Retiro")
async function aplicarMonto(tipo, amount, options = {}) {
  const monto = Number(String(amount).replace(',', '.'));
  if (!Number.isFinite(monto) || monto <= 0) throw new Error('El monto debe ser un número mayor a cero.');
  const ready = await ensureReady();
  if (ready.needsLogin || ready.pageError) return ready;

  let fila = _currentUser ? buscarFilaPorAlias(_currentUser) : null;
  if (!fila && _currentUser) {
    await ejecutarBusqueda(_currentUser, options.timeout || DEFAULT_TIMEOUT);
    fila = await waitFor(() => buscarFilaPorAlias(_currentUser), options.timeout || DEFAULT_TIMEOUT).catch(() => null);
  }
  if (!fila) throw new Error('No encuentro la fila del jugador para operar (¿se limpió la búsqueda?).');

  const reBtn = tipo === 'carga' ? /^depositar(io)?$/i : /^retiro$/i;
  const btn = await waitFor(() => {
    const f = (_currentUser ? buscarFilaPorAlias(_currentUser) : null) || fila;
    return f ? botonDeFila(f, reBtn) : null;
  }, options.timeout || DEFAULT_TIMEOUT).catch(() => null);
  if (!btn) throw new Error('No apareció el botón de ' + tipo + ' en la fila del jugador.');
  clickElement(btn);

  const _quiereBono = (tipo === 'carga' && Math.round(Number(options.bono) || 0) > 0);
  await waitFor(() => {
    const mm = leerModalMontos();
    return mm.modal && mm.cantidadInput && (!_quiereBono || mm.bonoInput);
  }, options.timeout || DEFAULT_TIMEOUT).catch(async () => {
    await waitFor(() => { const mm = leerModalMontos(); return mm.modal && mm.cantidadInput; }, 3000);
  });
  await delay(300);

  let m = leerModalMontos();
  const preJugador = m.jugador || { raw: '', value: 0, unchanged: true };

  if (tipo === 'retiro' && preJugador && preJugador.value > 0 && preJugador.value < monto) {
    await cerrarModalActual();
    return { ok: false, saldoInsuficiente: true, balance: preJugador,
             message: 'Saldo insuficiente: ' + preJugador.raw + ' disponible, se solicitaron ' + monto + '.' };
  }

  if (!m.cantidadInput) throw new Error('No se encontró el campo "Monto".');
  const montoOk = await setMontoYVerificar(m.cantidadInput, monto, 4);
  if (!montoOk) { await cerrarModalActual(); throw new Error('No se pudo escribir el monto (' + monto + ') en el modal. NO se envió nada.'); }
  let bonoAplicado = 0;
  if (tipo === 'carga' && m.bonoInput) {
    const bonoPedido = Math.max(0, Math.round(Number(options.bono) || 0));
    if (bonoPedido > 0 && await setMontoYVerificar(m.bonoInput, bonoPedido, 4)) bonoAplicado = bonoPedido;
    else if (parseMoney(m.bonoInput.value) !== 0) await setMontoYVerificar(m.bonoInput, 0, 3);
  }
  await delay(250);

  {
    const chk = leerModalMontos();
    const espCant = Math.round(monto);
    if (chk.cantidadInput && Math.round(parseMoney(chk.cantidadInput.value)) !== espCant) {
      await cerrarModalActual();
      throw new Error('"Monto" no quedó en ' + espCant + ' (quedó "' + (chk.cantidadInput.value || '') + '"). NO se envió nada.');
    }
    if (bonoAplicado > 0 && chk.bonoInput && Math.round(parseMoney(chk.bonoInput.value)) !== bonoAplicado) {
      await cerrarModalActual();
      throw new Error('"Bono" no quedó en ' + bonoAplicado + ' (quedó "' + (chk.bonoInput.value || '') + '"). NO se envió nada.');
    }
  }

  let enviar = null;
  const _tEnviar = now() + 6000;
  while (now() < _tEnviar) {
    enviar = botonConfirmar(findActiveModal() || m.modal);
    if (enviar && !botonDeshabilitado(enviar)) break;
    await delay(150);
  }
  if (!enviar) { await cerrarModalActual(); throw new Error('No se encontró el botón de confirmar. NO se envió nada.'); }
  if (botonDeshabilitado(enviar)) { await cerrarModalActual(); throw new Error('El botón de confirmar siguió deshabilitado tras 6s (¿monto inválido?). NO se envió nada.'); }

  if (tipo === 'retiro') {
    await delay(PAUSA_ANTES_DE_ENVIAR_RETIRO);
    const _re = botonConfirmar(findActiveModal() || m.modal);
    if (_re) enviar = _re;
    if (!enviar || botonDeshabilitado(enviar)) { await cerrarModalActual(); throw new Error('El botón de confirmar dejó de estar disponible durante la pausa. NO se envió nada.'); }
  }
  const capt = observarToast();
  _chequearFreno('antes de enviar');   // ÚLTIMO punto seguro antes de mover plata
  clickElement(enviar);

  const toast = await esperarToastCapturado(capt, 9000);
  const exito = toast ? (toast.tipo === 'ok') : null;
  if (findActiveModal()) await cerrarModalActual();

  // Saldo POST: se relee de la fila y se espera a que cambie respecto del pre (nunca se inventa sin marcarlo).
  const _postEstimado = (preJugador && !preJugador.unchanged)
    ? (tipo === 'carga' ? preJugador.value + monto + bonoAplicado : preJugador.value - monto) : null;
  let newBalance = null;
  if (exito !== false && _currentUser) {
    const _t0 = now();
    while (now() - _t0 < 3000) {
      const f = buscarFilaPorAlias(_currentUser);
      const s = f ? saldoDeFila(f) : null;
      if (s && /\d/.test(String(s.raw || ''))) {
        const refleja = !preJugador || preJugador.unchanged || Math.round(s.value) !== Math.round(preJugador.value);
        if (refleja) { newBalance = { raw: s.raw, value: s.value, leido: true }; break; }
      }
      await delay(200);
    }
  }
  if (!newBalance) {
    newBalance = (_postEstimado !== null)
      ? { raw: String(_postEstimado), value: _postEstimado, estimated: true }
      : { raw: preJugador.raw, value: preJugador.value, unchanged: true };
  }
  return {
    ok: true, action: tipo, amount: monto, bonoAplicado,
    previousBalance: preJugador, newBalance, exito,
    resultado: toast ? toast.texto : '',
    message: exito === false
      ? tipo + ' RECHAZADO por adminonline: ' + (toast ? toast.texto : 'sin detalle') + '.'
      : tipo + ' enviado. Saldo anterior: ' + (preJugador.raw || '—') + ' → ~' + newBalance.raw + '.'
  };
}
function cargarSaldo(amount, options) { return aplicarMonto('carga', amount, options); }
function retirarSaldo(amount, options) { return aplicarMonto('retiro', amount, options); }

async function finalizarOperacionAgentes() {
  try { if (findActiveModal()) await cerrarModalActual(); } catch (_) {}
  try {
    const limpiar = firstVisible('button[aria-label="Limpiar búsqueda"]');
    if (limpiar) { clickElement(limpiar); await delay(200); }
    else { const s = findSearchInput(); if (s) setFieldValue(s, ''); }
  } catch (_) {}
  return { ok: true };
}

// ── Cambiar clave (menú ⋮ de la fila → "Cambiar contraseña") ─────────────────
async function abrirMenuFila(fila) {
  const trigger = menuAccionesDeFila(fila);
  if (!trigger) throw new Error('No apareció el menú de acciones de la fila.');
  clickRadix(trigger);
  const menu = await waitFor(() => firstVisible('[role="menu"]'), 4000, 100, 'menu-acciones').catch(() => null);
  if (!menu) throw new Error('No se abrió el menú de acciones del jugador.');
  return menu;
}
async function cambiarClave(password, options = {}) {
  const ready = await ensureReady();
  if (ready.needsLogin || ready.pageError) return ready;
  const clave = claveParaAgente(password);
  // Una clave corta no se intenta: AdminOnline la rechaza y el modal queda abierto con el error.
  if (clave.length < CLAVE_MINIMA) {
    return { ok: false, motivo: 'CLAVE_CORTA', password: clave, message: 'la clave tiene que tener al menos ' + CLAVE_MINIMA + ' letras o números' };
  }
  const fila = _currentUser ? buscarFilaPorAlias(_currentUser) : null;
  if (!fila) throw new Error('No encuentro la fila del jugador para cambiar la clave.');

  const menu = await abrirMenuFila(fila);
  const item = findByText(/contrase[ñn]a|clave|password/i, 'button, [role="menuitem"]', menu);
  if (!item) { cerrarMenusAbiertos(); throw new Error('No apareció la opción "Cambiar contraseña" en el menú.'); }
  clickElement(item);

  const modal = await waitFor(findActiveModal, options.timeout || DEFAULT_TIMEOUT);
  await delay(300);
  const campo = firstVisible('input[type="text"], input[type="password"], input:not([type])', modal);
  if (!campo) throw new Error('No apareció el campo de nueva contraseña.');
  if (!(await setFieldAndVerify(campo, clave, 5))) throw new Error('No se pudo escribir la nueva contraseña.');

  const guardar = botonConfirmar(modal);
  if (!guardar) throw new Error('No se encontró el botón de guardar la contraseña.');
  const capt = observarToast();
  clickElement(guardar);
  const toast = await esperarToastCapturado(capt, 8000);
  // "Hecho" sólo si AdminOnline lo confirma: un aviso de éxito, o el modal se cerró sin error. Antes, sin
  // aviso se daba por bueno y al jugador le llegaba "Tu clave fue actualizada" con el modal abierto
  // diciendo que no (16/11).
  const abierto = findActiveModal();
  const errorCampo = abierto ? errorDelModal(abierto) : '';
  if (abierto) await cerrarModalActual();
  if (toast && toast.tipo === 'error') {
    return { ok: false, motivo: 'RECHAZADA', password: clave, message: 'el sistema de juego no la aceptó (' + toast.texto + ')' };
  }
  if (errorCampo) {
    return { ok: false, motivo: /m[ií]nimo|caracte/i.test(errorCampo) ? 'CLAVE_CORTA' : 'RECHAZADA', password: clave, message: errorCampo };
  }
  if ((toast && toast.tipo === 'ok') || !abierto) {
    return { ok: true, action: 'cambio_clave', password: clave, message: toast ? toast.texto : 'Clave cambiada.' };
  }
  return { ok: false, motivo: 'SIN_CONFIRMAR', password: clave, message: 'AdminOnline no confirmó el cambio de clave' };
}

// ── Crear jugador (botón "Nuevo jugador" → modal: Alias · Contraseña · Moneda) ──
async function crearUsuario(alias, _password, options = {}) {
  if (!alias || String(alias).trim().length < 3) throw new Error('El alias debe tener al menos 3 caracteres.');
  const ready = await ensureReady();
  if (ready.needsLogin || ready.pageError) return ready;

  const abrir = findByText(/^nuevo jugador$/i, 'button');
  if (!abrir) throw new Error('No se encontró el botón "Nuevo jugador".');
  clickElement(abrir);

  const modal = await waitFor(findActiveModal, options.timeout || DEFAULT_TIMEOUT);
  await delay(300);
  // Los tres campos tienen el mismo placeholder ("Escribir..."): se ubican por ORDEN dentro del modal.
  const campos = visibleElements('input[type="text"], input[type="password"], input:not([type])', modal);
  const aliasInput = campos[0], passInput = campos[1];
  if (!aliasInput) throw new Error('No apareció el campo Alias.');
  if (!(await setFieldAndVerify(aliasInput, String(alias).trim(), 5))) throw new Error('No se pudo escribir el alias.');
  // A veces la página ya trae una contraseña al azar en el campo. Si el operador no eligió otra (vacía o la
  // estándar que NODO pone de entrada), se usa ésa en vez de pisarla (Juan, 18/11). Si eligió una, se escribe.
  const elegida = String(_password == null ? '' : _password).trim();
  let propuesta = '';
  if (passInput && (!elegida || elegida === CLAVE_ESTANDAR)) {
    await _esperarQue(() => String(passInput.value || '').trim().length >= CLAVE_MINIMA, 1200);
    const v = String(passInput.value || '').trim();
    if (v.length >= CLAVE_MINIMA && /^[A-Za-z0-9]+$/.test(v)) propuesta = v;
  }
  const clave = propuesta || claveParaAgente(_password);
  if (clave.length < CLAVE_MINIMA) { if (findActiveModal()) await cerrarModalActual(); return { ok: false, alias, error: 'clave_corta', message: 'La clave tiene que tener al menos ' + CLAVE_MINIMA + ' letras o números.' }; }
  if (passInput && !propuesta) await setFieldAndVerify(passInput, clave, 5);

  const guardar = botonConfirmar(modal);
  if (!guardar) throw new Error('No se encontró el botón "Crear jugador".');
  const capt = observarToast();
  clickElement(guardar);
  // Lo primero que aparezca: el cartel "Usuario creado" (con el alias y la clave), el aviso
  // "user_create_successfully" o un aviso de error. Antes se esperaban 7 s fijos a un aviso que esta
  // página no da por notivue/sonner y después se buscaba al jugador (hasta 14 s más): con el cartel
  // "Usuario creado" ya a la vista, NODO seguía en "Creando…" medio minuto (Juan, 18/11).
  const aliasMin = String(alias).trim().toLowerCase();
  // Con dos diálogos abiertos (el panel de creación y el de encima) findActiveModal devuelve el primero:
  // se miran todos.
  const textoDe = d => normalizeText(d.innerText || d.textContent);
  const dialogos = () => visibleElements('[role="dialog"]');
  const cartelCreado = () => dialogos().find(d => {
    const t = textoDe(d);
    return /usuario creado/i.test(t) && t.toLowerCase().includes(aliasMin);
  }) || null;
  // Paso del medio (18/11): "Creación de jugador · Verifique la información antes de finalizar", con el
  // alias, la contraseña y Aceptar. NODO no lo apretaba y quedaba clavado en "Creando…" (Juan, 18/11).
  // La contraseña que muestra es la que va a quedar: se toma de ahí.
  const cartelVerificar = () => dialogos().find(d => /verifique la informaci[oó]n/i.test(textoDe(d)) && !/usuario creado/i.test(textoDe(d))) || null;
  let toast = null, creadoEn = null, avisoTexto = false, aceptado = false, claveVerificada = '';
  const limite = now() + 15000;
  while (now() < limite) {
    // "Balance actualizado exitosamente" también es un aviso verde y aparece solo: no dice nada de la creación.
    if (capt.resultado && capt.resultado.tipo === 'ok' && !/cread|usuario|jugador/i.test(capt.resultado.texto || '')) capt.resultado = null;
    if (capt.resultado) { toast = capt.resultado; break; }
    creadoEn = cartelCreado();
    if (creadoEn) break;
    if (!aceptado) {
      const v = cartelVerificar();
      const aceptar = v && findByText(/^aceptar$/i, 'button', v);
      if (aceptar) {
        const m = textoDe(v).match(/contrase[ñn]a:?\s*([A-Za-z0-9]+)/i);
        if (m) claveVerificada = m[1];
        clickElement(aceptar);
        aceptado = true;
        await delay(250);
        continue;
      }
    }
    if (/user_create_successfully/i.test((document.body && document.body.innerText) || '')) { avisoTexto = true; break; }
    await delay(150);
  }
  try { capt.obs && capt.obs.disconnect(); } catch (_e) {}

  if (toast && toast.tipo === 'error') {
    if (findActiveModal()) await cerrarModalActual();
    if (findActiveModal()) await cerrarModalActual();
    return toast.dup
      ? { ok: false, alias, error: 'duplicado', message: 'El alias ya existe en adminonline (' + toast.texto + ').' }
      : { ok: false, alias, error: 'rechazado', message: 'adminonline rechazó la creación: ' + toast.texto };
  }
  if (creadoEn) {
    // La clave que muestra el cartel es la que quedó de verdad.
    const m = textoDe(creadoEn).match(/contrase[ñn]a:?\s*([A-Za-z0-9]+)/i);
    const claveReal = m && m[1] && !/^moneda/i.test(m[1]) ? m[1] : (claveVerificada || clave);
    // "Usuario creado" se cierra con su propio Cerrar; después, lo que haya quedado abierto.
    const cerrarlo = findByText(/^cerrar$/i, 'button', creadoEn);
    if (cerrarlo) { clickElement(cerrarlo); await delay(300); } else await cerrarModalActual();
    for (let i = 0; i < 2 && findActiveModal(); i++) await cerrarModalActual();
    return { ok: true, alias, password: claveReal, message: 'Jugador creado (cartel "Usuario creado").' };
  }
  for (let i = 0; i < 3 && findActiveModal(); i++) await cerrarModalActual();
  if ((toast && toast.tipo === 'ok') || avisoTexto) return { ok: true, alias, password: claveVerificada || clave, message: 'Jugador creado correctamente.' };
  // Sin aviso concluyente: se VERIFICA buscando el alias (si figura, la creación fue correcta).
  try {
    await ejecutarBusqueda(String(alias).trim(), 8000);
    const fila = await waitFor(() => buscarFilaPorAlias(String(alias).trim()), 6000).catch(() => null);
    if (fila) { _currentUser = aliasDeFila(fila); return { ok: true, alias, password: claveVerificada || clave, message: 'Jugador creado (verificado por búsqueda).' }; }
  } catch (_e) {}
  return { ok: false, alias, error: 'sin_confirmacion', message: 'No se pudo confirmar la creación. Verificá en adminonline antes de cargar.' };
}

// ── Saldo del agente ─────────────────────────────────────────────────────────
// En la cabecera, un botón con el texto "<saldo> ARS" (junto a un badge "9+" de notificaciones: se lee
// SOLO el texto propio de cada elemento y se exige "<número> ARS" exacto, para no juntar el badge).
function readAgentBalance() {
  const ownText = el => Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
  for (const el of visibleElements('header span, header div, header p, header button, span, div, p, b, strong')) {
    const propio = normalizeText(ownText(el));
    // AdminOnline la arma asi: <div>187.929<span>ARS</span></div>. El texto propio del div es solo el
    // numero y "ARS" esta en un hijo: se juntan. Sigue sin sumar el badge de notificaciones (9+).
    const conMoneda = Array.from(el.children).some(c => normalizeText(c.textContent).toUpperCase() === 'ARS');
    const t = conMoneda ? propio + ' ARS' : propio;
    if (/^[$]?[ ]*[0-9][0-9.,]*[ ]*ARS$/i.test(t)) return { raw: t, value: parseMoney(t) };
  }
  return { raw: '', value: 0 };
}
function findMenuItem(re) {
  return visibleElements('a, button, [role="menuitem"]').find(el => re.test(normalizeText(el.textContent))) || null;
}
async function obtenerSaldoAgente(options = {}) {
  if (pageNeedsLogin()) return { ok: false, needsLogin: true };
  // Con un modal abierto (alguien en medio de una operación) no se mueve nada: se lee el campo del modal o la cabecera.
  const mm = leerModalMontos();
  if (mm.modal && mm.agente && mm.agente.value > 0) return { ok: true, balance: mm.agente, fuente: 'modal' };
  await waitFor(() => readAgentBalance().value > 0, options.timeout || 4000).catch(() => {});
  return { ok: true, balance: readAgentBalance(), fuente: 'header' };
}

function irABusquedaUsuarios() {
  if (!/adminonline\.me/i.test(location.href) || pageNeedsLogin()) _navegarA(CONTROL_URL, 'volver al inicio');
  return { ok: true, url: CONTROL_URL };
}
// Va a "Control de agentes" por el menú lateral (router de Vue, sin recargar); la URL directa es último recurso.
async function _asegurarInicio() {
  if (findSearchInput()) return true;
  _navegandoAInicio = true;
  try {
    await waitFor(() => findSearchInput() || findMenuItem(/control de agentes/i), 10000, 150, 'inicio-mount').catch(() => {});
    if (findSearchInput()) return true;
    const item = findMenuItem(/control de agentes/i);
    if (item) { clickElement(item); await delay(400); }
    else { _navegarA(CONTROL_URL, 'no encontré Control de agentes en el menú'); }
    await waitFor(findSearchInput, 12000, 150, 'inicio-buscador').catch(() => {});
    return !!findSearchInput();
  } finally { _navegandoAInicio = false; }
}

// ── Login ────────────────────────────────────────────────────────────────────
// Formulario: input#alias · input#password · botón submit "Iniciar sesión". Un error aparece como aviso Notivue.
async function iniciarSesion(usuario, clave) {
  _loginEnCurso = true;
  try { return await _iniciarSesionInterno(usuario, clave); }
  finally { _loginEnCurso = false; }
}
async function _iniciarSesionInterno(usuario, clave) {
  if (!pageNeedsLogin()) return { ok: true, message: 'Sesión ya activa.' };
  let f = null;
  const t = now();
  while (now() - t < 6000) {
    f = _loginFields();
    if (f.alias && f.pass && f.entrar) break;
    await delay(250);
  }
  if (!f || !f.alias || !f.pass || !f.entrar) return { ok: false, message: 'No se encontró el formulario de login de adminonline.' };
  setFieldValue(f.alias, usuario);
  await delay(200);
  setFieldValue(f.pass, clave);
  await delay(300);
  const capt = observarToast();
  clickElement(f.entrar);
  const inicio = now();
  while (now() - inicio < 15000) {
    await delay(500);
    if (!pageNeedsLogin()) { try { capt.obs && capt.obs.disconnect(); } catch (_e) {} return { ok: true, message: 'Sesión iniciada.' }; }
    if (capt.resultado && capt.resultado.tipo === 'error') {
      try { capt.obs && capt.obs.disconnect(); } catch (_e) {}
      return { ok: false, credenciales: true, message: 'adminonline rechazó el login: ' + capt.resultado.texto };
    }
  }
  try { capt.obs && capt.obs.disconnect(); } catch (_e) {}
  return { ok: false, message: 'No se pudo iniciar sesión en adminonline. Verificá usuario y contraseña (o si pide un código de verificación).' };
}

function _whatsappPhoneInput() {
  return firstVisible('input[type="tel"][placeholder="Ingrese número de WhatsApp"]');
}
function _whatsappSettings(input = _whatsappPhoneInput()) {
  let root = input;
  while (root && root !== document.body) {
    const text = normalizeText(root.innerText || root.textContent);
    const section = /Funcionalidad de contacto por WhatsApp/i.test(text)
      && /Permitir que los jugadores te contacten por WhatsApp/i.test(text);
    if (section) return root;
    root = root.parentElement;
  }
  return null;
}
function _whatsappCountryPrefix(input) {
  let scope = input && input.parentElement;
  for (let depth = 0; scope && depth < 6; depth++, scope = scope.parentElement) {
    const country = visibleElements('button', scope).find(btn => /\+\s?\d{1,4}/.test(btn.textContent || ''));
    if (country) {
      const match = String(country.textContent || '').match(/\+\s?\d{1,4}/);
      if (match) return match[0].replace(/\s/g, '');
    }
  }
  return '';
}
function _whatsappHabilitado(root = document) {
  const toggle = firstVisible('[role="switch"]', root);
  if (!toggle) return null;
  const state = toggle.getAttribute('aria-checked') || toggle.getAttribute('data-state');
  if (state !== 'true' && state !== 'checked' && state !== 'false' && state !== 'unchecked') return null;
  const checked = state === 'true' || state === 'checked';
  const disabled = toggle.disabled === true || toggle.hasAttribute('disabled') || toggle.getAttribute('aria-disabled') === 'true';
  return checked && !disabled;
}
async function _leerWhatsappEnPantalla() {
  if (_loginEnCurso) {
    return { ok: false, ocupado: true, message: 'La ventana de AdminOnline está entrando a la sesión.' };
  }
  if (pageNeedsLogin()) return { ok: false, needsLogin: true, message: 'Hay que entrar a AdminOnline antes de leer el WhatsApp.' };
  if (String(location.pathname || '').replace(/\/+$/, '') !== CONFIG_SOCIALS_PATH) {
    return { ok: false, motivo: 'OTRA_PANTALLA', message: 'AdminOnline no está en Personalizar página.' };
  }

  try {
    const inicio = now();
    let input = _whatsappPhoneInput();
    let section = _whatsappSettings(input);
    let toggle = section && firstVisible('[role="switch"]', section);
    while ((!input || !section || !toggle) && now() - inicio < 12000) {
      await delay(250);
      if (pageNeedsLogin()) return { ok: false, needsLogin: true, message: 'AdminOnline pidió ingresar de nuevo.' };
      input = _whatsappPhoneInput();
      section = _whatsappSettings(input);
      toggle = section && firstVisible('[role="switch"]', section);
    }
    if (!input) {
      return { ok: false, motivo: 'NO_APARECIO', message: 'La pantalla no mostró el campo de WhatsApp.' };
    }
    if (!toggle || !section) {
      return { ok: false, motivo: 'NO_APARECIO', message: 'La pantalla no mostró la configuración de contacto por WhatsApp.' };
    }

    const digits = String(input.value || '').replace(/\D/g, '');
    const prefix = _whatsappCountryPrefix(input);
    if (digits && !prefix) {
      return { ok: false, motivo: 'NO_APARECIO', message: 'No pude leer el código de país del WhatsApp.' };
    }
    return {
      ok: true,
      numero: digits ? prefix + digits : '',
      pais: prefix,
      habilitado: _whatsappHabilitado(section),
      numeroValido: !digits || (digits.length >= 7 && digits.length <= 10),
      puedeEditar: true,
      desde: 'pantalla'
    };
  } catch (e) {
    return { ok: false, motivo: 'ERROR', message: (e && e.message) ? e.message : String(e) };
  }
}

async function _guardarWhatsappEnPantalla(args = {}) {
  if (_loginEnCurso) {
    return { ok: false, ocupado: true, message: 'La ventana de AdminOnline está entrando a la sesión.' };
  }
  if (pageNeedsLogin()) return { ok: false, needsLogin: true, message: 'Hay que entrar a AdminOnline antes de cambiar el WhatsApp.' };
  if (String(location.pathname || '').replace(/\/+$/, '') !== CONFIG_SOCIALS_PATH) {
    return { ok: false, motivo: 'OTRA_PANTALLA', message: 'AdminOnline no está en Personalizar página.' };
  }

  // El cuadro de AdminOnline lleva SOLO el numero nacional (2236700367): el pais va en el selector
  // de al lado. NODO lo tiene completo (5492236700367); escrito asi el cuadro se pone rojo y Guardar
  // no anda. Se acepta como venga y se deja en el formato que la pagina acepta.
  let digits = String(args && args.numero || '').replace(/[^0-9]/g, '');
  if (digits.length > 10 && digits.startsWith('54')) digits = digits.slice(2);
  if (digits.length === 11 && (digits.startsWith('9') || digits.startsWith('0'))) digits = digits.slice(1);
  if (digits.length < 7 || digits.length > 10) {
    return { ok: false, motivo: 'NUMERO_INVALIDO', message: 'El número debe tener entre 7 y 10 dígitos.' };
  }

  try {
    const inicio = now();
    let input = _whatsappPhoneInput();
    let section = _whatsappSettings(input);
    let toggle = section && firstVisible('[role="switch"]', section);
    while ((!input || !section || !toggle) && now() - inicio < 12000) {
      await delay(250);
      if (pageNeedsLogin()) return { ok: false, needsLogin: true, message: 'AdminOnline pidió ingresar de nuevo.' };
      input = _whatsappPhoneInput();
      section = _whatsappSettings(input);
      toggle = section && firstVisible('[role="switch"]', section);
    }
    if (!input || !section || !toggle) {
      return { ok: false, motivo: 'NO_APARECIO', message: 'La pantalla no mostró la configuración de contacto por WhatsApp.' };
    }

    const prefix = _whatsappCountryPrefix(input);
    if (!prefix) return { ok: false, motivo: 'NO_APARECIO', message: 'No pude leer el código de país seleccionado.' };
    const actual = String(input.value || '').replace(/\D/g, '');
    const habilitadoAntes = _whatsappHabilitado(section);
    if (actual === digits) {
      return { ok: true, sinCambio: true, numero: prefix + digits, pais: prefix, habilitado: habilitadoAntes, numeroValido: true };
    }

    const botonGuardar = findByText(/^guardar$/i, 'button', section);
    if (!botonGuardar) {
      return { ok: false, motivo: 'NO_APARECIO', message: 'No encontré Guardar en la sección de WhatsApp.' };
    }

    setFieldValue(input, digits);
    await delay(180);
    if (String(input.value || '').replace(/\D/g, '') !== digits) {
      return { ok: false, motivo: 'NO_SE_ACTUALIZO', message: 'AdminOnline no tomó el número escrito.' };
    }
    if (botonDeshabilitado(botonGuardar)) {
      return { ok: false, motivo: 'NO_HAY_CAMBIOS', message: 'AdminOnline no habilitó Guardar para este número.' };
    }

    const capt = observarToast();
    clickElement(botonGuardar);
    const toast = await esperarToastCapturado(capt, 10000);
    if (!toast) {
      return { ok: false, motivo: 'SIN_CONFIRMACION', message: 'No pude confirmar el guardado. Revisá el número en AdminOnline antes de volver a intentarlo.' };
    }
    if (toast.tipo === 'error') {
      return { ok: false, motivo: 'RECHAZADO', message: 'AdminOnline no guardó el número.' };
    }

    const inputVerificacion = _whatsappPhoneInput();
    const sectionVerificacion = _whatsappSettings(inputVerificacion);
    const numeroGuardado = String(inputVerificacion && inputVerificacion.value || '').replace(/\D/g, '');
    if (numeroGuardado !== digits || _whatsappHabilitado(sectionVerificacion) !== habilitadoAntes) {
      return { ok: false, motivo: 'VERIFICACION', message: 'AdminOnline mostró un resultado inesperado. Revisá la configuración antes de seguir.' };
    }
    return {
      ok: true,
      numero: prefix + numeroGuardado,
      pais: prefix,
      habilitado: habilitadoAntes,
      numeroValido: true,
      mensaje: toast.texto
    };
  } catch (e) {
    return { ok: false, motivo: 'ERROR', message: (e && e.message) ? e.message : String(e) };
  }
}

// -- Ir a Personalizar pagina como lo haria el operador --------------------------------------
// Igual que la busqueda: el preload no espera que main le mueva la ventana, va por el MENU.
// AdminOnline es una SPA (Nuxt): apretar el link cambia la ruta SIN recargar, asi que esta misma
// llamada sigue viva (D-101 es para recargas). Al terminar vuelve a la pantalla donde estaba.
function _rutaActual() { return String(location.pathname || '/').replace(/[/]+$/, '') || '/'; }
async function _esperarQue(cond, ms) {
  const fin = now() + ms;
  while (now() < fin) { if (cond()) return true; await delay(150); }
  return !!cond();
}
async function _irARuta(ruta) {
  if (_rutaActual() === ruta) return true;
  const link = document.querySelector('a[href$="' + ruta + '"]');
  if (!link) return false;
  try { link.click(); } catch (_e) { return false; }
  return _esperarQue(() => _rutaActual() === ruta, 8000);
}
// Espera a que Personalizar pagina este DIBUJADA de verdad, como la busqueda espera la lista estable:
// el cuadro, la seccion y el interruptor a la vista, y el valor del cuadro QUIETO (Vue lo completa
// despues de pedirlo al servidor). Recien ahi se lee o se escribe: si no, se lee un cuadro vacio o a
// medio cargar, y la ventana vuelve antes de que el operador llegue a ver la pantalla.
async function _esperarDibujado(ms = 12000) {
  const inicio = now();
  let ultimo = null, desde = 0;
  while (now() - inicio < ms) {
    const input = _whatsappPhoneInput();
    const section = input && _whatsappSettings(input);
    const toggle = section && firstVisible('[role="switch"]', section);
    if (input && section && toggle) {
      const v = String(input.value || '');
      if (v !== ultimo) { ultimo = v; desde = now(); }
      if (now() - desde >= 800 && (v !== '' || now() - inicio >= 5000)) return true;
    }
    await delay(150);
  }
  return false;
}
async function _enPersonalizarPagina(fn, args) {
  if (_loginEnCurso) return { ok: false, ocupado: true, message: 'La ventana de AdminOnline está entrando a la sesión.' };
  if (pageNeedsLogin()) return { ok: false, needsLogin: true, message: 'Hay que entrar a AdminOnline antes de usar el WhatsApp.' };
  const antes = _rutaActual();
  const meMovi = antes !== CONFIG_SOCIALS_PATH;
  if (meMovi && !(await _irARuta(CONFIG_SOCIALS_PATH))) {
    return { ok: false, motivo: 'OTRA_PANTALLA', message: 'No pude abrir Personalizar página desde el menú de AdminOnline.' };
  }
  await _esperarDibujado();
  try { return await fn(args); }
  finally {
    if (meMovi) { try { if (!(await _irARuta(antes))) await _irARuta('/agents/control'); } catch (_e) {} }
  }
}
// ── Movimientos de crédito (/agents/tokens-report) ───────────────────────────
// Juan, 18/11: una carga cerrada como "ya cargada" no dejaba rastro en el historial de NODO. Para saber si
// las fichas se cargaron de verdad se mira este informe: Fecha · Tipo · Estado · Cantidad · Alias · Balance.
// "Deposito de un jugador" con cantidad positiva = carga; negativa = retiro. Más nuevo primero, de a 20.
// Se pasa de página hasta llegar a `desde` (o al tope) y se vuelve a la pantalla de antes.
const TOKENS_REPORT_PATH = '/agents/tokens-report';
function _fechaInforme(t) {   // "18/11/2026 07:43:01" (hora de Argentina) → ms
  const m = String(t || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):?(\d{2})?/);
  if (!m) return NaN;
  return Date.parse(m[3] + '-' + m[2] + '-' + m[1] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + '-03:00');
}
function _filasInforme() {
  return Array.from(document.querySelectorAll('table tbody tr')).filter(isVisible).map(tr => {
    const td = Array.from(tr.querySelectorAll('td')).map(c => normalizeText(c.textContent));
    if (td.length < 5) return null;
    const cant = parseMoney(td[3]) * (/^\s*-/.test(td[3]) ? -1 : 1);
    return { fecha: td[0], ms: _fechaInforme(td[0]), tipo: td[1], estado: td[2], cantidad: cant, alias: td[4], balance: td[5] || '' };
  }).filter(f => f && Number.isFinite(f.ms));
}
async function leerMovimientosCredito(args = {}) {
  if (_loginEnCurso) return { ok: false, ocupado: true, message: 'La ventana de AdminOnline está entrando a la sesión.' };
  if (pageNeedsLogin()) return { ok: false, needsLogin: true, message: 'Hay que entrar a AdminOnline.' };
  const desde = Number(args.desdeMs) || (now() - 6 * 3600000);
  const alias = String(args.alias || '').trim().toLowerCase();
  const tope = Math.max(1, Math.min(Number(args.maxPaginas) || 15, 40));
  const antes = _rutaActual();
  const meMovi = antes !== TOKENS_REPORT_PATH;
  if (meMovi && !(await _irARuta(TOKENS_REPORT_PATH))) {
    return { ok: false, motivo: 'OTRA_PANTALLA', message: 'No pude abrir "Movimientos de crédito" desde el menú de AdminOnline.' };
  }
  try {
    const filas = [];
    let completo = false, paginas = 0, firmaAnterior = '';
    while (paginas < tope) {
      const listo = await _esperarQue(() => _filasInforme().length > 0, 10000);
      if (!listo) break;
      await delay(400);
      const pagina = _filasInforme();
      const firma = pagina.map(f => f.fecha + f.alias + f.cantidad).join('|');
      if (firma === firmaAnterior) break;            // la página no cambió: no hay más
      firmaAnterior = firma; paginas++;
      for (const f of pagina) if (f.ms >= desde && (!alias || f.alias.toLowerCase() === alias)) filas.push(f);
      if (pagina[pagina.length - 1].ms < desde) { completo = true; break; }
      const sig = Array.from(document.querySelectorAll('button')).filter(isVisible)
        .find(b => b.querySelector('.i-mdi\\:chevron-right, [class*="chevron-right"]'));
      if (!sig || sig.disabled) { completo = true; break; }
      clickElement(sig);
      await _esperarQue(() => _filasInforme().map(f => f.fecha + f.alias + f.cantidad).join('|') !== firmaAnterior, 8000);
    }
    return { ok: true, filas, completo, paginas };
  } finally {
    if (meMovi) { try { if (!(await _irARuta(antes))) await _irARuta('/agents/control'); } catch (_e) {} }
  }
}

async function leerWhatsappOficina(args = {}) { return _enPersonalizarPagina(_leerWhatsappEnPantalla, args); }
async function guardarWhatsappOficina(args = {}) { return _enPersonalizarPagina(_guardarWhatsappEnPantalla, args); }

const api = {
  buscarUsuario,
  cargarSaldo,
  retirarSaldo,
  finalizarOperacionAgentes,
  cambiarClave,
  crearUsuario,
  obtenerSaldoAgente,
  leerWhatsappOficina,
  guardarWhatsappOficina,
  leerMovimientosCredito,
  irABusquedaUsuarios,
  iniciarSesion,
  estadoPagina: status,
  recuperarFlujo: async () => { await recuperarFlujoPendiente(); return status(); },
  abortarOperacion: () => { _abortOperacion = true; return { ok: true, message: 'Freno solicitado.' }; }
};
const METODOS_OPERACION = new Set(['buscarUsuario', 'cargarSaldo', 'retirarSaldo', 'crearUsuario', 'cambiarClave', 'guardarWhatsappOficina']);

// ---- ELECTRON-BEGIN
contextBridge.exposeInMainWorld('drexAutomation', api);

ipcRenderer.on('drex:automation:run', async (event, request = {}) => {
  const { requestId, method, args = [] } = request;
  try {
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`Método no permitido: ${method}`);
    if (METODOS_OPERACION.has(method)) { _abortOperacion = false; _opsEnCurso++; }
    const _fn = api[method];
    const result = METODOS_OPERACION.has(method) ? await _perfWrap(method, _fn)(...args) : await _fn(...args);
    ipcRenderer.send('drex:automation:result', { requestId, ok: true, result });
  } catch (error) {
    let _donde = '';
    try { _donde = ' · pantalla: ' + _resumenPantalla(); } catch (_e) {}
    ipcRenderer.send('drex:automation:result', { requestId, ok: false, error: (error.message || String(error)) + _donde });
  } finally {
    if (METODOS_OPERACION.has(method)) _opsEnCurso = Math.max(0, _opsEnCurso - 1);
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
// Saludo a main: "ya estoy escuchando" (evita la carrera de loadURL asíncrono, ver el preload de BET300).
try { ipcRenderer.send('drex:preload-listo'); } catch (_) {}
// ---- ELECTRON-END
