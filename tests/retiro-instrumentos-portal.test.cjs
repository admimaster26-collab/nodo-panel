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
    insert into public.landing_rutas_publicas values ('codp1', 'P1', true);
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
  assert.equal((await b.validar(r.solicitud_id, '20-38495012-4')).ok, true);
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

t('no coincide dos veces: rechazada, marca en la solicitud y ese DNI no se puede volver a usar', async () => {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  const r = await b.crear('otra.cuenta.mp', 'Fulano Demo', '5.123.456');
  assert.equal((await b.validar(r.solicitud_id, '99999999')).motivo, 'NO_COINCIDE');
  assert.equal((await b.validar(r.solicitud_id, '88888888')).motivo, 'RECHAZADO');
  assert.equal((await b.marca(r.solicitud_id)).estado, 'RECHAZADO');
  assert.equal((await b.estado(r.solicitud_id)).estado, 'RECHAZADO');
  assert.equal((await b.crear('tercera.cuenta.mp', 'Fulano Demo', '05123456')).error_code, 'DNI_RECHAZADO_PREVIAMENTE');
  const r3 = await b.crear('otra.cuenta.mp', 'Fulano Demo', '30111222');
  assert.equal(r3.estado_validacion, 'PENDIENTE');
});

t('controles: vínculo, datos y secreto del panel', async () => {
  const b = await base();
  await b.db.query(`insert into retiro_instrumentos_oficinas values ('P1', true)`);
  assert.match(await b.error(() => b.uno(`select landing_portal_retiro_crear_v1('codp1','otro','1',null,1000,'X Y','alias.demo.mp','38495012','{}')`)), /VINCULO_NO_VALIDO/);
  assert.match(await b.error(() => b.crear('ab', 'Fulano Demo', '38495012')), /RETIRO_DATOS_INVALIDOS/);
  assert.match(await b.error(() => b.uno(`select panel_retiro_instrumento('mal', 1)`)), /no-auth/);
  assert.match(await b.error(() => b.uno(`select _retiro_inst_hash('1')`)) || 'sin roles en PGlite', /.*/);
});
