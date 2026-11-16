const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Juan, 16/11: "noté tardanza en ... el recibo de mensaje del usuario".
//
// La lista de chats no se pide más de una vez cada 15 s. El servidor avisa al instante cuando escribe un
// jugador (canal nodo:chat), pero ese aviso pedía la lista por el mismo camino y caía dentro de los 15 s:
// se ignoraba, y el mensaje aparecía con el reloj siguiente. Medido en el código: el reloj es de 15 s y
// la marca se pone al TERMINAR la lectura, así que una vuelta de cada dos se salteaba: hasta 30 s.
// Ahora el aviso invalida la lista y la lectura siguiente va al servidor.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat', 'chat-canal-nuevo.js'), 'utf8');

function armar(){
  let ahora = 1_000_000, pedidos = 0, soltar = null;
  const filas = [{ chat_id: 'CHAT_1', usuario: 'pruebaxx', ultimo_mensaje: 'hola' }];
  const window = {
    pcOperativa: 'P1',
    NodoBetaChat: {
      ready: async () => true, active: () => true,
      lista: () => { pedidos++; const rows = filas.map(f => ({ ...f }));
        return soltar === null ? Promise.resolve({ rows }) : new Promise(r => { soltar = () => r({ rows }); }); }
    }
  };
  const ctx = { window, console, Map, Set, Number, String, Array, JSON, Promise, BigInt,
    Date: { now: () => ahora, parse: Date.parse } };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { canal: window._chatCanalNuevo, filas, pasan: ms => { ahora += ms; }, pedidos: () => pedidos,
    lento: () => { soltar = undefined; }, soltar: () => { const s = soltar; soltar = null; s && s(); } };
}

test('sin aviso, dentro de los 15 s no se vuelve a pedir la lista', async () => {
  const h = armar();
  await h.canal.cargar(); h.pasan(5000); await h.canal.cargar();
  assert.equal(h.pedidos(), 1);
});

test('con el aviso del servidor la lista se pide enseguida y trae el mensaje nuevo', async () => {
  const h = armar();
  await h.canal.cargar();
  h.pasan(2000);
  h.filas[0].ultimo_mensaje = 'no me llegó la carga';
  h.canal.invalidar();
  const filas = await h.canal.cargar();
  assert.equal(h.pedidos(), 2, 'no espera el reloj');
  assert.equal(filas[0].ultimo_mensaje, 'no me llegó la carga');
  h.pasan(1000); await h.canal.cargar();
  assert.equal(h.pedidos(), 2, 'y después vuelve a respetar los 15 s');
});

test('un aviso que llega con una lectura en vuelo no se pierde: se lee otra vez', async () => {
  const h = armar();
  h.lento();
  const primera = h.canal.cargar();           // sale la lectura (todavía sin el mensaje nuevo)
  await new Promise(r => setTimeout(r, 5));
  h.filas[0].ultimo_mensaje = 'hola, ¿están?';
  h.canal.invalidar();                         // llega el aviso con esa lectura en el aire
  const segunda = h.canal.cargar();
  h.soltar();
  await primera;
  const filas = await segunda;
  assert.equal(h.pedidos(), 2, 'la lectura en vuelo no alcanza: se pide de nuevo');
  assert.equal(filas[0].ultimo_mensaje, 'hola, ¿están?');
});
