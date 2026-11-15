const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Ingresos al Portal, revisiones y revisar teléfono, por oficina (beta). El SQL real en una base en memoria
// con dos oficinas: P4 (con sus claves PC4 y SANCHEZPLATA) y P2. Datos inventados; nada de jugadores reales.

function cargarPGlite() {
  for (const nombre of [process.env.NODO_PGLITE_PATH, '@electric-sql/pglite',
    path.join(os.tmpdir(), 'nodo-beta-sql-validation/node_modules/@electric-sql/pglite')].filter(Boolean)) {
    try { return require(nombre).PGlite; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  return null;
}
const PGlite = cargarPGlite();
const leer = f => fs.readFileSync(path.join(__dirname, '../servidor', f), 'utf8');
const saltear = !PGlite && 'falta PGlite';

async function base() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$;
    create schema acceso;
    create function acceso.autorizar(p_token text, p_pc text) returns uuid language plpgsql as $$
    begin
      if p_token is distinct from 'token-' || lower(p_pc) then raise exception using errcode='42501', message='BETA_NOT_AUTHORIZED'; end if;
      return gen_random_uuid();
    end $$;
    create function acceso.oficinas_autorizadas(p text) returns text[] language plpgsql as $$
    begin
      if upper(p) = 'PX' then raise exception using errcode='42501', message='BETA_OFFICE_AMBIGUOUS'; end if;
      return case upper(p) when 'P4' then array['P4','PC4','SANCHEZPLATA'] else array[upper(p)] end;
    end $$;
    create function public.nodo_norm_usuario_v21(t text) returns text language sql immutable as $$ select lower(btrim(coalesce(t,''))) $$;
    create function public._identidad_tel(t text) returns text language sql immutable as $$ select right(regexp_replace(coalesce(t,''),'\\D','','g'), 10) $$;

    create table public.usuarios_portal_vinculos (id bigserial primary key, pc_codigo text not null, usuario text not null,
      telefono_canon text not null, estado_vinculo text not null default 'PENDIENTE', fuente text, verificado_por text,
      titular text, app_instalada boolean default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.historial_ops (id bigserial primary key, pc_codigo text, usuario text, tipo text, estado text default 'OK',
      origen text, monto numeric default 0, created_at timestamptz default now());
    create table public.landing_solicitudes (id bigserial primary key, pc_codigo text, origen text default 'PORTAL_V16', usuario text,
      telefono text, tipo text, estado text default 'PENDIENTE', metadata jsonb default '{}', created_at timestamptz default now(),
      tomada_por_operador_nombre text, tomada_at timestamptz);
    create table public.usuarios_portal_eventos (id bigserial primary key, pc_codigo text, usuario text, evento text, operador text,
      created_at timestamptz default now());
    create table public.landing_rutas_publicas (pc_codigo text);
    insert into public.landing_rutas_publicas values ('P2'), ('P4'), ('PX');
    create table public.retiro_instrumentos (id bigserial primary key, pc_codigo text, usuario text, estado text);
    create table public.rescate_candidatos (pc_codigo text, usuario text, intento_veces int, intento_ultimo timestamptz,
      fue_rechazada boolean, alguna_vez_cargo boolean);

    -- Lo que hace hoy el resolvedor del Portal, en chico.
    create function public.landing_portal_resolver_vinculo(p_pc text, p_usuario text, p_tel text) returns jsonb language plpgsql as $$
    declare v_pc text := upper(btrim(coalesce(p_pc,''))); v_u text := lower(btrim(coalesce(p_usuario,''))); v_t text := public._identidad_tel(p_tel);
    begin
      if exists (select 1 from public.usuarios_portal_vinculos where pc_codigo=v_pc and lower(usuario)=v_u and telefono_canon=v_t) then
        return jsonb_build_object('ok',true,'verdict','ACCESO','pc_codigo',v_pc,'mensaje','Acceso verificado.');
      elsif exists (select 1 from public.usuarios_portal_vinculos where pc_codigo=v_pc and lower(usuario)=v_u) then
        return jsonb_build_object('ok',false,'verdict','CONFLICTO_TELEFONO','mensaje','Este usuario ya está vinculado a otro teléfono.');
      elsif exists (select 1 from public.usuarios_portal_vinculos where pc_codigo=v_pc and telefono_canon=v_t) then
        return jsonb_build_object('ok',false,'verdict','CONFLICTO_USUARIO','mensaje','Este teléfono ya está vinculado a otro usuario.');
      end if;
      return jsonb_build_object('ok',false,'verdict','NO_REGISTRADO','mensaje','Tu usuario no figura en la base de tu oficina.');
    end $$;
    create function public.admin_od_scope_effective(p_token text, p_pc text) returns jsonb language sql as $$
      select case p_token when 'admin-todas' then jsonb_build_object('ok',true,'pc_codigo_efectivo',upper(p_pc))
                          when 'admin-p4' then jsonb_build_object('ok',true,'pc_codigo_efectivo','P4')
                          else jsonb_build_object('ok',false,'error','SESION_INVALIDA') end $$;

    create schema nodo_beta;
    create table nodo_beta.salud_actual (client_id uuid, integration text not null, stage text, state text,
      constraint salud_actual_integration_check check (integration in ('CHAT','PORTAL','TELEMETRIA','CAPACIDADES','BANDEJA',
        'IDENTIDAD','HISTORIAL','BILLETERAS','RETIROS','VALIDACION','WORKERS','AUTOMATISMOS','CONCILIACION','NEXO','ADMIN','CONEXION')));
  `);
  await db.exec(leer('beta-ingresos-revisiones-v1.sql'));
  return db;
}

// Una oficina con todos los casos. Teléfonos inventados.
async function cargarCasos(db) {
  await db.exec(`
    insert into public.usuarios_portal_vinculos (pc_codigo, usuario, telefono_canon, estado_vinculo, fuente, verificado_por, created_at) values
      ('P4','pepe',   '1122223333','VINCULADO','CSV_WHATICKET',null, now() - interval '100 days'),
      ('P4','viejo3', '1144445555','VINCULADO','CSV_WHATICKET',null, now() - interval '100 days'),
      ('P4','pend1',  '1166667777','PENDIENTE','PORTAL_PRIMER_INGRESO',null, now() - interval '40 days'),
      ('P4','pend2',  '1144445555','PENDIENTE','PORTAL_PRIMER_INGRESO',null, now() - interval '20 days'),
      ('P4','pend3',  '1188889999','PENDIENTE','SOPORTE_AUTO',null, now() - interval '5 days'),
      ('P4','nuevo4', '1199990000','VINCULADO','OPERADOR_PANEL','ana', now() - interval '1 day'),
      ('P2','pepe',   '1122223333','VINCULADO','CSV_WHATICKET',null, now() - interval '100 days'),
      ('P2','otrop2', '1155556666','PENDIENTE','PORTAL_PRIMER_INGRESO',null, now() - interval '3 days');
    -- Intentos ya anotados (en el pasado).
    insert into identidad.ingresos_portal (pc_codigo, usuario, telefono, veredicto, created_at) values
      ('P4','pepe',  '1122220000','CONFLICTO_TELEFONO', now() - interval '3 hours'),
      ('P4','pepe',  '1122223333','ACCESO',             now() - interval '170 minutes'),
      ('P4','nuevo1','1100001111','NO_REGISTRADO',      now() - interval '3 days'),
      ('P4','nuevo2','1100002222','NO_REGISTRADO',      now() - interval '30 minutes'),
      ('P4','nuevo3','1144445555','CONFLICTO_USUARIO',  now() - interval '5 hours'),
      ('P4','nuevo5','1100005555','NO_REGISTRADO',      now() - interval '10 hours'),
      ('P2','otrop2','1155556666','NO_REGISTRADO',      now() - interval '2 hours');
    -- Tickets de soporte: el de nuevo4 lo validó un operador después; el de pepe es de alguien ya validado.
    insert into public.landing_solicitudes (pc_codigo, usuario, telefono, tipo, estado, created_at) values
      ('P4','nuevo4','1199990000','SOPORTE','CERRADO', now() - interval '2 days'),
      ('P4','pepe',  '1122223333','SOPORTE','CERRADO', now() - interval '1 day'),
      ('P2','otrop2','1155556666','SOPORTE','PENDIENTE', now() - interval '2 hours');
    -- pend1 ya opera (cargado con la clave vieja PC4).
    insert into public.historial_ops (pc_codigo, usuario, tipo, origen, monto, created_at) values
      ('PC4','pend1','CARGA','LANDING', 5000, now() - interval '10 days'),
      ('P4','pend2','CARGA','PROMO_BONO', 1000, now() - interval '15 days'),
      ('P4','viejo3','CARGA','PROMO_BONO', 1000, now() - interval '60 days'),
      ('P2','otrop2','CARGA','PROMO_BONO', 1000, now() - interval '1 day');
  `);
}

const uno = async (db, sql, p) => (await db.query(sql, p)).rows[0];
const r = async (db, sql, p) => (await uno(db, `select ${sql} as r`, p)).r;

test('entrar al Portal: devuelve lo mismo que el resolvedor de siempre y anota el intento una vez', { skip: saltear }, async () => {
  const db = await base();
  await cargarCasos(db);
  const viejo = await r(db, `public.landing_portal_resolver_vinculo('P4','pepe','11 2222-0000')`);
  const nuevo = await r(db, `public.landing_portal_ingreso_v1('P4','pepe','11 2222-0000')`);
  assert.deepEqual(nuevo, viejo);
  assert.equal(nuevo.verdict, 'CONFLICTO_TELEFONO');
  await r(db, `public.landing_portal_ingreso_v1('P4','pepe','11 2222-0000')`);   // doble toque
  const filas = (await db.query(`select usuario, telefono, veredicto, origen from identidad.ingresos_portal where created_at > now() - interval '1 minute'`)).rows;
  assert.deepEqual(filas, [{ usuario: 'pepe', telefono: '1122220000', veredicto: 'CONFLICTO_TELEFONO', origen: 'FORMULARIO' }]);

  // Si anotar falla, el jugador igual entra.
  await db.exec('alter table identidad.ingresos_portal rename to ingresos_portal_roto');
  assert.equal((await r(db, `public.landing_portal_ingreso_v1('P4','pepe','1122223333','REINTENTO')`)).verdict, 'ACCESO');
});

test('ingresos por oficina: quién corrigió, quién ya tenía usuario, quién espera, quién abandonó', { skip: saltear }, async () => {
  const db = await base();
  await cargarCasos(db);
  const ing = await r(db, `public.nodo_beta_ingresos_v1('token-p4','p4',7)`);
  assert.equal(ing.ok, true);
  assert.equal(ing.contract, 'ingresos.v1');
  const caso = u => ing.casos.find(c => c.usuario === u);
  assert.equal(caso('pepe').resultado, 'CORRIGIO');
  assert.equal(caso('pepe').entro_con, 'pepe');
  assert.deepEqual(caso('pepe').telefonos, ['…0000'], 'del teléfono sólo se ven los últimos 4');
  assert.equal(caso('nuevo3').resultado, 'ES_OTRO_USUARIO');
  assert.equal(caso('nuevo3').otro_usuario, 'viejo3');
  assert.equal(caso('nuevo2').resultado, 'EN_CURSO');
  assert.equal(caso('nuevo5').resultado, 'ESPERANDO');
  assert.equal(caso('nuevo1').resultado, 'ABANDONO');
  assert.equal(caso('nuevo4').resultado, 'VALIDADO', 'pidió por soporte y un operador lo vinculó después');
  assert.equal(caso('nuevo4').por_soporte, true);
  assert.equal(ing.casos.some(c => c.usuario === 'pepe' && c.por_soporte), false, 'el ticket de alguien ya validado no es un pedido de entrada');

  assert.deepEqual(
    { ...ing.resumen },
    { pedidos: 6, corrigieron: 1, operan: 0, validados: 1, es_otro_usuario: 1, otro_telefono: 0, bloqueados: 0,
      en_curso: 1, esperando: 1, abandonos: 1, intentos_anotados: 6, vinculos_pendientes: 3, vinculos_pendientes_opera: 1 });
  assert.equal(ing.por_respuesta.NO_REGISTRADO, 3);

  const pend = u => ing.pendientes.find(p => p.usuario === u);
  assert.equal(pend('pend1').opera, true, 'cargó con la clave PC4 de la misma oficina');
  assert.equal(pend('pend2').otro_usuario, 'viejo3');
  assert.equal(pend('pend3').dias, 5);

  // Nada de otra oficina.
  assert.doesNotMatch(JSON.stringify(ing), /otrop2/);
});

test('revisiones por oficina: cada cotejo con su número, en castellano y sin mezclar oficinas', { skip: saltear }, async () => {
  const db = await base();
  await cargarCasos(db);
  await db.exec(`
    insert into public.landing_solicitudes (pc_codigo, usuario, tipo, estado, created_at, tomada_por_operador_nombre, tomada_at, metadata) values
      ('P4','pepe',  'CARGA','PENDIENTE', now() - interval '2 hours', null, null, '{}'),
      ('P4','pepe',  'CARGA','PENDIENTE', now() - interval '10 minutes', null, null, '{}'),
      ('P2','otrop2','CARGA','PENDIENTE', now() - interval '5 hours', null, null, '{}'),
      ('P4','viejo3','RETIRO','EN_PROCESO', now() - interval '6 hours', 'ana', now() - interval '5 hours', '{"destino":"alias.otro"}'),
      ('P4','pepe',  'RETIRO','PAGADA', now() - interval '3 days', null, null, '{"destino":"Alias.Compartido"}'),
      ('P4','viejo3','RETIRO','PAGADA', now() - interval '2 days', null, null, '{"destino":"alias.compartido"}'),
      ('P2','otrop2','RETIRO','PAGADA', now() - interval '2 days', null, null, '{"destino":"alias.compartido"}');
    insert into public.retiro_instrumentos (pc_codigo, usuario, estado) values ('P4','pepe','PENDIENTE'), ('P2','otrop2','PENDIENTE');
    insert into public.usuarios_portal_eventos (pc_codigo, usuario, evento, operador, created_at) values
      ('P4','vani','CAMBIO_TELEFONO','opA', now() - interval '3 days'),
      ('P4','vani','USUARIO_REEMPLAZADO','opB', now() - interval '2 days'),
      ('P4','menor1','MENOR_DECLARADO', null, now() - interval '4 days'),
      ('P2','x','MENOR_DECLARADO', null, now() - interval '4 days');
    insert into public.rescate_candidatos values ('P4','amedias',2, now() - interval '1 day', true, false), ('P2','otro',1, now(), false, false);
  `);
  const rev = await r(db, `public.nodo_beta_revisiones_v1('token-p4','P4')`);
  const item = c => rev.items.find(i => i.clave === c);
  const numeros = Object.fromEntries(rev.items.map(i => [i.clave, i.cantidad]));
  assert.deepEqual(numeros, {
    VALIDACION_PENDIENTE: 5, USUARIO_DE_MAS: 1, INGRESO_ABANDONADO: 1, PRIMERA_CARGA_A_MEDIAS: 1,
    SOLICITUD_SIN_ATENDER: 1, TOMADA_SIN_CERRAR: 1, CUENTA_COMPARTIDA: 1, DNI_PENDIENTE: 1,
    CAMBIO_DE_USUARIO: 1, MENOR_DECLARADO: 1, BONO_REPETIDO: 1 });
  assert.equal(item('CAMBIO_DE_USUARIO').nivel, 'ALTO', 'dos operadores distintos en la semana');
  assert.match(item('CAMBIO_DE_USUARIO').ejemplos[0].dato, /opA · opB/);
  assert.match(item('CUENTA_COMPARTIDA').ejemplos[0].dato, /^2 usuarios · alias\.compartido$/, 'la de P2 no suma');
  assert.match(item('TOMADA_SIN_CERRAR').ejemplos[0].dato, /^ana · hace 5 h$/);
  assert.match(item('USUARIO_DE_MAS').ejemplos[0].dato, /su teléfono ya es de viejo3/);
  assert.match(item('PRIMERA_CARGA_A_MEDIAS').ejemplos[0].dato, /2 intento\(s\) · le rechazaron una/);
  assert.match(item('BONO_REPETIDO').ejemplos[0].usuario, /pend2 · viejo3/);
  for (const i of rev.items) {
    assert.ok(i.titulo && i.explicacion && i.grupo, i.clave + ' tiene textos');
    assert.doesNotMatch(i.titulo + i.explicacion, /[A-Z]{4,}_|null|undefined/, i.clave + ': nada técnico en pantalla');
  }
  assert.doesNotMatch(JSON.stringify(rev), /otrop2|"otro"/);
});

test('revisar un teléfono: sólo dentro de la oficina, con el mismo veredicto y textos de siempre', { skip: saltear }, async () => {
  const db = await base();
  await cargarCasos(db);
  await db.exec(`insert into public.landing_solicitudes (pc_codigo, usuario, tipo, estado, metadata, created_at) values
    ('P4','pepe','RETIRO','PAGADA','{"destino":"alias.compartido"}', now() - interval '3 days'),
    ('P4','viejo3','RETIRO','PAGADA','{"destino":"alias.compartido"}', now() - interval '2 days')`);

  const dos = await r(db, `public.nodo_beta_prevalidar_v1('token-p4','P4','11 4444-5555',null)`);
  assert.equal(dos.ok, true);
  assert.equal(dos.veredicto, 'YA_EXISTE');
  assert.equal(dos.aqui, 2);
  assert.equal(dos.otras, 0);
  assert.equal(dos.bonos, 2);
  assert.equal(dos.telefono_fin, '5555');
  assert.ok(dos.motivos.some(m => /ya tiene 2 usuario\(s\) en esta oficina/.test(m.texto)));
  assert.ok(dos.motivos.some(m => /ya cobró 2 bono/.test(m.texto)));
  assert.ok(dos.motivos.some(m => /comparte con otro usuario/.test(m.texto)));
  assert.doesNotMatch(JSON.stringify(dos.motivos), /otras oficinas/);

  const pepe = await r(db, `public.nodo_beta_prevalidar_v1('token-p4','P4','1122223333',null)`);
  assert.equal(pepe.aqui, 1, 'el pepe de P2 no cuenta');

  const libre = await r(db, `public.nodo_beta_prevalidar_v1('token-p4','P4','1177776666','libre')`);
  assert.equal(libre.veredicto, 'LIBRE');
  assert.equal(libre.motivos[0].texto, 'Sin antecedentes en esta oficina. Se puede crear.');

  const usuario = await r(db, `public.nodo_beta_prevalidar_v1('token-p4','P4',null,'Pend1')`);
  assert.equal(usuario.usuario_existe, true);
  assert.equal(usuario.veredicto, 'YA_EXISTE');

  assert.equal((await r(db, `public.nodo_beta_prevalidar_v1('token-p4','P4',null,null)`)).error, 'FALTA_TELEFONO_O_USUARIO');
});

test('sin la llave de la PC no se lee nada; el admin ve una oficina o los números de todas', { skip: saltear }, async () => {
  const db = await base();
  await cargarCasos(db);
  await assert.rejects(db.query(`select public.nodo_beta_ingresos_v1('token-p2','P4',7)`), /BETA_NOT_AUTHORIZED/);
  await assert.rejects(db.query(`select public.nodo_beta_revisiones_v1(null,'P4')`), /BETA_NOT_AUTHORIZED/);
  await assert.rejects(db.query(`select public.nodo_beta_ingresos_v1('token-p4','P4',0)`), /BETA_INVALID_DAYS/);
  await assert.rejects(db.query(`select public.nodo_beta_prevalidar_v1('token-p4','P4',repeat('1',50),null)`), /BETA_INVALID_INPUT/);

  assert.equal((await r(db, `public.admin_revisiones_v1('malo')`)).ok, false);
  const p4 = await r(db, `public.admin_revisiones_v1('admin-p4')`);
  assert.equal(p4.pc_codigo, 'P4');
  assert.ok(p4.items.length >= 8);

  const todas = await r(db, `public.admin_revisiones_v1('admin-todas')`);
  assert.deepEqual(todas.oficinas.map(o => o.pc), ['P2', 'P4', 'PX']);
  assert.equal(todas.oficinas.find(o => o.pc === 'PX').error, 'NO_SE_PUDO_LEER', 'una oficina rota no tapa a las demás');
  const vp = todas.oficinas.find(o => o.pc === 'P4').items.find(i => i.clave === 'VALIDACION_PENDIENTE');
  assert.equal(vp.cantidad, 5);
  assert.equal(todas.oficinas.find(o => o.pc === 'P4').items.some(i => i.ejemplos), false, 'todas = sólo números');
});

test('el canal de salud acepta CRM, ingresos y revisiones; la vuelta atrás deja todo como estaba', { skip: saltear }, async () => {
  const db = await base();
  await cargarCasos(db);
  await db.exec(`insert into nodo_beta.salud_actual (integration) values ('CRM'), ('INGRESOS'), ('REVISIONES')`);
  await db.exec(leer('beta-ingresos-revisiones-v1-vuelta-atras.sql'));
  const quedan = (await db.query(`select count(*)::int n from pg_proc where proname in ('landing_portal_ingreso_v1','nodo_beta_ingresos_v1',
    'nodo_beta_revisiones_v1','nodo_beta_prevalidar_v1','admin_revisiones_v1','ingresos_v1','revisiones_v1','prevalidar_v1')`)).rows[0].n;
  assert.equal(quedan, 0);
  assert.equal((await uno(db, `select to_regclass('identidad.ingresos_portal') t`)).t, null);
  await assert.rejects(db.query(`insert into nodo_beta.salud_actual (integration) values ('CRM')`), /salud_actual_integration_check/);
  assert.equal((await uno(db, `select count(*)::int n from public.usuarios_portal_vinculos`)).n, 8, 'los vínculos siguen intactos');
  assert.equal((await r(db, `public.landing_portal_resolver_vinculo('P4','pepe','1122223333')`)).verdict, 'ACCESO');
});
