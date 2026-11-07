const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Qué se borra y cuándo. Había CINCO listas de claves escritas a mano y ninguna coincidía:
//
//   _confirmarCambioUsuario                5/6   dejaba pending_billetera (y validacion_id, bono_usado)
//   _confirmarLimpiarPendiente             6/6
//   limpiarPendienteAprobado               5/6   dejaba pending_billetera
//   consultarEstadoSolicitud               3/6   dejaba pending_billetera, chat_id, chat_token
//   limpiarSolicitudAnteriorAntesDeNueva   4/6   dejaba pending_billetera, solicitud_started_at
//
// Lo que sobra no queda quieto: una billetera pendiente que sobrevive hace que el portal compare
// contra una solicitud que ya no existe y avise de un descuadre inventado. Y en un teléfono donde
// ya se usó el bono, al usuario siguiente no se le ofrecía.
//
// Estas pruebas sacan el código REAL del Portal y lo ejecutan. La última es la que importa para
// que esto no vuelva: si alguien agrega una clave nueva y se olvida de clasificarla, falla.

// PORTAL_A_PROBAR permite apuntar a otra copia, para comprobar que estas pruebas fallan de verdad
// contra un portal con una clave sin clasificar, en vez de confiar en que lo harían.
const PORTAL = fs.readFileSync(process.env.PORTAL_A_PROBAR || path.join(__dirname, '..', 'Portal'), 'utf8');
const NL = String.fromCharCode(10);

function sacar(nombre){
  const i = PORTAL.indexOf(nombre);
  assert.notEqual(i, -1, 'no está en el Portal: ' + nombre);
  const j = PORTAL.indexOf('{', i);
  let n = 0, fin = -1;
  for(let k = j; k < PORTAL.length; k++){
    if(PORTAL[k] === '{') n++;
    else if(PORTAL[k] === '}'){ n--; if(!n){ fin = k + 1; break; } }
  }
  assert.notEqual(fin, -1, 'no cierra: ' + nombre);
  // Desde la firma misma. Buscar hacia atras la palabra "function" se traia la funcion ANTERIOR
  // cuando la firma empieza con "async", y el pedazo extraido compilaba igual: la prueba parecia
  // andar midiendo otra cosa.
  return PORTAL.slice(i, fin);
}
function sacarConst(nombre){
  const re = new RegExp('const ' + nombre + '\\s*=\\s*\\[[\\s\\S]*?\\];');
  const m = PORTAL.match(re);
  assert.ok(m, 'no está la constante ' + nombre);
  return m[0];
}

function armar(guardado){
  const almacen = new Map(Object.entries(guardado || {}));
  const ctx = {
    localStorage: {
      getItem: (k) => (almacen.has(String(k)) ? almacen.get(String(k)) : null),
      setItem: (k, v) => { almacen.set(String(k), String(v)); },
      removeItem: (k) => { almacen.delete(String(k)); }
    },
    state: { pendingTipo:'CARGA', pendingBilletera:'MP Juan', solicitudId:'123',
             solicitudStartedAt: 111, chatId:'9', chatToken:'t', seenMsgIds:new Set(),
             usuario:'jugador04', telefono:'3856273053', nivelAcceso:'OK',
             motivoSoporte:'', portalThreadSeen:new Set(), shownTexts:new Set() },
    Set, Object
  };
  vm.createContext(ctx);
  vm.runInContext([
    sacarConst('CLAVES_SOLICITUD'), sacarConst('CLAVES_CHAT'), sacarConst('CLAVES_JUGADOR'),
    sacar('function _borrar('), sacar('function olvidarSolicitud('), sacar('function olvidarJugador(')
  ].join(NL), ctx);
  return { ctx, almacen };
}

const TODO_GUARDADO = {
  bet300_pending_tipo:'CARGA', bet300_pending_billetera:'MP Juan', bet300_solicitud_id:'123',
  bet300_solicitud_started_at:'111', bet300_chat_id:'9', bet300_chat_token:'t',
  bet300_usuario:'jugador04', bet300_telefono:'3856273053', bet300_vinculo_estado:'OK',
  bet300_nivel_acceso:'OK', bet300_motivo_soporte:'', bet300_portal_thread_seen:'[]',
  bet300_validacion_id:'555', bet300_validacion_estado:'EXISTE', bet300_bono_usado:'1',
  bet300_public_code:'rt-z9p42', bet300_app_instalada:'1', bet300_fs_hint:'1'
};

test('cerrar la solicitud se lleva TODO lo de la solicitud, incluida la billetera pendiente', () => {
  const { ctx, almacen } = armar(TODO_GUARDADO);
  ctx.olvidarSolicitud(true);
  for(const k of ['bet300_pending_tipo','bet300_pending_billetera','bet300_solicitud_id',
                  'bet300_solicitud_started_at','bet300_chat_id','bet300_chat_token'])
    assert.equal(almacen.has(k), false, 'quedó ' + k);
  assert.equal(ctx.state.pendingBilletera, '', 'y el estado en memoria tampoco puede quedar viejo');
  assert.equal(ctx.state.solicitudId, '');
  // El jugador sigue siendo el mismo: eso NO se toca.
  assert.equal(almacen.get('bet300_usuario'), 'jugador04');
  assert.equal(almacen.get('bet300_validacion_id'), '555');
});

test('si la rechazaron, la conversación queda abierta para poder preguntar', () => {
  const { ctx, almacen } = armar(TODO_GUARDADO);
  ctx.olvidarSolicitud(false);
  assert.equal(almacen.has('bet300_solicitud_id'), false, 'la solicitud se cierra');
  assert.equal(almacen.has('bet300_pending_billetera'), false, 'la billetera pendiente también');
  assert.equal(almacen.get('bet300_chat_id'), '9', 'el chat NO se corta');
  assert.equal(almacen.get('bet300_chat_token'), 't');
  assert.equal(ctx.state.chatId, '9');
});

test('cambiar de usuario no le deja nada del anterior', () => {
  // Esto es lo que fallaba: el usuario nuevo heredaba validacion_id y bono_usado.
  const { ctx, almacen } = armar(TODO_GUARDADO);
  ctx.olvidarJugador();
  for(const k of ['bet300_usuario','bet300_telefono','bet300_validacion_id',
                  'bet300_validacion_estado','bet300_bono_usado','bet300_vinculo_estado',
                  'bet300_nivel_acceso','bet300_portal_thread_seen',
                  'bet300_solicitud_id','bet300_chat_id','bet300_pending_billetera'])
    assert.equal(almacen.has(k), false, 'el usuario nuevo hereda ' + k);
  assert.equal(ctx.state.usuario, '');
});

test('lo que es del teléfono y no del jugador se queda', () => {
  // La oficina y lo del dispositivo no cambian porque cambie quien lo usa. Borrarlos mandaría al
  // jugador nuevo a pedir la ruta de nuevo, o le volvería a ofrecer instalar una app ya instalada.
  const { ctx, almacen } = armar(TODO_GUARDADO);
  ctx.olvidarJugador();
  assert.equal(almacen.get('bet300_public_code'), 'rt-z9p42', 'la oficina se queda');
  assert.equal(almacen.get('bet300_app_instalada'), '1');
  assert.equal(almacen.get('bet300_fs_hint'), '1');
});

test('borrar dos veces no rompe nada', () => {
  const { ctx } = armar({});
  ctx.olvidarJugador();
  ctx.olvidarSolicitud(true);
  ctx.olvidarSolicitud(false);
  assert.equal(ctx.state.usuario, '');
});

test('NINGUNA clave del portal puede quedar sin clasificar', () => {
  // Ésta es la que evita que vuelva a pasar. Toda clave bet300_* que el Portal escriba tiene que
  // estar en uno de los tres grupos, o declarada acá como del dispositivo. Si alguien agrega una
  // clave nueva y no decide a qué grupo pertenece, esta prueba falla y lo obliga a decidirlo —
  // en vez de descubrirlo meses después como un dato viejo que se le pegó al jugador siguiente.
  const DEL_DISPOSITIVO = [
    'bet300_public_code',      // la oficina: no cambia porque cambie el jugador
    'bet300_app_instalada',    // la PWA está instalada en ESTE teléfono
    'bet300_fs_hint',          // si ya se le mostró la ayuda de pantalla completa
    'bet300_oficina_de_prueba',// qué oficina se estaba probando EN ESTE aparato (sólo copia de prueba)
    'bet300_push_saved',       // la suscripción de push ya guardada (tiene su propia firma)
    'bet300_launcher_seen',    // sessionStorage
    'bet300_redirigido'        // sessionStorage
  ];
  const escritas = new Set();
  const re = /(?:local|session)Storage\.setItem\(\s*"(bet300_[^"]+)"/g;
  let m;
  while((m = re.exec(PORTAL))) escritas.add(m[1]);
  // El último retiro se guarda con el usuario pegado al nombre: se trata aparte.
  const reRetiro = /"bet300_ultimo_retiro_at_"/;
  assert.ok(reRetiro.test(PORTAL), 'cambió la clave del cooldown de retiro: revisar a qué grupo va');

  const clasificadas = new Set([
    ...JSON.parse(PORTAL.match(/const CLAVES_SOLICITUD\s*=\s*(\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, ']')),
    ...JSON.parse(PORTAL.match(/const CLAVES_CHAT\s*=\s*(\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, ']')),
    ...JSON.parse(PORTAL.match(/const CLAVES_JUGADOR\s*=\s*(\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, ']')),
    ...DEL_DISPOSITIVO
  ]);

  const sinClasificar = [...escritas].filter(k => !clasificadas.has(k));
  assert.deepEqual(sinClasificar, [],
    'estas claves no están en ningún grupo — decidir si son del jugador, de la solicitud o del ' +
    'teléfono: ' + sinClasificar.join(', '));
});

// ── Cambiar de oficina = empezar de cero ─────────────────────────────────────
// Lo que guarda el portal vive por SITIO, no por oficina. Siete oficinas no tienen dominio propio
// (P8, P9, P9B, P10, P10B, P10C, P11): entran por ?r= en el MISMO dominio y comparten
// almacenamiento. Entrabas por el enlace de una, despues por el de otra, y te arrastraba la
// validacion de la primera: veias las billeteras de la ULTIMA, transferias, y recien al enviar la
// solicitud te avisaba que no estabas validado (Juan, 3/10).

function armarConOficina(guardado){
  const almacen = new Map(Object.entries(guardado || {}));
  const logs = [];
  const ctx = {
    console: { log: (...a) => logs.push(a.join(' ')), warn(){} },
    localStorage: {
      getItem: (k) => (almacen.has(String(k)) ? almacen.get(String(k)) : null),
      setItem: (k, v) => { almacen.set(String(k), String(v)); },
      removeItem: (k) => { almacen.delete(String(k)); }
    },
    state: { usuario:'pruebaxx', telefono:'1134970581', nivelAcceso:'OK', publicCode:'',
             motivoSoporte:'', portalThreadSeen:new Set(), shownTexts:new Set(),
             pendingTipo:'CARGA', pendingBilletera:'MP Juan', solicitudId:'123',
             solicitudStartedAt:1, chatId:'9', chatToken:'t', seenMsgIds:new Set() },
    Set, Object, String
  };
  vm.createContext(ctx);
  vm.runInContext([
    sacarConst('CLAVES_SOLICITUD'), sacarConst('CLAVES_CHAT'), sacarConst('CLAVES_JUGADOR'),
    sacar('function _borrar('), sacar('function olvidarSolicitud('),
    sacar('function olvidarJugador('), sacar('function _fijarOficina(')
  ].join(NL), ctx);
  return { ctx, almacen, logs };
}

test('oficina · entrar por el enlace de OTRA oficina no arrastra la validacion', () => {
  const c = armarConOficina({
    bet300_public_code: 'rt-a8f31',      // venia de P1
    bet300_usuario: 'pruebaxx', bet300_telefono: '1134970581',
    bet300_nivel_acceso: 'OK', bet300_validacion_id: '555',
    bet300_chat_id: '9', bet300_pending_tipo: 'CARGA',
    bet300_app_instalada: '1'
  });
  c.ctx._fijarOficina('rt-z9p42');       // ahora entra por el de P4
  assert.equal(c.almacen.get('bet300_public_code'), 'rt-z9p42', 'la oficina cambia');
  for(const k of ['bet300_usuario','bet300_telefono','bet300_nivel_acceso',
                  'bet300_validacion_id','bet300_chat_id','bet300_pending_tipo'])
    assert.equal(c.almacen.has(k), false, 'se arrastro ' + k + ' de la oficina anterior');
  assert.equal(c.ctx.state.usuario, '', 'y el estado en memoria tampoco queda viejo');
  assert.ok(c.logs.join(' ').includes('cambio de oficina'), 'queda dicho en la consola');
});

test('oficina · si es la MISMA, no se toca nada', () => {
  // Entrar dos veces por el mismo enlace no puede desloguear a nadie.
  const c = armarConOficina({
    bet300_public_code: 'rt-z9p42', bet300_usuario: 'pruebaxx',
    bet300_nivel_acceso: 'OK', bet300_chat_id: '9'
  });
  c.ctx._fijarOficina('rt-z9p42');
  assert.equal(c.almacen.get('bet300_usuario'), 'pruebaxx', 'sigue validado');
  assert.equal(c.almacen.get('bet300_chat_id'), '9', 'y con su conversacion');
  assert.equal(c.logs.length, 0, 'ni avisa, porque no paso nada');
});

test('oficina · la primera vez no borra nada (no habia oficina antes)', () => {
  const c = armarConOficina({ bet300_usuario: 'pruebaxx', bet300_nivel_acceso: 'OK' });
  c.ctx._fijarOficina('rt-z9p42');
  assert.equal(c.almacen.get('bet300_usuario'), 'pruebaxx', 'no se deslogue a quien recien llega');
  assert.equal(c.almacen.get('bet300_public_code'), 'rt-z9p42');
});

test('oficina · lo del aparato se queda aunque cambie la oficina', () => {
  const c = armarConOficina({
    bet300_public_code: 'rt-a8f31', bet300_usuario: 'pruebaxx',
    bet300_app_instalada: '1', bet300_fs_hint: '1'
  });
  c.ctx._fijarOficina('rt-z9p42');
  assert.equal(c.almacen.get('bet300_app_instalada'), '1', 'la app sigue instalada en este telefono');
  assert.equal(c.almacen.get('bet300_fs_hint'), '1');
});

test('oficina · un codigo vacio no borra ni cambia nada', () => {
  const c = armarConOficina({ bet300_public_code: 'rt-z9p42', bet300_usuario: 'pruebaxx' });
  c.ctx._fijarOficina('');
  c.ctx._fijarOficina(null);
  assert.equal(c.almacen.get('bet300_public_code'), 'rt-z9p42');
  assert.equal(c.almacen.get('bet300_usuario'), 'pruebaxx');
});

test('oficina · hay UN solo lugar que fija la oficina', () => {
  // Habia cuatro caminos que la escribian a mano y ninguno olvidaba al jugador. Si alguien agrega
  // un quinto, esto lo frena.
  const escrituras = PORTAL.split(NL).filter(l => l.includes('setItem("bet300_public_code"'));
  assert.equal(escrituras.length, 1, 'solo _fijarOficina puede escribirla: ' + escrituras.join(' | '));
});
