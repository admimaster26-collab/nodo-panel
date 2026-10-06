const test = require('node:test');
const assert = require('node:assert/strict');
const identidad = require('../renderer/domain/identidad.js');

// Un solo lugar para contestar quién es el jugador.
//
// Juan, 6/10: "NO HAGAS DOS BUSQUEDAS DISTINTAS DEL NUMERO DE TELEFONO".
//
// El caso que lo destapó: en la MISMA pantalla, la tarjeta de arriba mostraba el teléfono de
// gracieeela228 (2241460009) y el expediente de abajo decía "Teléfono: No informado".
// Medido en la base ese día, 7 días, 29.360 solicitudes: la columna `telefono` está vacía en el
// 100% de las cargas, los retiros y los cambios de clave; en `metadata.telefono` está siempre.

// Las formas REALES en las que la misma solicitud llega a las distintas pantallas.
const CRUDA = {            // como viene de la RPC
  id: 311431, usuario: 'gracieeela228', tipo: 'CARGA', telefono: null,
  metadata: { telefono: '2241460009', titular: 'Graciela Casey' }
};
const MAPEADA = {          // como la deja mapSolicitudPortal
  ID: 311431, USUARIO: 'gracieeela228', TIPO: 'CARGA', TELEFONO: '2241460009',
  NOMBRE_COMPLETO: 'Graciela Casey',
  metadata: { telefono: '2241460009', titular: 'Graciela Casey' }
};
const FILA_HISTORIAL = {   // una operación: nunca tuvo teléfono propio
  id: 303566, usuario: 'gracieeela228', tipo: 'CARGA', monto: 10000,
  notas: 'Titular: Graciela Casey · Destino: MATRELO mp'
};
const FILA_UNIFICADA = {   // la que arma el historial mezclando las dos tablas
  id: 311431, usuario: 'gracieeela228', _fuente: 'SOLICITUD',
  historial_id: null, solicitud_id: null,
  _raw: { metadata: { telefono: '2241460009' } }
};

test('el telefono sale igual de CUALQUIERA de las formas', () => {
  assert.equal(identidad.telefono(CRUDA), '2241460009');
  assert.equal(identidad.telefono(MAPEADA), '2241460009');
  assert.equal(identidad.telefono(FILA_UNIFICADA), '2241460009');
});

test('la columna vacia no gana sobre el metadata, que es donde esta', () => {
  // Este es el bug exacto: la cadena que empezaba por la columna devolvia ''.
  assert.equal(CRUDA.telefono, null, 'asi llega de la base: la columna vacia');
  assert.equal(identidad.telefono(CRUDA), '2241460009');
});

test('una fila del historial no tiene telefono: se lo pide al padron', () => {
  assert.equal(identidad.telefono(FILA_HISTORIAL), '', 'sola no lo tiene');
  const padron = (u) => (u === 'gracieeela228' ? '2241460009' : '');
  assert.equal(identidad.telefono(FILA_HISTORIAL, padron), '2241460009',
    'con el padron da el mismo numero que la tarjeta del chat');
});

test('el padron no se consulta si la fila ya lo trae', () => {
  let consultas = 0;
  const padron = () => { consultas++; return '1111111111'; };
  assert.equal(identidad.telefono(CRUDA, padron), '2241460009');
  assert.equal(consultas, 0, 'un viaje de menos');
});

test('el titular sale de las notas cuando no viene de otro lado', () => {
  assert.equal(identidad.titular(FILA_HISTORIAL), 'Graciela Casey');
  assert.equal(identidad.titular(CRUDA), 'Graciela Casey');
  assert.equal(identidad.titular(MAPEADA), 'Graciela Casey');
});

test('sin nada, no inventa', () => {
  assert.equal(identidad.telefono({ usuario: 'x' }), '');
  assert.equal(identidad.titular({ usuario: 'x' }), '');
  assert.equal(identidad.telefono(null), '');
});

// ── El veredicto del padrón ─────────────────────────────────────────────────────────────────
test('VINCULADO es validado y no hay que volver a validarlo', () => {
  const v = identidad.veredicto('VINCULADO');
  assert.equal(v.validado, true);
  assert.equal(identidad.hayQueValidar('VINCULADO', true), false);
});

test('PENDIENTE es el que SI hay que validar', () => {
  const v = identidad.veredicto('PENDIENTE');
  assert.equal(v.validado, false);
  assert.equal(v.ofrecer, true);
  assert.equal(identidad.hayQueValidar('PENDIENTE'), true);
});

test('un DUPLICADO no se ofrece como alternativa', () => {
  // gracieeeela228 y grcieeela228 estan asi en la base: ya se resolvio que no son la cuenta
  // buena. La tarjeta las ofrecia igual, con un boton "usar ...".
  const v = identidad.veredicto('DUPLICADO');
  assert.equal(v.ofrecer, false);
  assert.equal(v.validado, false);
});

test('el que no figura en el padron cuenta como sin validar', () => {
  assert.equal(identidad.veredicto('').validado, false);
  assert.equal(identidad.veredicto(null).estado, '');
  assert.equal(identidad.hayQueValidar(''), true);
});

test('validado se revalida SOLO si el agente no encuentra la cuenta', () => {
  assert.equal(identidad.hayQueValidar('VINCULADO', true), false, 'la cuenta existe: no se toca');
  assert.equal(identidad.hayQueValidar('VINCULADO', false), true, 'el agente no la encontro');
  assert.equal(identidad.hayQueValidar('VINCULADO'), false, 'sin preguntarle al agente, manda lo guardado');
});

// ── Los dos números que se pisan ────────────────────────────────────────────────────────────
test('el numero de la solicitud y el del movimiento no se mezclan', () => {
  const n = identidad.numeros(FILA_UNIFICADA);
  assert.equal(n.solicitudId, '311431');
  assert.equal(n.historialId, '', 'esa fila no es un movimiento');
  const n2 = identidad.numeros({ id: 303566, usuario: 'vero8goat', _fuente: 'HISTORIAL', historial_id: 303566 });
  assert.equal(n2.historialId, '303566');
  assert.equal(n2.solicitudId, '');
});

// ── La cuenta de la operación: lo que el operador pega ──────────────────────────────────────
// Juan, 6/10: "podemos copiar facilmente el usuario, de lo cual ya casi no nos sirve para nada
// pero no podemos copiar facilmente el cbu u el alias".
//
// Y son DOS cosas distintas: en un RETIRO la cuenta es del jugador (a donde hay que pagarle), en
// una CARGA es la nuestra (a la que transfirió). Copiar la que no era es pagarle a la cuenta
// equivocada, así que cada una sale rotulada.

test('en un RETIRO la cuenta es la DEL JUGADOR', () => {
  const d = identidad.destino({ tipo:'RETIRO', metadata:{ destino:'juan.perez.mp', titular:'Juan Perez' } });
  assert.equal(d.valor, 'juan.perez.mp');
  assert.equal(d.etiqueta, 'CBU');
  assert.equal(d.de, 'jugador');
});

test('en una CARGA la cuenta es la NUESTRA', () => {
  const d = identidad.destino({ tipo:'CARGA', metadata:{ billetera_alias:'giordano.mp' } });
  assert.equal(d.valor, 'giordano.mp');
  assert.equal(d.etiqueta, 'Alias');
  assert.equal(d.de, 'nuestra');
});

test('una fila vieja del historial lo saca de las notas', () => {
  const d = identidad.destino({ tipo:'RETIRO',
    notas:'Titular: Juan Perez · CBU/CVU: 0000003100010000000001 · Obs: nada' });
  assert.equal(d.valor, '0000003100010000000001');
  assert.equal(d.etiqueta, 'CBU');
});

test('sin cuenta no se dibuja un boton vacio', () => {
  assert.equal(identidad.destino({ tipo:'CARGA' }), null);
  assert.equal(identidad.destino({ tipo:'RETIRO', metadata:{} }), null);
  assert.equal(identidad.destino(null), null);
});

test('la cuenta del retiro NUNCA sale rotulada como nuestra', () => {
  // La confusion que importa: pagarle al alias de la casa en vez del del jugador.
  const retiro = identidad.destino({ tipo:'RETIRO',
    metadata:{ destino:'juan.perez.mp', billetera_alias:'giordano.mp' } });
  assert.equal(retiro.valor, 'juan.perez.mp', 'manda el destino del jugador');
  assert.equal(retiro.de, 'jugador');
});
