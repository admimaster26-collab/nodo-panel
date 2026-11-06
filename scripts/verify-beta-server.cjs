'use strict';

// PostgreSQL aislado en memoria. No lee conexiones ni credenciales reales y no usa red.
// Reutiliza PGlite instalado por separado: NODO_PGLITE_PATH o carpeta temporal indicada.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'ab'.repeat(32), OTHER_TOKEN = 'cd'.repeat(32), PORTAL_TOKEN = 'portal-demo-token-alpha';
const BUILD = 'nodo-beta-v1';
const files = ['servidor/beta-chat-v1.sql', 'servidor/beta-portal-historial-v1.sql'];
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function resolvePGlite() {
  for(const name of [process.env.NODO_PGLITE_PATH, '@electric-sql/pglite', path.join(os.tmpdir(), 'nodo-beta-sql-validation/node_modules/@electric-sql/pglite')].filter(Boolean)) {
    try { return require(name).PGlite; } catch(error) { if(error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Falta PGlite. Indicar una instalacion existente mediante NODO_PGLITE_PATH; este script no instala dependencias.');
}

const fixture = `
create role anon; create role authenticated; create role service_role;
grant usage on schema public to anon,authenticated,service_role;
create table public.chat_sesiones (
 id bigserial primary key, chat_id text unique, pc_codigo text, usuario text, telefono text,
 estado text default 'ABIERTO', solicitud_id bigint, created_at timestamptz default now(),
 ultimo_mensaje timestamptz default now(), updated_at timestamptz default now(),
 chat_public_token text, metadata jsonb default '{}'::jsonb
);
create table public.chat_mensajes (
 id bigserial primary key, chat_id text, conversacion_id bigint, solicitud_id bigint,
 tipo_emisor text, emisor text, mensaje text, imagen_url text, leido boolean default false,
 leido_operador_at timestamptz, created_at timestamptz default now(),
 visible_usuario boolean default true, visible_operador boolean default true,
 metadata jsonb default '{}'::jsonb
);
create table public.landing_solicitudes (
 id bigserial primary key, tipo text, estado text, monto numeric, pc_codigo text, usuario text,
 metadata jsonb default '{}'::jsonb, created_at timestamptz default now()
);
create table public.historial_ops (
 id bigserial primary key, tipo text, estado text, usuario text, pc_codigo text,
 monto numeric, solicitud_id bigint, created_at timestamptz default now()
);
create table public.usuarios_portal_vinculos (usuario text,telefono_canon text,telefono_raw text,pc_codigo text);
create table public.landing_rutas_publicas (public_code text,pc_codigo text,activo boolean default true);
insert into public.chat_sesiones(id,chat_id,pc_codigo,usuario,telefono,estado,chat_public_token) values
 (10,'alpha','P1','DEMO','5550100001','ABIERTO','portal-demo-token-alpha'),
 (11,'beta','P1','OTRO','5550100002','ABIERTO','portal-demo-token-beta'),
 (12,'closed','P1','CERRADO','5550100003','CERRADO','portal-demo-token-closed'),
 (20,'gamma','P2','OTRA_OFICINA','5550200001','ABIERTO','portal-demo-token-gamma'),
 (99,'10','P2','COLISION','5550200002','ABIERTO','portal-demo-token-collision');
insert into public.chat_mensajes(id,chat_id,conversacion_id,tipo_emisor,emisor,mensaje) values
 (100,'alpha',10,'USUARIO','DEMO','mensaje 100'),(102,'alpha',10,'USUARIO','DEMO','mensaje 102'),
 (103,'alpha',10,'OPERADOR','OPERADOR_DEMO','respuesta'),(104,'alpha',10,'USUARIO','DEMO','mensaje 104'),
 (105,'alpha',10,'USUARIO','DEMO','oculto operador'),(106,'alpha',10,'SISTEMA','SISTEMA','evento'),
 (107,'alpha',10,'USUARIO','DEMO','getter legacy lo marco'),(108,'alpha',10,'USUARIO','DEMO','oculto portal'),
 (109,'alpha',20,'USUARIO','OTRA_OFICINA','identidad contradictoria'),
 (110,null,10,'USUARIO','DEMO','solo conversacion'),(111,'sin-canonica',10,'USUARIO','DEMO','puente sin colision'),
 (200,'beta',11,'USUARIO','OTRO','otro chat'),(300,'closed',12,'USUARIO','CERRADO','chat cerrado'),
 (400,'gamma',20,'USUARIO','OTRA_OFICINA','otra oficina'),(500,'10',null,'USUARIO','COLISION','ID textual manda');
update public.chat_mensajes set visible_operador=false where id=105;
update public.chat_mensajes set visible_usuario=false where id=108;
update public.chat_mensajes set leido=true,leido_operador_at=now() where id=107;
select setval('public.chat_mensajes_id_seq',1000);
insert into public.landing_rutas_publicas(public_code,pc_codigo) values ('demo-p1','P1'),('demo-p2','P2');
insert into public.usuarios_portal_vinculos values ('DEMO','5550100001',null,'P1'),('DEMO','5550200001',null,'P2');
insert into public.historial_ops(tipo,estado,usuario,pc_codigo,monto) values
 ('CARGA','OK','DEMO','P1',100),('RETIRO','PAGADA','DEMO','P2',900),('CARGA','OK','OTRO','P1',800);
insert into public.landing_solicitudes(tipo,estado,monto,metadata) values
 ('RETIRO','RECHAZADA',50,'{"usuario":"DEMO","telefono":"5550100001","public_code":"demo-p1","motivo":"Motivo de prueba"}'),
 ('CARGA','PENDIENTE',60,'{"usuario":"DEMO","telefono":"5550200001","public_code":"demo-p2"}');
`;

async function verify() {
  const PGlite = resolvePGlite(), db = new PGlite();
  const sources = files.map(file => ({ file, text: fs.readFileSync(path.join(ROOT, file), 'utf8') }));
   const report = { started_at: new Date().toISOString(), engine: 'PGlite', network: 'loopback only; no external traffic', source_hashes: Object.fromEntries(sources.map(s => [s.file, hash(s.text)])), tests: [], limitations: [
    'Fixture minima: no reproduce triggers legacy, latencia de red, RLS del proyecto desplegado ni concurrencia entre procesos.',
    'No sustituye snapshot de funciones/ACL ni ensayo de restore sobre la version desplegada.'
  ] };
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  let savepoint = 0;
  async function rpc(name, args = []) {
    assert.match(name, /^[a-z_][a-z0-9_]*$/);
    const sp = 'rpc_' + ++savepoint;
    await db.exec(`savepoint ${sp}; set local role anon;`);
    try {
      const rows = await query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args);
      await db.exec(`reset role; release savepoint ${sp};`);
      return rows[0].result;
    } catch(error) {
      await db.exec(`rollback to savepoint ${sp}; release savepoint ${sp};`);
      throw error;
    }
  }
  const node = (name, args = []) => rpc('nodo_beta_' + name + '_v1', [TOKEN, 'P1', ...args]);
  const active = () => node('capacidades', [BUILD, true]);
  const portal = (name = 'landing_beta_chat_leer_v1', args = []) => rpc(name, [10, PORTAL_TOKEN, ...args]);
  const messages = () => query('select id::text,leido,leido_operador_at from public.chat_mensajes order by id');
  function option(name) {
    const index = process.argv.indexOf(name);
    if(index === -1) return null;
    if(!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error('Falta ruta despues de ' + name);
    return path.resolve(process.argv[index + 1]);
  }
  async function check(name, run) {
    await db.exec('begin');
    try { await run(); report.tests.push({ name, ok: true }); }
    catch(error) { report.tests.push({ name, ok: false, error: String(error.message).slice(0, 600), code: error.code || null }); }
    finally { await db.exec('rollback'); }
  }
  try {
    await db.exec(fixture);
    for(const source of sources) await db.exec(source.text);
    const triggersPath = option('--triggers-snapshot');
    if(triggersPath) {
      const text = fs.readFileSync(triggersPath, 'utf8');
      const triggers = JSON.parse(text).filter(row => row.relname === 'chat_mensajes');
      assert.equal(triggers.length, 3, 'revisar snapshot si cambia el conjunto de triggers de chat');
      for(const row of triggers) {
        assert.equal(typeof row.definition, 'string'); assert.equal(typeof row.trigger, 'string');
        await db.exec(row.definition);
        await db.exec(row.trigger);
      }
      report.chat_triggers_snapshot = { sha256: hash(text), names: triggers.map(row => row.tgname), scope: 'Real INSERT triggers for operator send; USUARIO branches and realtime delivery are not exercised.' };
      report.limitations[0] = 'Fixture minima con triggers INSERT reales para emisor OPERADOR; no reproduce ramas USUARIO/realtime, latencia remota, RLS del proyecto ni concurrencia entre procesos.';
    }
    await db.query(`insert into acceso.beta_clientes(token_hash,pc_codigo,enabled) values
      (encode(sha256(convert_to($1,'UTF8')),'hex'),'P1',true),
      (encode(sha256(convert_to($2,'UTF8')),'hex'),'P2',true)`, [TOKEN, OTHER_TOKEN]);

    await check('autorizacion: token invalido, oficina cruzada y cliente deshabilitado no leen', async () => {
      await assert.rejects(rpc('nodo_beta_chat_lista_v1', ['00'.repeat(32), 'P1']), /BETA_NOT_AUTHORIZED/);
      await assert.rejects(rpc('nodo_beta_chat_lista_v1', [TOKEN, 'P2']), /BETA_NOT_AUTHORIZED/);
      await assert.rejects(node('chat_mensajes', ['gamma']), /BETA_CHAT_NOT_AUTHORIZED/);
      await db.exec("update acceso.beta_clientes set enabled=false where pc_codigo='P1'");
      await assert.rejects(node('chat_lista'), /BETA_NOT_AUTHORIZED/);
    });

    await check('privilegios: anon usa RPC y no entra al schema privado ni a tablas base', async () => {
      const checks = await query(`select (has_schema_privilege('anon','acceso','USAGE') or
        has_schema_privilege('anon','comunicaciones','USAGE') or has_schema_privilege('anon','observabilidad','USAGE')) as private_schema,
        has_table_privilege('anon','acceso.beta_clientes','SELECT') as private_table,
        has_function_privilege('anon','acceso.autorizar(text,text)','EXECUTE') as private_function,
        has_function_privilege('anon','public._zona_valida(text)','EXECUTE') as timezone_helper,
        has_function_privilege('anon','public.nodo_beta_chat_lista_v1(text,text,text,text,integer,bigint)','EXECUTE') as rpc`);
      assert.deepEqual(checks[0], { private_schema: false, private_table: false, private_function: false, timezone_helper: false, rpc: true });
      assert.equal((await node('chat_lista')).ok, true);
    });

    await check('lecturas puras: lista y detalle no marcan leido ni crean recibos', async () => {
      const before = await messages();
      await node('chat_lista'); await node('chat_mensajes', ['alpha']);
      assert.deepEqual(await messages(), before);
      assert.equal((await query('select count(*)::int as n from comunicaciones.chat_lecturas'))[0].n, 0);
    });

    await check('mensajes: pagina limitada, orden estable y conteo completo independiente de pagina', async () => {
      const page = await node('chat_mensajes', ['alpha', 2]);
      assert.equal(page.rows.length, 2); assert.equal(page.has_more, true);
      assert.deepEqual(page.rows.map(m => m.id), ['110', '111']);
      assert.equal(page.counts.unread, 4); assert.equal(page.counts.seen_remaining, 7);
      const older = await node('chat_mensajes', ['alpha', 2, page.next_before_id]);
      assert.deepEqual(older.rows.map(m => m.id), ['107', '108']);
      assert.deepEqual(older.counts, page.counts);
      await assert.rejects(node('chat_mensajes', ['alpha', 101]), /BETA_INVALID_PAGE/);
    });

    await check('contador: lo leido con el sistema anterior o ya contestado no cuenta como sin leer (D-131)', async () => {
      await db.exec(`insert into public.chat_sesiones(id,chat_id,pc_codigo,usuario,telefono,estado,chat_public_token) values
          (13,'contador','P1','CONTA','5550100004','ABIERTO','portal-demo-token-contador');
        insert into public.chat_mensajes(id,chat_id,conversacion_id,tipo_emisor,emisor,mensaje,leido,metadata) values
          (600,'contador',13,'USUARIO','CONTA','leido con el sistema anterior',true,'{}'),
          (601,'contador',13,'USUARIO','CONTA','sin marcar pero contestado',false,'{}'),
          (602,'contador',13,'OPERADOR','OPERADOR_DEMO','respuesta',false,'{}'),
          (603,'contador',13,'USUARIO','CONTA','nuevo',false,'{}'),
          (604,'contador',13,'OPERADOR','NODO','respuesta automatica',false,'{"auto":"true"}'),
          (605,'contador',13,'SISTEMA','SISTEMA','evento',false,'{}'),
          (606,'contador',13,'USUARIO','CONTA','nuevo 2',false,'{}');`);
      const page = await node('chat_mensajes', ['contador', 10]);
      assert.equal(page.counts.unread, 2, 'solo lo posterior a la ultima respuesta de una persona');
      assert.equal(page.counts.seen_remaining, 4, 'el visto del jugador no se infiere del leido viejo');
      await db.exec(`delete from public.chat_mensajes where chat_id='contador'; delete from public.chat_sesiones where id=13;`);
    });

    await check('lista: alcance y total sin leer no dependen de pagina ni incluyen cerrados', async () => {
      const list = await node('chat_lista', [null, 'ABIERTO', 1]);
      assert.equal(list.rows.length, 1); assert.equal(list.total, 2); assert.equal(list.unread_total, 5);
      assert.equal(list.has_more, true);
      const older = await node('chat_lista', [null, 'ABIERTO', 1, list.next_before_id]);
      assert.equal(older.unread_total, 5); assert.equal(older.rows.length, 1);
      const all = await node('chat_lista'); assert.equal(all.unread_total, 5, 'un chat cerrado no suma mensajes nuevos');
      const user = await node('chat_lista', [' demo ', 'ABIERTO']);
      assert.equal(user.total, 1); assert.equal(user.rows[0].chat_id, 'alpha');
    });

    await check('identidad: chat textual prevalece sobre sesion numerica y ramas no duplican ni mezclan', async () => {
      await assert.rejects(node('chat_mensajes', ['10']), /BETA_CHAT_NOT_AUTHORIZED/);
      const page = await node('chat_mensajes', ['alpha', 100]);
      const ids = page.rows.map(m => m.id);
      assert.equal(ids.length, new Set(ids).size); assert.equal(ids.includes('109'), false); assert.equal(ids.includes('500'), false);
      assert.equal(ids.includes('110'), true); assert.equal(ids.includes('111'), true);
      assert.equal(ids.includes('105'), false, 'no muestra contenido oculto al operador');
    });

    await check('legacy: solo hilo enlazado de misma oficina e identidad, sin deduplicacion por texto', async () => {
      const thread = [
        { id: '100', origen: 'USUARIO', mensaje: 'copia identificada' },
        { origen: 'OPERADOR', mensaje: 'texto repetido', fecha: '2026-10-26T10:00:00Z', auto: true },
        { origen: 'OPERADOR', mensaje: 'texto repetido', fecha: '2026-10-26T10:01:00Z' }
      ];
      await query("insert into public.landing_solicitudes(id,tipo,pc_codigo,usuario,metadata) values (700,'SOPORTE','P1','DEMO',$1::jsonb)", [JSON.stringify({ chat_thread: thread })]);
      await db.exec('update public.chat_sesiones set solicitud_id=700 where id=10');
      const page = await node('chat_mensajes', ['alpha', 2]);
      assert.equal(page.legacy_thread.length, 2);
      assert.equal(page.legacy_thread[0].mensaje, page.legacy_thread[1].mensaje);
      assert.notEqual(page.legacy_thread[0].portal_key, page.legacy_thread[1].portal_key);
      assert.ok(page.legacy_thread.every(m => m.visto_confirmado === false));
      assert.equal(page.legacy_thread[0].auto, true);
      assert.deepEqual((await node('chat_mensajes', ['alpha', 2, page.next_before_id])).legacy_thread, []);
      await active();
      assert.deepEqual((await portal()).legacy_thread, page.legacy_thread);
      await db.exec("update public.landing_solicitudes set pc_codigo='P2' where id=700");
      assert.deepEqual((await node('chat_mensajes', ['alpha'])).legacy_thread, []);
      await db.exec("update public.landing_solicitudes set pc_codigo='P1',usuario='OTRO' where id=700");
      assert.deepEqual((await node('chat_mensajes', ['alpha'])).legacy_thread, []);
    });

    await check('legacy: visibilidad explicita respeta canal y ausente conserva compatibilidad', async () => {
      const thread = [
        { origen: 'OPERADOR', mensaje: 'solo operador', visible_usuario: false, visible_operador: true },
        { origen: 'OPERADOR', mensaje: 'solo usuario', visible_usuario: true, visible_operador: false },
        { origen: 'OPERADOR', mensaje: 'ambos' }
      ];
      await query("insert into public.landing_solicitudes(id,tipo,pc_codigo,usuario,metadata) values (701,'SOPORTE','P1','DEMO',$1::jsonb)", [JSON.stringify({ chat_thread: thread })]);
      await db.exec('update public.chat_sesiones set solicitud_id=701 where id=10');
      const page = await node('chat_mensajes', ['alpha']);
      assert.deepEqual(page.legacy_thread.map(m => m.mensaje), ['solo operador', 'ambos']);
      await active();
      assert.deepEqual((await portal()).legacy_thread.map(m => m.mensaje), ['solo usuario', 'ambos']);
    });

    await check('legacy: el relleno guardado como USUARIO no viaja por ningun canal (D-130)', async () => {
      const thread = [
        { origen: 'OPERADOR', mensaje: 'buenas' },
        { origen: 'USUARIO', mensaje: '[Conversación iniciada por el operador juancarlos]' },
        { origen: 'USUARIO', mensaje: '[Conversación iniciada por el operador]' },
        { origen: 'USUARIO', mensaje: 'Consulta desde portal' },
        { origen: 'USUARIO', mensaje: 'Consulta desde portal', imagen_url: 'https://demo.invalid/c.png' },
        { origen: 'USUARIO', mensaje: 'Consulta desde portal por una carga' },
        { origen: 'OPERADOR', mensaje: 'Consulta desde portal' }
      ];
      const expected = ['buenas', 'Consulta desde portal', 'Consulta desde portal por una carga', 'Consulta desde portal'];
      await query("insert into public.landing_solicitudes(id,tipo,pc_codigo,usuario,metadata) values (702,'SOPORTE','P1','DEMO',$1::jsonb)", [JSON.stringify({ chat_thread: thread })]);
      await db.exec('update public.chat_sesiones set solicitud_id=702 where id=10');
      assert.deepEqual((await node('chat_mensajes', ['alpha'])).legacy_thread.map(m => m.mensaje), expected);
      await active();
      assert.deepEqual((await portal()).legacy_thread.map(m => m.mensaje), expected);
      await db.exec('update public.chat_sesiones set solicitud_id=701 where id=10');
    });

    await check('legacy: la copia en el hilo de un mensaje del chat no viaja dos veces (D-133)', async () => {
      await db.exec(`insert into public.chat_mensajes(id,chat_id,conversacion_id,tipo_emisor,emisor,mensaje,created_at) values
        (9001,'alpha',10,'USUARIO','DEMO','quiero ayuda','2026-11-01T19:55:25.505Z'),
        (9002,'alpha',10,'OPERADOR','NODO','recibimos tus datos','2026-11-01T19:55:25.530Z')`);
      const thread = [
        { origen: 'USUARIO', mensaje: 'quiero ayuda', fecha: '2026-11-01T19:55:25Z' },
        { origen: 'OPERADOR', operador: 'NODO', auto: true, mensaje: 'recibimos tus datos', fecha: '2026-11-01T19:55:25.530Z' },
        { origen: 'USUARIO', mensaje: 'quiero ayuda', fecha: '2026-11-01T20:10:00Z' },
        { origen: 'OPERADOR', mensaje: 'quiero ayuda', fecha: '2026-11-01T19:55:25Z' },
        { origen: 'OPERADOR', mensaje: 'ya validamos tu cuenta', fecha: '2026-11-01T19:55:25Z' },
        { origen: 'OPERADOR', mensaje: 'sin fecha' },
        { origen: 'OPERADOR', mensaje: 'fecha rota', fecha: 'cualquier cosa' }
      ];
      const expected = ['quiero ayuda', 'quiero ayuda', 'ya validamos tu cuenta', 'sin fecha', 'fecha rota'];
      await query("insert into public.landing_solicitudes(id,tipo,pc_codigo,usuario,metadata) values (703,'SOPORTE','P1','DEMO',$1::jsonb)", [JSON.stringify({ chat_thread: thread })]);
      await db.exec('update public.chat_sesiones set solicitud_id=703 where id=10');
      const page = await node('chat_mensajes', ['alpha']);
      assert.deepEqual(page.legacy_thread.map(m => m.mensaje), expected);
      assert.equal(page.rows.filter(m => m.id === '9001' || m.id === '9002').length, 2, 'el original sigue en rows');
      await active();
      assert.deepEqual((await portal()).legacy_thread.map(m => m.mensaje), expected);
      await db.exec('update public.chat_sesiones set solicitud_id=701 where id=10; delete from public.chat_mensajes where id in (9001,9002);');
    });

    await check('ACK: conjunto exacto con huecos, repetidos idempotentes y rechazo atomico crosschat', async () => {
      const ack = await node('chat_leido', ['alpha', ['100', '104', '104']]);
      assert.deepEqual(ack.acknowledged_ids, ['100', '104']); assert.equal(ack.inserted, 2);
      const rows = await messages();
      assert.equal(rows.find(m => m.id === '100').leido, true); assert.equal(rows.find(m => m.id === '104').leido, true);
      assert.equal(rows.find(m => m.id === '102').leido, false, 'no ACK de mensajes entre IDs vistos');
      assert.equal((await node('chat_leido', ['alpha', ['104', '100']])).inserted, 0);
      await assert.rejects(node('chat_leido', ['alpha', ['102', '200']]), /BETA_ACK_OUT_OF_SCOPE/);
      assert.equal((await messages()).find(m => m.id === '102').leido, false, 'rechazo no deja escritura parcial');
      await assert.rejects(node('chat_leido', ['alpha', ['103']]), /BETA_ACK_OUT_OF_SCOPE/);
      await assert.rejects(node('chat_leido', ['alpha', ['105']]), /BETA_ACK_OUT_OF_SCOPE/);
      await assert.rejects(node('chat_leido', ['alpha', []]), /BETA_INVALID_ACK/);
    });

    await check('Portal: visto requiere recibo explicito, no getter legacy; token cruzado no lee', async () => {
      await active();
      const initial = await portal(); assert.equal(initial.available, true);
      const legacyRead = initial.rows.find(m => m.id === '107');
      assert.equal(legacyRead.leido, true); assert.equal(legacyRead.visto_confirmado, false);
      assert.equal(initial.rows.some(m => m.id === '108'), false, 'no muestra contenido oculto al usuario');
      await node('chat_leido', ['alpha', ['100', '104']]);
      const seen = await portal('landing_chat_vistos_v1', [['100', '102', '104', '107']]);
      assert.deepEqual(seen.seen.map(m => m.message_id), ['100', '104']);
      await assert.rejects(rpc('landing_beta_chat_leer_v1', [11, PORTAL_TOKEN]), /BETA_CHAT_NOT_AUTHORIZED/);
    });

    await check('capacidades: consulta no activa; ACK de build activa lease y vencimiento vuelve Portal a legacy', async () => {
      const caps = await node('capacidades'); assert.equal(caps.active, false);
      assert.equal((await portal()).available, false);
      await assert.rejects(node('capacidades', [null, true]), /BETA_BUILD_REQUIRED/);
      const activated = await active(); assert.equal(activated.active, true); assert.equal(activated.build, BUILD);
      assert.equal((await portal()).available, true);
      await db.exec("update acceso.beta_clientes set last_seen=now()-interval '6 minutes' where pc_codigo='P1'");
      assert.equal((await portal()).available, false);
      await node('salud', [[], 'old-build']); assert.equal((await portal()).available, false);
      await node('salud', [[], BUILD]); assert.equal((await portal()).available, true);
    });

    await check('salud: etapas independientes, datos viejos no pisan nuevos y ultimo error sobrevive ALIVE', async () => {
      const now = new Date().toISOString();
      const sample = (stage, state, extra = {}) => ({ integration: 'CHAT', stage, state, observed_at: now, ...extra });
      let result = await node('salud', [[sample('DATA', 'ERROR', { errors: 1, code: 'TEST_DATA' }), sample('ALIVE', 'OK')], BUILD]);
      assert.equal(result.accepted, 2); assert.equal(result.rows.length, 2);
      assert.equal(result.rows.find(r => r.stage === 'DATA').state, 'ERROR');
      result = await node('salud', [[sample('DATA', 'OK', { observed_at: new Date(Date.now() - 10000).toISOString() })], BUILD]);
      assert.equal(result.accepted, 0); assert.equal(result.rows.find(r => r.stage === 'DATA').state, 'ERROR');
      await db.exec("update observabilidad.salud_actual set received_at=now()-interval '6 minutes'");
      result = await node('salud'); assert.ok(result.rows.every(r => r.state === 'UNKNOWN'));
      assert.equal(result.rows.find(r => r.stage === 'DATA').last_error_code, 'TEST_DATA');
    });

    await check('salud: limites de lote/campos/edad y scope evitan basura y datos cruzados', async () => {
      const valid = { integration: 'CHAT', stage: 'DATA', state: 'OK', observed_at: new Date().toISOString() };
      await assert.rejects(node('salud', [Array(33).fill(valid), BUILD]), /BETA_INVALID_HEALTH_BATCH/);
      await assert.rejects(node('salud', [[{ ...valid, message: 'texto privado prohibido' }], BUILD]), /BETA_INVALID_HEALTH_SAMPLE/);
      await assert.rejects(node('salud', [[{ ...valid, observed_at: new Date(Date.now() - 72 * 3600000).toISOString() }], BUILD]), /BETA_INVALID_HEALTH_TIME/);
      await node('salud', [[valid], BUILD]);
      assert.deepEqual((await rpc('nodo_beta_salud_v1', [OTHER_TOKEN, 'P2'])).rows, []);
    });

    await check('envio: mismo request_id escribe una vez y cambio de contenido no reutiliza identidad', async () => {
      const id = '8c100a3b-1c02-4027-b648-05e15b30fa8a';
      const before = (await query('select count(*)::int as n from public.chat_mensajes'))[0].n;
      const args = ['alpha', 'respuesta demo', null, 'OPERADOR_DEMO', id];
      const first = await node('chat_enviar', args), second = await node('chat_enviar', args);
      assert.equal(first.ok, true); assert.equal(second.ok, true);
      assert.equal((await query('select count(*)::int as n from public.chat_mensajes'))[0].n, before + 1);
      await assert.rejects(node('chat_enviar', ['alpha', 'texto cambiado', null, 'OPERADOR_DEMO', id]), /BETA_/);
      await assert.rejects(node('chat_enviar', ['gamma', 'respuesta demo', null, 'OPERADOR_DEMO', 'ac100a3b-1c02-4027-b648-05e15b30fa8a']), /BETA_CHAT_NOT_AUTHORIZED/);
    });

    await check('envio: cerrado y payload invalido no escriben mensaje ni reserva de idempotencia', async () => {
      const before = await query('select count(*)::int as n from public.chat_mensajes');
      const id = '8c100a3b-1c02-4027-b648-05e15b30fa8b';
      await assert.rejects(node('chat_enviar', ['closed', 'no enviar', null, 'DEMO', id]), /BETA_CHAT_CLOSED/);
      await assert.rejects(node('chat_enviar', ['alpha', '', 'http://demo.invalid/image.png', 'DEMO', id]), /BETA_INVALID_MESSAGE/);
      await assert.rejects(node('chat_enviar', ['alpha', 'a'.repeat(8001), null, 'DEMO', id]), /BETA_INVALID_MESSAGE/);
      await assert.rejects(node('chat_enviar', ['alpha', '  ', null, 'DEMO', id]), /BETA_INVALID_MESSAGE/);
      assert.deepEqual(await query('select count(*)::int as n from public.chat_mensajes'), before);
      assert.equal((await query('select count(*)::int as n from comunicaciones.chat_envios'))[0].n, 0);
    });

    await check('historial: servidor entrega solo identidad/oficina y rechazo del turno, sin escribir', async () => {
      const before = await query('select id::text,estado,monto from public.landing_solicitudes order by id');
      const result = await rpc('landing_historial_usuario_beta_v1', ['DEMO', '5550100001', 'demo-p1']);
      assert.equal(result.ok, true); assert.equal(result.contract, 'portal.historial.v1');
      assert.equal(result.rows.length, 2); assert.ok(result.rows.every(r => r.monto !== 900 && r.monto !== 800));
      assert.equal(result.rechazos_turno.RETIRO.motivo, 'Motivo de prueba');
      assert.ok(result.rows.every(r => !Object.hasOwn(r, '_orden_id')));
      assert.deepEqual(await query('select id::text,estado,monto from public.landing_solicitudes order by id'), before);
      assert.equal((await rpc('landing_historial_usuario_beta_v1', ['', '', 'demo-p1'])).ok, false);
       assert.equal((await rpc('landing_historial_usuario_beta_v1', ['DEMO', '5550100001', 'demo-p1', 'NOT_A_TIMEZONE'])).ok, false);
       assert.equal((await rpc('landing_historial_usuario_beta_v1', ['DEMO', '5550100001', 'demo-p1', null])).ok, false);
    });

    await check('historial: codigo inexistente no abre alcance global y pagina maxima es 50', async () => {
      const invalid = await rpc('landing_historial_usuario_beta_v1', ['DEMO', '5550100001', 'unknown-code']);
      assert.equal(invalid.ok, false);
      await db.exec("insert into public.historial_ops(tipo,estado,usuario,pc_codigo,monto) select 'CARGA','OK','DEMO','P1',g from generate_series(1,60) g");
      const result = await rpc('landing_historial_usuario_beta_v1', ['DEMO', '5550100001', 'demo-p1']);
      assert.equal(result.rows.length, 50);
    });

    await check('historial: ausencia de codigo no revela manuales de otra oficina con mismo nombre', async () => {
      for(const code of ['', null, '   ']) {
        const result = await rpc('landing_historial_usuario_beta_v1', ['DEMO', '5550100001', code]);
        assert.ok(result.ok === false || result.rows.every(row => row.monto !== 900), 'la identidad telefono P1 no autoriza al homonimo P2');
      }
    });

    await check('contencion reversible: deshabilitar cliente corta beta y rollback restaura sin borrar negocio', async () => {
      await active(); const before = await messages();
      await db.exec('savepoint containment');
      await db.exec("update acceso.beta_clientes set enabled=false where pc_codigo='P1'");
      await assert.rejects(node('chat_lista'), /BETA_NOT_AUTHORIZED/);
      assert.equal((await portal()).available, false);
      assert.deepEqual(await messages(), before);
      await db.exec('rollback to savepoint containment; release savepoint containment');
      assert.equal((await node('chat_lista')).ok, true); assert.equal((await portal()).available, true);
      assert.deepEqual(await messages(), before);
    });
    await check('transporte: cliente real -> IPC -> HTTP loopback -> SQL anon; ACK, visto, envio y salud persistidos', async () => {
      const { verifyTransport } = require('./beta-transport-check.cjs');
      await verifyTransport({ rpc, query, token: TOKEN, build: BUILD, portalToken: PORTAL_TOKEN });
    });
  } catch(error) {
    report.setup_error = { message: String(error.message).slice(0, 600), code: error.code || null };
  } finally { await db.close(); }
  report.source_changed_during_run = sources.some(s => hash(fs.readFileSync(path.join(ROOT, s.file), 'utf8')) !== report.source_hashes[s.file]);
  report.finished_at = new Date().toISOString();
  report.passed = report.tests.filter(t => t.ok).length;
  report.failed = report.tests.filter(t => !t.ok).length;
  report.ok = !report.setup_error && report.failed === 0 && !report.source_changed_during_run;
  const outIndex = process.argv.indexOf('--output');
  if(outIndex !== -1) {
    if(!process.argv[outIndex + 1]) throw new Error('Falta ruta despues de --output');
    fs.writeFileSync(path.resolve(process.argv[outIndex + 1]), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
  if(!report.ok) process.exitCode = 1;
  return report;
}

if(require.main === module) verify().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verify, resolvePGlite, fixture };
