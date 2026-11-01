#!/usr/bin/env node
'use strict';
// Auditor estático de desconexiones de NODO.
//
// Lee el panel TAL COMO SE EMPAQUETA (orden real de renderer/manifest.json + plantilla HTML),
// más main.js, main/** y los preloads, y detecta piezas sueltas por categoría:
//   DEFINICION_PISADA     función global definida más de una vez: sólo la última corre.
//   SIN_REFERENCIAS       función global que nadie nombra (posible código muerto).
//   BOTON_ROTO            onclick/onchange/... que llama a una función que no existe.
//   LLAMADA_SILENCIOSA    window.X?.() / typeof X==='function' sobre algo que nunca se define:
//                         no falla, simplemente no hace nada.
//   IPC_SIN_HANDLER       el preload invoca un canal que main no atiende.
//   IPC_SIN_USO           main atiende un canal que ningún preload invoca.
//   PUENTE_SIN_USO        método expuesto por contextBridge que el renderer no usa.
//   PUENTE_INEXISTENTE    el renderer usa un método del puente que no está expuesto.
//   RPC_FUERA_ALLOWLIST   panelAPI.rpc('x') con x fuera de BETA_RPC_PARAMS ni ruta legacy.
//   RPC_SIN_CATALOGO      .rpc('x') que no figura ni en el catálogo remoto ni en servidor/*.sql.
//   STORAGE_SOLO_ESCRITO  clave localStorage que se escribe y nunca se lee.
//   STORAGE_SOLO_LEIDO    clave localStorage que se lee y nunca se escribe.
//   SALUD_RAMA_DESCARTADA NodoSalud.begin/record con una rama que record() descarta en silencio.
//   SALUD_RAMA_SOLO_LOCAL rama aceptada por el cliente pero rechazada por el CHECK del servidor.
//   SALUD_RAMA_SIN_USO    rama declarada que ningún circuito alimenta.
//   CIRCUITO_SIN_SALUD    función con red/IPC sin evidencia funcional de NodoSalud.
//
// Es análisis estático: detecta lo que el código declara, no prueba ejecución. Rutas
// dinámicas quedan contadas como "no resueltas", nunca como revisadas.
//
// Uso:
//   node scripts/auditar-desconexiones.cjs                 resumen por consola
//   node scripts/auditar-desconexiones.cjs --report DIR    escribe DIR/desconexiones-auto.{json,md}
//   node scripts/auditar-desconexiones.cjs --embed         regenera renderer/runtime/desconexiones-estaticas.js
//   node scripts/auditar-desconexiones.cjs --check         falla si el embebido está desactualizado

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const EMBED_REL = 'renderer/runtime/desconexiones-estaticas.js';

function ts() { return require('typescript'); }
const slash = p => p.split(path.sep).join('/');
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const sha = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

const BUILTINS = new Set(('alert confirm prompt event this document window self globalThis console setTimeout clearTimeout ' +
  'setInterval clearInterval requestAnimationFrame cancelAnimationFrame parseInt parseFloat isNaN isFinite String Number ' +
  'Boolean Object Array JSON Math Date Promise Error TypeError RegExp Map Set WeakMap WeakSet Symbol encodeURIComponent ' +
  'decodeURIComponent encodeURI decodeURI escape unescape fetch structuredClone queueMicrotask atob btoa navigator location ' +
  'history localStorage sessionStorage indexedDB Notification Audio Image Blob File FileReader URL URLSearchParams FormData ' +
  'Headers Request Response AbortController AbortSignal CustomEvent Event KeyboardEvent MouseEvent MutationObserver ' +
  'ResizeObserver IntersectionObserver performance crypto getComputedStyle matchMedia open close print focus blur ' +
  'scrollTo scroll require module exports process Buffer __dirname __filename Intl BigInt Proxy Reflect ArrayBuffer ' +
  'Uint8Array Int32Array Float64Array DataView TextEncoder TextDecoder WebSocket Worker BroadcastChannel EventSource ' +
  'XMLHttpRequest DOMParser XMLSerializer Range Selection Node Element HTMLElement HTMLInputElement HTMLSelectElement ' +
  'customElements caches clipboardData getSelection innerWidth innerHeight devicePixelRatio screen name status ' +
  'if for while switch return typeof void delete new catch function await async import super with in of instanceof ' +
  'true false null undefined NaN Infinity arguments eval Function AggregateError SyntaxError RangeError ReferenceError ' +
  'isSecureContext origin top parent opener frames length speechSynthesis SpeechSynthesisUtterance Option ' +
  'dispatchEvent addEventListener removeEventListener postMessage getContext').split(/\s+/));
const GLOBAL_HOSTS = new Set(['window', 'globalThis', 'self', 'root', 'w', 'g', 'global', 'W']);

function manifestSources(root) {
  const manifest = JSON.parse(read(path.join(root, 'renderer', 'manifest.json')));
  const js = [], css = [];
  for (const block of manifest.blocks || []) for (const src of block.sources || [])
    (block.type === 'script' ? js : css).push({ file: 'renderer/' + slash(src), block: block.id });
  return { js, css };
}

function listFiles(dir, re, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'generated') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(f, re, out); else if (re.test(e.name)) out.push(f);
  }
  return out;
}

// --- Análisis de un archivo JS ------------------------------------------------------------
function analyzeJS(T, rel, text, ctx) {
  const sf = T.createSourceFile(rel, text, T.ScriptTarget.Latest, true, T.ScriptKind.JS);
  const lineOf = node => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const info = {
    file: rel, defs: [], declared: new Set(), idents: new Map(), props: new Map(), calls: [], silent: [],
    handlerStrings: [], rpc: [], ipcInvoke: [], ipcHandle: [], exposed: [], storage: [], health: [],
    netSites: [], functions: [], parseErrors: sf.parseDiagnostics?.length || 0,
  };
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const nameOf = node => {
    if (!node) return null;
    if (T.isIdentifier(node)) return node.text;
    if (T.isPropertyAccessExpression(node)) { const h = nameOf(node.expression); return h ? h + '.' + node.name.text : null; }
    if (T.isElementAccessExpression(node) && T.isStringLiteral(node.argumentExpression)) {
      const h = nameOf(node.expression); return h ? h + '.' + node.argumentExpression.text : null;
    }
    if (T.isNonNullExpression(node) || T.isParenthesizedExpression(node)) return nameOf(node.expression);
    return null;
  };
  const strLit = n => n && (T.isStringLiteral(n) || T.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
  const unwrapAssign = n => (n && T.isBinaryExpression(n) && n.operatorToken.kind === T.SyntaxKind.EqualsToken) ? unwrapAssign(n.right) : n;
  const isFn = n => { const u = unwrapAssign(n); return Boolean(u && (T.isFunctionExpression(u) || T.isArrowFunction(u) || T.isFunctionDeclaration(u))); };
  // ¿El nodo se ejecuta al cargar el script? (nivel superior o dentro de una IIFE de nivel superior)
  function topLevel(node) {
    let p = node.parent;
    while (p && p !== sf) {
      if (isFn(p) || T.isMethodDeclaration(p)) {
        const call = p.parent && (T.isParenthesizedExpression(p.parent) ? p.parent.parent : p.parent);
        if (!(call && T.isCallExpression(call) && (call.expression === p || call.expression === p.parent))) {
          // UMD: (function(root,factory){...})(globalThis,function(root){...}) -> la factory también corre al cargar.
          if (!(call && T.isCallExpression(call) && call.arguments.includes(p))) return false;
        }
      }
      p = p.parent;
    }
    return true;
  }
  function enclosingFn(node) {
    let p = node.parent;
    while (p && p !== sf) {
      if (isFn(p) || T.isMethodDeclaration(p)) {
        let name = p.name && T.isIdentifier(p.name) ? p.name.text : null;
        if (!name && p.parent) {
          if (T.isVariableDeclaration(p.parent)) name = nameOf(p.parent.name);
          else if (T.isPropertyAssignment(p.parent)) name = nameOf(p.parent.name);
          else if (T.isBinaryExpression(p.parent)) name = nameOf(p.parent.left);
        }
        if (name) return { name: name.replace(/^(window|globalThis|root|self)\./, ''), node: p };
      }
      p = p.parent;
    }
    return null;
  }
  function addDef(name, node, kind) {
    info.defs.push({ name, line: lineOf(node), kind, topLevel: topLevel(node), node, file: rel });
  }
  function visit(node) {
    if (T.isIdentifier(node)) bump(info.idents, node.text);
    if (T.isPropertyAccessExpression(node)) bump(info.props, node.name.text);
    if (T.isFunctionDeclaration(node) && node.name) {
      info.declared.add(node.name.text);
      if (node.parent === sf) addDef(node.name.text, node, 'function');
    }
    if (T.isVariableDeclaration(node) && T.isIdentifier(node.name)) {
      info.declared.add(node.name.text);
      if (node.parent?.parent?.parent === sf) addDef(node.name.text, node, isFn(node.initializer) ? 'function-var' : 'var');
    }
    if (T.isVariableDeclaration(node) && !T.isIdentifier(node.name)) {
      const walk = b => b.elements?.forEach(e => e.name && (T.isIdentifier(e.name) ? info.declared.add(e.name.text) : walk(e.name)));
      walk(node.name);
    }
    if (T.isParameter(node)) {
      const walk = b => T.isIdentifier(b) ? info.declared.add(b.text) : b.elements?.forEach(e => e.name && walk(e.name));
      walk(node.name);
    }
    if (T.isClassDeclaration(node) && node.name) { info.declared.add(node.name.text); if (node.parent === sf) addDef(node.name.text, node, 'class'); }
    if (T.isCatchClause(node) && node.variableDeclaration && T.isIdentifier(node.variableDeclaration.name)) info.declared.add(node.variableDeclaration.name.text);
    if ((T.isFunctionExpression(node)) && node.name) info.declared.add(node.name.text);
    if (T.isImportSpecifier?.(node) || T.isImportClause?.(node)) { if (node.name) info.declared.add(node.name.text); }

    // window.X = ...  /  root.X = ...  /  X = function (global implícita)
    if (T.isBinaryExpression(node) && node.operatorToken.kind === T.SyntaxKind.EqualsToken) {
      const left = nameOf(node.left);
      if (left) {
        const parts = left.split('.');
        if (parts.length === 2 && GLOBAL_HOSTS.has(parts[0]) && ctx.renderer) addDef(parts[1], node, isFn(node.right) ? 'window-fn' : 'window');
        else if (parts.length > 2 && parts[parts.length - 2] === 'window' && ctx.renderer) addDef(parts[parts.length - 1], node, isFn(node.right) ? 'window-fn' : 'window');
        else if (parts.length === 1 && ctx.renderer && T.isExpressionStatement(node.parent) && node.parent.parent === sf && isFn(node.right)) addDef(parts[0], node, 'implicit');
      }
    }
    // Object.assign(window,{a,b})
    if (T.isCallExpression(node) && nameOf(node.expression) === 'Object.assign' && ctx.renderer) {
      const target = nameOf(node.arguments[0]);
      if (target && GLOBAL_HOSTS.has(target)) for (const a of node.arguments.slice(1)) if (T.isObjectLiteralExpression(a))
        for (const p of a.properties) { const n = p.name && (T.isIdentifier(p.name) || T.isStringLiteral(p.name)) ? p.name.text : null; if (n) addDef(n, p, 'assign'); }
    }

    if (T.isCallExpression(node)) {
      const callee = nameOf(node.expression);
      const a0 = strLit(node.arguments[0]);
      const line = lineOf(node);
      const fnCtx = enclosingFn(node);
      if (callee) info.calls.push({ callee, line, optional: Boolean(node.questionDotToken || node.expression.questionDotToken), fn: fnCtx?.name || null });
      // Llamada opcional sobre global: window.X?.(), window.X?.y?.()
      if (callee && ctx.renderer) {
        const parts = callee.split('.');
        const optionalChain = node.questionDotToken || hasOptional(node.expression);
        if (optionalChain && GLOBAL_HOSTS.has(parts[0]) && parts.length >= 2) info.silent.push({ name: parts[1], line, expr: callee, fn: fnCtx?.name || null });
      }
      if (callee && /(^|\.)rpc$/.test(callee)) {
        info.rpc.push({ name: a0, dynamic: !a0, via: /panelAPI\.rpc$/.test(callee) ? 'panelAPI' : 'supabase', line, fn: fnCtx?.name || null });
        info.netSites.push({ line, kind: 'rpc', target: a0, fn: fnCtx?.name || null, fnNode: fnCtx?.node });
      } else if (callee && /\.from$/.test(callee) && a0 && !/^Array\.from$/.test(callee)) {
        info.netSites.push({ line, kind: 'tabla', target: a0, fn: fnCtx?.name || null, fnNode: fnCtx?.node });
      } else if (callee && /(^|\.)fetch$/.test(callee) || callee === '_sbFetch') {
        info.netSites.push({ line, kind: 'fetch', target: a0, fn: fnCtx?.name || null, fnNode: fnCtx?.node });
      } else if (callee && /^(window\.)?(ctrlElectron|chunior|panelAPI|updaterAPI|nodoApp)\./.test(callee) && ctx.renderer) {
        info.netSites.push({ line, kind: 'ipc', target: callee.replace(/^window\./, ''), fn: fnCtx?.name || null, fnNode: fnCtx?.node });
      }
      if (callee && /ipcRenderer\.(invoke|send|sendSync|on|once)$/.test(callee) && a0) info.ipcInvoke.push({ channel: a0, line, method: callee.split('.').pop() });
      if (callee && /ipcMain\.(handle|on|once|handleOnce)$/.test(callee) && a0) info.ipcHandle.push({ channel: a0, line });
      if (callee && /\.webContents\.send$|^(win|mainWindow|panelWindow|w)\.?webContents\.send$/.test(callee) && a0) info.ipcHandle.push({ channel: a0, line, push: true });
      if (callee === 'contextBridge.exposeInMainWorld' && a0) {
        const obj = node.arguments[1];
        if (obj && T.isObjectLiteralExpression(obj)) for (const p of obj.properties) {
          const n = p.name && (T.isIdentifier(p.name) || T.isStringLiteral(p.name)) ? p.name.text : null;
          if (n) info.exposed.push({ ns: a0, key: n, line: lineOf(p) });
        } else info.exposed.push({ ns: a0, key: '*', line });
      }
      const st = callee && callee.match(/(?:^|\.)(localStorage|sessionStorage)\.(getItem|setItem|removeItem)$/);
      if (st) info.storage.push({ area: st[1], op: st[2], key: a0, dynamicPrefix: !a0 ? templatePrefix(node.arguments[0]) : null, line });
      if (callee && /NodoSalud\??\.?(begin|record)$|NodoSalud\.(begin|record)$/.test(callee.replace(/\?/g, ''))) {
        info.health.push({ op: callee.endsWith('begin') ? 'begin' : 'record', branch: a0, line, fn: fnCtx?.name || null });
      } else if (T.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'begin' && a0 && /^[A-Z]{3,}$/.test(a0)
        && /health|salud/i.test(node.expression.expression.getText(sf))) {
        // getHealth()?.begin?.('RAMA') y variantes inyectadas.
        info.health.push({ op: 'begin', branch: a0, line, fn: fnCtx?.name || null });
      }
    }
    // Módulos de Portal: create(deps) devuelve { globals: api } y portal-bridge hace Object.assign(window, globals).
    if (ctx.portalGlobals && T.isBinaryExpression(node) && node.operatorToken.kind === T.SyntaxKind.EqualsToken) {
      const left = nameOf(node.left);
      if (left && /^api\.[A-Za-z_$][\w$]*$/.test(left)) info.defs.push({ name: left.slice(4), line: lineOf(node), kind: isFn(node.right) ? 'portal-fn' : 'portal', topLevel: true, node, file: rel });
    }
    // typeof X === 'function'
    if (T.isBinaryExpression(node) && T.isTypeOfExpression(node.left) && strLit(node.right) === 'function' && ctx.renderer) {
      const n = nameOf(node.left.expression);
      if (n) { const parts = n.split('.'); const name = GLOBAL_HOSTS.has(parts[0]) && parts.length === 2 ? parts[1] : parts.length === 1 ? parts[0] : null;
        if (name) info.silent.push({ name, line: lineOf(node), expr: 'typeof ' + n, fn: enclosingFn(node)?.name || null, typeofGuard: true }); }
    }
    // Strings con HTML que llevan manejadores inline.
    if (T.isStringLiteral(node) || T.isNoSubstitutionTemplateLiteral(node) || T.isTemplateExpression(node)) {
      const raw = T.isTemplateExpression(node) ? node.getText(sf).replace(/\$\{[\s\S]*?\}/g, 'X') : node.text;
      if (/\bon[a-z]+\s*=/.test(raw)) info.handlerStrings.push({ text: raw, line: lineOf(node) });
    }
    if (isFn(node) || T.isMethodDeclaration(node)) {
      const e = { node };
      info.functions.push(e);
    }
    T.forEachChild(node, visit);
  }
  function hasOptional(expr) {
    while (expr && (T.isPropertyAccessExpression(expr) || T.isElementAccessExpression(expr) || T.isCallExpression(expr))) {
      if (expr.questionDotToken) return true; expr = expr.expression;
    }
    return false;
  }
  function templatePrefix(n) {
    if (!n) return null;
    if (T.isTemplateExpression(n)) return n.head.text || null;
    if (T.isBinaryExpression(n) && n.operatorToken.kind === T.SyntaxKind.PlusToken) return strLit(n.left) || templatePrefix(n.left);
    return null;
  }
  visit(sf);
  info.sf = sf; info.text = text;
  return info;
}

const HANDLER_ATTR = /\bon([a-z]+)\s*=\s*(\\?["'])([\s\S]*?)\2/g;
const HANDLER_OPEN = /\bon([a-z]+)\s*=\s*\\?["']([^"']*)/g;
function handlerCalls(src) {
  const out = [];
  for (const m of src.matchAll(HANDLER_ATTR)) {
    const code = m[3].replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
    for (const c of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) out.push({ event: m[1], name: c[2] });
  }
  for (const m of src.matchAll(HANDLER_OPEN)) {
    for (const c of m[2].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) out.push({ event: m[1], name: c[2] });
  }
  return out;
}

// --- Catálogos ---------------------------------------------------------------------------
function serverCatalog(root) {
  const names = new Set(), sources = [];
  const tryJson = (f, pick) => { try { const j = JSON.parse(read(f)); const n = pick(j); n.forEach(x => names.add(x)); sources.push({ file: f, count: n.length }); } catch (_) {} };
  tryJson(path.join(root, '..', 'PROYECTO_SERVIDOR_NODO', 'servidor-derivacion-actual.json'), j => (j.functions || []).map(f => f.name));
  tryJson(path.join(root, '..', 'PROYECTO_SERVIDOR_NODO', 'servidor-firmas-2026-10-21.json'), j => (Array.isArray(j) ? j : []).map(f => f.name || f.proname).filter(Boolean));
  if (process.env.LOCALAPPDATA) tryJson(path.join(process.env.LOCALAPPDATA, 'NODO', 'resguardos-servidor', '20261030-cobertura', 'rpc-before.json'),
    j => (Array.isArray(j) ? j : []).map(f => f.name || f.proname || f.function_name).filter(Boolean));
  const local = new Set();
  for (const f of listFiles(path.join(root, 'servidor'), /\.sql$/i)) for (const m of read(f).matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:"?[\w]+"?\.)?"?(\w+)"?\s*\(/gi)) local.add(m[1]);
  return { remote: names, local, sources };
}
function healthServerBranches(root) {
  const f = path.join(root, 'servidor', 'beta-chat-v1.sql');
  if (!fs.existsSync(f)) return null;
  const m = read(f).match(/integration\s+text\s+not\s+null\s+check\s*\(\s*integration\s+in\s*\(([^)]*)\)/i);
  return m ? new Set([...m[1].matchAll(/'([A-Z_]+)'/g)].map(x => x[1])) : null;
}
function healthClientBranches(root) {
  const t = read(path.join(root, 'renderer', 'runtime', 'integration-health.js'));
  const m = t.match(/const integrations=new Set\('([^']+)'/);
  return m ? new Set(m[1].split(' ')) : new Set();
}
function betaAllowlist(root) {
  const t = read(path.join(root, 'main', 'panel-rpc.js'));
  const block = t.slice(t.indexOf('BETA_RPC_PARAMS'), t.indexOf(']);', t.indexOf('BETA_RPC_PARAMS')));
  return new Set([...block.matchAll(/\[\s*'([a-z0-9_]+)'/g)].map(m => m[1]));
}

// --- Auditoría completa ------------------------------------------------------------------
function audit({ root = ROOT } = {}) {
  const T = ts();
  const { js } = manifestSources(root);
  const order = new Map(js.map((s, i) => [s.file, i]));
  const renderer = js.filter(s => s.file !== EMBED_REL).map(s => {
    const text = read(path.join(root, s.file));
    return { ...s, info: analyzeJS(T, s.file, text, { renderer: true, portalGlobals: /\bglobals\s*:\s*api\b/.test(text) }) };
  });
  const template = read(path.join(root, 'renderer', 'panel.template.html'));
  const mainFiles = [path.join(root, 'main.js'), ...listFiles(path.join(root, 'main'), /\.js$/)].filter(fs.existsSync);
  const preloadFiles = ['app-preload.js', 'agent-preload.js', 'agent-preload-bet300.js', 'chunior-bridge.js', 'main/visor-imagen-preload.js', 'main/preload-listo.js']
    .map(f => path.join(root, f)).filter(fs.existsSync);
  const mainInfos = mainFiles.map(f => analyzeJS(T, slash(path.relative(root, f)), read(f), { renderer: false }));
  const preloadInfos = preloadFiles.map(f => analyzeJS(T, slash(path.relative(root, f)), read(f), { renderer: false }));

  const findings = [];
  const add = (cat, sev, data) => findings.push({ categoria: cat, severidad: sev, ...data });

  // Globales definidas y menciones.
  const globals = new Map();
  for (const s of renderer) for (const d of s.info.defs) {
    if (!globals.has(d.name)) globals.set(d.name, []);
    globals.get(d.name).push({ ...d, order: order.get(s.file) });
  }
  const mentionCount = new Map();
  const addMention = (n, c = 1) => mentionCount.set(n, (mentionCount.get(n) || 0) + c);
  for (const s of renderer) { for (const [k, v] of s.info.idents) addMention(k, v); for (const [k, v] of s.info.props) addMention(k, v); }
  const allHandlerCalls = [];
  for (const h of handlerCalls(template)) { addMention(h.name); allHandlerCalls.push({ ...h, file: 'renderer/panel.template.html', line: null }); }
  for (const s of renderer) for (const hs of s.info.handlerStrings) for (const h of handlerCalls(hs.text)) { addMention(h.name); allHandlerCalls.push({ ...h, file: s.file, line: hs.line }); }
  // ids/strings que se usan como nombre: window['x'], data-fn="x", etc.
  const templateWords = new Map(); for (const m of template.matchAll(/[A-Za-z_$][\w$]{3,}/g)) templateWords.set(m[0], (templateWords.get(m[0]) || 0) + 1);
  const stringWords = new Map();
  for (const s of renderer) for (const m of s.info.text.matchAll(/['"`]([A-Za-z_$][\w$]{3,})['"`]/g)) stringWords.set(m[1], (stringWords.get(m[1]) || 0) + 1);

  const declaredAnywhere = new Set();
  for (const s of renderer) for (const d of s.info.declared) declaredAnywhere.add(d);
  const isDefined = n => globals.has(n) || BUILTINS.has(n) || declaredAnywhere.has(n);

  // 1) DEFINICION_PISADA
  for (const [name, defs] of globals) {
    const fnDefs = defs.filter(d => d.kind !== 'var' && d.kind !== 'window' || d.kind === 'window-fn');
    const loadDefs = fnDefs.filter(d => d.topLevel);
    if (loadDefs.length < 2) continue;
    loadDefs.sort((a, b) => a.order - b.order || a.line - b.line);
    const winner = loadDefs[loadDefs.length - 1];
    for (const d of loadDefs.slice(0, -1)) {
      // ¿La definición posterior envuelve a la anterior (captura window.X antes de pisarla)?
      const laterText = renderer.find(r => r.file === winner.file).info.text;
      const wraps = new RegExp(`(?:const|let|var)\\s+[\\w$]+\\s*=\\s*(?:window\\.)?${name.replace(/\$/g, '\\$')}\\b(?!\\s*=)`).test(laterText)
        || new RegExp(`(?:window|globalThis)\\.${name.replace(/\$/g, '\\$')}\\s*(?:\\|\\||&&|\\?\\.)`).test(laterText);
      if (wraps) continue;
      add('DEFINICION_PISADA', d.file === winner.file ? 'ALTA' : 'MEDIA', {
        simbolo: name, archivo: d.file, linea: d.line, gana: winner.file + ':' + winner.line,
        detalle: d.file === winner.file ? 'Definida dos veces en el mismo archivo: la primera nunca corre.' : 'Una fuente posterior del manifest la reemplaza: esta versión es código muerto.' });
    }
  }
  // 2) SIN_REFERENCIAS (sólo funciones; las variables de estado se excluyen)
  for (const [name, defs] of globals) {
    if (!defs.some(d => /function|window-fn|implicit|assign/.test(d.kind))) continue;
    if (name.length < 3 || /^_?(init|main)$/.test(name)) continue;
    const uses = (mentionCount.get(name) || 0) - defs.length * (defs.some(d => d.kind.startsWith('window')) ? 1 : 1);
    const viaStrings = (templateWords.get(name) || 0) + (stringWords.get(name) || 0);
    if (uses <= 0 && viaStrings === 0) {
      const d = defs[defs.length - 1];
      add('SIN_REFERENCIAS', 'BAJA', { simbolo: name, archivo: d.file, linea: d.line, detalle: 'Ninguna fuente del panel, plantilla ni manejador la nombra.' });
    }
  }
  // 3) BOTON_ROTO
  const seenBroken = new Set();
  for (const h of allHandlerCalls) {
    if (isDefined(h.name) || /^(if|return|function)$/.test(h.name)) continue;
    const k = h.name + '|' + h.file; if (seenBroken.has(k)) continue; seenBroken.add(k);
    add('BOTON_ROTO', 'ALTA', { simbolo: h.name, archivo: h.file, linea: h.line, detalle: `on${h.event} llama a ${h.name}() y esa función no existe en el panel: el clic tira ReferenceError.` });
  }
  // 4) LLAMADA_SILENCIOSA
  const seenSilent = new Set();
  for (const s of renderer) for (const c of s.info.silent) {
    if (isDefined(c.name) || GLOBAL_HOSTS.has(c.name)) continue;
    if (/^(ctrlElectron|chunior|panelAPI|updaterAPI|nodoApp|electronAPI|require|module|process|__nodoTest|Notification|gc)$/.test(c.name)) continue;
    const k = c.name + '|' + s.file; if (seenSilent.has(k)) continue; seenSilent.add(k);
    add('LLAMADA_SILENCIOSA', 'ALTA', { simbolo: c.name, archivo: s.file, linea: c.line, funcion: c.fn,
      detalle: `${c.expr} nunca está definida en el panel: la llamada no falla y no hace nada.` });
  }
  // 5) IPC
  const handled = new Map(), invoked = new Map();
  for (const m of mainInfos) for (const h of m.ipcHandle) if (!h.push) handled.set(h.channel, m.file + ':' + h.line);
  const pushed = new Set(); for (const m of mainInfos) for (const h of m.ipcHandle) if (h.push) pushed.add(h.channel);
  // Canales declarados por constante (const CANAL = 'x'; ipcMain.on(CANAL)) o emitidos con
  // otro objeto (view.webContents.send('x')): basta con que main nombre el literal.
  const mainText = mainInfos.map(m => m.text).join('\n');
  const mainNames = ch => mainText.includes(`'${ch}'`) || mainText.includes(`"${ch}"`) || mainText.includes('`' + ch + '`');
  for (const p of [...preloadInfos, ...mainInfos]) for (const i of p.ipcInvoke) {
    if (['on', 'once'].includes(i.method)) { if (!pushed.has(i.channel) && !handled.has(i.channel) && !mainNames(i.channel)) add('IPC_SIN_EMISOR', 'MEDIA', { simbolo: i.channel, archivo: p.file, linea: i.line, detalle: 'El preload escucha un canal que main nunca emite.' }); continue; }
    invoked.set(i.channel, p.file + ':' + i.line);
    if (!handled.has(i.channel) && !mainNames(i.channel)) add('IPC_SIN_HANDLER', 'ALTA', { simbolo: i.channel, archivo: p.file, linea: i.line, detalle: 'El preload invoca un canal que main no atiende: la promesa se rechaza.' });
  }
  for (const [ch, where] of handled) if (!invoked.has(ch)) {
    const [file, line] = where.split(':');
    add('IPC_SIN_USO', 'BAJA', { simbolo: ch, archivo: file, linea: Number(line), detalle: 'main atiende un canal que ningún preload invoca.' });
  }
  // 6) Puente contextBridge
  const rendererText = renderer.map(r => r.info.text).join('\n') + '\n' + template;
  const appExposed = preloadInfos.filter(p => p.file === 'app-preload.js').flatMap(p => p.exposed.map(e => ({ ...e, file: p.file })));
  const exposedSet = new Set(appExposed.map(e => e.ns + '.' + e.key));
  for (const e of appExposed) {
    if (e.key === '*') continue;
    const re = new RegExp(`\\b${e.ns}\\s*\\??\\.\\s*${e.key}\\b`);
    if (!re.test(rendererText)) add('PUENTE_SIN_USO', 'BAJA', { simbolo: e.ns + '.' + e.key, archivo: e.file, linea: e.line, detalle: 'Expuesto al renderer y nadie lo usa.' });
  }
  const nsList = [...new Set(appExposed.map(e => e.ns))];
  for (const ns of nsList) {
    if (appExposed.some(e => e.ns === ns && e.key === '*')) continue;
    for (const m of rendererText.matchAll(new RegExp(`(?<![\\w$.'"/])(?:window\\s*\\??\\.\\s*)?${ns}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)\\s*(?:\\?\\.\\s*)?\\(`, 'g'))) {
      if (!exposedSet.has(ns + '.' + m[1]) && !findings.some(f => f.categoria === 'PUENTE_INEXISTENTE' && f.simbolo === ns + '.' + m[1])) {
        const owner = renderer.find(r => r.info.text.includes(m[0]));
        add('PUENTE_INEXISTENTE', 'ALTA', { simbolo: ns + '.' + m[1], archivo: owner?.file || 'renderer/panel.template.html', linea: null, detalle: `El renderer usa ${ns}.${m[1]} y app-preload.js no lo expone.` });
      }
    }
  }
  // 7) RPC
  const allow = betaAllowlist(root), catalog = serverCatalog(root);
  const panelRpcText = read(path.join(root, 'main', 'panel-rpc.js'));
  let dynamicRpc = 0;
  for (const s of renderer) for (const r of s.info.rpc) {
    if (r.dynamic) { dynamicRpc++; continue; }
    if (r.via === 'panelAPI' && !allow.has(r.name) && !panelRpcText.includes(`'${r.name}'`))
      add('RPC_FUERA_ALLOWLIST', 'ALTA', { simbolo: r.name, archivo: s.file, linea: r.line, funcion: r.fn, detalle: 'panelAPI.rpc con una función que main no permite.' });
    if (!catalog.remote.has(r.name) && !catalog.local.has(r.name))
      add('RPC_SIN_CATALOGO', 'MEDIA', { simbolo: r.name, archivo: s.file, linea: r.line, funcion: r.fn, detalle: 'No figura en el catálogo remoto guardado ni en servidor/*.sql.' });
  }
  // 8) localStorage
  const keys = new Map();
  const prefixes = [];
  for (const s of renderer) for (const st of s.info.storage) {
    if (!st.key) { if (st.dynamicPrefix) prefixes.push({ ...st, file: s.file }); continue; }
    const k = st.area + ':' + st.key; if (!keys.has(k)) keys.set(k, { r: [], w: [] });
    (st.op === 'getItem' ? keys.get(k).r : keys.get(k).w).push(s.file + ':' + st.line);
  }
  // Claves leídas/escritas por envoltorios con el nombre como literal (p. ej. lsGet('k')).
  const literalUse = k => (stringWords.get(k) || 0) + (templateWords.get(k) || 0);
  for (const [k, v] of keys) {
    const key = k.split(':').slice(1).join(':');
    const coveredByPrefix = prefixes.some(p => key.startsWith(p.dynamicPrefix));
    if (v.w.length && !v.r.length && !coveredByPrefix && literalUse(key) <= v.w.length)
      add('STORAGE_SOLO_ESCRITO', 'BAJA', { simbolo: k, archivo: v.w[0].split(':')[0], linea: Number(v.w[0].split(':')[1]), detalle: 'Se escribe y ninguna fuente la lee.' });
    if (v.r.length && !v.w.length && !coveredByPrefix && literalUse(key) <= v.r.length)
      add('STORAGE_SOLO_LEIDO', 'MEDIA', { simbolo: k, archivo: v.r[0].split(':')[0], linea: Number(v.r[0].split(':')[1]), detalle: 'Se lee y ninguna pantalla la escribe: sólo se configura a mano desde consola o queda de una versión vieja.' });
  }
  // 9) Salud
  const client = healthClientBranches(root), server = healthServerBranches(root);
  const used = new Map();
  for (const s of renderer) for (const h of s.info.health) {
    if (!h.branch) continue;
    used.set(h.branch, (used.get(h.branch) || []).concat(s.file + ':' + h.line));
    if (!client.has(h.branch)) add('SALUD_RAMA_DESCARTADA', 'ALTA', { simbolo: h.branch, archivo: s.file, linea: h.line, detalle: 'NodoSalud.record() descarta esta rama en silencio: nunca aparece en el semáforo.' });
  }
  if (server) for (const b of client) if (!server.has(b)) add('SALUD_RAMA_SOLO_LOCAL', 'ALTA', { simbolo: b, archivo: 'renderer/runtime/integration-health.js', linea: 6,
    detalle: 'El CHECK de observabilidad.salud_actual no acepta esta rama: si se envía, el servidor rechaza el lote completo.' });
  for (const b of client) if (!used.has(b) && b !== 'TELEMETRIA') add('SALUD_RAMA_SIN_USO', 'MEDIA', { simbolo: b, archivo: 'renderer/runtime/integration-health.js', linea: 6, detalle: 'Rama declarada que ningún circuito alimenta: queda UNKNOWN para siempre.' });
  // 10) Circuitos con red/IPC: separar código muerto/pisado, salud directa, salud por compuerta y sin salud.
  const pisadasKey = new Map(), sinRefKey = new Set();
  for (const f of findings) {
    if (f.categoria === 'DEFINICION_PISADA') pisadasKey.set(f.archivo + '|' + f.simbolo + '|' + f.linea, f.gana);
    if (f.categoria === 'SIN_REFERENCIAS') sinRefKey.add(f.archivo + '|' + f.simbolo);
  }
  const directHealthRe = /NodoSalud|(?:health|capHealth|_wHealth|_autoHealth|_admHealth|_connHealth|_apiHealth)\s*\??\.\s*(?:begin|record|reply)/;
  const instrumentedGateways = new Set();
  for (const s of renderer) for (const fnObj of s.info.functions) {
    const p = fnObj.node.parent;
    let name = fnObj.node.name && T.isIdentifier(fnObj.node.name) ? fnObj.node.name.text : null;
    if (!name && p) {
      if (T.isVariableDeclaration(p) && T.isIdentifier(p.name)) name = p.name.text;
      else if (T.isBinaryExpression(p)) { const l = p.left.getText(s.info.sf); name = l.split('.').pop(); }
    }
    if (name && directHealthRe.test(fnObj.node.getText(s.info.sf))) instrumentedGateways.add(name);
  }
  const circuits = [];
  for (const s of renderer) {
    const fileHasHealth = s.info.health.length > 0;
    const byFn = new Map();
    for (const n of s.info.netSites) {
      const key = n.fn || '(nivel superior)';
      if (!byFn.has(key)) byFn.set(key, { fn: key, sites: [], node: n.fnNode });
      byFn.get(key).sites.push(n);
    }
    for (const [fn, c] of byFn) {
      const fnStartLine = c.node ? s.info.sf.getLineAndCharacterOfPosition(c.node.getStart(s.info.sf)).line + 1 : c.sites[0].line;
      let pisadaPor = null;
      for (const [k, winner] of pisadasKey) {
        const [pf, ps, pl] = k.split('|');
        if (pf === s.file && ps === fn && Math.abs(Number(pl) - fnStartLine) <= 3) { pisadaPor = winner; break; }
      }
      const esSinRef = sinRefKey.has(s.file + '|' + fn);
      const body = c.node ? c.node.getText(s.info.sf) : '';
      const direct = directHealthRe.test(body);
      const viaGateway = !direct && (fileHasHealth || [...instrumentedGateways].some(g => new RegExp(`\\b${g.replace(/\$/g, '\\$')}\\s*\\(`).test(body)));
      const destinos = [...new Set(c.sites.map(x => x.kind + ':' + (x.target || '?')))].slice(0, 6);
      const entry = { archivo: s.file, funcion: fn, linea: c.sites[0].line, sitios: c.sites.length,
        destinos, en_codigo_muerto: Boolean(pisadaPor || esSinRef), observado_directo: direct, observado_compuerta: viaGateway };
      circuits.push(entry);
      if (pisadaPor || esSinRef) {
        add('LECTOR_EN_CODIGO_MUERTO', 'MEDIA', { simbolo: fn, archivo: s.file, linea: entry.linea, destinos,
          detalle: pisadaPor ? `Tiene ${c.sites.length} llamada(s) de red/IPC (${destinos.join(', ')}) pero la función está pisada por ${pisadaPor}: nunca se ejecuta.`
            : `Tiene ${c.sites.length} llamada(s) de red/IPC (${destinos.join(', ')}) pero la función no tiene referencias en todo el panel.` });
      } else if (!direct && !viaGateway) {
        add('CIRCUITO_SIN_SALUD', 'MEDIA', { simbolo: fn, archivo: s.file, linea: entry.linea, destinos,
          detalle: 'Función activa con red/IPC sin evidencia de NodoSalud ni compuerta instrumentada.' });
      }
    }
  }
  const activeCircuits = circuits.filter(c => !c.en_codigo_muerto);
  const parseErrors = renderer.filter(s => s.info.parseErrors).map(s => s.file);
  const summary = {};
  for (const f of findings) summary[f.categoria] = (summary[f.categoria] || 0) + 1;
  const sourceHash = sha(renderer.map(r => r.file + '\n' + r.info.text).join('\n') + template + mainInfos.map(m => m.text).join('') + preloadInfos.map(p => p.text).join(''));
  return {
    contrato: 'nodo.desconexiones.v1', fuente_hash: sourceHash,
    alcance: { fuentes_renderer: renderer.length, main: mainInfos.length, preloads: preloadInfos.length, rpc_dinamicas_no_resueltas: dynamicRpc,
      claves_storage_dinamicas: prefixes.length, catalogo_servidor: catalog.sources.map(s => ({ archivo: path.basename(s.file), funciones: s.count })), errores_parseo: parseErrors },
    resumen: summary,
    circuitos: {
      total: circuits.length,
      activos: activeCircuits.length,
      en_codigo_muerto: circuits.length - activeCircuits.length,
      observados_directo: activeCircuits.filter(c => c.observado_directo).length,
      observados_compuerta: activeCircuits.filter(c => c.observado_compuerta).length,
      observados: activeCircuits.filter(c => c.observado_directo || c.observado_compuerta).length,
      sin_salud: activeCircuits.filter(c => !c.observado_directo && !c.observado_compuerta).length,
    },
    hallazgos: findings.map(f => { const { node, ...rest } = f; return rest; }),
  };
}

// --- Cotejo con la bitácora humana -------------------------------------------------------
function crossCheckLog(result, root = ROOT) {
  const f = path.join(root, 'DESCONEXIONES.md');
  if (!fs.existsSync(f)) return null;
  const t = read(f);
  const items = t.split(/\n(?=## )/).filter(p => /^## [A-Z]+-\d+/.test(p)).map(p => {
    const head = p.split('\n')[0];
    const id = head.match(/^## ([A-Z]+-\d+)/)[1];
    const est = (p.match(/\*\*Estado\*\*[^\n]*?(ABIERTO|EN REVISI\S*|RESUELTO|DESCARTADO|CORREGIDO|HECHO|ELIMINAD\S*|PARCIAL)/i)
      || head.match(/(RESUELTO|CORREGIDO|HECHO|ELIMINAD\S*|DESCARTADO|ABIERTO|PARCIAL)/i) || [null, 'SIN_ESTADO'])[1].toUpperCase();
    const symbols = [...new Set([...p.matchAll(/`([A-Za-z_$][\w$.:-]{2,})`/g)].map(m => m[1].replace(/\(\)$/, '')))];
    return { id, titulo: head.replace(/^## /, '').slice(0, 140), estado: est, symbols };
  });
  const bySymbol = new Map();
  for (const h of result.hallazgos) { const k = String(h.simbolo).split(':').pop(); if (!bySymbol.has(k)) bySymbol.set(k, []); bySymbol.get(k).push(h.categoria); }
  for (const it of items) it.detectado_por = [...new Set(it.symbols.flatMap(s => bySymbol.get(s.split('.').pop()) || []))];
  const abiertos = items.filter(i => !/RESUELTO|CORREGIDO|HECHO|ELIMINAD|DESCARTADO/.test(i.estado));
  return { total: items.length, abiertos_o_sin_estado: abiertos.length,
    abiertos_detectados_automaticamente: abiertos.filter(i => i.detectado_por.length).length,
    items: abiertos.map(({ symbols, ...i }) => i) };
}

function embedText(result, log) {
  const compact = {
    contrato: result.contrato, fuente_hash: result.fuente_hash, resumen: result.resumen, circuitos: result.circuitos,
    bitacora: log ? { total: log.total, abiertos: log.abiertos_o_sin_estado, detectados: log.abiertos_detectados_automaticamente } : null,
    // Sólo nombres de símbolos y ubicaciones del propio código: nada de datos de negocio ni secretos.
    hallazgos: result.hallazgos.filter(h => h.severidad !== 'BAJA').slice(0, 400)
      .map(h => [h.categoria, h.severidad, String(h.simbolo).slice(0, 80), h.archivo, h.linea || 0]),
  };
  return '// GENERADO por scripts/auditar-desconexiones.cjs --embed. No editar a mano.\n' +
    '// Lo consume NodoSalud.show() para que el semáforo muestre también las desconexiones estáticas.\n' +
    '(function(root){ root.NodoDesconexiones = Object.freeze(' + JSON.stringify(compact) + '); })(globalThis);\n';
}

function toMarkdown(result, log) {
  const L = [];
  L.push('# Desconexiones detectadas automáticamente', '', `Contrato \`${result.contrato}\` · hash de fuentes \`${result.fuente_hash}\``, '');
  L.push('Análisis estático del panel tal como se empaqueta (manifest + plantilla), main y preloads. No prueba ejecución.', '');
  L.push('| Categoría | Cantidad |', '|---|---|');
  for (const [k, v] of Object.entries(result.resumen).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push('', `Circuitos con red/IPC: ${result.circuitos.total} · con evidencia funcional NodoSalud: ${result.circuitos.observados}.`);
  L.push(`RPC con nombre dinámico no resuelto: ${result.alcance.rpc_dinamicas_no_resueltas} · claves storage dinámicas: ${result.alcance.claves_storage_dinamicas}.`, '');
  if (log) {
    L.push('## Cotejo con DESCONEXIONES.md', '', `Ítems: ${log.total} · abiertos o sin estado: ${log.abiertos_o_sin_estado} · detectados por este auditor: ${log.abiertos_detectados_automaticamente}.`, '');
    L.push('Los ítems de datos (tablas huérfanas, filas inconsistentes, flujos de negocio) no son detectables por análisis estático del código; requieren consulta SQL.', '');
  }
  const order = ['ALTA', 'MEDIA', 'BAJA'];
  for (const sev of order) {
    const hs = result.hallazgos.filter(h => h.severidad === sev);
    if (!hs.length) continue;
    L.push(`## Severidad ${sev} (${hs.length})`, '');
    for (const h of hs) L.push(`- **${h.categoria}** \`${h.simbolo}\` — ${h.archivo}${h.linea ? ':' + h.linea : ''}${h.gana ? ' (gana ' + h.gana + ')' : ''}. ${h.detalle}`);
    L.push('');
  }
  return L.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const result = audit();
  const log = crossCheckLog(result);
  const embedPath = path.join(ROOT, EMBED_REL);
  if (argv.includes('--check')) {
    const current = fs.existsSync(embedPath) ? read(embedPath) : '';
    if (current !== embedText(result, log)) { console.error('desconexiones-estaticas.js desactualizado. Ejecutá npm run audit:desconexiones -- --embed'); process.exitCode = 1; return; }
    console.log('Desconexiones embebidas al día.'); return;
  }
  if (argv.includes('--embed')) fs.writeFileSync(embedPath, embedText(result, log));
  const ri = argv.indexOf('--report');
  if (ri >= 0) {
    const dir = path.resolve(argv[ri + 1] || path.join(ROOT, '..', 'PROYECTO_SERVIDOR_NODO', 'auditoria'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'desconexiones-auto.json'), JSON.stringify({ ...result, bitacora: log }, null, 1));
    fs.writeFileSync(path.join(dir, 'desconexiones-auto.md'), toMarkdown(result, log));
  }
  console.log(JSON.stringify({ resumen: result.resumen, circuitos: result.circuitos, alcance: result.alcance,
    bitacora: log && { total: log.total, abiertos: log.abiertos_o_sin_estado, detectados: log.abiertos_detectados_automaticamente } }, null, 1));
}

if (require.main === module) main();
module.exports = { audit, crossCheckLog, embedText, handlerCalls, analyzeJS };
