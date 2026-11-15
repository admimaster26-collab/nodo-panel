const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// agent-preload.js está en Windows-1252 (tiene acentos de antes): se lee así a propósito.
const PRELOAD = fs.readFileSync(path.join(ROOT, 'agent-preload.js'), 'latin1');
const PRELOAD_BET300 = fs.readFileSync(path.join(ROOT, 'agent-preload-bet300.js'), 'utf8');

// La sección "Contacto por Whatsapp" de bo.casinodrex.com/agents/features, tal como la sirve
// el backoffice (React + MUI), con el número cambiado por uno inventado: el repo es público.
// Si el backoffice cambia su HTML, este test es el que avisa dónde mirar.
const PANTALLA_REAL = `
<p class="mt-0 ms-0 fs-4 fw-bold">Contacto por Whatsapp</p>
<div class="col-12"><div><label class="MuiFormControlLabel-root MuiFormControlLabel-labelPlacementEnd css-1jaw3da">
<span class="MuiButtonBase-root MuiCheckbox-root Mui-checked css-gu9632">
<input class="PrivateSwitchBase-input css-1m9pwf3" type="checkbox" data-indeterminate="false" checked="">
</span><span class="MuiTypography-root MuiFormControlLabel-label css-6179kh">Permite que tus jugadores te contacten por Whatsapp</span></label>
<p class="mt-0 ms-4 fst-italic fs-7">(El sitio web mostrará un botón con tu WhatsApp para que tus jugadores puedan contactarte)</p></div>
<div class="mt-4"><form id="Form_WhatsappContact" novalidate="">
<div class="MuiFormControl-root MuiTextField-root css-i44wyl">
<label class="MuiFormLabel-root MuiInputLabel-root css-1qebely" data-shrink="true" for=":rd:" id=":rd:-label">Whatsapp</label>
<div class="MuiInputBase-root MuiOutlinedInput-root css-1v7ho83">
<input aria-invalid="false" autocomplete="phone" id=":rd:" type="text" data-parsley-validate-whatsapp-phone="true"
 data-parsley-validate-whatsapp-phone-message="Formato de número de teléfono incorrecto. Usa el formato E.164 sin espacios (ej.  123456789)"
 class="MuiInputBase-input css-1pog434" value="5491100000001">
</div></div></form><button class="btn btn-primary mt-1">Guardar</button></div></div>`;

// Los selectores que el preload declara, en orden.
function selectoresDelPreload() {
  const bloque = PRELOAD.slice(PRELOAD.indexOf('function _wsInput'), PRELOAD.indexOf('function _wsHabilitado'));
  return [...bloque.matchAll(/'([^']*(?:Form_WhatsappContact|parsley)[^']*)'/g)].map(m => m[1]);
}

test('el preload busca el numero con selectores que la pantalla real cumple', () => {
  const sels = selectoresDelPreload();
  assert.ok(sels.length >= 2, 'tiene que haber más de un selector: si el backoffice mueve algo, hay de dónde agarrarse');

  // Cada selector se descompone en las piezas que tiene que encontrar en el HTML.
  const cumple = sel => {
    const id = sel.match(/#([\w-]+)/);
    const attr = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    if (id && !PANTALLA_REAL.includes('id="' + id[1] + '"')) return false;
    return attr.every(([, nombre, valor]) =>
      PANTALLA_REAL.includes(valor === undefined ? nombre + '=' : nombre + '="' + valor + '"'));
  };

  const sirven = sels.filter(cumple);
  assert.ok(sirven.length >= 1, 'ningún selector del preload encuentra el campo en la pantalla real: ' + sels.join(' | '));
  // El primero es el más específico y es el que debería andar.
  assert.ok(cumple(sels[0]), 'el selector principal ya no sirve: ' + sels[0]);
});

test('el preload reconoce el checkbox por el texto que la pantalla real usa', () => {
  const bloque = PRELOAD.slice(PRELOAD.indexOf('function _wsHabilitado'), PRELOAD.indexOf('async function leerWhatsappOficina'));
  const re = bloque.match(/\/([^/]+)\/i\.test/);
  assert.ok(re, 'no encontré la expresión con la que busca la etiqueta del checkbox');

  // La etiqueta real: "Permite que tus jugadores te contacten por Whatsapp".
  const etiqueta = 'Permite que tus jugadores te contacten por Whatsapp';
  assert.ok(PANTALLA_REAL.includes(etiqueta));
  assert.match(etiqueta, new RegExp(re[1], 'i'), 'la expresión del preload ya no matchea la etiqueta real');
});

// 15/11: la primera versión leia con un iframe oculto. Medido contra la pagina real: 21
// segundos y el iframe nunca entrega documento, el backoffice no se deja enmarcar. Queda como
// prueba para que no vuelva: ni iframe, ni navegacion desde el preload.
test('el preload lee la pantalla: ni iframe ni navegacion', () => {
  const bloque = PRELOAD.slice(PRELOAD.indexOf('async function leerWhatsappOficina'), PRELOAD.indexOf('const api = {'));
  // Navegar la ventana descarga la pagina que el operador esta usando y mata la propia
  // llamada: el preload ya tiene ese error documentado como D-101. Navega main, antes de llamar.
  assert.doesNotMatch(bloque, /location\.(assign|replace)\s*\(/, 'no puede navegar: navega main (D-101)');
  assert.doesNotMatch(bloque, /location(\.href)?\s*=[^=]/, 'no puede asignarle la URL a location (D-101)');
  assert.doesNotMatch(bloque, /iframe/i, 'el iframe no funciona contra este backoffice: no vuelve');
  // Si no esta en la pantalla, lo dice con un motivo propio y no lo confunde con "no hay numero".
  assert.match(bloque, /OTRA_PANTALLA/);
  assert.match(bloque, /\/agents\/features/);
  // Y lee del documento vivo.
  assert.match(bloque, /_wsInput\(document\)/);
});

// La navegacion la hace main, como con buscarUsuario y obtenerSaldoAgente. Y solo si se la
// piden: el repaso de fondo no le puede mover la pantalla al operador para mirar un numero.
test('main lleva la ventana a la pantalla del WhatsApp, y solo cuando se lo piden', () => {
  const automation = fs.readFileSync(path.join(ROOT, 'main', 'automation.js'), 'utf8');
  const linea = automation.slice(automation.indexOf("method === 'leerWhatsappOficina'"));
  assert.ok(linea, 'automation.js no sabe de leerWhatsappOficina');
  assert.match(linea.slice(0, 400), /args\[0\][\s\S]{0,60}navegar/, 'tiene que mirar el pedido de navegar');
  assert.match(linea.slice(0, 400), /whatsappUrl/, 'la URL sale del backend, no escrita a mano');
  assert.match(linea.slice(0, 400), /agents\.ready\(win\)/, 'sin pedido de navegar, no se mueve nada');

  const backends = fs.readFileSync(path.join(ROOT, 'main', 'agent-backends.js'), 'utf8');
  assert.match(backends, /whatsappUrl:\s*'https:\/\/bo\.casinodrex\.com\/agents\/features'/);
  assert.match(backends, /whatsappUrl:\s*null/, 'bet300 no tiene esa pantalla y hay que decirlo');
});

test('el preload se corre del paso si la ventana esta sin sesion', () => {
  const bloque = PRELOAD.slice(PRELOAD.indexOf('async function leerWhatsappOficina'), PRELOAD.indexOf('const api = {'));
  assert.match(bloque, /_loginEnCurso/);
  assert.match(bloque, /pageNeedsLogin\(\)/);
  assert.match(bloque, /needsLogin/, 'si la sesión se cayó lo tiene que decir, no devolver vacío');
  // 15/11, medido en el NODO real: con esta guarda NUNCA leia. El ipc sube _opsEnCurso para
  // todos los metodos, incluido este, asi que mirarlo aca es bloquearse a uno mismo. El codigo
  // ya lo tenia escrito en irABusquedaUsuarios y se piso igual.
  const sinComentarios = bloque.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(sinComentarios, /_opsEnCurso/,
    'mirar _opsEnCurso aca es bloquearse solo: el ipc ya lo subio por esta misma llamada');
});

// Y como la guarda propia no sirve, el que no la deja cruzarse con una carga o un retiro es el
// panel: la misma cola del watchdog. Si eso se cae, la lectura puede navegar en mal momento.
test('la lectura va por la cola del panel, que es la que frena durante una operacion', () => {
  const modulo = fs.readFileSync(path.join(ROOT, 'renderer', 'extensions', 'oficina-whatsapp.js'), 'utf8');
  assert.match(modulo, /_drexEncolar/, 'tiene que pasar por la cola, como el watchdog con las fichas');
  assert.match(modulo, /_colaOcupada\(\)/, 'y saltear la vuelta si hay algo en curso');
  assert.match(modulo, /silencioso:\s*true/, 'es de fondo: no le tira carteles al operador');
});

test('los dos backoffices contestan al mismo metodo', () => {
  for (const [nombre, fuente] of [['casinodrex', PRELOAD], ['bet300', PRELOAD_BET300]]) {
    assert.match(fuente, /leerWhatsappOficina/, nombre + ' no expone el método');
    const api = fuente.slice(fuente.indexOf('const api = {'), fuente.indexOf('const api = {') + 700);
    assert.match(api, /leerWhatsappOficina,/, nombre + ' no lo agregó al api, así que el puente lo rechaza');
  }
  // bet300 no tiene esa pantalla: tiene que decirlo con un motivo, no tirar un error.
  assert.match(PRELOAD_BET300, /OTRO_BACKOFFICE/);
});

// 15/11: el módulo nunca leyó el backoffice ni una vez y mostraba "no lo puedo revisar solo".
// No era el preload: el puente del panel tiene lista blanca y el método no estaba. Desde el
// renderer eso sale como "Método no permitido", que nadie mira. Esta prueba cierra ese agujero.
test('el puente del panel deja pasar el metodo: si no, no se llama nunca', () => {
  const puente = fs.readFileSync(path.join(ROOT, 'app-preload.js'), 'utf8');
  const lista = puente.match(/ALLOWED_AUTOMATION_METHODS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(lista, 'no encontré la lista blanca del puente');
  assert.match(lista[1], /'leerWhatsappOficina'/,
    'el preload lo expone pero el puente lo rechaza: la llamada muere antes de salir del panel');
});

test('leer el numero NO cuenta como operacion: no puede limpiar un freno anterior', () => {
  const linea = PRELOAD.match(/const METODOS_OPERACION = new Set\(\[([^\]]*)\]\)/);
  assert.ok(linea, 'no encontré METODOS_OPERACION');
  assert.doesNotMatch(linea[1], /leerWhatsappOficina/,
    'si entra acá, pedir el número borraría el freno de un ⛔ anterior');
});
