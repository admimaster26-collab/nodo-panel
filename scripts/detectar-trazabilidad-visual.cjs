#!/usr/bin/env node
'use strict';

// Detecta visualizaciones declaradas que no tienen un camino estático hasta el
// template o un escritor DOM. Es un detector de candidatos: no certifica que
// una rama condicional se ejecute ni reemplaza una prueba de pantalla.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'renderer', 'manifest.json');
const TEMPLATE = path.join(ROOT, 'renderer', 'panel.template.html');
const OUT_ARG = process.argv.find(arg => arg.startsWith('--report='));

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function codeBefore(text, offset) {
  return text.slice(0, offset)
    .replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length))
    .replace(/\/\/[^\r\n]*/g, match => ' '.repeat(match.length))
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, match => ' '.repeat(match.length));
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function sourceFiles() {
  const manifest = JSON.parse(read(MANIFEST));
  return (manifest.blocks || [])
    .filter(block => block.type === 'script')
    .flatMap(block => (block.sources || []).map(source => path.join(ROOT, 'renderer', source)));
}

function cardinalityFindings() {
  const findings = [];
  const files = [
    ...sourceFiles(),
    path.join(ROOT, 'servidor', 'dominios', 'perfil-v1.sql'),
  ].filter(fs.existsSync);
  for (const file of files) {
    const text = read(file);
    const relFile = rel(file);
    const patterns = [
      {
        re: /Object\.values\(\s*[^)]*titulares[^)]*\s*\)\s*\[\s*0\s*\]/gi,
        evidence: 'Reduce la colección local de titulares al primer elemento.',
      },
      {
        re: /array_agg\([^;]*?\)\s*\)\s*\[\s*1\s*\]\s*titular\b/gi,
        evidence: 'Reduce un agregado de titulares al primer elemento antes de entregarlo al cliente.',
      },
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern.re)) {
        findings.push({
          categoria: 'CARDINALIDAD_REDUCIDA',
          severidad: 'ALTA',
          archivo: relFile,
          linea: lineAt(text, match.index),
          simbolo: 'titular',
          evidencia: pattern.evidence,
          comprobacion: 'Comparar cantidad de titulares de entrada con los que llegan a la vista.',
        });
      }
    }
  }
  return findings;
}

function functionsIn(file, text) {
  const result = [];
  const patterns = [
    /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/g,
    /(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const name = match[1];
      const scopeDepth = (codeBefore(text, start).match(/[{}]/g) || []).reduce((depth, token) => depth + (token === '{' ? 1 : -1), 0);
      const bodyStart = text.indexOf('{', start);
      if (bodyStart < 0) continue;
      let depth = 0;
      let end = bodyStart;
      for (; end < text.length; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      const body = text.slice(bodyStart, end + 1);
      result.push({
        name,
        file: rel(file),
        line: lineAt(text, start),
        body,
        scopeDepth,
        key: `${rel(file)}:${name}:${lineAt(text, start)}`,
      });
    }
  }
  return result;
}

function unique(items, key) {
  const seen = new Set();
  return items.filter(item => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function audit() {
  const template = read(TEMPLATE);
  const files = sourceFiles();
  const allText = files.map(read).join('\n');
  const funcs = unique(files.flatMap(file => functionsIn(file, read(file))), item => item.key);
  const names = new Map();
  for (const fn of funcs) {
    if (!names.has(fn.name)) names.set(fn.name, []);
    names.get(fn.name).push(fn);
  }

  const templateIds = [...template.matchAll(/\bid=["']([A-Za-z][\w:-]*)["']/g)].map(match => match[1]);
  const sourceIds = [...allText.matchAll(/\bid\s*=\s*['"`]([A-Za-z][\w:-]*)['"`]/g)].map(match => match[1]);
  const assignedIds = [...allText.matchAll(/\.id\s*=\s*['"`]([A-Za-z][\w:-]*)['"`]/g)].map(match => match[1]);
  const domIds = new Set([...templateIds, ...sourceIds, ...assignedIds]);
  const dynamicIdPrefixes = [...allText.matchAll(/\bid\s*=\s*['"`]([A-Za-z][\w:-]*)(?:['"`]\s*\+|\$\{)/g)].map(match => match[1]);
  const ignoredNames = new Set(['create', 'fila', 'pintar', 'installCss', 'ensureCss', 'renderMacrosPanel', 'onload', 'onerror']);
  const visual = funcs.filter(fn => /innerHTML|insertAdjacentHTML|appendChild|replaceChildren|createElement|return\s+['"`][\s\S]*<(?:div|section|article|button|table|span)\b/i.test(fn.body));

  const findings = cardinalityFindings();
  for (const fn of visual) {
    const bodyWithoutDefinition = allText.replace(fn.body, '');
    const sourceReferences = (bodyWithoutDefinition.match(new RegExp(`\\b${fn.name}\\s*\\(`, 'g')) || []).length;
    const templateReferences = (template.match(new RegExp(`\\b${fn.name}\\s*\\(`, 'g')) || []).length;
    const references = sourceReferences + templateReferences;
    const writesDom = /innerHTML|insertAdjacentHTML|appendChild|replaceChildren|createElement/.test(fn.body);
    const returnedHtml = /return\s+['"`][\s\S]*<(?:div|section|article|button|table|span)\b/i.test(fn.body);
    const ids = [...fn.body.matchAll(/\bgetElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
    const missingIds = ids.filter(id => !domIds.has(id) && !dynamicIdPrefixes.some(prefix => id.startsWith(prefix)));
    const duplicate = (names.get(fn.name) || []).length > 1;
    const callbackName = /^(onload|onerror|onclick|onchange|oninput|onsubmit|onmessage)$/.test(fn.name);
    const topLevel = fn.scopeDepth === 0;
    const wrapped = new RegExp(`(?:old|prev|original|base)[A-Za-z_$]*\\s*=\\s*(?:window\\.)?${fn.name}\\b`).test(allText);
    if (!topLevel || ignoredNames.has(fn.name)) continue;

    if (returnedHtml && references === 0) {
      findings.push({
        categoria: 'VISUAL_SIN_MONTAJE',
        severidad: 'ALTA',
        archivo: fn.file,
        linea: fn.line,
        simbolo: fn.name,
        evidencia: 'La función devuelve HTML, pero no se encontró ningún llamador fuera de su propia definición.',
        ids,
      });
    } else if (writesDom && missingIds.length && /window\.chunior\.exec|#result_list|\.paginator/.test(fn.body)) {
      findings.push({
        categoria: 'VISUAL_DESTINO_REMOTO',
        severidad: 'INFO',
        archivo: fn.file,
        linea: fn.line,
        simbolo: fn.name,
        evidencia: `El destino ${missingIds.join(', ')} pertenece a una ventana o página remota, no al template local.`,
        ids: missingIds,
      });
    } else if (writesDom && missingIds.length) {
      findings.push({
        categoria: 'VISUAL_DESTINO_AUSENTE',
        severidad: 'ALTA',
        archivo: fn.file,
        linea: fn.line,
        simbolo: fn.name,
        evidencia: `Escribe DOM usando ${missingIds.join(', ')}, pero esos contenedores no están declarados en la plantilla.`,
        ids: missingIds,
      });
    } else if (duplicate && !callbackName && !wrapped) {
      findings.push({
        categoria: 'VISUAL_PISADA',
        severidad: 'MEDIA',
        archivo: fn.file,
        linea: fn.line,
        simbolo: fn.name,
        evidencia: 'El mismo productor visual tiene más de una definición en el panel; una versión puede reemplazar a la otra.',
        definiciones: names.get(fn.name).map(item => `${item.file}:${item.line}`),
      });
    }
  }

  return {
    contrato: 'nodo.trazabilidad-visual.v1',
    alcance: { fuentes: files.map(rel), contenedores_template: domIds.size, productores_visual: visual.length },
    resumen: findings.reduce((out, item) => {
      out[item.categoria] = (out[item.categoria] || 0) + 1;
      return out;
    }, {}),
    hallazgos: findings,
  };
}

const result = audit();
const output = JSON.stringify(result, null, 2);
if (OUT_ARG) {
  fs.mkdirSync(OUT_ARG.slice('--report='.length), { recursive: true });
  fs.writeFileSync(path.join(OUT_ARG.slice('--report='.length), 'trazabilidad-visual.json'), output + '\n');
}
console.log(output);
