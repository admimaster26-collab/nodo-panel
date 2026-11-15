const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Monitor de canales (fase 0): el SQL real en una base en memoria. pg_stat_statements se reemplaza por una
// tabla con consultas copiadas tal cual las arma PostgREST, para poder mover los contadores a mano.

function cargarPGlite() {
  for (const nombre of [process.env.NODO_PGLITE_PATH, '@electric-sql/pglite',
    path.join(os.tmpdir(), 'nodo-beta-sql-validation/node_modules/@electric-sql/pglite')].filter(Boolean)) {
    try { return require(nombre).PGlite; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  return null;
}
const PGlite = cargarPGlite();
const SQL = fs.readFileSync(path.join(__dirname, '../servidor/canales-monitor.sql'), 'utf8');
const VUELTA = fs.readFileSync(path.join(__dirname, '../servidor/canales-monitor-vuelta-atras.sql'), 'utf8');

// Formas reales (recortadas) de lo que manda PostgREST.
const Q = {
  rpcEscalar: fn => `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_pc_codigo" FROM json_to_record(pgrst_payload.json_data) AS _("p_pc_codigo" text) LIMIT $4) pgrst_body , LATERAL (SELECT "public"."${fn}"("p_pc_codigo" := pgrst_body."p_pc_codigo") pgrst_scalar) pgrst_call) SELECT 1`,
  rpcTabla: fn => `WITH pgrst_source AS (SELECT "pgrst_call".* FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_pc_codigos", "p_secret" FROM json_to_record(pgrst_payload.json_data) AS _("p_pc_codigos" text[], "p_secret" text) LIMIT $4) pgrst_body , LATERAL "public"."${fn}"("p_pc_codigos" := pgrst_body."p_pc_codigos") pgrst_call) SELECT 1`,
  tabla: t => `WITH pgrst_source AS ( SELECT "public"."${t}"."id", "public"."${t}"."usuario" FROM "public"."${t}" WHERE "public"."${t}"."pc_codigo" = ANY ($1) ) SELECT 1`
};

async function base() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema extensions;
    create table public.estadisticas_falsas (userid oid, queryid bigint, query text, calls bigint, total_exec_time double precision);
    create view extensions.pg_stat_statements as select * from public.estadisticas_falsas;
    create function public.panel_validar_admin_session(p text) returns table(ok boolean, usuario text, puede_todas boolean)
      language sql as $$ select p in ('admin-todas','admin-p1'), 'x'::text, p = 'admin-todas' $$;
    create schema nodo_beta;
    create table nodo_beta.beta_clientes (id uuid primary key, pc_codigo text, enabled boolean);
    create table nodo_beta.salud_actual (client_id uuid, integration text, stage text, state text, code text,
      last_error_code text, received_at timestamptz);
  `);
  await db.exec(SQL);
  return db;
}

async function ponerStats(db, filas) {
  await db.exec('delete from public.estadisticas_falsas');
  const anon = (await db.query(`select oid from pg_roles where rolname='anon'`)).rows[0].oid;
  for (const [queryid, query, calls, ms] of filas) {
    await db.query('insert into public.estadisticas_falsas values ($1,$2,$3,$4,$5)', [anon, queryid, query, calls, ms]);
  }
}
const uno = async (db, sql, p) => (await db.query(sql, p)).rows[0];

test('reconoce el canal de cada consulta como la arma PostgREST', { skip: !PGlite && 'falta PGlite' }, async () => {
  const db = await base();
  const canal = async q => (await uno(db, 'select nodo_monitor._canal($1) c', [q])).c;
  assert.equal(await canal(Q.rpcEscalar('panel_v15_5_listar_solicitudes_portal')), 'panel_v15_5_listar_solicitudes_portal');
  assert.equal(await canal(Q.rpcTabla('panel_crm_vinculos')), 'panel_crm_vinculos');
  assert.equal(await canal(Q.tabla('historial_ops')), 'tabla:historial_ops');
  assert.equal(await canal('select set_config($1, $2, true)'), null, 'lo interno de PostgREST no es un canal');
});

test('la primera foto sólo se anota; la segunda mide la diferencia por canal, y aguanta contadores reiniciados', { skip: !PGlite && 'falta PGlite' }, async () => {
  const db = await base();
  await ponerStats(db, [[1, Q.rpcEscalar('panel_bandeja_senal'), 100, 500], [2, Q.tabla('historial_ops'), 10, 1000]]);
  const f1 = (await uno(db, 'select nodo_monitor.tomar_foto() r')).r;
  assert.equal(f1.primera, true);
  assert.equal((await uno(db, 'select count(*)::int n from nodo_monitor.medicion')).n, 0, 'sin foto anterior no se inventa nada');

  // Bandeja: +20 llamadas. Historial: el servidor reinició el contador (bajó a 4).
  await ponerStats(db, [[1, Q.rpcEscalar('panel_bandeja_senal'), 120, 700], [2, Q.tabla('historial_ops'), 4, 80]]);
  await uno(db, 'select nodo_monitor.tomar_foto() r');
  const m = Object.fromEntries((await db.query('select canal, llamadas::int n, ms_total::int ms from nodo_monitor.medicion')).rows.map(r => [r.canal, r]));
  assert.deepEqual([m.panel_bandeja_senal.n, m.panel_bandeja_senal.ms], [20, 200]);
  assert.deepEqual([m['tabla:historial_ops'].n, m['tabla:historial_ops'].ms], [4, 80]);
});

test('alerta de lento y de cerca del corte; se cierra sola cuando vuelve a lo normal', { skip: !PGlite && 'falta PGlite' }, async () => {
  const db = await base();
  const medir = async (canal, n, ms) => db.query(
    `insert into nodo_monitor.medicion values (date_trunc('minute', now()) - interval '5 minutes', $1, $2, $3)
     on conflict (ventana, canal) do update set llamadas = excluded.llamadas, ms_total = excluded.ms_total`, [canal, n, ms]);
  await medir('panel_crm_agente_resumen', 10, 10 * 1800);   // umbral 1.500 → LENTO
  await medir('admin_od_dashboard_v3', 5, 5 * 2600);        // ≥ 2.000 → CERCA_DEL_CORTE
  await medir('panel_bandeja_senal', 1000, 1000 * 3);       // normal
  await uno(db, 'select nodo_monitor.evaluar() r');
  let abiertas = (await db.query('select canal, tipo, detalle from nodo_monitor.alertas where cerrada_at is null order by canal')).rows;
  assert.deepEqual(abiertas.map(a => a.canal + ':' + a.tipo), ['admin_od_dashboard_v3:CERCA_DEL_CORTE', 'panel_crm_agente_resumen:LENTO']);
  assert.match(abiertas[0].detalle, /Admin: tablero de inicio: tarda 2600 ms en promedio \(el servidor corta a los 3\.000\)/);

  await uno(db, 'select nodo_monitor.evaluar() r');
  assert.equal((await uno(db, `select veces from nodo_monitor.alertas where canal='panel_crm_agente_resumen' and cerrada_at is null`)).veces, 2, 'la misma alerta se renueva, no se duplica');

  await medir('panel_crm_agente_resumen', 10, 10 * 300);
  await uno(db, 'select nodo_monitor.evaluar() r');
  abiertas = (await db.query('select canal from nodo_monitor.alertas where cerrada_at is null')).rows;
  assert.deepEqual(abiertas.map(a => a.canal), ['admin_od_dashboard_v3']);
  assert.ok((await uno(db, `select cerrada_at from nodo_monitor.alertas where canal='panel_crm_agente_resumen'`)).cerrada_at, 'quedó cerrada, con fecha');
});

test('sin señal: sólo con una hora medida y con NODO andando (de madrugada o recién publicado no salta)', { skip: !PGlite && 'falta PGlite' }, async () => {
  const db = await base();
  // La bandeja espera ≥ 250 por hora; hubo 3.
  await db.exec(`insert into nodo_monitor.medicion values (date_trunc('minute', now()) - interval '10 minutes', 'panel_v15_5_listar_solicitudes_portal', 3, 30)`);
  await db.exec(`insert into nodo_monitor.medicion values (date_trunc('minute', now()) - interval '10 minutes', 'panel_registrar_actividad', 500, 400)`);
  await uno(db, 'select nodo_monitor.evaluar() r');
  assert.equal((await uno(db, `select count(*)::int n from nodo_monitor.alertas where tipo='SIN_SENAL'`)).n, 0, 'recién publicado: no hay una hora de historia');

  await db.exec(`insert into nodo_monitor.corridas (at, canales, llamadas, abiertas, ms) values (now() - interval '70 minutes', 0, 0, 0, 1)`);
  await uno(db, 'select nodo_monitor.evaluar() r');
  const a = await uno(db, `select canal, detalle from nodo_monitor.alertas where tipo='SIN_SENAL' and cerrada_at is null
    and canal = 'panel_v15_5_listar_solicitudes_portal'`);
  assert.ok(a, 'la bandeja con 3 llamadas en una hora salta');
  assert.match(a.detalle, /3 llamadas en la última hora/);
  assert.equal((await uno(db, `select count(*)::int n from nodo_monitor.alertas where tipo='SIN_SENAL' and canal='panel_registrar_actividad'`)).n, 0,
    'el latido con 500 llamadas no salta');

  await db.exec(`delete from nodo_monitor.medicion where canal = 'panel_registrar_actividad'`);
  await uno(db, 'select nodo_monitor.evaluar() r');
  assert.equal((await uno(db, `select count(*)::int n from nodo_monitor.alertas where tipo='SIN_SENAL' and cerrada_at is null`)).n, 0,
    'sin latidos de NODO (nadie trabajando) el silencio no es una falla');
});

test('junta lo que informan las PCs (una consulta cortada por demora sólo la ve la PC)', { skip: !PGlite && 'falta PGlite' }, async () => {
  const db = await base();
  await db.exec(`
    insert into nodo_beta.beta_clientes values ('00000000-0000-0000-0000-000000000001', 'P1', true);
    insert into nodo_beta.salud_actual values ('00000000-0000-0000-0000-000000000001', 'RETIROS', 'DATA', 'ERROR', 'X', 'CUENTA_COBRO_NO_LEIDA', now());
    insert into nodo_beta.salud_actual values ('00000000-0000-0000-0000-000000000001', 'CHAT', 'DATA', 'OK', null, null, now());
    insert into nodo_beta.salud_actual values ('00000000-0000-0000-0000-000000000001', 'BANDEJA', 'DATA', 'ERROR', 'Y', 'VIEJO', now() - interval '1 hour');`);
  await uno(db, 'select nodo_monitor.evaluar() r');
  const fallas = (await db.query(`select canal, detalle from nodo_monitor.alertas where tipo='FALLA_EN_PC'`)).rows;
  assert.deepEqual(fallas.map(f => f.canal), ['P1 · RETIROS'], 'sólo lo reciente y lo que falló');
  assert.match(fallas[0].detalle, /CUENTA_COBRO_NO_LEIDA/);
});

test('la lectura es sólo para el admin general y no deja ver datos de jugadores', { skip: !PGlite && 'falta PGlite' }, async () => {
  const db = await base();
  assert.equal((await uno(db, `select public.admin_canales_estado_v1('cualquiera') r`)).r.error, 'SESION_INVALIDA');
  assert.equal((await uno(db, `select public.admin_canales_estado_v1('admin-p1') r`)).r.error, 'SOLO_ADMIN_GENERAL');
  await db.exec(`insert into nodo_monitor.corridas (canales, llamadas, abiertas, ms) values (1, 10, 0, 3);
    insert into nodo_monitor.medicion values (date_trunc('minute', now()), 'panel_bandeja_senal', 40, 120),
                                             (date_trunc('minute', now()), 'funcion_nueva_sin_catalogo', 7, 70);`);
  const r = (await uno(db, `select public.admin_canales_estado_v1('admin-todas') r`)).r;
  assert.equal(r.ok, true);
  assert.equal(r.monitor_vivo, true);
  const bandeja = r.canales.find(c => c.canal === 'panel_bandeja_senal');
  assert.deepEqual([bandeja.llamadas_1h, Number(bandeja.media_ms_1h), bandeja.que_hace], [40, 3, 'Aviso de solicitudes nuevas']);
  assert.deepEqual(r.sin_catalogar.map(c => c.canal), ['funcion_nueva_sin_catalogo'], 'lo que no está en el catálogo también se ve');
  // Sólo contadores y textos del catálogo: ningún campo de jugador.
  assert.deepEqual(Object.keys(bandeja).sort(), ['canal', 'consumidor', 'llamadas_1h', 'llamadas_24h', 'media_ms_1h', 'media_ms_24h',
    'nota', 'que_hace', 'reemplazo', 'segundos_servidor_24h', 'umbral_ms']);
  assert.deepEqual(Object.keys(r).sort(), ['alertas', 'canales', 'monitor_ultima_corrida', 'monitor_vivo', 'ok', 'sin_catalogar']);
});

test('correr junta foto + evaluación y deja constancia; la vuelta atrás borra todo', { skip: !PGlite && 'falta PGlite' }, async () => {
  const db = await base();
  await ponerStats(db, [[1, Q.rpcEscalar('panel_bandeja_senal'), 1, 1]]);
  const r = (await uno(db, 'select nodo_monitor.correr() r')).r;
  assert.equal(r.ok, true);
  assert.equal((await uno(db, 'select count(*)::int n from nodo_monitor.corridas')).n, 1);
  await db.exec(VUELTA);
  assert.equal((await uno(db, `select count(*)::int n from pg_namespace where nspname='nodo_monitor'`)).n, 0);
});
