#!/usr/bin/env node
'use strict';

// Índice local de metadatos: nunca guarda cuerpos, comentarios ni literales libres.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const VERSION = 2;
const ROOT = path.resolve(__dirname, '..');
const slash = value => value.replace(/\\/g, '/');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const unique = values => [...new Set(values)];
const safeName = value => typeof value === 'string' && /^[A-Za-z_$][\w.$:-]{0,120}$/.test(value);
const sensitive = value => /(?:eyJ[A-Za-z0-9_-]{12,}\.|(?:sb_secret_|sk_live_|ghp_)[A-Za-z0-9_]+|-----BEGIN .*PRIVATE KEY|(?:password|passwd|secret|api[_-]?key|access[_-]?token|service[_-]?role)\s*[:=]\s*['"][^'"\r\n]{4,}['"])/i.test(value);

function parser() {
  try { return require('typescript'); }
  catch { throw new Error('Falta el parser AST typescript. Instalá las dependencias de desarrollo del proyecto; no se genera un grafo con expresiones regulares.'); }
}
function git(root, args) {
  return cp.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
function local(root, relative) {
  const target = path.resolve(root, relative), rel = path.relative(root, target);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('Ruta fuera del proyecto');
  return target;
}
function filesIn(root) {
  try { return unique(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean)); }
  catch {
    const files = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || /^(?:\.|node_modules$|dist$|out$|build$|user-data|_.*tmp)/.test(entry.name)) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file); else files.push(slash(path.relative(root, file)));
      }
    }
    walk(root); return files;
  }
}
function manifestInfo(root) {
  const file = path.join(root, 'renderer', 'manifest.json');
  if (!fs.existsSync(file)) return { hash: '', sources: {}, generated: {}, warnings: [] };
  const raw = fs.readFileSync(file, 'utf8'), manifest = JSON.parse(raw), sources = {}, generated = {};
  if (manifest.output) generated[slash(manifest.output)] = [];
  for (const block of manifest.blocks || []) {
    const sourcePaths = (block.sources || []).map(file => slash(path.relative(root, local(path.join(root, 'renderer'), file))));
    const output = 'renderer/generated/' + String(block.id).replace(':', '-') + (block.type === 'script' ? '.js' : '.css');
    if (!block.inline) generated[output] = sourcePaths;
    if (manifest.output) generated[slash(manifest.output)].push(...sourcePaths);
    for (const source of sourcePaths) sources[source] = { block: block.id, output: block.inline ? manifest.output : output, group: 'panel-classic' };
  }
  return { hash: hash(raw), sources, generated, warnings: [] };
}
function kindOf(file) {
  if (/(?:^|\/)(?:config\.json|\.env[^/]*|.*(?:credentials|secrets)\.json)$/i.test(file)) return null;
  if (/\.sql$/i.test(file)) return 'sql';
  if (/\.[cm]?[jt]sx?$/i.test(file)) return 'js';
  if (/\.html?$/i.test(file) || /(?:^|\/)Portal$/.test(file)) return 'html';
  if (/\.md$/i.test(file)) return 'doc';
  return null;
}
function blankRecord(file, text, kind, manifest) {
  return { file, hash: hash(text), bytes: Buffer.byteLength(text), kind, source: manifest.sources[file] || null,
    symbols: [], calls: [], bindings: [], imports: [], exports: [], mentions: [], paths: [], contracts: [], warnings: [], scopes: {} };
}
let lineText, lineBreaks = [];
function lineAt(text, position) {
  if (lineText !== text) { lineText = text; lineBreaks = []; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineBreaks.push(i); }
  let low = 0, high = lineBreaks.length;
  while (low < high) { const mid = (low + high) >>> 1; if (lineBreaks[mid] < position) low = mid + 1; else high = mid; }
  return low + 1;
}

function parseJS(ts, record, text, code, offset = 0) {
  const sf = ts.createSourceFile(record.file, code, ts.ScriptTarget.Latest, true, /\.tsx?$/.test(record.file) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const prefix = record.file + ':' + offset + ':';
  const scopes = record.scopes, nodeScopes = new Map(), nodes = new Map();
  const rootScope = prefix + 'root'; scopes[rootScope] = null;
  const position = node => node.getStart(sf) + offset;
  const nameOf = node => {
    if (!node) return null;
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) { const head = nameOf(node.expression); return head ? head + '.' + node.name.text : null; }
    if (ts.isStringLiteral(node) && safeName(node.text)) return node.text;
    return null;
  };
  const functionLike = node => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node);
  function functionName(node) {
    if (node.name) return nameOf(node.name);
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent)) return nameOf(parent.name);
    if (ts.isPropertyAssignment(parent)) return nameOf(parent.name);
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return nameOf(parent.left);
    return null;
  }
  const bind = (scope, name, target = null) => { if (name) record.bindings.push({ scope, name, target }); };
  function declarationNames(node) {
    if (ts.isIdentifier(node)) return [node.text];
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) return node.elements.flatMap(e => e.name ? declarationNames(e.name) : []);
    return [];
  }
  function first(node, scope, owner, varScope = rootScope) {
    nodeScopes.set(node, scope);
    if (functionLike(node)) {
      let name = functionName(node);
      const parent = node.parent;
      if (name && (ts.isMethodDeclaration(node) || ts.isPropertyAssignment(parent))) {
        const object = ts.isMethodDeclaration(node) ? parent : parent.parent;
        if (ts.isObjectLiteralExpression(object) && ts.isVariableDeclaration(object.parent)) {
          const base = nameOf(object.parent.name); if (base) name = base + '.' + name;
        }
      }
      const start = position(node), id = record.file + ':' + start;
      const symbol = { id, name: name || '@callback:' + lineAt(text, start), anonymous: !name, kind: 'js', file: record.file,
        line: lineAt(text, start), endLine: lineAt(text, node.end + offset), start, end: node.end + offset,
        scope, parent: owner, params: node.parameters.map(p => declarationNames(p.name).join(',') || '{desestructurado}'),
        async: Boolean(node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) };
      record.symbols.push(symbol); nodes.set(node, symbol);
      if (name) bind(scope, name, id);
      if (name && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) record.exports.push({ exported: node.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : name, local: name });
      const childScope = prefix + node.pos; scopes[childScope] = scope;
      for (const param of node.parameters) for (const paramName of declarationNames(param.name)) bind(childScope, paramName);
      if (ts.isFunctionExpression(node) && node.name) bind(childScope, node.name.text, id);
      ts.forEachChild(node, child => first(child, childScope, id, childScope)); return;
    }
    if (ts.isBlock(node) || ts.isCatchClause(node)) { const child = prefix + 'block' + node.pos; scopes[child] = scope; scope = child; nodeScopes.set(node, scope); }
    if (ts.isVariableDeclaration(node)) {
      const bindingScope = ts.isVariableDeclarationList(node.parent) && !(node.parent.flags & ts.NodeFlags.BlockScoped) ? varScope : scope;
      if (!node.initializer || !functionLike(node.initializer)) for (const name of declarationNames(node.name)) bind(bindingScope, name);
      if (node.initializer && ts.isCallExpression(node.initializer) && nameOf(node.initializer.expression) === 'require' && ts.isStringLiteral(node.initializer.arguments[0])) {
        const spec = node.initializer.arguments[0].text;
        if (spec.startsWith('.')) {
          if (ts.isIdentifier(node.name)) record.imports.push({ scope, local: node.name.text, imported: '*', spec });
          else if (ts.isObjectBindingPattern(node.name)) for (const e of node.name.elements) record.imports.push({ scope, local: nameOf(e.name), imported: nameOf(e.propertyName || e.name), spec });
        }
      }
      if (node.name.getText(sf) === 'CONTRACT' && node.initializer && ts.isStringLiteral(node.initializer) && safeName(node.initializer.text) && !sensitive(node.initializer.text)) record.contracts.push(node.initializer.text);
      if (node.parent.parent?.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) for (const name of declarationNames(node.name)) record.exports.push({ exported: name, local: name });
      // var vive en la función, incluso si el inicializador está dentro de un bloque.
      ts.forEachChild(node, child => first(child, bindingScope, owner, varScope)); return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = nameOf(node.left), right = node.right;
      if (left === 'module.exports' && ts.isObjectLiteralExpression(right)) {
        for (const p of right.properties) if (ts.isShorthandPropertyAssignment(p) || ts.isPropertyAssignment(p)) {
          const exported = nameOf(p.name), value = ts.isShorthandPropertyAssignment(p) ? exported : nameOf(p.initializer);
          if (exported && value) record.exports.push({ exported, local: value });
        }
      } else if (left === 'module.exports' || left?.startsWith('module.exports.') || left?.startsWith('exports.')) {
        const value = functionLike(right) ? functionName(right) : nameOf(right);
        if (value) record.exports.push({ exported: left === 'module.exports' ? 'default' : left.split('.').pop(), local: value });
      }
    }
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const e of node.exportClause.elements) record.exports.push({ exported: e.name.text, local: (e.propertyName || e.name).text });
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text, clause = node.importClause;
      if (clause?.name) { bind(scope, clause.name.text); record.imports.push({ scope, local: clause.name.text, imported: 'default', spec }); }
      const named = clause?.namedBindings;
      if (named && ts.isNamedImports(named)) for (const e of named.elements) { bind(scope, e.name.text); record.imports.push({ scope, local: e.name.text, imported: (e.propertyName || e.name).text, spec }); }
      else if (named && ts.isNamespaceImport(named)) { bind(scope, named.name.text); record.imports.push({ scope, local: named.name.text, imported: '*', spec }); }
    }
    if (ts.isClassDeclaration(node) && node.name) bind(scope, node.name.text);
    ts.forEachChild(node, child => first(child, scope, owner, varScope));
  }
  first(sf, rootScope, null);
  function second(node, owner) {
    if (nodes.has(node)) owner = nodes.get(node).id;
    if (ts.isIdentifier(node)) record.mentions.push(node.text);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (/^(?:\.\.?\/)?[\w /.-]+\.(?:[cm]?js|sql|html?)$/.test(node.text) || node.text === 'Portal') record.paths.push(slash(node.text));
    }
    if (ts.isCallExpression(node)) {
      const callee = nameOf(node.expression), args = node.arguments;
      const literal = arg => arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && safeName(arg.text) && !sensitive(arg.text) ? arg.text : null;
      const rpc = callee?.endsWith('.rpc');
      record.calls.push({ from: owner, scope: nodeScopes.get(node), file: record.file, line: lineAt(text, position(node)),
        callee: callee || '@dinamica', rpc: Boolean(rpc), rpcName: rpc ? literal(args[0]) : null,
        rpcParam: rpc && args[0] && ts.isIdentifier(args[0]) ? args[0].text : null,
        // Los argumentos libres no se guardan: sólo hashes para cruzar contra nombres SQL.
        literalHashes: args.slice(0, 6).map(arg => { const value = literal(arg); return value ? hash(value) : null; }) });
    }
    ts.forEachChild(node, child => second(child, owner));
  }
  second(sf, null);
  if (sf.parseDiagnostics.length) record.warnings.push('AST parcial: ' + sf.parseDiagnostics.length + ' errores de sintaxis; revisar archivo antes de inferir ausencia de referencias.');
}

// Lexer SQL mínimo: separa comentarios, strings y cuerpos dollar-quoted antes de buscar DDL.
function sqlTokens(text, base = 0) {
  const out = []; let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text.startsWith('--', i)) { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end; continue; }
    if (text.startsWith('/*', i)) { let level = 1; i += 2; while (i < text.length && level) { if (text.startsWith('/*', i)) { level++; i += 2; } else if (text.startsWith('*/', i)) { level--; i += 2; } else i++; } continue; }
    const start = i;
    if (text[i] === "'" || text[i] === '"') {
      const quote = text[i++]; let value = '';
      while (i < text.length) { if (text[i] === quote) { if (text[i + 1] === quote) { value += quote; i += 2; } else { i++; break; } } else value += text[i++]; }
      out.push({ value: quote === '"' ? value : '?', type: quote === '"' ? 'id' : 'string', start: base + start, end: base + i }); continue;
    }
    const dollar = text.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/);
    if (dollar) {
      const begin = i + dollar[0].length, end = text.indexOf(dollar[0], begin);
      i = end < 0 ? text.length : end + dollar[0].length;
      out.push({ value: '?', type: 'body', start: base + start, end: base + i, bodyStart: base + begin, bodyEnd: base + (end < 0 ? text.length : end) }); continue;
    }
    const word = text.slice(i).match(/^[A-Za-z_][\w$]*/);
    if (word) { i += word[0].length; out.push({ value: word[0].toLowerCase(), type: 'id', start: base + start, end: base + i }); }
    else { out.push({ value: text[i++], type: 'punct', start: base + start, end: base + i }); }
  }
  return out;
}
function parseSQL(record, text) {
  const tokens = sqlTokens(text);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value !== 'create') continue;
    let j = i + 1;
    if (tokens[j]?.value === 'or' && tokens[j + 1]?.value === 'replace') j += 2;
    if (tokens[j]?.value !== 'function') continue;
    j++; let name = tokens[j++]?.value;
    if (tokens[j]?.value === '.') name += '.' + tokens[++j]?.value, j++;
    if (!safeName(name) || tokens[j]?.value !== '(') continue;
    if (!name.includes('.')) name = 'public.' + name;
    const params = []; let level = 0, param = [];
    for (; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.value === '(') { level++; if (level === 1) continue; }
      if (t.value === ')') { level--; if (!level) { if (param.length) params.push(param); j++; break; } }
      if (t.value === ',' && level === 1) { params.push(param); param = []; } else param.push(t.value);
    }
    const header = []; let body = null;
    for (; j < tokens.length && tokens[j].value !== ';'; j++) { if (tokens[j].type === 'body') body = tokens[j]; else header.push(tokens[j].value); }
    const id = record.file + ':' + tokens[i].start;
    const symbol = { id, name, kind: 'sql', file: record.file, start: tokens[i].start, end: tokens[j]?.end || text.length,
      line: lineAt(text, tokens[i].start), endLine: lineAt(text, tokens[j]?.end || text.length),
      params: params.map(p => p.slice(0, p.findIndex(x => x === 'default' || x === '=') < 0 ? p.length : p.findIndex(x => x === 'default' || x === '=')).join(' ')),
      returns: header.slice(header.indexOf('returns') + 1).join(' ').split(/\b(?:language|as|security|set)\b/)[0].trim() };
    record.symbols.push(symbol);
    if (body) {
      const inner = sqlTokens(text.slice(body.bodyStart, body.bodyEnd), body.bodyStart);
      for (let k = 0; k < inner.length; k++) if (inner[k].type === 'id') {
        let callee = inner[k].value, end = k + 1;
        if (inner[end]?.value === '.' && inner[end + 1]?.type === 'id') { callee += '.' + inner[end + 1].value; end += 2; }
        if (inner[end]?.value === '(') { record.calls.push({ from: id, file: record.file, line: lineAt(text, inner[k].start), callee, sql: true }); k = end; }
      }
    }
    i = j;
  }
}
function parseFile(ts, file, text, kind, manifest) {
  const record = blankRecord(file, text, kind, manifest);
  if (kind === 'sql') parseSQL(record, text);
  if (kind === 'js') parseJS(ts, record, text, text);
  if (kind === 'html') {
    // No interpretar atributos, comentarios HTML, estilos ni JSON como JavaScript.
    const visible = text.replace(/<!--[\s\S]*?-->/g, value => value.replace(/[^\r\n]/g, ' '));
    const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    for (const match of visible.matchAll(scripts)) {
      if (/\bsrc\s*=/i.test(match[1])) continue;
      const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
      if (type && !/^(?:module|(?:text|application)\/javascript)$/i.test(type)) continue;
      const offset = match.index + match[0].indexOf('>') + 1;
      parseJS(ts, record, text, text.slice(offset, offset + match[2].length), offset);
    }
    record.warnings.push('HTML: sólo scripts inline; atributos de eventos y scripts externos requieren revisión aparte.');
  }
  record.mentions = unique(record.mentions); record.paths = unique(record.paths); record.contracts = unique(record.contracts);
  return record;
}
function buildIndex({ root = ROOT, cacheDir, noCache = false } = {}) {
  root = path.resolve(root); const ts = parser(), manifest = manifestInfo(root);
  cacheDir ||= path.join(os.tmpdir(), 'nodo-contexto-codigo', hash(root).slice(0, 20));
  const cacheFile = path.join(cacheDir, 'index.json');
  const parserKey = 'typescript:' + ts.version;
  let old = {};
  if (!noCache) try { const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (cached.version === VERSION && cached.parser === parserKey && cached.manifestHash === manifest.hash) old = cached.files; } catch {}
  const files = {}, stats = { parsed: 0, reused: 0, removed: 0 }, excluded = [];
  for (const file of filesIn(root).map(slash).sort()) {
    if (manifest.generated[file] || file.startsWith('renderer/generated/')) { excluded.push(file); continue; }
    const kind = kindOf(file); if (!kind) continue;
    const absolute = local(root, file);
    if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink()) continue;
    const text = fs.readFileSync(absolute, 'utf8'), digest = hash(text);
    if (old[file]?.hash === digest) { files[file] = old[file]; stats.reused++; }
    else { files[file] = parseFile(ts, file, text, kind, manifest); stats.parsed++; }
  }
  stats.removed = Object.keys(old).filter(file => !files[file]).length;
  const index = { version: VERSION, parser: parserKey, manifestHash: manifest.hash, files };
  if (!noCache) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const temp = cacheFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(index), { mode: 0o600 }); fs.renameSync(temp, cacheFile);
  }
  return { ...index, root, manifest, stats, excluded, cacheFile,
    fingerprint: hash(Object.values(files).map(file => file.file + ':' + file.hash).join('\n') + manifest.hash) };
}

function graph(index) {
  const files = Object.values(index.files), symbols = files.flatMap(f => f.symbols), byId = new Map(symbols.map(s => [s.id, s]));
  const byName = new Map(); for (const symbol of symbols) { if (!byName.has(symbol.name)) byName.set(symbol.name, []); byName.get(symbol.name).push(symbol); }
  const sql = name => (byName.get(name.includes('.') ? name : 'public.' + name) || []).filter(s => s.kind === 'sql').map(s => s.id);
  function resolve(call, file) {
    if (call.sql) return sql(call.callee);
    if (call.rpc) return call.rpcName ? sql(call.rpcName) : [];
    const head = call.callee.split('.')[0];
    let scope = call.scope;
    while (scope) {
      const matches = file.bindings.filter(b => b.scope === scope && b.name === call.callee);
      if (matches.some(b => b.target)) return unique(matches.map(b => b.target).filter(Boolean));
      const imported = file.imports.find(b => b.scope === scope && b.local === head);
      if (imported && imported.spec.startsWith('.')) {
        const target = slash(path.normalize(path.join(path.dirname(file.file), imported.spec)));
        const targetFile = [target, target + '.js', target + '.cjs', target + '.mjs', target + '/index.js'].find(p => index.files[p]);
        const name = imported.imported === '*' ? call.callee.slice(head.length + 1) || 'default' : imported.imported;
        const exported = index.files[targetFile]?.exports.filter(e => e.exported === name).map(e => e.local) || [];
        return (index.files[targetFile]?.symbols || []).filter(s => exported.includes(s.name) && !s.parent).map(s => s.id);
      }
      if (matches.length || file.bindings.some(b => b.scope === scope && b.name === head)) return [];
      scope = file.scopes[scope];
    }
    // Sólo globals de scripts del mismo documento/panel; nunca unir por nombre entre módulos arbitrarios.
    return (byName.get(call.callee) || []).filter(s => !s.parent && s.kind === 'js' && (s.file === file.file || (file.source && index.files[s.file].source?.group === file.source.group))).map(s => s.id);
  }
  const edges = [];
  for (const file of files) for (const call of file.calls) {
    const targets = resolve(call, file);
    edges.push({ ...call, targets, evidence: call.rpc ? 'RPC literal' : call.sql ? 'nombre SQL local; revisar search_path' : 'resolución estática', state: targets.length === 1 ? 'única' : targets.length ? 'ambigua' : 'no resuelta' });
  }
  // Un salto por wrapper: fn parámetro -> .rpc(fn), invocado con literal. No inferir alias dinámicos.
  const wrappers = new Map();
  for (const edge of edges) if (edge.rpc && edge.rpcParam && edge.from) {
    const param = byId.get(edge.from)?.params.indexOf(edge.rpcParam);
    if (param >= 0) wrappers.set(edge.from, param);
  }
  const derived = [];
  const sqlNames = new Map(symbols.filter(s => s.kind === 'sql').flatMap(s => [[hash(s.name), s.name], [hash(s.name.replace(/^public\./, '')), s.name.replace(/^public\./, '')]]));
  for (const edge of edges) if (!edge.rpc && edge.targets.length === 1 && wrappers.has(edge.targets[0])) {
    const name = sqlNames.get(edge.literalHashes?.[wrappers.get(edge.targets[0])]);
    if (name) { const targets = sql(name); derived.push({ ...edge, callee: name, rpc: true, rpcName: name, targets, evidence: 'literal a wrapper RPC (1 salto)', state: targets.length === 1 ? 'única' : targets.length ? 'ambigua' : 'no resuelta' }); }
  }
  return { symbols, byId, byName, edges: [...edges, ...derived] };
}
function shortSymbol(symbol, index) {
  return { simbolo: symbol.name, ubicacion: symbol.file + ':' + symbol.line, hasta: symbol.endLine, tipo: symbol.kind,
    contrato: { parametros: symbol.params, ...(symbol.kind === 'sql' ? { devuelve: symbol.returns, despliegue: 'no verificado' } : { async: symbol.async }) },
    fuente: index.files[symbol.file].source ? { editable: symbol.file, generado: index.files[symbol.file].source.output } : { editable: symbol.file },
    sha256: index.files[symbol.file].hash };
}
function query(index, command, term, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 30)), depth = Math.max(1, Math.min(Number(options.depth) || 2, 5));
  const g = graph(index), omit = {};
  // First show business routes and RPCs. SQL builtins remain in the cached graph,
  // but must not displace actual local dependencies in a bounded task packet.
  const sqlBuiltins=new Set('coalesce nullif length upper lower trim btrim count sum min max exists greatest least jsonb_build_object jsonb_build_array jsonb_agg jsonb_array_elements jsonb_array_length jsonb_typeof to_jsonb now clock_timestamp statement_timestamp encode sha256 convert_to unnest cardinality array_agg array_position regexp_replace date_trunc extract floor abs'.split(' '));
  const relevant=edges=>edges.filter(e=>{
    const builtin=e.sql&&!e.targets.length&&sqlBuiltins.has(e.callee.replace(/^pg_catalog\./,'').toLowerCase());
    if(builtin)omit.operacionesSQL=(omit.operacionesSQL||0)+1;
    return !builtin;
  }).sort((a,b)=>(a.rpc?0:a.targets.length?1:2)-(b.rpc?0:b.targets.length?1:2));
  const bounded = (label, values) => { if (values.length > limit) omit[label] = (omit[label] || 0) + values.length - limit; return values.slice(0, limit); };
  const result = { consulta: command, termino: term || '', frescura: { sha256: index.fingerprint, parser: index.parser, archivos: Object.keys(index.files).length, cache: index.stats },
    limites: ['Análisis estático local; no demuestra despliegue, ejecución ni cobertura de pruebas.', 'Alias, callbacks, IPC, HTML onclick y llamadas dinámicas pueden requerir revisión manual.'], omitidos: omit };
  const locate = edge => ({ desde: edge.from ? g.byId.get(edge.from)?.name : '<nivel de archivo>', ubicacion: edge.file + ':' + edge.line,
    llama: edge.rpcName || edge.callee, tipo: edge.evidence, estado: edge.state,
    destinos: bounded('destinos', edge.targets.map(id => { const s = g.byId.get(id); return s.file + ':' + s.line; })) });
  function evidence(selected) {
    const names = new Set(selected.flatMap(s => [s.name, s.name.split('.').pop()]));
    const paths = new Set(selected.map(s => s.file));
    const contracts = unique(selected.flatMap(s => index.files[s.file].contracts));
    const tests = [], docs = [];
    for (const f of Object.values(index.files)) {
      const byPath = f.paths.some(p => [...paths].some(target => p.replace(/^(?:\.\.\/|\.\/)+/, '') === target || slash(path.normalize(path.join(path.dirname(f.file), p))) === target));
      const bySymbol = f.mentions.some(n => names.has(n));
      if (/(?:^|\/)tests?\//.test(f.file) && (byPath || bySymbol)) tests.push({ archivo: f.file, evidencia: byPath ? 'referencia de ruta' : 'identificador AST; revisar alcance', ejecucion: 'no ejecutada por esta consulta' });
      if (f.kind === 'doc') {
        const text = fs.readFileSync(local(index.root, f.file), 'utf8');
        if ([...names, ...contracts].some(name => name.length > 3 && text.includes(name))) docs.push({ archivo: f.file, evidencia: 'mención documental; no contrato validado' });
      }
    }
    return { pruebas: bounded('pruebas', tests), documentos: bounded('documentos', docs), versionesContrato: contracts };
  }
  if (command === 'changes') {
    let changed;
    try { changed = unique([...git(index.root, ['diff', '--name-only', '-z', options.since || 'HEAD']).split('\0'), ...git(index.root, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0')].filter(Boolean)); }
    catch { throw new Error('changes necesita un repositorio Git y una referencia válida (--since HEAD por defecto).'); }
    const sources = unique(changed.flatMap(p => index.manifest.generated[p] || [p]));
    const selected = g.symbols.filter(s => sources.includes(s.file) && !s.anonymous);
    return { ...result, cambios: bounded('cambios', changed.map(file => ({ archivo: file, ...(index.manifest.generated[file] ? { editar: index.manifest.generated[file] } : {}) }))),
      simbolos: bounded('simbolos', selected.map(s => shortSymbol(s, index))), ...evidence(selected),
      alcance: 'Archivos distintos de la referencia Git, incluidos staged, unstaged y no ignorados sin seguimiento; no es diff semántico por función.' };
  }
  if (!['symbol', 'flow', 'impact'].includes(command) || !term) throw new Error('Usá symbol, flow o impact con un símbolo, o changes. Consultá --help.');
  const [qualifier, name] = term.includes('::') ? term.split('::') : [null, term];
  let selected = g.symbols.filter(s => !s.anonymous && (!qualifier || s.file === slash(qualifier)) && (s.name === name || s.name === 'public.' + name));
  if (!selected.length) {
    result.coincidencias = bounded('coincidencias', g.symbols.filter(s => !s.anonymous && s.name.toLowerCase().includes(name.toLowerCase()) && (!qualifier || s.file === slash(qualifier))).map(s => ({ simbolo: s.name, ubicacion: s.file + ':' + s.line })));
    result.aviso = 'Sin símbolo exacto. Elegí archivo::simbolo; las coincidencias parciales no se expanden.'; return result;
  }
  selected = bounded('definiciones', selected);
  const selectedIds = new Set(selected.map(s => s.id));
  let related = [...selected], edges = [];
  if (command !== 'symbol') {
    let frontier = new Set(selectedIds), visited = new Set(selectedIds);
    for (let level = 0; level < depth; level++) {
      const batch = g.edges.filter(e => command === 'flow' ? frontier.has(e.from) : e.targets.some(id => frontier.has(id)));
      const next = new Set(); edges.push(...batch);
      for (const e of batch) for (const id of command === 'flow' ? e.targets : [e.from]) if (id && !visited.has(id)) { next.add(id); visited.add(id); }
      frontier = new Set([...next].slice(0, limit));
      if (next.size > limit) omit.expansion = (omit.expansion || 0) + next.size - limit;
    }
    related = [...visited].map(id => g.byId.get(id)).filter(Boolean);
    result.recorrido = bounded('recorrido', relevant(unique(edges)).map(locate));
    result.profundidad = depth;
  }
  result.definiciones = selected.map(s => shortSymbol(s, index));
  result.entrantes = bounded('entrantes', g.edges.filter(e => e.targets.some(id => selectedIds.has(id))).map(locate));
  result.salientes = bounded('salientes', relevant(g.edges.filter(e => selectedIds.has(e.from))).map(locate));
  result.rpc = bounded('rpc', g.edges.filter(e => e.rpc && related.some(s => s.id === e.from)).map(locate));
  Object.assign(result, evidence(related));
  result.avisos = unique(selected.flatMap(s => index.files[s.file].warnings));
  if (selected.length > 1) result.avisos.push('Varias definiciones locales; no se elige una implementación activa ni una migración desplegada.');
  if (options.code) {
    if (selected.length !== 1) result.avisos.push('--code requiere una definición única: usá archivo::simbolo.');
    else {
      const s = selected[0], text = fs.readFileSync(local(index.root, s.file), 'utf8');
      if (hash(text) !== index.files[s.file].hash) throw new Error('La fuente cambió durante la consulta. Repetí para recalcular el índice.');
      const block = text.slice(s.start, s.end);
      if (sensitive(block)) result.avisos.push('Bloque omitido: posible secreto literal. Revisar localmente.');
      else if (block.length > (Number(options.maxCode) || 6000)) result.avisos.push('Bloque omitido por tamaño; abrir la ubicación exacta o aumentar --max-code.');
      else result.codigo = { exacto: true, contenido: block };
    }
  }
  return result;
}
function format(result, maxChars = 12000) {
  maxChars = Math.max(2000, Math.min(Number(maxChars) || 12000, 100000));
  const copy = JSON.parse(JSON.stringify(result));
  let output = JSON.stringify(copy, null, 2);
  if (output.length <= maxChars) return output;
  delete copy.codigo;
  copy.limiteSalida = 'Salida acotada; usar archivo::simbolo, --limit o --max-chars para afinar.';
  const arrays = ['recorrido', 'entrantes', 'salientes', 'documentos', 'pruebas', 'rpc', 'simbolos', 'cambios', 'coincidencias', 'definiciones'];
  while ((output = JSON.stringify(copy, null, 2)).length > maxChars) {
    const key = arrays.find(key => Array.isArray(copy[key]) && copy[key].length > (key === 'definiciones' ? 1 : 0));
    if (!key) break;
    copy[key].pop(); copy.omitidos[key] = (copy.omitidos[key] || 0) + 1;
  }
  if (output.length > maxChars) return JSON.stringify({ consulta: copy.consulta, sha256: copy.frescura.sha256, aviso: 'El mínimo detalle supera --max-chars; aumentá el límite.', ubicaciones: (copy.definiciones || []).map(s => s.ubicacion), omitidos: copy.omitidos });
  return output;
}
function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || !args.length) {
    console.log('Consulta local de código (JSON acotado):\n  node scripts/contexto-codigo.cjs symbol [archivo::]simbolo [--code]\n  node scripts/contexto-codigo.cjs flow [archivo::]simbolo --depth 2\n  node scripts/contexto-codigo.cjs impact [archivo::]simbolo\n  node scripts/contexto-codigo.cjs changes [--since HEAD]\nOpciones: --limit 8 --max-chars 12000 --max-code 6000 --no-cache --root ruta\nCaché de metadatos fuera del repositorio, en el temporal del sistema.'); return;
  }
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) positional.push(arg);
    else if (arg === '--code') options.code = true;
    else if (arg === '--no-cache') options.noCache = true;
    else { const keys = { '--limit': 'limit', '--depth': 'depth', '--max-chars': 'maxChars', '--max-code': 'maxCode', '--since': 'since', '--root': 'root' }; if (!keys[arg] || !args[i + 1]) throw new Error('Opción inválida: ' + arg); options[keys[arg]] = args[++i]; }
  }
  const index = buildIndex(options);
  console.log(format(query(index, positional[0], positional[1], options), options.maxChars));
}
if (require.main === module) try { main(); } catch (error) { console.error('contexto-codigo: ' + error.message); process.exitCode = 1; }
module.exports = { buildIndex, query, format, graph, parseFile, sqlTokens, main };
