// Congelamiento al abrir un chat (Sánchez, 19/11): sin clave de Gemini, analizarComprobanteConGemini devolvía
// { error: "sin_clave" } sin guardarlo, y el .finally() de renderBannerSolicitud volvía a pintar y a llamarla,
// una y otra vez, sin ceder nunca el control a la pantalla.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat', 'chat-solicitud-preview.js'), 'utf8');

test('sin clave de IA el resultado se guarda en ocrCache (si no, el banner se vuelve a pintar sin parar)', () => {
  const i = src.indexOf('if(!GEMINI_API_KEY){');
  assert.ok(i > 0, 'no se encontró la guarda de la clave');
  const bloque = src.slice(i, src.indexOf('if(!urlOBase64) return null;', i));
  assert.match(bloque, /ocrCache\.set\(urlOBase64, sinClave\)/);
  assert.match(bloque, /return sinClave/);
});

test('el banner sólo pide el análisis si todavía no hay resultado guardado', () => {
  assert.match(src, /ocr = ocrCache\.get\(comprobanteUrl\) \|\| null;\s*\n\s*if\(!ocr\)\{\s*\n\s*analizarComprobanteConGemini\(comprobanteUrl\)\.finally/);
});
