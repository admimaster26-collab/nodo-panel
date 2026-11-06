'use strict';
// PostgreSQL en memoria: pares de reversion, filtros, oficina y compatibilidad.
// No consulta configuracion privada, no usa red y nunca escribe en el servidor.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { resolvePGlite, fixture } = require('./verify-beta-server.cjs');
const { extension } = require('./verify-domain-server.cjs');
const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'ab'.repeat(32);
const FILES = ['servidor/beta-chat-v1.sql', 'servidor/dominios/perfil-v1.sql', 'servidor/dominios/lecturas-operativas-v1.sql'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function verify() {
  const texts = FILES.map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const report = { started_at: new Date().toISOString(), source_hashes: Object.fromEntries(FILES.map((f, i) => [f, sha(texts[i])])), tests: [], limitations: ['Fixture aislada; no demuestra despliegue, latencia remota ni render.'] };
  const db = new (resolvePGlite())();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const rpc = async (name, args) => {
    assert.match(name, /^nodo_beta_[a-z_0-9]+$/);
    return (await query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args))[0].r;
  };
  const profile = user => rpc('nodo_beta_perfil_v1', [TOKEN, 'P1', user]);
  const history = (user, filters = {}, limit = 100, cursor = null) => rpc('nodo_beta_historial_v1', [TOKEN, 'P1', { ...filters, ...(user ? { q: user } : {}) }, limit, cursor]);
  const nexo = (limit = 1000, cursor = null) => rpc('nodo_beta_nexo_export_v1', [TOKEN, 'P1', limit, cursor]);
  const check = async (name, fn) => {
    await db.exec('begin read only; set local role anon;');
    try { await fn(); report.tests.push({ name, ok: true }); }
    catch (error) { report.tests.push({ name, ok: false, message: error.message.slice(0, 700), code: error.code }); }
    finally { await db.exec('rollback'); }
  };
  const row = (id, user, type, state, amount, reversal = null, office = 'P1', date = '2026-10-30T12:00:00Z') => [id, user, type, state, amount, reversal, office, date];
  try {
    await db.exec(fixture);
    await db.exec(extension);
    await db.exec('truncate public.historial_ops');
    await db.exec(texts[0]);
    await query("insert into acceso.beta_clientes(token_hash,pc_codigo,enabled) values (encode(sha256(convert_to($1,'UTF8')),'hex'),'P1',true)", [TOKEN]);
    // Simula un contrato legacy existente antes de instalar los nuevos lectores.
    await db.exec("create function public.fixture_legacy_historial() returns bigint language sql stable security definer set search_path='' as 'select count(*) from public.historial_ops'; grant execute on function public.fixture_legacy_historial() to anon");
    const legacyBefore = await query("select pg_get_functiondef('public.fixture_legacy_historial()'::regprocedure) definition,proacl::text acl from pg_proc where oid='public.fixture_legacy_historial()'::regprocedure");
    await db.exec(texts[1]);
    await db.exec(texts[2]);
    const records = [
      row(1001, 'normal_case', 'CARGA', 'OK', 50), row(1002, 'normal_case', 'RETIRO', 'PAGADA', -20), row(1003, 'normal_case', 'CARGA', 'ERROR', 900),
      row(1101, 'valid_case', 'CARGA', 'REVERTIDA', 100), row(1102, 'valid_case', 'RETIRO', 'OK', 100, 1101),
      row(1201, 'inverse_case', 'RETIRO', 'REVERTIDA', -75), row(1202, 'inverse_case', 'CARGA', 'OK', 75, 1201),
      row(1301, 'mismatch_case', 'CARGA', 'REVERTIDA', 100), row(1302, 'mismatch_case', 'RETIRO', 'OK', 90, 1301),
      row(1401, 'state_case', 'CARGA', 'OK', 100), row(1402, 'state_case', 'RETIRO', 'OK', 100, 1401),
      row(1501, 'duplicate_case', 'CARGA', 'REVERTIDA', 100), row(1502, 'duplicate_case', 'RETIRO', 'OK', 100, 1501), row(1503, 'duplicate_case', 'RETIRO', 'OK', 100, 1501),
      row(1601, 'orphan_case', 'RETIRO', 'OK', 100, 999999),
      row(1701, 'missing_case', 'CARGA', 'REVERTIDA', 100),
      row(1801, 'type_case', 'CARGA', 'REVERTIDA', 100), row(1802, 'type_case', 'CARGA', 'OK', 100, 1801),
      row(1901, 'error_case', 'CARGA', 'REVERTIDA', 100), row(1902, 'error_case', 'RETIRO', 'ERROR', 100, 1901),
      row(2001, 'scope_case', 'CARGA', 'OK', 37), row(2002, 'scope_case', 'RETIRO', 'OK', 37, 2001, 'P2'),
      row(2101, 'alias_case', 'CARGA', 'REVERTIDA', 100, null, 'P1'), row(2102, 'alias_case', 'RETIRO', 'OK', 100, 2101, 'P_1'),
      row(2201, 'owner_case', 'CARGA', 'OK', 29), row(2202, 'other_case', 'RETIRO', 'OK', 29, 2201),
      row(2301, 'date_case', 'CARGA', 'REVERTIDA', 100, null, 'P1', '2026-10-28T10:00:00Z'), row(2302, 'date_case', 'RETIRO', 'OK', 100, 2301, 'P1', '2026-10-30T10:00:00Z'),
      row(2401, 'page_case', 'CARGA', 'OK', 11, null, 'P1', '2026-10-31T12:00:00.000001Z'), row(2402, 'page_case', 'RETIRO', 'OK', 3, null, 'P1', '2026-10-31T12:00:00.000001Z'),
      row(2403, 'page_case', 'CARGA', 'REVERTIDA', 80, null, 'P1', '2026-10-31T12:00:00.000002Z'), row(2404, 'page_case', 'RETIRO', 'OK', 80, 2403, 'P1', '2026-10-31T12:00:00.000002Z'),
      row(2501, 'null_case', 'CARGA', 'OK', 5, null, 'P1', null)
    ];
    for (const record of records) await query('insert into public.historial_ops(id,usuario,tipo,estado,monto,reversion_de,pc_codigo,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)', record);
    const digest = async () => (await query("select md5(jsonb_agg(to_jsonb(h) order by h.id)::text) digest from public.historial_ops h"))[0].digest;
    const before = await digest();
    const assertTotals = async (user, net, revision) => {
      const p = await profile(user), h = await history(user);
      assert.equal(p.resumen.neto, net, 'Perfil');
      assert.equal(h.totals.neto, net, 'Historial');
      assert.equal(p.resumen.requiere_revision, revision, 'Revision Perfil');
      assert.equal(h.totals.requiere_revision, revision, 'Revision Historial');
      assert.equal(h.totals.monto_cargas, p.resumen.montoCargas);
      assert.equal(h.totals.monto_retiros, p.resumen.montoRetiros);
      assert.equal(h.totals.cargas, p.resumen.cargas);
      assert.equal(h.totals.retiros, p.resumen.retiros);
    };
    await check('Operaciones normales conservan montos absolutos y estados confirmados', () => assertTotals('normal_case', 30, false));
    for (const user of ['valid_case', 'inverse_case', 'alias_case']) await check(`Pareja valida ${user}: neto cero con detalle conservado`, async () => {
      await assertTotals(user, 0, false);
      const h = await history(user);
      assert.equal(h.rows.length, 2);
      assert.ok(h.rows.every(r => r.vigente === false && r.requiere_revision === false));
    });
    for (const user of ['mismatch_case', 'state_case', 'duplicate_case', 'orphan_case', 'missing_case', 'type_case', 'error_case']) {
      await check(`Pareja invalida ${user}: no suma movimientos y solicita revision`, () => assertTotals(user, 0, true));
    }
    await check('Una reversa de otra oficina no modifica vigencia ni filtra informacion a P1', async () => {
      await assertTotals('scope_case', 37, false);
      assert.deepEqual((await history('scope_case')).rows.map(r => r.id), ['2001']);
      await assert.rejects(rpc('nodo_beta_historial_v1', [TOKEN, 'P2', {}, 100, null]), /BETA_NOT_AUTHORIZED/);
    });
    await check('Un usuario distinto no puede anular el movimiento de otro por reversion_de', async () => {
      await assertTotals('owner_case', 29, false);
      await assertTotals('other_case', 0, true);
    });
    await check('Fecha, tipo y estado filtran detalle despues de evaluar la pareja completa', async () => {
      const h = await history('date_case', { desde: '2026-10-30', hasta: '2026-10-30', tipo: 'RETIRO', estado: 'OK' });
      assert.deepEqual(h.rows.map(r => r.id), ['2302']);
      assert.equal(h.totals.neto, 0);
      assert.equal(h.totals.requiere_revision, false);
    });
    await check('Historial paginado conserva microsegundos, todos los IDs y totales completos', async () => {
      let cursor = null; const ids = [];
      do {
        const h = await history('page_case', {}, 1, cursor);
        assert.equal(h.totals.neto, 8); assert.equal(h.totals.total_rows, 4);
        ids.push(...h.rows.map(r => r.id)); cursor = h.next_cursor;
        assert.equal(Boolean(cursor), h.has_more); assert.ok(ids.length <= 4);
      } while (cursor);
      assert.deepEqual(ids, ['2404', '2403', '2402', '2401']);
    });
    await check('Nexo exporta solo movimientos vigentes y mantiene cursor/total en cada pagina', async () => {
      const expected = ['1001', '1002', '2001', '2201', '2401', '2402'];
      const ids = []; let cursor = null;
      do {
        const n = await nexo(2, cursor);
        assert.equal(n.total, expected.length); assert.equal(n.requiere_revision, true);
        assert.equal(n.complete, !n.has_more); assert.ok(n.rows.every(r => ['P1', 'P_1'].includes(r.pc_codigo)));
        ids.push(...n.rows.map(r => r.id)); cursor = n.next_cursor;
        assert.ok(ids.length <= expected.length);
      } while (cursor);
      assert.deepEqual(ids.sort(), expected.sort());
    });
    await check('Sin pendientes Chunior no incluye compensaciones como operaciones nuevas', async () => {
      const h = await history('valid_case', { solo_sin_chunior: true });
      assert.equal(h.rows.length, 0); assert.equal(h.totals.neto, 0);
    });
    await check('Helper privado; no existe una segunda entrada publica sin autorizacion', async () => {
      assert.equal((await query("select has_function_privilege('anon',p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='operaciones' and p.proname='historial_evaluado_v1'"))[0].allowed, false);
    });
    await check('Lecturas nuevas y contrato legacy funcionan dentro de una transaccion read only', async () => {
      await profile('normal_case'); await history(null); await nexo();
      assert.equal(Number((await query('select public.fixture_legacy_historial() n'))[0].n), records.length);
    });
    assert.equal(await digest(), before, 'Los lectores no deben modificar historial');
    assert.deepEqual(await query("select pg_get_functiondef('public.fixture_legacy_historial()'::regprocedure) definition,proacl::text acl from pg_proc where oid='public.fixture_legacy_historial()'::regprocedure"), legacyBefore);
    report.legacy_definition_and_acl_unchanged = true;
    report.business_rows_unchanged = true;
  } catch (error) { report.setup_error = { message: error.message, code: error.code }; }
  finally { await db.close(); }
  report.source_changed_during_run = FILES.some((file, i) => sha(fs.readFileSync(path.join(ROOT, file), 'utf8')) !== sha(texts[i]));
  report.passed = report.tests.filter(t => t.ok).length;
  report.failed = report.tests.filter(t => !t.ok).length;
  report.ok = !report.setup_error && !report.failed && !report.source_changed_during_run;
  report.finished_at = new Date().toISOString();
  const index = process.argv.indexOf('--report');
  if (index >= 0) fs.writeFileSync(path.resolve(process.argv[index + 1]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
  return report;
}
if (require.main === module) verify().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verify };
