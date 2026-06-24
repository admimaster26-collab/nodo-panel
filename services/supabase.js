const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

function createSupabase(config) {
  if (!config.supabaseUrl || !config.supabaseAnonKey || config.supabaseUrl.includes("TU-PROYECTO")) {
    console.warn("[supabase] Falta configurar supabaseUrl/supabaseAnonKey en config.json");
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    realtime: { transport: WebSocket }
  });
}

module.exports = { createSupabase };
