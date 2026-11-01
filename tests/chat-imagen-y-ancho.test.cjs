const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ancho = require('../renderer/chat/chat-redimensionable.js');

// Lo que el operador ve del comprobante, y hasta dónde puede estirar el chat.
//
// Juan, 25/10: "agranda la vista previa para que en cualquier formato de vista no se desencaje y
// se vea a relativa simple vista la informacion · no se aprecia un carajo lo que mierda envia el
// usuario" · "poder estirar el chat hasta donde el operador quiera... que tenga un tamaño minimo
// y un tamaño maximo para que no haya errores".
//
// La vista previa era una caja de 220×180 con `object-fit:cover`. `cover` RECORTA: de un
// comprobante de transferencia, que es alto y angosto, se veía una tira del medio — ni el monto
// ni el titular ni la hora.

// ── Se ejecuta el código que arma el HTML, no se lo lee ───────────────────────────────────
function armarImg(archivo, extras) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat', archivo), 'utf8');
  const linea = src.split(/\r?\n/).find(l => /const imgHtml\s*=/.test(l));
  assert.ok(linea, 'no esta la linea que arma la imagen en ' + archivo);

  const ctx = Object.assign({
    E: (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    NodoChatMessage: { author: () => "D'Angelo" },
    m: {}, fresh: { usuario: 'jugador_chat' },
    __out: null
  }, extras || {});
  vm.createContext(ctx);
  vm.runInContext(linea + '\n;__out=imgHtml;', ctx);
  return ctx.__out;
}

const LOS_DOS = ['chat-hilos.js', 'chat-local.js'];

for (const archivo of LOS_DOS) {
  test(archivo + ' · la vista previa no recorta y ocupa el ancho', () => {
    const html = armarImg(archivo, { imgSrc: 'https://sb.co/comprobante.png' });
    assert.doesNotMatch(html, /object-fit:\s*cover/, 'cover recorta el comprobante');
    assert.doesNotMatch(html, /max-width:\s*220px/, 'el ancho fijo de 220px era el problema');
    assert.match(html, /max-width:\s*100%/, 'tiene que seguir el ancho de la burbuja');
    assert.match(html, /height:\s*auto/, 'sin height:auto se deforma');
    assert.match(html, /class="wq2-img"/, 'la burbuja se ensancha por esta clase');
  });

  test(archivo + ' · se puede abrir en la ventana aparte', () => {
    const html = armarImg(archivo, { imgSrc: 'https://sb.co/comprobante.png' });
    assert.match(html, /onclick=/, 'sin clic no hay forma de agrandarla');
    assert.match(html, /nodoVerImagenCompleta\(this\.src/,
      'la url se lee de this.src, no se escribe adentro del onclick');
  });

  test(archivo + ' · una url con comilla no parte el boton', () => {
    // E() escribe la comilla como &#39;, que el navegador vuelve a convertir en comilla ANTES de
    // que lo lea el JavaScript: interpolada adentro del onclick, cerraba el argumento.
    const html = armarImg(archivo, { imgSrc: "https://sb.co/a'b.png" });
    const onclick = (html.match(/onclick="([^"]*)"/) || [])[1] || '';
    assert.ok(onclick, 'no se pudo leer el onclick');
    assert.doesNotMatch(onclick, /&#39;|'b\.png/,
      'la url no tiene que aparecer adentro del onclick: ' + onclick);
  });
}

test('chat-hilos · el nombre del que mando la foto viaja por un atributo', () => {
  const html = armarImg('chat-hilos.js', { imgSrc: 'https://sb.co/c.png' });
  // "D'Angelo" escapado queda como D&#39;Angelo: correcto adentro de un atributo, veneno
  // adentro de un onclick.
  assert.match(html, /data-titulo="D&#39;Angelo"/);
  assert.match(html, /this\.dataset\.titulo/);
});

// ── El ancho del chat ─────────────────────────────────────────────────────────────────────
// Ventana de 1920: el techo es 900 (el máximo) porque 1920-426 = 1494 es más grande.
// Ventana de 1280: el techo pasa a ser 1280-426 = 854, y manda ese.

test('respeta el minimo y el maximo', () => {
  assert.equal(ancho.limpiar(50,   1920, 300, 900), 300, 'un chat de 50px no sirve para nada');
  assert.equal(ancho.limpiar(5000, 1920, 300, 900), 900, 'no puede crecer sin fin');
  assert.equal(ancho.limpiar(620,  1920, 300, 900), 620, 'en el medio manda el operador');
});

test('la columna de la izquierda nunca queda en cero', () => {
  // Esto es lo que Juan llamó "que no haya errores": arrastrando hasta el borde, la bandeja y
  // las billeteras desaparecían y no había forma de volver atrás.
  const r = ancho.limpiar(900, 1280, 300, 900);
  assert.equal(r, 1280 - ancho.RESERVA_IZQ);
  assert.ok(1280 - r >= ancho.RESERVA_IZQ, 'le queda lugar a la bandeja');
});

test('en una ventana muy chica manda el minimo', () => {
  // Con 600px de ventana el techo daría 174, menos que el piso. Antes que un chat de 174px
  // —inusable— se prefiere apretar la izquierda.
  assert.equal(ancho.limpiar(800, 600, 300, 900), 300);
});

test('basura guardada no rompe nada', () => {
  for (const malo of [null, undefined, '', 'ancho', NaN, {}]) {
    assert.equal(ancho.limpiar(malo, 1920, 300, 900), null, String(malo));
  }
  assert.equal(ancho.limpiar('620', 1920, 300, 900), 620, 'un numero en texto si vale');
});

test('siempre devuelve un entero', () => {
  assert.equal(ancho.limpiar(620.7, 1920, 300, 900), 621);
  assert.equal(Number.isInteger(ancho.limpiar(405.4, 1920, 300, 900)), true);
});
