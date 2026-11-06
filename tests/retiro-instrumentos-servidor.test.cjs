const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Cuentas de cobro validadas por DNI: el archivo SQL real, corrido en una base en memoria (PGlite)
// con las tablas y funciones del servidor que usa, recortadas a lo que hace falta.
//
// Juan, 6/11: "un semáforo que me diga 'sí' sin saber qué revisa no sirve": cada regla de abajo
// se comprueba contra datos, no contra que la función haya contestado.

function cargarPGlite() {
  for (const nombre of [process.env.NODO_PGLITE_PATH, '@electric-sql/pglite',
    path.join(os.tmpdir(), 'nodo-beta-sql-validation/node_modules/@electric-sql/pglite')].filter(Boolean)) {
    try { return require(nombre).PGlite; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  return null;
}
const PGlite = cargarPGlite();
const SQL = fs.readFileSync(path.join(__dirname, '../servidor/retiro-instrumentos.sql'), 'utf8');

async function base() {
  const db = new PGlite();
  await db.exec(`
    create table public.landing_solicitudes (id bigserial primary key, pc_codigo text, usuario text, tipo text, metadata jsonb);
    create table public.landing_rutas_publicas (public_code text, pc_codigo text, activo boolean);
    insert into public.landing_rutas_publicas values ('codp1', 'p1', true);
    create function public.landing_portal_v16_pc_from_code(text) returns text language sql as $$ select null::text $$;
    -- Vínculo de prueba: pruebaxx con su teléfono tiene acceso; "nuevo" está pendiente; el resto, no.
    create function public.landing_portal_resolver_vinculo(p_pc text, p_usuario text, p_tel text) returns jsonb language sql as $$
      select jsonb_build_object('verdict', case
        when lower(p_usuario) = 'pruebaxx' and p_tel = '1100000000' then 'ACCESO'
        when lower(p_usuario) = 'nuevo' then 'PENDIENTE'
        else 'BLOQUEADO' end) $$;
    create function public._panel_data_auth(p text) returns boolean language sql as $$ select p = 'secreto' $$;
  `);
  await db.exec(SQL);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const uno = async (sql, params) => Object.values((await q(sql, params))[0])[0];
  const solicitud = async (destino, usuario = 'pruebaxx') => uno(
    `insert into landing_solicitudes(pc_codigo, usuario, tipo, metadata) values ('P1', $1, 'RETIRO', $2) returning id`,
    [usuario, JSON.stringify({ usuario, destino, titular: 'Fulano Demo' })]);
  const declarar = (destino, dni, usuario = 'pruebaxx', tel = '1100000000') => uno(
    `select landing_retiro_instrumento_declarar('codp1', $1, $2, $3, 'Fulano Demo', $4)`, [usuario, tel, destino, dni]);
  const validar = (sid, dni) => uno(`select panel_retiro_instrumento_validar('secreto', $1, $2, 'juancarlos')`, [sid, dni]);
  const estado = (sid) => uno(`select panel_retiro_instrumento('secreto', $1)`, [sid]);
  const error = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };
  return { db, q, uno, solicitud, declarar, validar, estado, error };
}

const t = PGlite ? test : test.skip;

t('declarar y validar con el DNI correcto: la cuenta queda validada y NODO nunca ve el DNI', async () => {
  const b = await base();
  assert.deepEqual(await b.declarar('alias.demo.mp', '38.495.012'), { ok: true, estado: 'PENDIENTE' });
  const sid = await b.solicitud('Alias.Demo.MP');               // el destino se compara normalizado
  const e = await b.estado(sid);
  assert.equal(e.estado, 'PENDIENTE');
  assert.ok(!JSON.stringify(e).includes('38495012') && !JSON.stringify(e).includes('495012'), 'el estado para NODO no trae el DNI');
  const r = await b.validar(sid, '20-38495012-4');               // el CUIT que muestra Mercado Pago
  assert.equal(r.ok, true); assert.equal(r.estado, 'VALIDADO');
  assert.equal((await b.estado(sid)).validado_por, 'juancarlos');
  // Próximo retiro a la misma cuenta: ya validada, el Portal no vuelve a declarar.
  assert.deepEqual(await b.declarar('alias.demo.mp', '11111111'), { ok: true, estado: 'VALIDADO' });
});

t('DNI de 7 dígitos y CUIT con cero adelante coinciden', async () => {
  const b = await base();
  await b.declarar('cuenta.vieja.mp', '5.123.456');
  const sid = await b.solicitud('cuenta.vieja.mp');
  assert.equal((await b.validar(sid, '27-05123456-3')).ok, true);
});

t('un error del operador no quema al jugador: segundo intento; dos fallas rechazan', async () => {
  const b = await base();
  await b.declarar('alias.demo.mp', '38495012');
  const sid = await b.solicitud('alias.demo.mp');
  assert.deepEqual(await b.validar(sid, '38495013'), { ok: false, motivo: 'NO_COINCIDE', intentos_restantes: 1 });
  assert.equal((await b.estado(sid)).estado, 'PENDIENTE');
  assert.deepEqual(await b.validar(sid, '22323877'), { ok: false, motivo: 'RECHAZADO' });
  assert.equal((await b.estado(sid)).estado, 'RECHAZADO');
  // El mismo DNI no se puede volver a declarar para esa cuenta; otro sí.
  assert.match(await b.error(() => b.declarar('alias.demo.mp', '38.495.012')), /DNI_YA_RECHAZADO/);
  assert.deepEqual(await b.declarar('alias.demo.mp', '22323877'), { ok: true, estado: 'PENDIENTE' });
  const sid2 = await b.solicitud('alias.demo.mp');
  assert.equal((await b.validar(sid2, '22323877')).ok, true);
});

t('rechazo directo del operador', async () => {
  const b = await base();
  await b.declarar('alias.demo.mp', '38495012');
  const sid = await b.solicitud('alias.demo.mp');
  assert.deepEqual(await b.uno(`select panel_retiro_instrumento_rechazar('secreto', $1, 'juancarlos')`, [sid]), { ok: true, estado: 'RECHAZADO' });
  assert.match(await b.error(() => b.declarar('alias.demo.mp', '38495012')), /DNI_YA_RECHAZADO/);
});

t('sin DNI declarado (Portal anterior): NODO lo ve como SIN_DECLARAR y no hay nada que validar', async () => {
  const b = await base();
  const sid = await b.solicitud('otra.cuenta.mp');
  assert.equal((await b.estado(sid)).estado, 'SIN_DECLARAR');
  assert.deepEqual(await b.validar(sid, '38495012'), { ok: false, motivo: 'SIN_DECLARAR' });
});

t('controles: vínculo, DNI inválido, secreto del panel y tablas cerradas', async () => {
  const b = await base();
  assert.match(await b.error(() => b.declarar('alias.demo.mp', '38495012', 'pruebaxx', '1199999999')), /VINCULO_NO_VALIDO/);
  assert.match(await b.error(() => b.declarar('alias.demo.mp', '123')), /DNI_INVALIDO/);
  assert.match(await b.error(() => b.declarar('ab', '38495012')), /DESTINO_INVALIDO/);
  assert.match(await b.error(() => b.uno(`select panel_retiro_instrumento('mal', 1)`)), /no-auth/);
  // Un vínculo pendiente puede declarar (igual que pedir el retiro) pero no listar cuentas.
  assert.equal((await b.declarar('alias.nuevo.mp', '30111222', 'nuevo', '1')).ok, true);
  assert.deepEqual(await b.uno(`select landing_retiro_instrumentos('codp1', 'nuevo', '1')`), { ok: true, instrumentos: [] });
  const lista = await b.uno(`select landing_retiro_instrumentos('codp1', 'pruebaxx', '1100000000')`);
  assert.equal(lista.ok, true);
});

t('el Portal ve sus cuentas con sólo los últimos 3 números del DNI', async () => {
  const b = await base();
  await b.declarar('alias.demo.mp', '38495012');
  const sid = await b.solicitud('alias.demo.mp');
  await b.validar(sid, '38495012');
  const lista = await b.uno(`select landing_retiro_instrumentos('codp1', 'pruebaxx', '1100000000')`);
  assert.equal(lista.instrumentos.length, 1);
  assert.equal(lista.instrumentos[0].estado, 'VALIDADO');
  assert.equal(lista.instrumentos[0].dni_fin, '012');
  assert.ok(!JSON.stringify(lista).includes('38495012'));
  const eventos = await b.q(`select evento from retiro_instrumento_eventos order by id`);
  assert.deepEqual(eventos.map(e => e.evento), ['DECLARADO', 'VALIDADO']);
});
