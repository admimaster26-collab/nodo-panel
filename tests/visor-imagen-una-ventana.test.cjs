const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createImageWindowService } = require('../main/image-window.js');

// El visor de imágenes abre en una VENTANA APARTE, y una sola.
//
// Juan, 25/10: "el visualizador, si queda profesional, el problema es que estorba, cualquier cosa
// que se despliegue asi de esa manera estorba en aceptar otras cargas... es mas logico que se
// despliegue en otra ventana a pesar de que puede llenar la memoria al desplegar varias ventanas,
// deberias de dejar un maximo de 1, que la anterior muera antes de redesplegarse otra."
//
// El tope de una no puede depender de que el operador cierre la anterior: en una tarde mira
// decenas de comprobantes. Lo tiene que garantizar el código, y eso es lo que se prueba acá —
// ejecutando el servicio con una ventana de mentira, no leyendo el archivo.

function banco() {
  const creadas = [];
  function VentanaFalsa(opciones) {
    this.opciones = opciones;
    this.destruida = false;
    this.mostrada  = false;
    this.cargo     = null;
    this.enviado   = [];
    this._alCargar = null;
    const self = this;
    this.webContents = {
      once: (evento, cb) => { if (evento === 'did-finish-load') self._alCargar = cb; },
      on:   () => {},
      send: (canal, payload) => self.enviado.push({ canal, payload }),
      setWindowOpenHandler: () => {}
    };
    this.loadFile    = (p) => { self.cargo = p; };
    this.on          = () => {};
    this.show        = () => { self.mostrada = true; };
    this.isDestroyed = () => self.destruida;
    this.destroy     = () => { self.destruida = true; };
    creadas.push(this);
  }
  const servicio = createImageWindowService({
    BrowserWindow: VentanaFalsa, ipcMain: null, rootDir: '/nodo', icon: 'icono.png'
  });
  return { servicio, creadas };
}

test('abre una ventana y le manda la imagen recien cuando termino de cargar', () => {
  const { servicio, creadas } = banco();
  const r = servicio.abrir('https://sb.co/storage/comprobante.png', 'jugador_chat');

  assert.equal(r.ok, true);
  assert.equal(creadas.length, 1);
  const v = creadas[0];

  // La url NO viaja en la página que se carga: se manda por IPC después.
  assert.match(String(v.cargo), /visor-imagen\.html$/);
  assert.doesNotMatch(String(v.cargo), /comprobante\.png/);
  assert.equal(v.enviado.length, 0, 'todavia no cargo: no se manda nada');
  assert.equal(v.mostrada, false, 'no se muestra vacia');

  v._alCargar();   // la ventana termina de cargar

  assert.deepEqual(v.enviado, [{ canal: 'visor:cargar', payload: { url: 'https://sb.co/storage/comprobante.png', titulo: 'jugador_chat' } }]);
  assert.equal(v.mostrada, true);
});

test('la anterior MUERE antes de que nazca la nueva', () => {
  const { servicio, creadas } = banco();
  servicio.abrir('https://sb.co/uno.png');
  servicio.abrir('https://sb.co/dos.png');
  servicio.abrir('https://sb.co/tres.png');

  assert.equal(creadas.length, 3, 'se creo una por cada clic');
  assert.deepEqual(creadas.map(v => v.destruida), [true, true, false],
    'solo la ultima sigue viva');
});

test('veinte comprobantes seguidos dejan UNA ventana', () => {
  const { servicio, creadas } = banco();
  for (let i = 0; i < 20; i++) servicio.abrir('https://sb.co/c' + i + '.png');
  assert.equal(creadas.filter(v => !v.destruida).length, 1);
});

test('acepta https y data:image, y nada mas', () => {
  const { servicio, creadas } = banco();
  assert.equal(servicio.abrir('https://sb.co/ok.png').ok, true);
  assert.equal(servicio.abrir('data:image/png;base64,iVBORw0KGgo=').ok, true);
  const vivas = creadas.length;

  // Lo que llega acá viene de una fila del chat, o sea de afuera. Si alguna vez entrara un
  // "javascript:", abrirlo en una ventana nuestra seria ejecutarlo.
  for (const malo of ['javascript:alert(1)', 'file:///C:/Windows/win.ini',
                      'http://sb.co/sin-tls.png', 'data:text/html,<script>x</script>',
                      '', null, undefined, '   ']) {
    const r = servicio.abrir(malo);
    assert.equal(r.ok, false, 'no deberia abrir: ' + String(malo));
    assert.equal(r.message, 'URL_NO_VALIDA');
  }
  assert.equal(creadas.length, vivas, 'ninguna url rara llego a crear una ventana');
});

test('una url invalida NO mata la ventana que ya estaba', () => {
  const { servicio, creadas } = banco();
  servicio.abrir('https://sb.co/buena.png');
  servicio.abrir('javascript:alert(1)');
  assert.equal(creadas.length, 1);
  assert.equal(creadas[0].destruida, false,
    'si la nueva no se puede abrir, el operador se queda con la que estaba mirando');
});

test('la ventana tiene un tamaño minimo para que no se pisen los controles', () => {
  // Los controles de acercar flotan abajo al centro; por debajo de este mínimo la ventana queda
  // tan angosta que se montan sobre la imagen entera.
  const { servicio, creadas } = banco();
  servicio.abrir('https://sb.co/ok.png');
  const o = creadas[0].opciones;
  assert.ok(o.minWidth  >= 400, 'minWidth: ' + o.minWidth);
  assert.ok(o.minHeight >= 300, 'minHeight: ' + o.minHeight);
});

test('el visor corre aislado: contextIsolation, sandbox, sin nodeIntegration ni webview', () => {
  const { servicio, creadas } = banco();
  servicio.abrir('https://sb.co/ok.png');
  const w = creadas[0].opciones.webPreferences;
  assert.equal(w.contextIsolation, true);
  assert.equal(w.nodeIntegration, false);
  assert.equal(w.sandbox, true);
  assert.equal(w.webviewTag, false);
  assert.match(String(w.preload), /visor-imagen-preload\.js$/);
});

test('cerrar deja todo limpio y se banca que la llamen de mas', () => {
  const { servicio, creadas } = banco();
  servicio.abrir('https://sb.co/ok.png');
  servicio.cerrar();
  assert.equal(creadas[0].destruida, true);
  servicio.cerrar();   // sin ventana viva: no tiene que explotar
  assert.equal(servicio.current, null);
});

// ── EL TÍTULO DE LA VENTANA ES EL NOMBRE, A SECAS ───────────────────────────────────────────────
//
// Juan, sobre el visor: "reitero que se sigue sin poder agrandar las imagenes, anteriormente se
// podia y es redundante la informacion, no tiene sentido." La información redundante era la barra
// de adentro: repetía el nombre y las medidas, y un "Cerrar" cuando la ventana ya tiene su X.
// El nombre del jugador queda UNA sola vez, en la barra de título de la ventana.

test('el titulo de la ventana es el nombre del jugador a secas, sin prefijo', () => {
  const { servicio, creadas } = banco();
  servicio.abrir('https://sb.co/ok.png', '  jugador_chat ');
  assert.equal(creadas[0].opciones.title, 'jugador_chat');
});

test('sin nombre el titulo de la ventana es "Imagen"', () => {
  const { servicio, creadas } = banco();
  servicio.abrir('https://sb.co/a.png');
  servicio.abrir('https://sb.co/b.png', '');
  servicio.abrir('https://sb.co/c.png', '   ');
  servicio.abrir('https://sb.co/d.png', null);
  assert.deepEqual(creadas.map(v => v.opciones.title), ['Imagen', 'Imagen', 'Imagen', 'Imagen']);
});

// ── LA PÁGINA DEL VISOR ─────────────────────────────────────────────────────────────────────────
// Se lee el html tal cual viaja en el instalador, y más abajo se EJECUTA su script.

const HTML = fs.readFileSync(path.join(__dirname, '..', 'main', 'visor-imagen.html'), 'utf8');

test('el visor no tiene barra interna: nada de nombre, medidas ni boton Cerrar adentro', () => {
  assert.doesNotMatch(HTML, /<header[\s>]/i, 'sobra el <header>');
  for (const id of ['quien', 'medidas', 'btnCerrar', 'btnZoom']) {
    assert.doesNotMatch(HTML, new RegExp('id="' + id + '"'), 'sobra #' + id);
    assert.doesNotMatch(HTML, new RegExp('getElementById\\(\'' + id + '\'\\)'), 'el script sigue pidiendo #' + id);
  }
  // El título inicial es neutro; el nombre llega después por el canal y se pone en document.title.
  assert.match(HTML, /<title>Imagen<\/title>/);
});

test('la politica de seguridad del visor sigue tal cual', () => {
  const m = /<meta http-equiv="Content-Security-Policy"\s+content="([^"]*)">/.exec(HTML);
  assert.ok(m, 'falta la meta de Content-Security-Policy');
  assert.equal(m[1], "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
});

test('acercar es un transform sobre la misma imagen: nada de recargas ni de tamaños en el CSS', () => {
  assert.match(HTML, /transform-origin:\s*0 0/);
  assert.match(HTML, /image-rendering:\s*auto/);
  assert.match(HTML, /style\.transform\s*=\s*'translate\(/);
  assert.match(HTML, /scale\(/);
  // La imagen no lleva tope de tamaño en el CSS: la acomoda la escala.
  assert.doesNotMatch(HTML, /max-width:\s*100%/);
  // El src se escribe una sola vez en todo el script: acercar nunca la vuelve a pedir.
  assert.equal((HTML.match(/\bfoto\.src\s*=/g) || []).length, 1);
});

test('antes de cargar nada flota: controles, imagen y aviso de error arrancan escondidos', () => {
  for (const id of ['controles', 'foto', 'error']) {
    assert.match(HTML, new RegExp('<(?:div|img)[^>]*id="' + id + '"[^>]*\\shidden'), '#' + id + ' tiene que arrancar hidden');
  }
  assert.match(HTML, /\[hidden\]\{\s*display:none !important/, 'hidden tiene que ganarle a cualquier display');
  assert.match(HTML, /<div id="error"[^>]*>No se pudo cargar la imagen\.<\/div>/);
});

test('los textos que ve el operador estan en castellano simple y no muestran medidas', () => {
  const marcado = HTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const visibles = [];
  marcado.replace(/\b(?:title|aria-label|alt)="([^"]*)"/g, (_, t) => { if (t.trim()) visibles.push(t.trim()); return _; });
  marcado.replace(/>([^<>]+)</g, (_, t) => { if (t.trim()) visibles.push(t.trim()); return _; });

  for (const esperado of ['Ver entera', 'No se pudo cargar la imagen.', 'Acercar', 'Alejar']) {
    assert.ok(visibles.some(t => t.startsWith(esperado)), 'falta el texto "' + esperado + '"');
  }
  for (const t of visibles) {
    assert.doesNotMatch(t, /\b(zoom|fit|close|reset|size|pixels?|px|click|full|width|height|actual)\b/i,
      'palabra en ingles en: "' + t + '"');
    assert.doesNotMatch(t, /\d+\s*[x×]\s*\d+/i, 'una medida en pixeles en: "' + t + '"');
  }
});

// ── LA CUENTA DEL ZOOM, EJECUTADA DE VERDAD ─────────────────────────────────────────────────────
// Las funciones puras viven en el script del visor, entre las marcas @@zoom-puro. Se sacan del html
// y se corren en un contexto VACÍO de node:vm: sin `document` ni `window`, así que si alguna llegara
// a depender de la página, esta prueba revienta en vez de pasar de casualidad.
//
// Los objetos que devuelve el contexto nacen en otro "mundo" de JavaScript: por eso se comparan
// número a número y no con deepEqual (que miraría el prototipo y diría que son distintos).

let _zoom = null;
function zoom() {
  if (_zoom) return _zoom;
  const m = /\/\/ @@zoom-puro-inicio([\s\S]*?)\/\/ @@zoom-puro-fin/.exec(HTML);
  assert.ok(m, 'faltan las marcas @@zoom-puro-inicio / @@zoom-puro-fin en visor-imagen.html');
  const nombres = ['ZOOM_MAXIMO', 'ZOOM_DOBLE', 'ZOOM_PASO', 'escalaEntera', 'limitar', 'acotar',
    'vistaEntera', 'verEntera', 'esEntera', 'enElTope', 'porcentaje', 'zoomHacia', 'mover',
    'dobleClic', 'redimensionar', 'factorRueda'];
  _zoom = vm.runInNewContext('"use strict";\n' + m[1] + '\n({ ' + nombres.join(', ') + ' })', {}, { timeout: 2000 });
  return _zoom;
}

function cerca(real, esperado, tolerancia, mensaje) {
  assert.ok(Math.abs(real - esperado) <= tolerancia,
    (mensaje ? mensaje + ': ' : '') + 'se esperaba ' + esperado + ' y salio ' + real);
}

test('una imagen chica arranca ENTERA y con escala mayor a 1: se agranda hasta llenar la ventana', () => {
  // El comprobante de 287x394 de la queja de Juan, en la ventana normal del visor.
  const z = zoom();
  const v = z.vistaEntera(287, 394, 904, 801);

  assert.ok(v.escala > 1, 'una imagen chica tiene que agrandarse de entrada: escala ' + v.escala);
  cerca(394 * v.escala, 801, 1e-9, 'llena el alto de la ventana');
  assert.ok(287 * v.escala <= 904, 'y no se pasa de ancho');
  cerca(v.x, (904 - 287 * v.escala) / 2, 1e-9, 'queda centrada a lo ancho');
  cerca(v.y, 0, 1e-9);
  assert.equal(z.esEntera(v), true);
  assert.equal(z.porcentaje(v), 100);

  // Y se puede seguir agrandando: este es el botón que antes se escondía.
  assert.ok(z.zoomHacia(v, z.ZOOM_PASO, 452, 400).escala > v.escala);
});

test('una imagen grande arranca entera y achicada; ninguna se recorta ni se sale', () => {
  const z = zoom();
  const grande = z.vistaEntera(3000, 4000, 904, 801);
  assert.ok(grande.escala < 1, 'una foto grande se achica para entrar: ' + grande.escala);

  for (const [nw, nh] of [[3000, 4000], [4000, 3000], [1080, 2400], [287, 394], [50, 50], [1, 1], [4000, 10], [10, 4000]]) {
    for (const [vw, vh] of [[904, 801], [420, 360], [1600, 900], [500, 1200]]) {
      const v = z.vistaEntera(nw, nh, vw, vh);
      const ancho = nw * v.escala, alto = nh * v.escala;
      const que = nw + 'x' + nh + ' en ' + vw + 'x' + vh;
      assert.ok(v.x >= -1e-9 && v.x + ancho <= vw + 1e-9, 'entra a lo ancho: ' + que);
      assert.ok(v.y >= -1e-9 && v.y + alto <= vh + 1e-9, 'entra a lo alto: ' + que);
      assert.ok(Math.abs(ancho - vw) < 1e-6 || Math.abs(alto - vh) < 1e-6, 'toca los bordes en un eje: ' + que);
      cerca(v.x, (vw - ancho) / 2, 1e-6, 'centrada a lo ancho: ' + que);
      cerca(v.y, (vh - alto) / 2, 1e-6, 'centrada a lo alto: ' + que);
    }
  }
  // Datos que no sirven no rompen: se queda en escala 1 en vez de NaN.
  assert.equal(zoom().escalaEntera(0, 0, 904, 801), 1);
  assert.equal(zoom().escalaEntera(287, 394, 0, 0), 1);
});

test('al acercar o alejar, el punto bajo el cursor NO se mueve', () => {
  const z = zoom();
  // 3000x4000 en 904x801: entera ≈ 0.2 (entra por el alto). Se acerca primero seis veces para que
  // la imagen desborde la ventana en los dos ejes: si en un eje sigue siendo más chica, queda
  // centrada y ahí no hay punto fijo posible (ver zoomHacia).
  let v = z.vistaEntera(3000, 4000, 904, 801);
  const base = v.escala;
  v = z.zoomHacia(v, 6, 452, 400);
  cerca(v.escala, base * 6, 1e-9);
  assert.ok(3000 * v.escala > 904 && 4000 * v.escala > 801, 'desborda por los dos ejes');

  const gestos = [[1.3, 500, 250], [0.8, 120, 700], [1.1, 880, 20], [0.9, 15, 780], [1.25, 452, 400],
                  [0.5, 700, 300], [1.4, 60, 90]];
  for (const [factor, px, py] of gestos) {
    const ix = (px - v.x) / v.escala, iy = (py - v.y) / v.escala;   // punto de la imagen bajo el cursor
    const w = z.zoomHacia(v, factor, px, py);
    assert.notEqual(w.escala, v.escala, 'el zoom tiene que cambiar algo: factor ' + factor);
    cerca((px - w.x) / w.escala, ix, 1e-9, 'la x de la imagen bajo el cursor, factor ' + factor);
    cerca((py - w.y) / w.escala, iy, 1e-9, 'la y de la imagen bajo el cursor, factor ' + factor);
    v = w;
  }
});

test('los topes: nunca mas chica que entera ni mas de 800 %', () => {
  const z = zoom();
  assert.equal(z.ZOOM_MAXIMO, 8);
  assert.equal(z.limitar(0.05, 0.2), 0.2, 'por debajo de entera, se queda en entera');
  assert.equal(z.limitar(9, 0.2), 0.2 * 8, 'por encima de 800 %, se queda en 800 %');
  assert.equal(z.limitar(0.5, 0.2), 0.5, 'en el medio no se toca');

  const entera = z.vistaEntera(3000, 4000, 904, 801);
  const arriba = z.zoomHacia(entera, 1e6, 100, 100);
  assert.equal(z.porcentaje(arriba), 800);
  assert.equal(z.enElTope(arriba), true);
  assert.equal(z.enElTope(entera), false);

  const abajo = z.zoomHacia(arriba, 1e-6, 100, 100);
  assert.equal(z.porcentaje(abajo), 100);
  assert.equal(z.esEntera(abajo), true);

  // Pasarse del tope no mueve nada: ni escala ni posición.
  const mas = z.zoomHacia(arriba, 1.5, 300, 300);
  assert.equal(mas.escala, arriba.escala);
  cerca(mas.x, arriba.x, 1e-9);
  cerca(mas.y, arriba.y, 1e-9);
  const menos = z.zoomHacia(entera, 0.5, 300, 300);
  assert.equal(menos.escala, entera.escala);
  cerca(menos.x, entera.x, 1e-9);
  cerca(menos.y, entera.y, 1e-9);
});

test('los topes valen para cualquier tamaño de imagen, incluso la chica que se agranda de entrada', () => {
  const z = zoom();
  const chica = z.vistaEntera(287, 394, 904, 801);       // entera ≈ 2.03 (203 % del tamaño original)
  const tope = z.zoomHacia(chica, 1e6, 450, 400);
  cerca(tope.escala, chica.escala * 8, 1e-9);
  assert.equal(z.porcentaje(tope), 800, 'el porcentaje cuenta desde "entera", no desde el tamaño original');
  const doble = z.dobleClic(chica, 450, 400);
  cerca(doble.escala, chica.escala * 2, 1e-9, '200 % es el doble de lo que ya se veia');
  assert.equal(z.porcentaje(doble), 200);
});

test('la imagen nunca deja ver fondo ni se sale de los topes, hagas lo que hagas', () => {
  // Un recorrido largo y repetible de acercar, arrastrar, redimensionar y doble clic.
  const z = zoom();
  let semilla = 20251101;
  const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };

  for (const [nw, nh] of [[3000, 4000], [287, 394], [4000, 700], [60, 60]]) {
    let v = z.vistaEntera(nw, nh, 904, 801);
    for (let i = 0; i < 1500; i++) {
      const r = azar();
      if (r < 0.5)      v = z.zoomHacia(v, Math.exp((azar() - 0.5) * 2.2), azar() * v.vw, azar() * v.vh);
      else if (r < 0.8) v = z.mover(v, v.x + (azar() - 0.5) * 900, v.y + (azar() - 0.5) * 900);
      else if (r < 0.9) v = z.redimensionar(v, 420 + azar() * 1300, 360 + azar() * 700);
      else              v = z.dobleClic(v, azar() * v.vw, azar() * v.vh);

      const donde = nw + 'x' + nh + ' paso ' + i;
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.escala), 'numeros validos: ' + donde);
      assert.ok(v.escala >= v.entera - 1e-9, 'no baja de entera: ' + donde);
      assert.ok(v.escala <= v.entera * 8 + 1e-9, 'no pasa de 800 %: ' + donde);
      const ancho = nw * v.escala, alto = nh * v.escala;
      if (ancho <= v.vw) cerca(v.x, (v.vw - ancho) / 2, 1e-6, 'centrada a lo ancho: ' + donde);
      else assert.ok(v.x <= 1e-9 && v.x + ancho >= v.vw - 1e-9, 'sin fondo a los costados: ' + donde);
      if (alto <= v.vh) cerca(v.y, (v.vh - alto) / 2, 1e-6, 'centrada a lo alto: ' + donde);
      else assert.ok(v.y <= 1e-9 && v.y + alto >= v.vh - 1e-9, 'sin fondo arriba ni abajo: ' + donde);
    }
  }
});

test('arrastrar mueve la imagen acercada y la frena en los bordes; entera no se mueve', () => {
  const z = zoom();
  const entera = z.vistaEntera(3000, 4000, 904, 801);
  const quieta = z.mover(entera, 500, 500);
  cerca(quieta.x, entera.x, 1e-9, 'entera: no hay a donde moverla (x)');
  cerca(quieta.y, entera.y, 1e-9, 'entera: no hay a donde moverla (y)');

  const v = z.zoomHacia(entera, 8, 452, 400);              // el tope (≈ 1.6): 4800x6400, desborda por todos lados
  const corrida = z.mover(v, v.x - 100, v.y - 50);
  cerca(corrida.x, v.x - 100, 1e-9);
  cerca(corrida.y, v.y - 50, 1e-9);

  const pegadaArribaIzq = z.mover(v, 99999, 99999);
  cerca(pegadaArribaIzq.x, 0, 1e-9);
  cerca(pegadaArribaIzq.y, 0, 1e-9);
  const pegadaAbajoDer = z.mover(v, -99999, -99999);
  cerca(pegadaAbajoDer.x, 904 - 3000 * v.escala, 1e-9);
  cerca(pegadaAbajoDer.y, 801 - 4000 * v.escala, 1e-9);
});

test('doble clic alterna entre entera y 200 % hacia el punto del clic', () => {
  const z = zoom();
  const entera = z.vistaEntera(3000, 4000, 904, 801);     // entera ≈ 0.2; al 200 % son ≈ 1200x1600 y desborda
  const px = 450, py = 400;
  const ix = (px - entera.x) / entera.escala, iy = (py - entera.y) / entera.escala;

  const ampliada = z.dobleClic(entera, px, py);
  cerca(ampliada.escala, entera.escala * 2, 1e-9);
  assert.equal(z.porcentaje(ampliada), 200);
  assert.equal(z.esEntera(ampliada), false);
  cerca((px - ampliada.x) / ampliada.escala, ix, 1e-9, 'el punto del clic sigue bajo el cursor (x)');
  cerca((py - ampliada.y) / ampliada.escala, iy, 1e-9, 'el punto del clic sigue bajo el cursor (y)');

  const de_vuelta = z.dobleClic(ampliada, 10, 10);
  assert.equal(z.esEntera(de_vuelta), true);
  assert.equal(z.porcentaje(de_vuelta), 100);
  cerca(de_vuelta.x, entera.x, 1e-9);
  cerca(de_vuelta.y, entera.y, 1e-9);

  // Desde cualquier nivel intermedio también vuelve a entera.
  assert.equal(z.esEntera(z.dobleClic(z.zoomHacia(entera, 1.3, 300, 300), 300, 300)), true);
});

test('al cambiar el tamaño de la ventana: entera sigue entera, acercada conserva escala y centro', () => {
  const z = zoom();
  const entera = z.vistaEntera(287, 394, 904, 801);
  const chica = z.redimensionar(entera, 600, 500);
  assert.equal(z.esEntera(chica), true);
  cerca(394 * chica.escala, 500, 1e-9, 'sigue llenando el alto de la ventana nueva');
  cerca(chica.x, (600 - 287 * chica.escala) / 2, 1e-9);

  let v = z.vistaEntera(3000, 4000, 904, 801);
  v = z.dobleClic(v, 452, 400);                           // 200 % ≈ 0.4
  const cx = (452 - v.x) / v.escala, cy = (400.5 - v.y) / v.escala;   // lo que había en el centro
  const w = z.redimensionar(v, 700, 600);
  cerca(w.escala, v.escala, 1e-9, 'la escala no cambia si sigue dentro de los topes');
  cerca((350 - w.x) / w.escala, cx, 1e-9, 'sigue mirando el mismo centro (x)');
  cerca((300 - w.y) / w.escala, cy, 1e-9, 'sigue mirando el mismo centro (y)');

  // Si la ventana crece tanto que "entera" supera la escala de ahora, pasa a ser entera.
  const enorme = z.redimensionar(v, 3000, 4000);
  assert.equal(z.esEntera(enorme), true);
});

test('la rueda: arriba acerca, abajo aleja, y un golpe fuerte no salta de entera a 800 %', () => {
  const z = zoom();
  const muesca = z.factorRueda(-100, 0);
  assert.ok(muesca > 1.1 && muesca < 1.4, 'una muesca de mouse son unas decenas por ciento: ' + muesca);
  cerca(muesca * z.factorRueda(100, 0), 1, 1e-12, 'bajar es lo inverso de subir');
  assert.equal(z.factorRueda(0, 0), 1);
  cerca(z.factorRueda(-3, 1), z.factorRueda(-99, 0), 1e-12, 'en modo lineas, 3 lineas son una muesca');
  assert.ok(z.factorRueda(-100000, 0) < 2.2, 'tope por evento');
  assert.ok(z.factorRueda(100000, 0) > 0.45, 'tope por evento hacia abajo');

  // Datos raros no mueven nada ni dejan NaN en la vista.
  const v = z.vistaEntera(3000, 4000, 904, 801);
  for (const factor of [NaN, 0, -2, Infinity, undefined]) {
    const w = z.zoomHacia(v, factor, 100, 100);
    assert.equal(w.escala, v.escala, 'factor ' + factor);
    cerca(w.x, v.x, 1e-9);
  }
  const sinCursor = z.zoomHacia(z.zoomHacia(v, 3, 100, 100), 1.2, NaN, undefined);
  assert.ok(Number.isFinite(sinCursor.x) && Number.isFinite(sinCursor.y), 'sin cursor, acerca hacia el centro');
});

// ── EL VISOR ARMADO: el script REAL, corrido sobre un DOM de mentira ────────────────────────────
// La cuenta pura se prueba sola (arriba), pero el error que dejó sin agrandar los comprobantes no
// estaba en la cuenta: estaba en el enganche — un botón que se escondía solo cuando la imagen
// entraba en la ventana. Por eso acá se corre el script ENTERO del visor, con los mismos ids que
// tiene la página, y se le tocan los controles como lo haría el operador.

function armarVisor({ ancho = 904, alto = 801, conPuente = true } = {}) {
  const guion = /<script>([\s\S]*?)<\/script>/.exec(HTML);
  assert.ok(guion, 'el visor tiene que traer su script');

  function elemento(id) {
    const oyentes = {};
    const clases = new Set();
    const el = {
      id, oyentes, capturas: [],
      style: {}, hidden: false, disabled: false, textContent: '',
      naturalWidth: 0, naturalHeight: 0, clientWidth: ancho, clientHeight: alto,
      classList: {
        add:      (c) => { clases.add(c); },
        remove:   (c) => { clases.delete(c); },
        toggle:   (c, forzar) => { if (forzar === undefined ? !clases.has(c) : forzar) clases.add(c); else clases.delete(c); },
        contains: (c) => clases.has(c)
      },
      addEventListener: (tipo, fn, opciones) => { (oyentes[tipo] = oyentes[tipo] || []).push({ fn, opciones }); },
      setPointerCapture:     (n) => { el.capturas.push('tomar:' + n); },
      releasePointerCapture: (n) => { el.capturas.push('soltar:' + n); }
    };
    return el;
  }

  const ids = ['escena', 'foto', 'error', 'controles', 'btnMenos', 'btnMas', 'btnEntera', 'porcentaje'];
  const elementos = {};
  for (const id of ids) elementos[id] = elemento(id);

  // La imagen anota cada vez que se le escribe el src: acercar no puede recargarla.
  const escrituras = [];
  Object.defineProperty(elementos.foto, 'src', {
    get: () => escrituras[escrituras.length - 1] || '',
    set: (valor) => { escrituras.push(valor); }
  });
  // Y anota cada propiedad de estilo que se le escribe: una vez cargada, acercar y mover sólo
  // pueden tocar el transform (un left o un top que se sumen a la cuenta la desplazarían doble).
  const estilosEscritos = [];
  elementos.foto.style = new Proxy({}, {
    set(destino, propiedad, valor) { estilosEscritos.push(propiedad); destino[propiedad] = valor; return true; }
  });

  const cierres = [];
  let recibir = null;
  const ventana = elemento('window');
  ventana.visorImagen = conPuente
    ? { alCargar: (cb) => { recibir = cb; }, cerrar: () => { cierres.push('puente'); } }
    : undefined;
  ventana.close = () => { cierres.push('window.close'); };

  const documento = elemento('document');
  documento.title = 'Imagen';
  documento.body = elemento('body');
  documento.getElementById = (id) => {
    if (!elementos[id]) throw new Error('el script pidio un id que la pagina no tiene: ' + id);
    return elementos[id];
  };

  // Reloj de mentira: los temporizadores quedan en fila y la prueba los dispara cuando quiere.
  let ultimo = 0;
  const pendientes = new Map();
  const contexto = vm.createContext({
    window: ventana, document: documento,
    setTimeout: (fn, ms) => { pendientes.set(++ultimo, { fn, ms }); return ultimo; },
    clearTimeout: (n) => { pendientes.delete(n); }
  });
  vm.runInContext(guion[1], contexto, { filename: 'visor-imagen.html', timeout: 2000 });

  function disparar(el, tipo, datos) {
    const evento = Object.assign({ type: tipo, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, datos);
    for (const { fn } of (el.oyentes[tipo] || [])) fn(evento);
    return evento;
  }

  return {
    elementos, documento, ventana, cierres, escrituras, estilosEscritos, disparar,
    // lo que main le manda por el canal visor:cargar
    pedir(url, titulo) { recibir({ url, titulo }); },
    // pedir + que el navegador termine de cargar una imagen con esas medidas
    cargar(nw, nh, titulo = 'jugador_chat') {
      recibir({ url: 'https://sb.co/comprobante.png', titulo });
      elementos.foto.naturalWidth = nw;
      elementos.foto.naturalHeight = nh;
      disparar(elementos.foto, 'load');
    },
    // lo que el visor le pidió al navegador que dibuje
    vista() {
      const m = /^translate\(([-\d.e+]+)px,([-\d.e+]+)px\) scale\(([-\d.e+]+)\)$/.exec(elementos.foto.style.transform || '');
      return m ? { x: Number(m[1]), y: Number(m[2]), escala: Number(m[3]) } : null;
    },
    texto(id) { return elementos[id].textContent; },
    pendientes() { return pendientes.size; },
    correrTemporizadores() { const lista = [...pendientes.values()]; pendientes.clear(); lista.forEach(t => t.fn()); },
    rueda(clientX, clientY, deltaY) {
      return disparar(documento, 'wheel', { deltaY, deltaMode: 0, ctrlKey: false, clientX, clientY });
    },
    tecla(key, extra) { return disparar(documento, 'keydown', Object.assign({ key, code: '' }, extra)); }
  };
}

test('visor armado: una imagen chica de 287x394 se abre ENTERA y grande, y los controles estan a la vista', () => {
  const v = armarVisor();
  v.cargar(287, 394);
  const t = v.vista();

  assert.ok(t.escala > 1, 'una imagen chica se agranda hasta llenar la ventana: ' + t.escala);
  cerca(394 * t.escala, 801, 0.05, 'llena el alto de la ventana');
  cerca(t.x, (904 - 287 * t.escala) / 2, 0.05, 'queda centrada a lo ancho');
  cerca(t.y, 0, 0.05);
  assert.equal(v.texto('porcentaje'), '100 %');

  // El error de Juan: el botón para agrandar se escondía si la imagen "entraba". Nada se esconde.
  for (const id of ['controles', 'btnMenos', 'btnMas', 'btnEntera', 'porcentaje', 'foto']) {
    assert.equal(v.elementos[id].hidden, false, '#' + id + ' no tiene que estar oculto');
    assert.notEqual(v.elementos[id].style.display, 'none', '#' + id + ' no tiene que tener display:none');
  }
  assert.equal(v.elementos.btnMas.disabled, false, 'se puede acercar');
  assert.equal(v.elementos.btnMenos.disabled, true, 'en entera no se puede alejar mas');
  assert.equal(v.elementos.foto.src, 'https://sb.co/comprobante.png');
  assert.equal(v.elementos.foto.style.width, '287px', 'la caja mide lo que mide la imagen');
  assert.equal(v.elementos.foto.style.height, '394px');
});

test('visor armado: el boton + agranda la imagen chica y "Ver entera" la devuelve', () => {
  const v = armarVisor();
  v.cargar(287, 394);
  const entera = v.vista().escala;

  v.disparar(v.elementos.btnMas, 'click');
  cerca(v.vista().escala, entera * 1.25, 1e-4, 'un toque de + agranda un cuarto');
  assert.equal(v.texto('porcentaje'), '125 %');
  assert.equal(v.elementos.btnMenos.disabled, false);
  assert.equal(v.elementos.btnEntera.disabled, false);

  v.disparar(v.elementos.btnMenos, 'click');
  assert.equal(v.texto('porcentaje'), '100 %');

  v.disparar(v.elementos.btnMas, 'click');
  v.disparar(v.elementos.btnMas, 'click');
  v.disparar(v.elementos.btnMas, 'click');
  assert.ok(v.vista().escala > entera * 1.9);
  v.disparar(v.elementos.btnEntera, 'click');
  cerca(v.vista().escala, entera, 1e-4);
  assert.equal(v.texto('porcentaje'), '100 %');
  assert.equal(v.elementos.btnEntera.disabled, true);
});

test('visor armado: en el tope de 800 % el + se apaga pero no desaparece', () => {
  const v = armarVisor();
  v.cargar(287, 394);
  for (let i = 0; i < 40; i++) v.disparar(v.elementos.btnMas, 'click');
  assert.equal(v.texto('porcentaje'), '800 %');
  assert.equal(v.elementos.btnMas.disabled, true);
  assert.equal(v.elementos.btnMas.hidden, false);
  assert.equal(v.elementos.btnMenos.disabled, false);
});

test('visor armado: la rueda acerca hacia el cursor, sin Ctrl, y el punto bajo el cursor no se mueve', () => {
  const v = armarVisor();
  v.cargar(3000, 4000);

  // El oyente tiene que ser NO pasivo, o el preventDefault no vale y Chromium agranda la página.
  const oyentes = v.documento.oyentes.wheel;
  assert.equal(oyentes.length, 1);
  assert.equal(oyentes[0].opciones.passive, false);

  const entera = v.vista().escala;
  const e = v.rueda(452, 400, -100);
  assert.equal(e.defaultPrevented, true);
  assert.ok(v.vista().escala > entera, 'la rueda hacia arriba acerca, sin tocar Ctrl');

  // Hasta el tope, hacia el centro: así la imagen desborda por los dos lados.
  for (let i = 0; i < 20; i++) v.rueda(452, 400, -100);
  assert.equal(v.texto('porcentaje'), '800 %');

  const px = 300, py = 200;
  const antes = v.vista();
  const ix = (px - antes.x) / antes.escala, iy = (py - antes.y) / antes.escala;
  v.rueda(px, py, 100);
  const despues = v.vista();
  assert.ok(despues.escala < antes.escala, 'la rueda hacia abajo aleja');
  cerca((px - despues.x) / despues.escala, ix, 0.05, 'la x bajo el cursor');
  cerca((py - despues.y) / despues.escala, iy, 0.05, 'la y bajo el cursor');
});

test('visor armado: la rueda se queda entre entera y 800 %, y acercar nunca recarga la imagen', () => {
  const v = armarVisor();
  v.cargar(287, 394);
  for (let i = 0; i < 200; i++) v.rueda(200, 200, -100);
  assert.equal(v.texto('porcentaje'), '800 %');
  for (let i = 0; i < 200; i++) v.rueda(700, 600, 100);
  assert.equal(v.texto('porcentaje'), '100 %');
  assert.equal(v.elementos.btnMenos.disabled, true);

  v.disparar(v.elementos.escena, 'dblclick', { clientX: 400, clientY: 300 });
  v.tecla('+');
  assert.equal(v.escrituras.length, 1, 'el src se escribio una sola vez: acercar no recarga');
});

test('visor armado: despues de cargar, acercar y mover solo tocan el transform de la imagen', () => {
  const v = armarVisor();
  v.cargar(3000, 4000);
  // Al cargar se le da a la caja la medida original y se la ubica con el transform; nada más.
  assert.deepEqual([...new Set(v.estilosEscritos)].sort(), ['height', 'transform', 'width']);

  v.estilosEscritos.length = 0;
  const escena = v.elementos.escena;
  for (let i = 0; i < 6; i++) v.rueda(452, 400, -100);
  v.disparar(escena, 'pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
  v.disparar(escena, 'pointermove', { pointerId: 1, clientX: 380, clientY: 280 });
  v.disparar(escena, 'pointerup', { pointerId: 1, clientX: 380, clientY: 280 });
  v.disparar(escena, 'dblclick', { clientX: 300, clientY: 300 });
  v.disparar(escena, 'dblclick', { clientX: 300, clientY: 300 });
  v.disparar(v.elementos.btnMas, 'click');
  v.disparar(v.elementos.btnMenos, 'click');
  v.disparar(v.elementos.btnEntera, 'click');
  v.tecla('+');
  v.tecla('0');
  escena.clientWidth = 700;
  escena.clientHeight = 600;
  v.disparar(v.ventana, 'resize');

  assert.ok(v.estilosEscritos.length > 0, 'la prueba tiene que haber movido algo');
  assert.deepEqual([...new Set(v.estilosEscritos)], ['transform'], 'se escribio algo mas que el transform');
});

test('visor armado: la rueda sin imagen no revienta y igual frena el zoom de pagina', () => {
  const v = armarVisor();
  const e = v.rueda(100, 100, -100);
  assert.equal(e.defaultPrevented, true);
  assert.equal(v.vista(), null);
});

test('visor armado: con la imagen acercada arrastrar la mueve y el cursor lo indica; entera no se mueve', () => {
  const v = armarVisor();
  v.cargar(3000, 4000);
  const escena = v.elementos.escena;

  // Entera: no hay nada que mover, ni manito ni arrastre.
  assert.equal(escena.classList.contains('movible'), false);
  v.disparar(escena, 'pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
  assert.equal(escena.classList.contains('arrastrando'), false);
  v.disparar(escena, 'pointerup', { pointerId: 1, clientX: 400, clientY: 300 });

  // Acercada: manito (grab) y el arrastre mueve la imagen.
  for (let i = 0; i < 20; i++) v.rueda(452, 400, -100);
  assert.equal(escena.classList.contains('movible'), true, 'cursor grab');
  const antes = v.vista();
  v.disparar(escena, 'pointerdown', { button: 0, pointerId: 7, clientX: 400, clientY: 300 });
  assert.equal(escena.classList.contains('arrastrando'), true, 'cursor grabbing');
  assert.deepEqual(escena.capturas, ['tomar:7']);

  v.disparar(escena, 'pointermove', { pointerId: 7, clientX: 350, clientY: 260 });
  const t = v.vista();
  cerca(t.x, antes.x - 50, 0.02, 'se corrio lo que se arrastro (x)');
  cerca(t.y, antes.y - 40, 0.02, 'se corrio lo que se arrastro (y)');
  assert.equal(t.escala, antes.escala, 'arrastrar no cambia la escala');

  v.disparar(escena, 'pointermove', { pointerId: 99, clientX: 0, clientY: 0 });   // otro dedo/mouse
  assert.equal(v.vista().x, t.x, 'un puntero ajeno no arrastra');

  v.disparar(escena, 'pointerup', { pointerId: 7, clientX: 350, clientY: 260 });
  assert.equal(escena.classList.contains('arrastrando'), false, 'al soltar vuelve a grab');
  assert.equal(escena.classList.contains('movible'), true);
  assert.deepEqual(escena.capturas, ['tomar:7', 'soltar:7']);
  v.disparar(escena, 'pointermove', { pointerId: 7, clientX: 0, clientY: 0 });
  assert.equal(v.vista().x, t.x, 'ya soltada, mover el mouse no la arrastra');

  // Y se frena en el borde: no se puede arrastrar la imagen hasta dejar todo el fondo a la vista.
  v.disparar(escena, 'pointerdown', { button: 0, pointerId: 8, clientX: 100, clientY: 100 });
  v.disparar(escena, 'pointermove', { pointerId: 8, clientX: 90000, clientY: 90000 });
  cerca(v.vista().x, 0, 0.02);
  cerca(v.vista().y, 0, 0.02);
  v.disparar(escena, 'lostpointercapture', { pointerId: 8 });
  assert.equal(escena.classList.contains('arrastrando'), false, 'si se pierde el puntero, termina el arrastre');
});

test('visor armado: un boton que no es el principal no arrastra', () => {
  const v = armarVisor();
  v.cargar(3000, 4000);
  for (let i = 0; i < 20; i++) v.rueda(452, 400, -100);
  v.disparar(v.elementos.escena, 'pointerdown', { button: 2, pointerId: 3, clientX: 400, clientY: 300 });
  assert.equal(v.elementos.escena.classList.contains('arrastrando'), false);
});

test('visor armado: doble clic alterna entre entera y 200 % hacia el punto del clic', () => {
  const v = armarVisor();
  v.cargar(3000, 4000);
  const entera = v.vista();
  const px = 450, py = 400;
  const ix = (px - entera.x) / entera.escala, iy = (py - entera.y) / entera.escala;

  v.disparar(v.elementos.escena, 'dblclick', { clientX: px, clientY: py });
  const t = v.vista();
  cerca(t.escala, entera.escala * 2, 1e-4);
  assert.equal(v.texto('porcentaje'), '200 %');
  cerca((px - t.x) / t.escala, ix, 0.05, 'el punto del clic sigue bajo el cursor (x)');
  cerca((py - t.y) / t.escala, iy, 0.05, 'el punto del clic sigue bajo el cursor (y)');

  v.disparar(v.elementos.escena, 'dblclick', { clientX: 10, clientY: 10 });
  cerca(v.vista().escala, entera.escala, 1e-4, 'el segundo doble clic vuelve a entera');
  assert.equal(v.texto('porcentaje'), '100 %');
});

test('visor armado: + y - acercan y alejan, 0 la vuelve a ver entera, y Esc cierra por el puente', () => {
  const v = armarVisor();
  v.cargar(287, 394);

  const e = v.tecla('+');
  assert.equal(e.defaultPrevented, true);
  assert.equal(v.texto('porcentaje'), '125 %');
  v.tecla('+');
  assert.equal(v.texto('porcentaje'), '156 %');
  v.tecla('-');
  v.tecla('-');
  assert.equal(v.texto('porcentaje'), '100 %');
  v.tecla('-');
  assert.equal(v.texto('porcentaje'), '100 %', 'alejar de mas se queda en entera');

  v.tecla('+'); v.tecla('+'); v.tecla('+');
  v.tecla('0');
  assert.equal(v.texto('porcentaje'), '100 %', '0 vuelve a verla entera');

  // Cualquier distribución de teclado: "=" (sin Shift en inglés), "_" y el teclado numérico.
  v.tecla('=');
  assert.equal(v.texto('porcentaje'), '125 %');
  v.tecla('', { code: 'NumpadSubtract' });
  assert.equal(v.texto('porcentaje'), '100 %');
  v.tecla('', { code: 'NumpadAdd' });
  v.tecla('', { code: 'Numpad0' });
  assert.equal(v.texto('porcentaje'), '100 %');

  // Con Ctrl también, y se frena el atajo del menú de Electron, que agrandaría toda la página.
  const conCtrl = v.tecla('+', { ctrlKey: true });
  assert.equal(conCtrl.defaultPrevented, true);
  assert.equal(v.texto('porcentaje'), '125 %');

  // Una tecla cualquiera no se traga.
  assert.equal(v.tecla('a').defaultPrevented, false);
  assert.deepEqual(v.cierres, []);

  v.tecla('Escape');
  assert.deepEqual(v.cierres, ['puente'], 'Esc cierra por window.visorImagen.cerrar');
});

test('visor armado: Esc cierra aunque todavia no haya imagen, y sin puente cae a window.close', () => {
  const conImagen = armarVisor();
  conImagen.tecla('Escape');
  assert.deepEqual(conImagen.cierres, ['puente']);

  const sinPuente = armarVisor({ conPuente: false });
  sinPuente.tecla('Escape');
  assert.deepEqual(sinPuente.cierres, ['window.close']);
});

test('visor armado: los controles se atenuan solos si el mouse no se mueve y vuelven al moverlo', () => {
  const v = armarVisor();
  v.cargar(287, 394);
  const cuerpo = v.documento.body;

  assert.equal(cuerpo.classList.contains('quieto'), false, 'al abrir se ven a pleno');
  assert.equal(v.pendientes(), 1);
  v.correrTemporizadores();
  assert.equal(cuerpo.classList.contains('quieto'), true, 'sin movimiento se atenuan');

  v.disparar(v.documento, 'mousemove', { clientX: 5, clientY: 5 });
  assert.equal(cuerpo.classList.contains('quieto'), false, 'al mover el mouse vuelven');
  assert.equal(v.pendientes(), 1, 'y se vuelven a atenuar si no hay actividad');

  // En el CSS atenuar es bajar la opacidad (se sigue viendo), no esconder; y pasar por encima la devuelve.
  assert.match(HTML, /body\.quieto #controles\{\s*opacity:\s*\.\d+;\s*\}/);
  assert.match(HTML, /body\.quieto #controles:hover\{\s*opacity:\s*1;\s*\}/);
});

test('visor armado: al cambiar el tamaño de la ventana, entera sigue entera y acercada conserva escala y centro', () => {
  const v = armarVisor();
  v.cargar(287, 394);
  v.elementos.escena.clientWidth = 600;
  v.elementos.escena.clientHeight = 500;
  v.disparar(v.ventana, 'resize');
  const t = v.vista();
  cerca(394 * t.escala, 500, 0.05, 'sigue llenando el alto de la ventana nueva');
  cerca(t.x, (600 - 287 * t.escala) / 2, 0.05, 'y centrada');
  assert.equal(v.texto('porcentaje'), '100 %');

  const w = armarVisor();
  w.cargar(3000, 4000);
  w.disparar(w.elementos.escena, 'dblclick', { clientX: 452, clientY: 400 });   // 200 % ≈ 0.4
  const antes = w.vista();
  const cx = (452 - antes.x) / antes.escala, cy = (400.5 - antes.y) / antes.escala;   // el centro de la ventana
  w.elementos.escena.clientWidth = 700;
  w.elementos.escena.clientHeight = 600;
  w.disparar(w.ventana, 'resize');
  const despues = w.vista();
  cerca(despues.escala, antes.escala, 1e-4, 'acercada: la escala se queda');
  cerca((350 - despues.x) / despues.escala, cx, 0.1, 'mira el mismo centro (x)');
  cerca((300 - despues.y) / despues.escala, cy, 0.1, 'mira el mismo centro (y)');
});

test('visor armado: si la imagen no carga se ve el aviso y no quedan controles sueltos', () => {
  const v = armarVisor();
  v.pedir('https://sb.co/rota.png', 'jugador_chat');
  v.disparar(v.elementos.foto, 'error');
  assert.equal(v.elementos.error.hidden, false, 'se ve "No se pudo cargar la imagen."');
  assert.equal(v.elementos.foto.hidden, true);
  assert.equal(v.elementos.controles.hidden, true);
  assert.equal(v.vista(), null);

  // Sin imagen, nada de lo que se toque revienta.
  v.rueda(10, 10, -100);
  v.tecla('+');
  v.disparar(v.elementos.escena, 'dblclick', { clientX: 10, clientY: 10 });
  v.disparar(v.ventana, 'resize');
  v.tecla('Escape');
  assert.deepEqual(v.cierres, ['puente']);

  // Una imagen que "carga" pero sin medidas tampoco sirve para mostrar.
  const w = armarVisor();
  w.cargar(0, 0);
  assert.equal(w.elementos.error.hidden, false);
  assert.equal(w.elementos.controles.hidden, true);

  // Y si después llega una buena, el aviso se va y vuelven los controles.
  v.cargar(287, 394);
  assert.equal(v.elementos.error.hidden, true);
  assert.equal(v.elementos.foto.hidden, false);
  assert.equal(v.elementos.controles.hidden, false);
  assert.ok(v.vista().escala > 1);
});

test('visor armado: el nombre del jugador va SOLO en el titulo de la ventana', () => {
  const v = armarVisor();
  v.pedir('https://sb.co/x.png', 'jugador_chat');
  assert.equal(v.documento.title, 'jugador_chat');
  v.pedir('https://sb.co/x.png', '   ');
  assert.equal(v.documento.title, 'Imagen');
  v.pedir('https://sb.co/x.png');
  assert.equal(v.documento.title, 'Imagen');

  // Adentro de la ventana no se repite el nombre ni se muestran medidas en pixeles.
  const w = armarVisor();
  w.cargar(287, 394, 'jugador_chat');
  w.disparar(w.elementos.btnMas, 'click');
  for (const [id, el] of Object.entries(w.elementos)) {
    assert.doesNotMatch(el.textContent, /jugador_chat/, '#' + id + ' repite el nombre');
    assert.doesNotMatch(el.textContent, /287|394|×|px/i, '#' + id + ' muestra medidas');
  }
  assert.equal(w.pendientes() >= 0, true);
});
