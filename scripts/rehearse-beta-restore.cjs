'use strict';

// Generates a PRIVATE, guarded restore from an explicit snapshot and rehearses it
// in isolated PostgreSQL. Never opens a remote connection or reads live credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { resolvePGlite, fixture } = require('./verify-beta-server.cjs');
const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  { name: '_zona_valida', signature: 'public._zona_valida(text)' },
  { name: 'landing_historial_usuario_beta_v1', signature: 'public.landing_historial_usuario_beta_v1(text,text,text,text)' }
];
const md5Pattern = /^[0-9a-f]{32}$/;
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const literal = text => "'" + String(text).replaceAll("'", "''") + "'";
const ident = text => '"' + String(text).replaceAll('"', '""') + '"';

function option(name, required = false) {
  const index = process.argv.indexOf(name);
  if(index < 0) { if(required) throw new Error('Falta ' + name); return null; }
  const value = process.argv[index + 1];
  if(!value || value.startsWith('--')) throw new Error('Falta ruta despues de ' + name);
  return path.resolve(value);
}

async function rehearse() {
  const snapshotPath = option('--snapshot', true), outputPath = option('--output', true);
  const reportPath = option('--report'), expectedPath = option('--expected-current');
  const relativeOutput = path.relative(ROOT, outputPath);
  if(!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput)) throw new Error('El restore contiene funciones privadas: --output debe estar fuera del repositorio.');
  const snapshotText = fs.readFileSync(snapshotPath, 'utf8');
  const snapshot = JSON.parse(snapshotText);
  const targets = TARGETS.map(target => {
    const row = snapshot.find(row => row.proname === target.name && row.schema === 'public');
    assert.ok(row && md5Pattern.test(row.md5) && typeof row.definition === 'string', 'Snapshot incompleto: ' + target.name);
    assert.equal(row.owner, 'postgres', 'Revisar propietario del snapshot antes de restaurar');
    return { ...target, ...row };
  });
  const PGlite = resolvePGlite(), db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const report = {
    started_at: new Date().toISOString(), engine: 'PGlite', network: 'none',
    snapshot_sha256: sha256(snapshotText), expected_hash_source: expectedPath ? 'explicit file' : 'local SQL normalized by PGlite; compare with remote catalog before use',
    tests: [], limitations: ['No sustituye cotejo de hashes del catalogo remoto ni ensayo de concurrencia.', 'ACL NULL se restaura como permisos por defecto equivalentes; no se escriben catalogos internos.']
  };
  const catalog = async () => query(`select p.proname,md5(pg_get_functiondef(p.oid)) as md5,
    pg_get_userbyid(p.proowner) as owner,
    (select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
      order by a.grantee,a.grantor,a.privilege_type,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) as privileges
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('_zona_valida','landing_historial_usuario_beta_v1') order by p.proname`);
  const business = async () => {
    const result = {};
    for(const table of ['chat_mensajes','chat_sesiones','landing_solicitudes','historial_ops','usuarios_portal_vinculos','landing_rutas_publicas']) {
      result[table] = (await query(`select md5(coalesce(string_agg(row_to_json(t)::text,'|' order by row_to_json(t)::text),'')) as md5 from public.${table} t`))[0].md5;
    }
    return result;
  };
  try {
    await db.exec(fixture);
    const grantsByName = new Map();
    for(const row of targets) {
      await db.exec(row.definition);
      const grants = await query(`select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type,a.is_grantable from aclexplode(coalesce($1::aclitem[],acldefault('f','postgres'::regrole))) a
        order by a.grantee,a.is_grantable`, [row.acl]);
      const statements = [
        `alter function ${row.signature} owner to ${ident(row.owner)};`,
        `revoke all on function ${row.signature} from public,anon,authenticated,service_role,postgres;`
      ];
      for(const grant of grants) {
        assert.equal(grant.privilege_type, 'EXECUTE');
        const role = grant.grantee === 'PUBLIC' ? 'public' : ident(grant.grantee);
        statements.push(`grant execute on function ${row.signature} to ${role}${grant.is_grantable ? ' with grant option' : ''};`);
      }
      grantsByName.set(row.name, statements.join('\n'));
      await db.exec(statements.join('\n'));
    }
    const before = await catalog(), beforeBusiness = await business();
    for(const row of targets) assert.equal(before.find(item => item.proname === row.name).md5, row.md5, 'Snapshot exacto no coincide en motor local: ' + row.name);
    report.tests.push({ name: 'snapshot previo exacto normaliza al mismo MD5; propietario y privilegios capturados', ok: true });
    const sqlPath = path.join(ROOT, 'servidor/beta-portal-historial-v1.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await db.exec(sql);
    const after = await catalog();
    const expected = expectedPath ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')) : Object.fromEntries(after.map(row => [row.proname, row.md5]));
    for(const row of targets) {
      assert.match(expected[row.name], md5Pattern);
      assert.equal(after.find(item => item.proname === row.name).md5, expected[row.name], 'Hash actual esperado no coincide con SQL que se ensaya: ' + row.name);
    }
    report.before_hashes = Object.fromEntries(before.map(row => [row.proname, row.md5]));
    report.expected_current_hashes = expected;
    report.current_source_sha256 = sha256(sql);
    const guards = targets.map(row => `  if coalesce(md5(pg_get_functiondef(to_regprocedure(${literal(row.signature)}))),'ABSENT') not in (${literal(expected[row.name])},${literal(row.md5)}) then
    raise exception using errcode='55000',message=${literal('RESTORE_DRIFT_' + row.name.toUpperCase())};
  end if;`).join('\n');
    const restore = '-- Exact previous definitions from private snapshot; no business rows are modified.\n' +
      '-- Only expected current hashes or already-restored hashes are accepted. Abort on drift.\n' +
      '-- Decide rollback: Juan. Execute only after confirming the incident and these catalog hashes.\n' +
      'begin;\ndo $restore_guard$\nbegin\n' + guards + '\nend;\n$restore_guard$;\n\n' +
      targets.map(row => row.definition.trimEnd() + (row.definition.trimEnd().endsWith(';') ? '' : ';') + '\n' + grantsByName.get(row.name)).join('\n\n') +
      "\nnotify pgrst,'reload schema';\ncommit;\n";
    await db.exec(restore);
    assert.deepEqual(await catalog(), before);
    assert.deepEqual(await business(), beforeBusiness);
    report.tests.push({ name: 'restore exacto recupera MD5, owner y ACL equivalentes sin cambiar datos', ok: true });
    await db.exec(restore);
    assert.deepEqual(await catalog(), before);
    report.tests.push({ name: 'restore es repetible cuando ya esta aplicado', ok: true });
    // A later unrelated change must stop the entire restore before replacing either function.
    await db.exec(sql);
    await db.exec("create or replace function public._zona_valida(p_zona text) returns boolean language sql immutable as 'select false'");
    const drift = await catalog();
    await assert.rejects(db.exec(restore), /RESTORE_DRIFT_/);
    await db.exec('rollback');
    assert.deepEqual(await catalog(), drift);
    assert.deepEqual(await business(), beforeBusiness);
    report.tests.push({ name: 'hash ajeno aborta restore atomico sin pisar cambios posteriores', ok: true });
    assert.equal(fs.readFileSync(sqlPath, 'utf8'), sql, 'SQL cambio durante ensayo');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, restore, { encoding: 'utf8', mode: 0o600 });
    report.restore_sha256 = sha256(restore);
    report.ok = true;
  } catch(error) {
    report.ok = false;
    report.error = { message: String(error.message).slice(0, 500), code: error.code || null };
  } finally { await db.close(); }
  report.finished_at = new Date().toISOString();
  if(reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if(!report.ok) process.exitCode = 1;
  return report;
}

if(require.main === module) rehearse().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { rehearse };
