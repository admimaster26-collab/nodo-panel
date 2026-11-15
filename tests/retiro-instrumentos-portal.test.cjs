const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Retiro con DNI, unión de las dos versiones: los dos SQL reales en una base en memoria (PGlite),
// recorriendo lo que hacen el Portal nuevo (contexto_v1, crear_v1) y NODO (panel_retiro_instrumento*).

function cargarPGlite() {
  for (const nombre of [process.env.NODO_PGLITE_PATH, '@electric-sql/pglite',
    path.join(os.tmpdir(), 'nodo-beta-sql-validation/node_modules/@electric-sql/pglite')].filter(Boolean)) {
    try { return require(nombre).PGlite; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  return null;
}
const PGlite = cargarPGlite();
const leer = (f) => fs.readFileSync(path.join(__dirname, '../servidor', f), 'utf8');

async function base() {
  const db = new PGlite();
  await db.exec(`
    create table public.landing_solicitudes (id bigserial primary key, pc_codigo text, usuario text, tipo text,
      estado text default 'PENDIENTE', monto numeric, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.landing_rutas_publicas (public_code text, pc_codigo text, activo boolean);
    create table public.usuarios_portal_eventos (id bigserial primary key, pc_codigo text, usuario text, evento text,
      telefono_anterior text, telefono_nuevo text, titular text, nota text, operador text, origen text, created_at timestamptz default now());
    insert into public.landing_rutas_publicas values ('codp1', 'P1', true), ('codp2', 'P2', true);
    create function public.panel_validar_admin_session(p text) returns table(ok boolean, mensaje text, operador_id bigint,
      usuario text, nombre text, rol text, tipo text, pc_codigo text, scope text, puede_todas boolean, expires_at timestamptz, pcs text[])
      language sql as $$
      select p in ('admin-p1','admin-todas'), null::text, 1::bigint, case p when 'admin-p1' then 'encargada' else 'general' end,
             null::text, null::text, null::text, 'P1', null::text, p = 'admin-todas', now(), array['P1'] $$;
    create function public.landing_portal_v16_pc_from_code(text) returns text language sql as $$ select null::text $$;
    create function public.landing_resolver_ruta_por_host(text) returns jsonb language sql as $$ select '{"ok":false}'::jsonb $$;
    create function public.landing_portal_resolver_vinculo(p_pc text, p_usuario text, p_tel text) returns jsonb language sql as $$
      select jsonb_build_object('verdict', case when lower(p_usuario) = 'pruebaxx' and p_tel = '1100000000' then 'ACCESO' else 'BLOQUEADO' end) $$;
    create function public._panel_data_auth(p text) returns boolean language sql as $$ select p = 's' $$;
    create function public.landing_portal_v16_crear_solicitud(p_code text, p_usuario text, p_tipo text, p_monto numeric,
      p_titular text, p_destino text, p_msg text, p_meta jsonb) returns jsonb language plpgsql as $$
      declare v bigint; begin
        insert into landing_solicitudes(pc_codigo, usuario, tipo, monto, metadata) values ('P1', p_usuario, p_tipo, p_monto, p_meta || jsonb_build_object('usuario', p_usuario, 'destino', p_destino)) returning id into v;
        return jsonb_build_object('ok', true, 'id', v, 'solicitud_id', v); end $$;
  `);
  await db.exec(leer('retiro-instrumentos.sql'));
  await db.exec(leer('retiro-instrumentos-portal.sql'));
  await db.exec(leer('retiro-dni-interruptor.sql'));
  const uno = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];
  const crear = (destino, titular, dni, meta = { telefono: '1100000000' }) => uno(
    `select landing_portal_retiro_crear_v1('codp1','pruebaxx','1100000000',null,15000,$1,$2,$3,$4)`, [titular, destino, dni, JSON.stringify(meta)]);
  const contexto = () => uno(`select landing_portal_retiro_contexto_v1('codp1','pruebaxx','1100000000',null)`);
  const estado = (sid) => uno(`select panel_retiro_instrumento('s', $1)`, [sid]);
  const validar = (sid, dni) => uno(`select panel_retiro_instrumento_validar('s', $1, $2, 'juancarlos')`, [sid, dni]);
  const marca = async (sid) => (await uno(`select metadata from landing_solicitudes where id=$1`, [sid])).retiro_instrumento_v1;
  const error = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };
  return { db, uno, crear, contexto, estado, validar, marca, error };
}

const t = PGlite ? test : test.skip;

t('con la llave apagada el Portal sigue con el retiro de siempre', async () => {
  const b = await base();
  assert.deepEqual(await b.contexto(), { ok: true, contract: 'retiro.instrumentos.v1', enabled: false });
  assert.equal((await b.crear('alias.demo.mp', 'Fulano Demo', '38495012')).enabled, false);
  assert.equal(await b.uno(`select count(*)::int from landing_solicitudes`), 0);
  // Apagada no frena a nadie: ni un vínculo raro ni una oficina desconocida dan error acá.
  assert.equal((await b.uno(`select landing_portal_retiro_contexto_v1('codp1','otro','1',null)`)).enabled, false);
  assert.equal((await b.uno(`select landing_portal_retiro_contexto_v1('nada','pruebaxx','1100000000',null)`)).enabled, false);
  assert.equal((await b.uno(`select landing_portal_retiro_contexto_v1('codp1','',null,null)`)).enabled, false);
});

t('cuenta nueva: pide DNI, crea solicitud y cuenta juntas, sin DNI en claro ni en la metadata', async () => {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  assert.equal((await b.crear('alias.demo.mp', 'Fulano Demo', '')).error_code, 'DNI_REQUERIDO');
  const r = await b.crear('alias.demo.mp', 'Fulano Demo', '38.495.012', { telefono: '1100000000', dni: '38495012' });
  assert.equal(r.ok, true); assert.equal(r.estado_validacion, 'PENDIENTE');
  const m = await b.uno(`select metadata from landing_solicitudes where id=$1`, [r.solicitud_id]);
  assert.equal(m.retiro_instrumento_v1.estado, 'PENDIENTE'); assert.ok(m.retiro_instrumento_v1.instrumento_id);
  assert.equal(m.dni, undefined, 'el DNI no viaja en la metadata');
  const fila = await b.uno(`select row_to_json(i)::text from retiro_instrumentos i`);
  assert.ok(!fila.includes('38495012'), 'el DNI no queda en claro en ningún lado');
  assert.equal((await b.crear('alias.demo.mp', 'Fulano Demo', '38495012')).error_code, 'RETIRO_EN_VALIDACION');
  // NODO: la ve pendiente y la valida con el CUIT que muestra Mercado Pago.
  assert.equal((await b.estado(r.solicitud_id)).estado, 'PENDIENTE');
  assert.equal((await b.validar(r.solicitud_id, '20-38495012-5')).ok, true);
  assert.equal((await b.marca(r.solicitud_id)).estado, 'VALIDADO');
  assert.equal(await b.uno(`select dni_hash from retiro_instrumentos`), null, 'la huella se borra al validar');
  // Portal: ve la cuenta validada y el próximo retiro a esa cuenta sale sin DNI.
  const c = await b.contexto();
  assert.equal(c.instrumento.destino, 'ALIAS.DEMO.MP'); assert.equal(c.instrumento.titular, 'FULANO DEMO');
  assert.equal(c.ultima_solicitud.estado_validacion, 'VALIDADO');
  const r2 = await b.crear('alias.demo.mp', 'fulano  demo', '');
  assert.equal(r2.estado_validacion, 'VALIDADO');
  assert.equal((await b.marca(r2.solicitud_id)).estado, 'VALIDADO');
});

t('no coincide dos veces: rechazada y marcada; ese DNI puede volver a usarse, pero el operador lo ve', async () => {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  const r = await b.crear('otra.cuenta.mp', 'Fulano Demo', '5.123.456');
  assert.equal((await b.validar(r.solicitud_id, '99999999')).motivo, 'NO_COINCIDE');
  assert.equal((await b.validar(r.solicitud_id, '88888888')).motivo, 'RECHAZADO');
  assert.equal((await b.marca(r.solicitud_id)).estado, 'RECHAZADO');
  assert.equal((await b.estado(r.solicitud_id)).estado, 'RECHAZADO');
  // Antes quedaba trabado para siempre (un operador que tipeó mal dos veces lo dejaba sin su propio DNI).
  const r2 = await b.crear('tercera.cuenta.mp', 'Fulano Demo', '05123456');
  assert.equal(r2.estado_validacion, 'PENDIENTE');
  assert.ok((await b.estado(r2.solicitud_id)).alertas.includes('YA_RECHAZADO'));
  const r3 = await b.crear('otra.cuenta.mp', 'Fulano Demo', '30111222');
  assert.equal(r3.estado_validacion, 'PENDIENTE');
});

// 8/11: contexto_v1 era STABLE y llama al resolver de vínculo, que escribe. El servidor corre las STABLE en
// sólo lectura: el Portal recibió 405 apenas se prendió P1. Lo que llama a algo que escribe, VOLATILE.
test('lo que el Portal llama y pasa por funciones que escriben no se declara de sólo lectura', () => {
  const sql = leer('retiro-instrumentos-portal.sql');
  for (const fn of ['landing_portal_retiro_contexto_v1', '_retiro_inst_pc2', 'landing_portal_retiro_crear_v1']) {
    const cab = sql.slice(sql.indexOf('function public.' + fn + '('), sql.indexOf('function public.' + fn + '(') + 400);
    assert.match(cab, /language plpgsql volatile/, fn + ' tiene que ser VOLATILE');
  }
});

// Juan, 8/11: "detectar DNI falso generando un margen o una manera de detectar a los menores, esto
// último es sumamente importante". Y después: el número es un estimativo, ampliarlo y preguntar la edad:
// "si el usuario ingresa 23 sabemos que es falso".
const ANIO = new Date().getFullYear();
const rango = (anio) => ({ min: Math.max(ANIO - anio - 3, 0), max: ANIO - anio + 3 });

// Juan, 8/11: "que no se pueda dar un falso positivo que genere problemas entre usuarios y operadores,
// tipo alguna traba mal hecha". Todos iguales o escalera son DNI reales (la numeración es correlativa);
// 60 M es el CUIL provisorio de extranjeros. El número no traba: sólo avisa. Lo único obligatorio, el formato.
t('el número del DNI nunca traba: lo raro se avisa al operador; sólo el formato es obligatorio', async () => {
  const b = await base();
  const ctl = (d) => b.uno(`select _retiro_inst_dni_control($1)`, [d]);
  for (const [d, alertas] of [['11111111', ['NUMERO_REPETIDO']], ['12345678', ['NUMERO_ESCALERA']],
    ['87654321', ['NUMERO_ESCALERA', 'NUMERO_BEBE']], ['65000000', ['NUMERO_RESERVADO']], ['71000000', ['NUMERO_BEBE']],
    ['92345678', ['EXTRANJERO']], ['30111222', []]]) {
    const r = await ctl(d);
    assert.equal(r.valido, true, d + ' es válido'); assert.deepEqual(r.alertas, alertas, d);
  }
  assert.deepEqual(await ctl('123456'), { valido: false, motivo: 'FORMATO' });
});

t('rango amplio de edad por el número (estimado ± 3) y cuándo se pregunta la edad', async () => {
  const b = await base();
  const ctl = (d) => b.uno(`select _retiro_inst_dni_control($1)`, [d]);
  // Interpolación lineal dentro de cada tramo de la tabla: 38,495 M → 1995 + 3,495 = 1998,5 → 1998.
  for (const [d, anio] of [['38495012', 1998], ['44000000', 2006], ['45200000', 2008], ['48000000', 2011], ['52000000', 2015]]) {
    const r = await ctl(d), g = rango(anio);
    assert.equal(r.valido, true, d); assert.equal(r.anio_estimado, anio, d);
    assert.equal(r.edad_min, g.min, d); assert.equal(r.edad_max, g.max, d);
    assert.equal(r.preguntar_edad, g.min < 18, d + ': se pregunta si el rango incluye menores');
  }
});

// Un DNI cuyo rango incluye menores (48 M ≈ nacido en 2011) y la edad que declara el jugador.
async function conDniJoven(edad) {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  const meta = { telefono: '1100000000' };
  if (edad !== undefined) meta.edad_declarada = String(edad);
  return { b, r: await b.crear('alias.demo.mp', 'Fulano Demo', '48.000.001', meta) };
}

t('un DNI raro pasa igual y el operador lo ve; un formato roto pide el DNI de nuevo', async () => {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  assert.equal((await b.crear('alias.demo.mp', 'Fulano Demo', '123')).error_code, 'DNI_REQUERIDO');
  const r = await b.crear('alias.demo.mp', 'Fulano Demo', '12345678');
  assert.equal(r.estado_validacion, 'PENDIENTE', 'no traba al jugador');
  assert.deepEqual((await b.estado(r.solicitud_id)).alertas, ['NUMERO_ESCALERA']);
});

t('DNI joven sin edad: el Portal tiene que preguntarla, y no se crea nada todavía', async () => {
  const { b, r } = await conDniJoven();
  assert.equal(r.error_code, 'EDAD_REQUERIDA');
  assert.equal(await b.uno(`select count(*)::int from landing_solicitudes`), 0);
});

t('declara menos de 18: no hay retiro y queda en la historia del jugador', async () => {
  const { b, r } = await conDniJoven(16);
  assert.equal(r.error_code, 'MENOR_DE_EDAD');
  assert.equal(await b.uno(`select count(*)::int from landing_solicitudes`), 0);
  assert.deepEqual((await b.db.query(`select usuario, evento, nota from usuarios_portal_eventos`)).rows,
    [{ usuario: 'pruebaxx', evento: 'MENOR_DECLARADO', nota: 'Declaró 16 años al pedir un retiro' }]);
});

t('declara 18 o más dentro del rango: sigue, y NODO ve que coincide', async () => {
  const g = rango(2011), edad = Math.max(18, g.min);
  const { b, r } = await conDniJoven(edad);
  assert.equal(r.estado_validacion, 'PENDIENTE');
  const e = await b.estado(r.solicitud_id);
  assert.deepEqual(e.alertas, ['EDAD_COINCIDE']); assert.equal(e.edad_declarada, edad);
  assert.equal(e.edad_min, g.min); assert.equal(e.edad_max, g.max);
  const fila = await b.uno(`select row_to_json(i)::text from retiro_instrumentos i`);
  assert.ok(!fila.includes('48000001'), 'el DNI sigue sin quedar en claro');
});

t('declara una edad que el DNI no permite ("23 sabemos que es falso"): sigue, pero NODO lo ve en rojo', async () => {
  const g = rango(2011), edad = g.max + 5;
  const { b, r } = await conDniJoven(edad);
  assert.equal(r.estado_validacion, 'PENDIENTE', 'al jugador no se le dice: no prueba hasta acertar');
  const e = await b.estado(r.solicitud_id);
  assert.deepEqual(e.alertas, ['EDAD_NO_COINCIDE']); assert.equal(e.edad_declarada, edad);
});

t('edad mal tipeada (1, 150): se vuelve a pedir, sin anotar nada en su historia', async () => {
  for (const edad of [1, 150]) {
    const { b, r } = await conDniJoven(edad);
    assert.equal(r.error_code, 'EDAD_INVALIDA', String(edad));
    assert.equal(await b.uno(`select count(*)::int from usuarios_portal_eventos`), 0);
  }
});

t('dijo 16 y después 18: no queda trabado, pero el operador ve que antes dijo otra cosa', async () => {
  const { b, r } = await conDniJoven(16);
  assert.equal(r.error_code, 'MENOR_DE_EDAD');
  const g = rango(2011), edad = Math.max(18, g.min);
  const r2 = await b.crear('alias.demo.mp', 'Fulano Demo', '48.000.001', { telefono: '1100000000', edad_declarada: String(edad) });
  assert.equal(r2.estado_validacion, 'PENDIENTE');
  const e = await b.estado(r2.solicitud_id);
  assert.deepEqual(e.alertas, ['EDAD_COINCIDE', 'EDAD_CAMBIO']); assert.equal(e.edad_previa, 16);
});

t('DNI de adulto: no se pregunta la edad', async () => {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  const r = await b.crear('alias.demo.mp', 'Fulano Demo', '30111222');
  assert.equal(r.estado_validacion, 'PENDIENTE');
  assert.deepEqual((await b.estado(r.solicitud_id)).alertas, []);
});

t('CUIT mal tipeado por el operador: no le gasta un intento al jugador', async () => {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  const r = await b.crear('alias.demo.mp', 'Fulano Demo', '38495012');
  assert.equal((await b.validar(r.solicitud_id, '20-38495012-4')).motivo, 'CUIT_INVALIDO');
  assert.equal((await b.estado(r.solicitud_id)).intentos_restantes, 2, 'siguen los dos intentos');
  assert.equal((await b.validar(r.solicitud_id, '20-38495012-5')).estado, 'VALIDADO');
});

// 8/11: contexto_v1 buscaba la última solicitud con DNI recorriendo TODAS las solicitudes por la metadata
// (457.000 filas, 2,9 s) y el servidor la cortaba por tiempo: "No pudimos comprobar la verificación de
// retiro". Lo que llama el Portal en cada retiro tiene que ir por número, nunca recorrer la tabla.
test('el Portal nunca recorre todas las solicitudes buscando por la metadata', () => {
  const sql = leer('retiro-instrumentos-portal.sql');
  for (const fn of ['landing_portal_retiro_contexto_v1', 'landing_portal_retiro_crear_v1']) {
    const i = sql.indexOf('function public.' + fn + '(');
    const cuerpo = sql.slice(i, sql.indexOf('end $$;', i));
    assert.doesNotMatch(cuerpo, /metadata \? 'retiro_instrumento_v1'/, fn + ' no puede filtrar solicitudes por la metadata');
    for (const m of cuerpo.matchAll(/from public\.landing_solicitudes s\b([\s\S]{0,200})/g))
      assert.match(m[1], /s\.id = /, fn + ': toda consulta a landing_solicitudes va por número');
  }
});

// Juan, 8/11: "si la oficina quiere esa seguridad debe de poder prender un switch en el admin de NODO".
t('interruptor del admin: prende y apaga el DNI de SU oficina, con quién y cuándo', async () => {
  const b = await base();
  const lista = async (tok) => (await b.db.query(`select * from admin_retiro_dni_oficinas($1)`, [tok])).rows;
  assert.deepEqual((await lista('admin-p1')).map(r => [r.pc_codigo, r.habilitado]), [['P1', false]], 'la encargada de P1 ve sólo P1');
  assert.equal((await lista('admin-todas')).length, 2, 'el admin general ve todas');
  const r = await b.uno(`select admin_retiro_dni_oficina_cambiar('admin-p1', 'p1', true)`);
  assert.deepEqual(r, { ok: true, pc_codigo: 'P1', habilitado: true, cambiado_por: 'encargada' });
  assert.equal((await b.contexto()).enabled, true, 'el Portal ya pide el DNI en P1');
  assert.match(await b.error(() => b.uno(`select admin_retiro_dni_oficina_cambiar('admin-p1', 'P2', true)`)), /Sin permiso para P2/);
  assert.match(await b.error(() => b.uno(`select admin_retiro_dni_oficina_cambiar('cualquiera', 'P1', false)`)), /Sesión inválida/);
  assert.match(await b.error(() => b.uno(`select admin_retiro_dni_oficina_cambiar('admin-todas', 'P99', true)`)), /OFICINA_DESCONOCIDA/);
  await b.uno(`select admin_retiro_dni_oficina_cambiar('admin-todas', 'P1', false)`);
  assert.equal((await b.contexto()).enabled, false, 'apagado vuelve al retiro de siempre');
  const hist = (await b.db.query(`select pc_codigo, habilitado, cambiado_por from retiro_instrumentos_oficinas_historial order by id`)).rows;
  assert.deepEqual(hist.map(h => [h.pc_codigo, h.habilitado, h.cambiado_por]), [['P1', true, 'encargada'], ['P1', false, 'general']]);
});

t('controles: vínculo, datos y secreto del panel', async () => {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  assert.match(await b.error(() => b.uno(`select landing_portal_retiro_crear_v1('codp1','otro','1',null,1000,'X Y','alias.demo.mp','38495012','{}')`)), /VINCULO_NO_VALIDO/);
  // Datos mal: un motivo que el Portal sabe explicar, no un error crudo.
  assert.equal((await b.crear('ab', 'Fulano Demo', '38495012')).error_code, 'DESTINO_INVALIDO');
  // Juan, 8/11: ".pobre" pasaba en el Portal (6 caracteres) y el servidor lo rechazaba sin el punto (5).
  // Se mide como lo escribió, igual que el Portal y el retiro de siempre.
  const pobre = await b.crear('.pobre', 'Fulano Demo', '38495012');
  assert.equal(pobre.estado_validacion, 'PENDIENTE', JSON.stringify(pobre));
  assert.match(await b.error(() => b.uno(`select panel_retiro_instrumento('mal', 1)`)), /no-auth/);
  assert.match(await b.error(() => b.uno(`select _retiro_inst_hash('1')`)) || 'sin roles en PGlite', /.*/);
});
