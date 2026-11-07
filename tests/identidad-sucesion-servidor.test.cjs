const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Cambio de número y cambio de usuario como transición registrada, no como borrado. El SQL real,
// en una base en memoria (PGlite), con las tablas de vínculos recortadas a lo que usa.
//
// Juan, 6/11: jugador01 perdió su número y pidió con otro; la tarjeta dijo "no hay cuenta con este
// usuario". Y: "cuidado, este usuario es viejo y anteriormente lo usaba este número, actualmente
// este número usa este usuario" — sigue siendo criterio del operador, pero con los datos a la vista.

function cargarPGlite() {
  for (const nombre of [process.env.NODO_PGLITE_PATH, '@electric-sql/pglite',
    path.join(os.tmpdir(), 'nodo-beta-sql-validation/node_modules/@electric-sql/pglite')].filter(Boolean)) {
    try { return require(nombre).PGlite; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  return null;
}
const PGlite = cargarPGlite();
const SQL = fs.readFileSync(path.join(__dirname, '../servidor/identidad-sucesion.sql'), 'utf8');

async function base() {
  const db = new PGlite();
  await db.exec(`
    create table public.usuarios_portal_vinculos (id bigserial primary key, pc_codigo text, usuario text, telefono_canon text,
      telefono_raw text, estado_vinculo text, fuente text, verificado_por text, created_at timestamptz default now(),
      updated_at timestamptz default now(), titular text, duplicado_de text, cbu_retiro text);
    create unique index ux_vinc_pc_usuario on public.usuarios_portal_vinculos(pc_codigo, usuario);
    create table public.usuarios_portal_eventos (id bigserial primary key, pc_codigo text, usuario text, evento text,
      telefono_anterior text, telefono_nuevo text, titular text, nota text, operador text, origen text, created_at timestamptz default now());
    create table public.historial_ops (id bigserial primary key, usuario text, estado text, tipo text, created_at timestamptz);
    create function public._panel_data_auth(p text) returns boolean language sql as $$ select p = 's' $$;
    create or replace function public._wtk_usuario_limpio(p_raw text) returns text language sql immutable as $f$
      select coalesce(
        (select tk from unnest(regexp_split_to_array(regexp_replace(lower(coalesce(p_raw,'')), '\\([^)]*\\)|\\[[^\\]]*\\]|\\{[^}]*\\}', ' ', 'g'), '[^a-z0-9._]+')) tk where tk ~ '[0-9]' and tk ~ '[a-z]' limit 1),
        (select tk from unnest(regexp_split_to_array(regexp_replace(lower(coalesce(p_raw,'')), '\\([^)]*\\)|\\[[^\\]]*\\]|\\{[^}]*\\}', ' ', 'g'), '[^a-z0-9._]+')) tk where tk ~ '[0-9]' limit 1),
        (select tk from unnest(regexp_split_to_array(regexp_replace(lower(coalesce(p_raw,'')), '\\([^)]*\\)|\\[[^\\]]*\\]|\\{[^}]*\\}', ' ', 'g'), '[^a-z0-9._]+')) tk where tk <> '' limit 1), '')
    $f$;
  `);
  await db.exec(SQL);
  const uno = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];
  const filas = async (sql, params) => (await db.query(sql, params)).rows;
  const vincular = (u, tel, forzar = false, motivo = null) => uno(`select panel_vincular_usuario_v2('s','P4',$1,$2,$3,'juancarlos',$4)`, [u, tel, forzar, motivo]);
  const cotejo = (u, tel) => uno(`select panel_identidad_cotejo('s','P4',$1,$2)`, [u, tel]);
  const portal = (u, tel) => uno(`select landing_portal_resolver_vinculo('P4',$1,$2)`, [u, tel]);
  const alta = (u, tel, estado = 'VINCULADO') => db.query(`insert into usuarios_portal_vinculos(pc_codigo,usuario,telefono_canon,estado_vinculo,fuente) values('P4',$1,$2,$3,'TEST')`, [u, tel, estado]);
  return { db, uno, filas, vincular, cotejo, portal, alta };
}

const t = PGlite ? test : test.skip;

t('mismo usuario con número nuevo: la tarjeta lo dice y al validar queda anotado el cambio', async () => {
  const b = await base();
  await b.alta('jugador01', '1100000001');
  const c = await b.cotejo('jugador01', '+54 9 1100 000002');
  assert.equal(c.veredicto, 'CAMBIO_TELEFONO');
  assert.equal(c.usuario.telefono, '1100000001');
  assert.equal(c.telefono.dueno, null);
  const r = await b.vincular('jugador01', '5491100000002', false, 'perdió el número');
  assert.equal(r.ok, true);
  assert.deepEqual(r.cambio_telefono, { anterior: '1100000001', nuevo: '1100000002' });
  const ev = await b.filas(`select usuario, evento, telefono_anterior, telefono_nuevo, nota, operador from usuarios_portal_eventos`);
  assert.deepEqual(ev, [{ usuario: 'jugador01', evento: 'CAMBIO_TELEFONO', telefono_anterior: '1100000001', telefono_nuevo: '1100000002', nota: 'perdió el número', operador: 'juancarlos' }]);
  assert.equal((await b.cotejo('jugador01', '1100000002')).veredicto, 'COINCIDE');
  const viejo = await b.cotejo('jugador01', '1100000001');
  assert.equal(viejo.veredicto, 'TELEFONO_ANTERIOR');
  assert.equal(viejo.telefonos_anteriores[0].anterior, '1100000001');
  assert.equal((await b.portal('jugador01', '1100000002')).verdict, 'ACCESO');
  assert.equal((await b.portal('jugador01', '1100000001')).verdict, 'CONFLICTO_TELEFONO');
});

t('teléfono de otro usuario: sin forzar es conflicto; forzado, el viejo queda DUPLICADO apuntando al nuevo y no se borra', async () => {
  const b = await base();
  await b.alta('jugador02', '1122334455');
  const sinForzar = await b.vincular('jugador03', '1122334455');
  assert.equal(sinForzar.ok, false); assert.equal(sinForzar.conflicto_tel, true); assert.equal(sinForzar.usuario_actual, 'jugador02');
  const r = await b.vincular('jugador03', '1122334455', true, 'cambió de usuario');
  assert.equal(r.ok, true); assert.deepEqual(r.reemplazados, ['jugador02']);
  const v = await b.filas(`select usuario, estado_vinculo, duplicado_de, reemplazado_por, reemplazado_operador, reemplazado_motivo from usuarios_portal_vinculos order by id`);
  // DUPLICADO y no un estado nuevo: las funciones que ya excluyen DUPLICADO no lo muestran como jugador activo.
  assert.deepEqual(v, [
    { usuario: 'jugador02', estado_vinculo: 'DUPLICADO', duplicado_de: 'jugador03', reemplazado_por: 'jugador03', reemplazado_operador: 'juancarlos', reemplazado_motivo: 'cambió de usuario' },
    { usuario: 'jugador03', estado_vinculo: 'VINCULADO', duplicado_de: null, reemplazado_por: null, reemplazado_operador: null, reemplazado_motivo: null }]);
  assert.equal(await b.uno(`select count(*)::int from usuarios_portal_eventos where evento='USUARIO_REEMPLAZADO' and usuario='jugador02'`), 1);
  // Portal: el alias viejo queda pendiente, sin acceso y SIN nombrar al usuario de ahora
  // ("redirigir la información al operador, nunca la identidad del usuario").
  const p = await b.portal('jugador02', '1122334455');
  assert.equal(p.verdict, 'REVISION'); assert.equal(p.ok, false);
  assert.ok(!JSON.stringify(p).includes('jugador03'), 'el Portal no revela el alias nuevo');
  const p2 = await b.portal('jugador02', '1199999999');
  assert.equal(p2.verdict, 'CONFLICTO_TELEFONO'); assert.equal(p2.usuario_vigente, undefined);
  assert.equal((await b.portal('jugador03', '1122334455')).verdict, 'ACCESO');
  // NODO: el alias viejo dice quién es hoy; el número dice quién lo usaba antes.
  const c = await b.cotejo('jugador02', '1122334455');
  assert.equal(c.veredicto, 'USUARIO_REEMPLAZADO'); assert.equal(c.usuario.vigente, 'jugador03');
  const c2 = await b.cotejo('otro99', '1122334455');
  assert.equal(c2.veredicto, 'TELEFONO_DE_OTRO'); assert.equal(c2.telefono.dueno.usuario, 'jugador03');
  assert.equal(c2.usuarios_anteriores[0].usuario, 'jugador02'); assert.equal(c2.usuarios_anteriores[0].ahora, 'jugador03');
});

t('usuario viejo de otra persona con un número que hoy usa otro: los dos datos a la vista', async () => {
  const b = await base();
  await b.alta('viejo11', '1100000001');
  await b.alta('actual22', '1100000002');
  await b.db.query(`insert into historial_ops(usuario,estado,tipo,created_at) values ('viejo11','OK','RETIRO','2026-07-01'),('viejo11','OK','CARGA','2026-06-30'),('actual22','OK','CARGA','2026-11-05')`);
  await b.db.query(`update usuarios_portal_vinculos set cbu_retiro='alias.viejo.mp' where usuario='viejo11'`);
  const c = await b.cotejo('viejo11', '1100000002');
  assert.equal(c.veredicto, 'TELEFONO_DE_OTRO');
  assert.equal(c.usuario.telefono, '1100000001');
  assert.equal(c.telefono.dueno.usuario, 'actual22');
  assert.match(String(c.usuario.ultima_operacion), /^2026-07-01/);
  assert.match(String(c.telefono.dueno.ultima_operacion), /^2026-11-05/);
  // Con historia y CBU de cobro: la tarjeta tiene con qué exigir una decisión.
  assert.equal(c.usuario.operaciones, 2); assert.equal(c.usuario.tiene_cbu, true);
  assert.equal(c.telefono.dueno.operaciones, 1); assert.equal(c.telefono.dueno.tiene_cbu, false);
});

t('un DUPLICADO de antes (unificado por el panel, sin reemplazado_por) entra al Portal como entraba', async () => {
  const b = await base();
  await b.db.query(`insert into usuarios_portal_vinculos(pc_codigo,usuario,telefono_canon,estado_vinculo,duplicado_de) values('P4','dup55','1100000055','DUPLICADO','bueno55')`);
  assert.equal((await b.portal('dup55', '1100000055')).verdict, 'ACCESO');
  // En NODO sí se ve que es un alias viejo.
  const c = await b.cotejo('dup55', '1100000055');
  assert.equal(c.veredicto, 'USUARIO_REEMPLAZADO'); assert.equal(c.usuario.vigente, 'bueno55');
});

t('la firma vieja (2.1.5) usa la nueva: tampoco borra', async () => {
  const b = await base();
  await b.alta('jugador02', '1122334455');
  const r = await b.uno(`select panel_vincular_usuario('s','P4','jugador03','1122334455',true,'op')`);
  assert.equal(r.ok, true);
  assert.equal(await b.uno(`select count(*)::int from usuarios_portal_vinculos`), 2);
});

t('cadena de reemplazos: el vigente es el último; nuevo y bloqueado', async () => {
  const b = await base();
  await b.alta('aaa1', '1100000010');
  await b.vincular('bbb2', '1100000010', true);
  await b.vincular('ccc3', '1100000010', true);
  assert.equal(await b.uno(`select _identidad_vigente('P4','aaa1')`), 'ccc3');
  assert.equal((await b.cotejo('nadie5', '1199887766')).veredicto, 'NUEVO');
  await b.alta('malo9', '1100000099', 'BLOQUEADO');
  assert.equal((await b.cotejo('malo9', '1100000099')).veredicto, 'BLOQUEADO');
  assert.match(String(await b.uno(`select panel_vincular_usuario_v2('s','P4','malo9','1100000099',true,'op',null)->>'mensaje'`)), /BLOQUEADO/);
});

t('la decisión del operador queda en la historia; sin evidencia no toca ningún vínculo', async () => {
  const b = await base();
  await b.alta('jugador02', '1122334455');
  const antes = await b.filas(`select usuario, telefono_canon, estado_vinculo from usuarios_portal_vinculos`);
  assert.deepEqual(await b.uno(`select panel_identidad_decision('s','P4','jugador02','1199999999','SIN_EVIDENCIA','no contesta','juancarlos')`), { ok: true });
  assert.deepEqual(await b.uno(`select panel_identidad_decision('s','P4','jugador02','1199999999','OTRA_PERSONA','es la hermana','juancarlos')`), { ok: true });
  assert.deepEqual(await b.filas(`select usuario, telefono_canon, estado_vinculo from usuarios_portal_vinculos`), antes);
  assert.deepEqual(await b.filas(`select evento, telefono_nuevo, nota, operador from usuarios_portal_eventos order by id`), [
    { evento: 'IDENTIDAD_SIN_EVIDENCIA', telefono_nuevo: '1199999999', nota: 'no contesta', operador: 'juancarlos' },
    { evento: 'IDENTIDAD_OTRA_PERSONA', telefono_nuevo: '1199999999', nota: 'es la hermana', operador: 'juancarlos' }]);
  assert.equal((await b.uno(`select panel_identidad_decision('s','P4','jugador02','1','BORRAR','x','y')`)).ok, false);
});
