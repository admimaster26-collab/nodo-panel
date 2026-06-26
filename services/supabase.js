const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

function createSupabase(config) {
  if (!config.supabaseUrl || !config.supabaseAnonKey || config.supabaseUrl.includes("TU-PROYECTO")) {
    console.warn("[supabase] Falta configurar supabaseUrl/supabaseAnonKey en config.json");
  }

  // El worker corre en la PC de la oficina con la anon key; el blindaje (RLS por header)
  // exige el mismo secreto que el panel para leer/escribir las tablas operativas.
  const headers = {};
  if (config.panelDataSecret) headers["x-panel-secret"] = config.panelDataSecret;

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    realtime: { transport: WebSocket },
    global: { headers }
  });
}

module.exports = { createSupabase };
