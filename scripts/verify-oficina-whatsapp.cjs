'use strict';

// Prueba de servidor/oficina-whatsapp.sql en PostgreSQL aislado en memoria (PGlite), sin red ni
// credenciales. Aparte de verify-beta-server.cjs porque ese arma otra fixture de
// landing_rutas_publicas y lo están tocando otros. Las funciones de la fixture son copia exacta
// de producción (pg_get_functiondef, 2/11): _panel_data_auth, nodo_norm_telefono_v21 y
// landing_resolver_ruta_publica.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const SECRET = 'secreto-de-prueba';
const FN = 'public.panel_oficina_whatsapp_registrar(text,text,text,text)';

function resolvePGlite() {
  for(const name of [process.env.NODO_PGLITE_PATH, '@electric-sql/pglite', path.join(os.tmpdir(), 'nodo-beta-sql-validation/node_modules/@electric-sql/pglite')].filter(Boolean)) {
    try { return require(name).PGlite; } catch(error) { if(error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Falta PGlite. Indicar una instalacion existente mediante NODO_PGLITE_PATH; este script no instala dependencias.');
}

const fixture = `
create role anon; create role authenticated; create role service_role; create role tercero;
grant usage on schema public to anon,authenticated,service_role,tercero;
create table public.panel_secrets (id integer primary key, data_secret text);
insert into public.panel_secrets values (1, '${SECRET}');
CREATE OR REPLACE FUNCTION public._panel_data_auth(p_secret text)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.panel_secrets where id=1 and data_secret = p_secret);
$function$;
CREATE OR REPLACE FUNCTION public.nodo_norm_telefono_v21(p_tel text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  select nullif(regexp_replace(coalesce(p_tel,''), '[^0-9]', '', 'g'), '');
$function$;
create table public.landing_rutas_publicas (
 id bigserial primary key, public_code text not null unique, pc_codigo text not null,
 nombre_publico text, link_plataforma text default 'https://www.bet-300.pw/', whatsapp_numero text,
 activo boolean default true, created_at timestamptz default now(), updated_at timestamptz default now(),
 subdominio text, host text, promo_activa boolean default false, min_carga integer, min_retiro integer
);
alter table public.landing_rutas_publicas enable row level security;
grant all on public.landing_rutas_publicas to anon, authenticated;
create table public.panel_operativo_auditoria (
 id bigserial primary key, created_at timestamptz not null default now(), pc_codigo text, operador text,
 accion text not null, entidad text, entidad_id bigint, worker_job_id bigint, solicitud_id bigint,
 billetera_id bigint, billetera_origen_id bigint, billetera_destino_id bigint, monto numeric,
 signo integer, valor_anterior jsonb, valor_nuevo jsonb, motivo text, metadata jsonb not null default '{}'::jsonb
);
alter table public.panel_operativo_auditoria enable row level security;
CREATE OR REPLACE FUNCTION public.landing_resolver_ruta_publica(p_public_code text)
 RETURNS TABLE(ok boolean, pc_codigo text, public_code text, host text, nombre_publico text, link_plataforma text, whatsapp_numero text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  return query
  select true, r.pc_codigo, r.public_code, nullif(btrim(coalesce(r.host,'')),''),
         coalesce(r.nombre_publico,'Canal'),
         coalesce(r.link_plataforma,'https://www.bet-300.pw/'),
         coalesce(r.whatsapp_numero,'')
  from public.landing_rutas_publicas r
  where r.public_code = trim(coalesce(p_public_code,'')) and r.activo = true
  limit 1;
  if not found then
    return query select false, null::text, null::text, null::text, null::text, null::text, null::text;
  end if;
end;
$function$;
insert into public.landing_rutas_publicas(public_code,pc_codigo,whatsapp_numero,activo,updated_at) values
 ('demo-p1','P1','5491100000001',true,'2026-01-01'),
 ('demo-p2','P2','5492990000002',true,'2026-01-01'),
 ('demo-p3','P3',null,true,'2026-01-01'),
 ('demo-p4','P4','5493510000004',true,'2026-01-01'),
 ('demo-p4-viejo','P4','5493510000099',false,'2026-01-01');
`;

async function main() {
  const PGlite = resolvePGlite(), db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const results = [];
  let savepoint = 0;
  async function registrar(secret, pc, numero, operador = null) {
    const sp = 'rpc_' + ++savepoint;
    await db.exec(`savepoint ${sp}; set local role anon;`);
    try {
      const rows = await query('select public.panel_oficina_whatsapp_registrar($1,$2,$3,$4) as r', [secret, pc, numero, operador]);
      await db.exec(`reset role; release savepoint ${sp};`);
      return rows[0].r;
    } catch(error) {
      await db.exec(`rollback to savepoint ${sp}; release savepoint ${sp};`);
      throw error;
    }
  }
  const numero = async pc => (await query("select whatsapp_numero as n from public.landing_rutas_publicas where pc_codigo=$1 and activo order by id limit 1", [pc]))[0].n;
  const rutas = () => query('select id, pc_codigo, whatsapp_numero, updated_at::text as u from public.landing_rutas_publicas order by id');
  const auditoria = () => query("select pc_codigo, entidad_id, valor_anterior, valor_nuevo from public.panel_operativo_auditoria where accion='WHATSAPP_OFICINA' order by id");
  async function check(name, run) {
    await db.exec('begin');
    try { await run(); results.push({ name, ok: true }); }
    catch(error) { results.push({ name, ok: false, error: String(error.message).slice(0, 600) }); }
    finally { await db.exec('rollback'); }
  }

  await db.exec(fixture);
  const source = fs.readFileSync(path.join(ROOT, 'servidor/oficina-whatsapp.sql'), 'utf8');
  await db.exec(source);
  await db.exec(source); // se puede volver a correr

  await check('secreto invalido: no-auth y no toca nada', async () => {
    const antes = await rutas();
    await assert.rejects(registrar('otro', 'P3', '11 2345 6789'), /no-auth/);
    await assert.rejects(registrar(null, 'P3', '11 2345 6789'), /no-auth/);
    assert.deepEqual(await rutas(), antes);
    assert.equal((await auditoria()).length, 0);
  });

  for(const entrada of ['+54 9 11 2345-6789', '011 2345 6789', '11 2345 6789', '5491123456789', '541123456789', '9 11 2345 6789', '+54 0 11 2345 6789', ' (11) 2345.6789 '])
    await check('normaliza ' + JSON.stringify(entrada), async () => {
      const r = await registrar(SECRET, 'p3 ', entrada);
      assert.deepEqual(r, { ok: true, cambio: true, pc: 'P3', whatsapp_numero: '5491123456789', anterior: null, rutas: 1 });
      assert.equal(await numero('P3'), '5491123456789');
    });

  await check('normaliza area de 3 y 4 digitos', async () => {
    assert.equal((await registrar(SECRET, 'P3', '0351 15 ')).ok, false, '0351 15 sin numero');
    assert.equal((await registrar(SECRET, 'P3', '351 234 5678')).whatsapp_numero, '5493512345678');
    assert.equal((await registrar(SECRET, 'P3', '+54 9 2944 12-3456')).whatsapp_numero, '5492944123456');
  });

  await check('otro pais solo con +', async () => {
    assert.equal((await registrar(SECRET, 'P3', '+598 99 123 456')).whatsapp_numero, '59899123456');
    assert.equal((await registrar(SECRET, 'P3', '598 99 123 456')).motivo, 'NUMERO_INVALIDO');
  });

  await check('rechaza numeros invalidos con mensaje legible y sin escribir', async () => {
    const antes = await rutas();
    for(const entrada of ['abc', '+-', '1234', '15 2345 6789', '11 15 2345 6789', '54911234567', '549112345678', '0054 9 11 2345 6789', '+0']) {
      const r = await registrar(SECRET, 'P1', entrada);
      assert.equal(r.ok, false, entrada); assert.equal(r.motivo, 'NUMERO_INVALIDO', entrada);
      assert.match(r.mensaje, /no es válido.*sin el 0 ni el 15/, entrada);
    }
    for(const entrada of ['', '   ', null]) {
      const r = await registrar(SECRET, 'P1', entrada);
      assert.deepEqual([r.ok, r.motivo], [false, 'SIN_NUMERO'], String(entrada));
    }
    assert.deepEqual(await rutas(), antes, 'vacio no borra el numero guardado');
    assert.equal((await auditoria()).length, 0);
  });

  await check('oficina sin fila o vacia: error legible y no inserta', async () => {
    const antes = await rutas();
    assert.deepEqual(await registrar(SECRET, 'P99', '11 2345 6789'), { ok: false, motivo: 'OFICINA_SIN_PORTAL', mensaje: 'La oficina P99 no tiene portal cargado. Avisá a soporte.' });
    assert.equal((await registrar(SECRET, '  ', '11 2345 6789')).motivo, 'SIN_OFICINA');
    assert.deepEqual(await rutas(), antes);
    assert.equal((await auditoria()).length, 0);
  });

  await check('no toca otra oficina y deja el anterior en la auditoria', async () => {
    const antes = await rutas();
    const r = await registrar(SECRET, 'P1', '+54 9 11 5555-0000', ' carla ');
    assert.deepEqual(r, { ok: true, cambio: true, pc: 'P1', whatsapp_numero: '5491155550000', anterior: '5491100000001', rutas: 1 });
    const despues = await rutas();
    assert.deepEqual(despues.filter(x => x.pc_codigo !== 'P1'), antes.filter(x => x.pc_codigo !== 'P1'));
    assert.notEqual(despues.find(x => x.pc_codigo === 'P1').u, antes.find(x => x.pc_codigo === 'P1').u, 'updated_at se mueve');
    assert.deepEqual(await auditoria(), [{ pc_codigo: 'P1', entidad_id: despues.find(x => x.pc_codigo === 'P1').id, valor_anterior: { whatsapp_numero: '5491100000001' }, valor_nuevo: { whatsapp_numero: '5491155550000' } }]);
    assert.deepEqual(await query("select operador from public.panel_operativo_auditoria where accion='WHATSAPP_OFICINA'"), [{ operador: 'carla' }], 'queda quién la cambió');
  });

  await check('sin cambio: cambio false, no escribe ni mueve updated_at', async () => {
    const antes = await rutas();
    assert.deepEqual(await registrar(SECRET, 'P1', '011 0000 0001'), { ok: true, cambio: false, pc: 'P1', whatsapp_numero: '5491100000001' });
    assert.deepEqual(await rutas(), antes);
    assert.equal((await auditoria()).length, 0);
  });

  await check('oficina con dos rutas: las dos, anterior de la activa, una fila de auditoria por ruta', async () => {
    const r = await registrar(SECRET, 'P4', '351 777 8888');
    assert.deepEqual(r, { ok: true, cambio: true, pc: 'P4', whatsapp_numero: '5493517778888', anterior: '5493510000004', rutas: 2 });
    assert.deepEqual((await rutas()).filter(x => x.pc_codigo === 'P4').map(x => x.whatsapp_numero), ['5493517778888', '5493517778888']);
    assert.equal((await auditoria()).length, 2);
  });

  await check('el Portal lo lee por landing_resolver_ruta_publica', async () => {
    await registrar(SECRET, 'P3', '11 2345 6789');
    await db.exec('set local role anon');
    const fila = (await query("select * from public.landing_resolver_ruta_publica('demo-p3')"))[0];
    await db.exec('reset role');
    assert.equal(fila.ok, true); assert.equal(fila.whatsapp_numero, '5491123456789');
  });

  await check('permisos: anon, authenticated y service_role ejecutan; nadie mas', async () => {
    const tiene = async rol => (await query('select has_function_privilege($1, $2, \'EXECUTE\') as x', [rol, FN]))[0].x;
    for(const rol of ['anon', 'authenticated', 'service_role']) assert.equal(await tiene(rol), true, rol);
    assert.equal(await tiene('tercero'), false, 'PUBLIC revocado');
    const def = (await query("select prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [FN]))[0];
    assert.equal(def.prosecdef, true); assert.deepEqual(def.proconfig, ['search_path=public']);
  });

  await check('vuelta atras: saca la funcion y no toca los datos', async () => {
    await registrar(SECRET, 'P3', '11 2345 6789');
    const antes = await rutas();
    await db.exec(fs.readFileSync(path.join(ROOT, 'servidor/oficina-whatsapp-vuelta-atras.sql'), 'utf8'));
    assert.equal((await query('select to_regprocedure($1) as x', [FN]))[0].x, null);
    assert.deepEqual(await rutas(), antes);
  });

  await db.close();
  for(const r of results) console.log((r.ok ? 'ok   ' : 'FALLA') + ' ' + r.name + (r.ok ? '' : '\n      ' + r.error));
  const fallas = results.filter(r => !r.ok).length;
  console.log(`${results.length - fallas}/${results.length} pruebas bien`);
  if(fallas) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
