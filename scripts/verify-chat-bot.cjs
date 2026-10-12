// Verifica la migración REAL en PostgreSQL WASM aislado. No conecta a Supabase.
// node scripts/verify-chat-bot.cjs <ruta-a-@electric-sql/pglite>
// Dependencia de verificación: @electric-sql/pglite@0.5.8; puede instalarse en TEMP.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const dependency = process.argv[2] || '@electric-sql/pglite';
  const { PGlite } = require(dependency);
  const db = new PGlite();
  const root = path.resolve(__dirname, '..');
  const original = fs.readFileSync(path.join(root, 'servidor/revision-chat-2026-10-11/bot-original.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261011100217_chat_respuestas_y_ayuda_contextual.sql'), 'utf8');
  let assertions = 0;
  try {
    // Sólo los helpers y la tabla mínimos; todas las identidades son ficticias.
    // unaccent se simula para estos ejemplos; no verifica configuración de extensiones.
    await db.exec(`
      create function public.unaccent(text) returns text language sql immutable as $$
        select translate($1, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN') $$;
      create function public.nodo_norm_usuario_v21(text) returns text language sql immutable as $$
        select lower(btrim($1)) $$;
      create table public.landing_solicitudes (
        pc_codigo text, usuario text, tipo text, estado text, monto numeric,
        metadata jsonb default '{}', created_at timestamptz
      );
      create table public.bot_seen(caso text);
      create function public._soporte_ya_dijo(text,text,text,interval) returns boolean language sql stable as $$
        select exists(select 1 from public.bot_seen where caso=$3) $$;
      create function public._soporte_texto_rechazo(text,text,integer,text) returns text language sql immutable as $$
        select 'Rechazo informado' $$;
    `);
    await db.exec(original);
    await db.exec(migration);
    const when = '2026-10-11T10:00:00Z';
    const ask = async (text, pc = 'P1') => {
      const result = await db.query('select * from soporte_auto_mensaje_v1($1,$2,$3,$4::timestamptz)', [pc, 'cliente_prueba', text, when]);
      return result.rows[0];
    };
    function check(value, message) { assert.ok(value, message); assertions++; }
    let result = await ask('Hola');
    check(result.caso === 'SALUDO' && result.mensaje.includes('asistente automático') && result.mensaje.includes('⟦AYUDA:inicio⟧'), 'saludo identifica bot y ofrece guía');
    result = await ask('ya transferí');
    check(result.caso === 'AVISO_PAGO_SIN_SOLICITUD' && result.mensaje.includes('⟦AYUDA:revisar_envio⟧'), 'transferencia sin solicitud ofrece diagnóstico');
    check(result.mensaje.includes('No vuelvas a transferir') && !result.mensaje.includes('te lo procesamos'), 'no invita a repetir pago ni promete acreditación');
    result = await ask('necesito hablar con un operador, ya transferí');
    check(result.caso === 'PIDE_OPERADOR', 'la petición de persona tiene prioridad');
    result = await ask('Resumen de ayuda guiada: ya transferí. Falta mi pedido.');
    check(result.caso === 'AYUDA_GUIADA_OPERADOR' && result.mensaje === null, 'resumen para humano no dispara otro bot');
    result = await ask('no puedo parar');
    check(result.caso === 'DERIVAR_HUMANO' && result.mensaje === null, 'se conserva la derivación sensible');
    result = await ask('cuánto tarda');
    check(result.caso === 'DEMORA' && !/pocos minutos|media hora/.test(result.mensaje), 'sin estado real no promete plazos');
    await db.exec(`insert into landing_solicitudes values ('P1','cliente_prueba','CARGA','PENDIENTE',1500,'{}','2026-10-11T09:50:00Z')`);
    result = await ask('ya transferí');
    check(result.caso === 'AVISO_PAGO' && result.mensaje.includes('$1.500') && result.mensaje.includes('10 minutos'), 'estado y monto provienen del registro y fecha consultada');
    check(!result.mensaje.includes('está verificando'), 'pendiente no prueba actividad de operador');
    result = await ask('hola no puedo entrar');
    check(result.caso === 'PROBLEMA_TECNICO', 'saludo con consulta no se desvía a una carga pendiente');
    result = await ask('ya transferí', 'P2');
    check(result.caso === 'AVISO_PAGO_SIN_SOLICITUD', 'no cruza oficinas');
    await db.exec(`update landing_solicitudes set created_at='2026-10-11T10:05:00Z'`);
    result = await ask('ya transferí');
    check(result.caso === 'AVISO_PAGO_SIN_SOLICITUD', 'no consulta operaciones posteriores al mensaje');
    await db.exec(`update landing_solicitudes set created_at='2026-10-11T09:55:00Z',estado='ACREDITADA'`);
    result = await ask('ya transferí');
    check(result.caso === 'AVISO_PAGO_ACREDITADA' && result.mensaje.includes('acreditada') && !result.mensaje.includes('suerte'), 'acreditación factual sin promoción');
    await db.exec(`insert into bot_seen values ('SALUDO')`);
    check(await ask('hola') === undefined, 'respeta el helper de no repetición');
    check((await db.query('select count(*)::int as n from landing_solicitudes')).rows[0].n === 1, 'consultar el bot no crea solicitudes');
    await assert.rejects(() => db.exec(migration), /El bot cambió/, 'la guarda evita sobrescribir otra versión');
    assertions++;
    console.log(JSON.stringify({ ok: true, assertions, engine: 'PostgreSQL/PGlite', externalConnections: 0 }, null, 2));
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
