'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════
// EXTRACTOR DE MOVIMIENTOS · lo que corre DENTRO de la pestaña
//
// Se escribe como función normal y se inyecta con toString(): así es código de verdad, se
// prueba acá contra una página armada con el mismo marcado, y no es un string a ciegas.
//
// Devuelve, además de las filas, un DIAGNÓSTICO: cuántos enlaces vio, cuántos descartó por
// duplicado, qué selector encontró y cuál no. Eso es lo que hace que una sola corrida en P4
// alcance para saber si el marcado real es el que esperábamos, en vez de guardar basura en
// silencio. El marcado de Mercado Pago (clases andes-*) viene del análisis hecho en P4; acá
// NO está verificado contra la página real, y el diagnóstico es justamente para eso.
//
// Reglas de plata: el monto se devuelve en CENTAVOS, como entero, y el texto crudo al lado.
// Comparar pesos con decimales en coma flotante es cómo se pierden las diferencias de $0,01
// y cómo un cotejo empieza a mentir. El signo va aparte: para las cargas interesan las que
// ENTRAN, pero se devuelven las dos y filtra quien consume.
// ══════════════════════════════════════════════════════════════════════════════════════════

function extraerMovimientos() {
  var D = {
    url: String(location.href || ''),
    enlaces: 0, duplicados: 0, sin_monto: 0, sin_nombre: 0, sin_hora: 0,
    selectores: {}, nota: ''
  };
  function marcar(nombre, cuantos) { D.selectores[nombre] = cuantos; return cuantos; }

  var esActividades = /\/activities(\/|$|\?)/.test(D.url);
  var esMovimientos = /\/banking\/balance\/movements/.test(D.url);

  // Primero por la clase conocida; si no hay, por el href, que es más estable que una clase.
  var anclas = [].slice.call(document.querySelectorAll(
    'a.andes-ui-list__item-actionable[href*="/banking/balance/movements/"], a.andes-ui-list__item-actionable[href*="/activities/detail/"]'));
  marcar('a.andes-ui-list__item-actionable', anclas.length);
  if (!anclas.length) {
    anclas = [].slice.call(document.querySelectorAll('a[href*="/banking/balance/movements/"], a[href*="/activities/detail/"]'));
    marcar('a[href*=movements|activities/detail] (respaldo)', anclas.length);
    if (anclas.length) D.nota = 'la clase andes-ui-list__item-actionable no apareció: se usó el href';
  }
  D.enlaces = anclas.length;

  var vistos = {}, filas = [];
  for (var i = 0; i < anclas.length; i++) {
    var a = anclas[i];
    var href = a.getAttribute('href') || '';
    if (!href) continue;
    // La vista responsive repite cada fila (angosta y ancha): el href desempata.
    if (vistos[href]) { D.duplicados++; continue; }
    vistos[href] = 1;

    var fila = a.closest('li') || a.parentElement || a;

    // ── quién ────────────────────────────────────────────────────────────────────────
    // El texto accesible del propio enlace es la contraparte ("Devcross Sa").
    var elNombre = a.querySelector('.andes-ui-visually-hidden')
      || fila.querySelector('[class*="activities__title"], [class*="activities-wide__title"]');
    var nombre = elNombre ? String(elNombre.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (!nombre) D.sin_nombre++;

    // ── cuánto, en centavos ──────────────────────────────────────────────────────────
    var elMonto = fila.querySelector('.andes-ui-money-amount');
    var centavos = null, montoTexto = '', signo = '+';
    if (elMonto) {
      var negativo = !!elMonto.querySelector('.andes-ui-money-amount__negative-symbol')
        || /negative/.test(String(elMonto.className || ''));
      signo = negativo ? '-' : '+';
      var entera = elMonto.querySelector('[data-andes-money-amount-fraction="true"]');
      var cents = elMonto.querySelector('[data-andes-money-amount-cents="true"]');
      var sEntera = entera ? String(entera.textContent || '') : '';
      var sCents = cents ? String(cents.textContent || '') : '';
      var dEntera = sEntera.replace(/[^0-9]/g, '');
      var dCents = sCents.replace(/[^0-9]/g, '');
      if (dEntera) {
        centavos = parseInt(dEntera, 10) * 100 + (dCents ? parseInt((dCents + '00').slice(0, 2), 10) : 0);
        if (negativo) centavos = -centavos;
        montoTexto = String(elMonto.textContent || '').replace(/\s+/g, ' ').trim();
      }
    }
    if (centavos === null) {
      // Respaldo: el primer "$ 1.234,56" que aparezca en la fila.
      var m = String(fila.textContent || '').match(/\$\s*([\d.]+)(?:,(\d{1,2}))?/);
      if (m) {
        centavos = parseInt(m[1].replace(/\D/g, ''), 10) * 100 + (m[2] ? parseInt((m[2] + '00').slice(0, 2), 10) : 0);
        montoTexto = m[0];
        if (/^-|menos/i.test(String(fila.textContent || '').slice(0, 40))) { signo = '-'; centavos = -centavos; }
      }
    }
    if (centavos === null) D.sin_monto++;

    // ── cuándo ───────────────────────────────────────────────────────────────────────
    var elHora = fila.querySelector('time');
    var hora = elHora ? String(elHora.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var cuando = elHora ? (elHora.getAttribute('datetime') || '') : '';
    if (!hora && !cuando) D.sin_hora++;

    var elDesc = fila.querySelector('[class*="description"]');
    var descripcion = elDesc ? String(elDesc.textContent || '').replace(/\s+/g, ' ').trim() : '';

    var desdeActividades = href.indexOf('/activities/detail/') >= 0;
    var id = desdeActividades
      ? href.split('/activities/detail/')[1]
      : (href.split('/banking/balance/movements/')[1] || '');
    id = String(id || '').split(/[?#/]/)[0];

    filas.push({
      id: id,
      href: href,
      fuente: desdeActividades ? 'actividades' : 'movimientos',
      nombre: nombre,
      signo: signo,
      centavos: centavos,
      monto_texto: montoTexto,
      descripcion: descripcion,
      hora: hora,
      datetime: cuando,
      // El orden en que aparecen en la pantalla importa: "la 2ª de las 20 del turno".
      posicion: filas.length + 1
    });
  }

  // ── de qué cuenta son ──────────────────────────────────────────────────────────────
  // Si la página dice de quién es la cuenta, no hace falta mapear el perfil a mano. Se
  // informa lo que haya y no se depende de que esté.
  var cuenta = { titular: '', cvu: '', alias: '' };
  try {
    var txt = String(document.body.textContent || '');
    var mCvu = txt.match(/\b\d{22}\b/);
    if (mCvu) cuenta.cvu = mCvu[0];
    var elTit = document.querySelector('[class*="user-name"], [class*="profile-name"], [data-testid*="user"]');
    if (elTit) cuenta.titular = String(elTit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  } catch (_e) {}

  return {
    ok: true,
    pagina: esMovimientos ? 'movimientos' : (esActividades ? 'actividades' : 'otra'),
    url: D.url,
    titulo: String(document.title || '').slice(0, 120),
    cuenta: cuenta,
    filas: filas,
    diagnostico: D
  };
}

// La expresión que se le pasa a Runtime.evaluate.
const EXPRESION = '(' + extraerMovimientos.toString() + ')()';

module.exports = { extraerMovimientos, EXPRESION };
