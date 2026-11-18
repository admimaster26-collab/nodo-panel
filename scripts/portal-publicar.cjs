// Arma el Portal que se publica, sin nada de desarrollo.
//
// Juan, 18/11: "hay que realizar limpieza absoluta del código del portal: hay información de desarrollo que
// no debería estar; el usuario no debe ver eso". Hasta ahora se subía una copia exacta del archivo `Portal`:
// cualquiera que abriera el código de la página veía ~650 líneas de comentarios internos (nombres, fechas,
// incidentes, funciones del servidor), los console.log y el bloque de pruebas con las rutas de TODAS las
// oficinas ("BORRAR ANTES DEL DEPLOY", decía, y nunca se borraba).
//
// El archivo `Portal` del repo sigue siendo la fuente, con sus comentarios para quien lo mantiene. Lo que se
// sube es lo que sale de acá:
//   · sin comentarios (JavaScript, CSS y HTML) ni console.*;
//   · producción además sin el modo pruebas (rutas de las oficinas, cartel PRUEBAS).
// El código no se reescribe: TypeScript sólo quita comentarios y las llamadas a console; se comprueba que cada
// script compile y que no quede nada de lo anterior.
//
// Uso: node scripts/portal-publicar.cjs   → dist/portal/produccion/index.html y dist/portal/prueba/index.html
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function sinConsole(context) {
  const f = context.factory;
  const esConsole = (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
    && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'console';
  const visit = (n) => {
    if (ts.isExpressionStatement(n) && esConsole(n.expression)) return f.createEmptyStatement();
    if (esConsole(n)) return f.createVoidZero();
    return ts.visitEachChild(n, visit, context);
  };
  return (sf) => ts.visitNode(sf, visit);
}

function limpiarJs(codigo) {
  const r = ts.transpileModule(codigo, {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.None,
      moduleDetection: ts.ModuleDetectionKind.Legacy, alwaysStrict: false },
    reportDiagnostics: true,
    transformers: { before: [sinConsole] }
  });
  const errores = (r.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errores.length) throw new Error('el script del Portal no se pudo leer: ' + ts.flattenDiagnosticMessageText(errores[0].messageText, ' '));
  return r.outputText;
}

function sinModoPruebas(html) {
  const ini = html.indexOf('MODO PRUEBAS · BORRAR ANTES DEL DEPLOY');
  const fin = html.indexOf('// ── fin del modo pruebas');
  if (ini < 0 || fin < 0) throw new Error('no encuentro el bloque del modo pruebas en el Portal');
  const desde = html.lastIndexOf('\n', html.lastIndexOf('\n', ini) - 1) + 1;   // la línea del recuadro de arriba
  const hasta = html.indexOf('\n', fin) + 1;
  return html.slice(0, desde) + 'const MODO_PRUEBA = null;\n' + html.slice(hasta);
}

function armar(fuente, { produccion }) {
  let html = fuente.replace(/\r\n/g, '\n');
  if (produccion) html = sinModoPruebas(html);
  // Los scripts y estilos se apartan para no tocar su contenido al sacar comentarios del HTML.
  const apartados = [];
  html = html.replace(/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi, (todo, attrs, cuerpo) => {
    const esJs = !/\bsrc\s*=/.test(attrs) && !/type\s*=\s*["']?(application\/(ld\+)?json|text\/template)/i.test(attrs);
    apartados.push(esJs && cuerpo.trim() ? '<script' + attrs + '>\n' + limpiarJs(cuerpo) + '</script>' : todo);
    return '\u0000' + (apartados.length - 1) + '\u0000';
  });
  html = html.replace(/<style(\b[^>]*)>([\s\S]*?)<\/style>/gi, (todo, attrs, cuerpo) => {
    apartados.push('<style' + attrs + '>' + cuerpo.replace(/\/\*[\s\S]*?\*\//g, '') + '</style>');
    return '\u0000' + (apartados.length - 1) + '\u0000';
  });
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n');
  return html.replace(/\u0000(\d+)\u0000/g, (_m, i) => apartados[Number(i)]);
}

// Lo que no puede quedar en lo publicado. Devuelve la lista de problemas (vacía = limpio).
function revisar(html, { produccion }) {
  const problemas = [];
  for (const m of html.matchAll(/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1]) || !m[2].trim()) continue;
    try { new vm.Script(m[2]); } catch (e) { problemas.push('un script no compila: ' + e.message); }
    if (/\bconsole\s*\.\s*(log|warn|info|debug|error|table|trace)\s*\(/.test(m[2])) problemas.push('quedó un console');
  }
  if (/<!--/.test(html)) problemas.push('quedó un comentario HTML');
  // Las notas internas tenían la forma «(Juan, 16/11)»; «Ej: Juan» es un ejemplo para el jugador y queda.
  if (/BORRAR ANTES DEL DEPLOY|Juan[,:]? *\d{1,2}\/\d{1,2}/.test(html)) problemas.push('quedó texto interno de desarrollo');
  if (produccion && /RUTAS_PRUEBA|PRUEBAS · /.test(html)) problemas.push('quedó el modo pruebas en producción');
  return problemas;
}

function main() {
  const fuente = fs.readFileSync(path.join(ROOT, 'Portal'), 'utf8');
  const salidas = [['produccion', true], ['prueba', false]];
  for (const [nombre, produccion] of salidas) {
    const html = armar(fuente, { produccion });
    const problemas = revisar(html, { produccion });
    if (problemas.length) { console.error('Portal (' + nombre + ') NO se armó:\n  · ' + problemas.join('\n  · ')); process.exit(1); }
    const dir = path.join(ROOT, 'dist', 'portal', nombre);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    console.log('Portal ' + nombre + ': ' + path.relative(ROOT, path.join(dir, 'index.html')) + ' · '
      + Math.round(fuente.length / 1024) + ' KB → ' + Math.round(html.length / 1024) + ' KB');
  }
}

if (require.main === module) main();
module.exports = { armar, revisar, limpiarJs, sinModoPruebas };
