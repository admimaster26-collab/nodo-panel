// Sonda de UNA PREGUNTA: ¿la API de Whaticket da el teléfono de cada línea?
//
// SOLO GET. No crea, no modifica, no manda mensajes, y NO devuelve valores: de cada respuesta
// informa los NOMBRES de los campos y, para los que parecen un teléfono, cuántos dígitos tienen.
// Así se puede contestar la pregunta sin que un número de línea salga por el log de una función.
//
// Hace falta para rotar la línea del Portal: si una línea se cae hay que poner otra, y para eso
// el servidor necesita saber qué número es cada línea. GET /whatsapps devuelve solo
// channel, id, name y status (verificado en P4 el 13/11), así que lo que queda por probar es el
// detalle de una línea sola y las variantes que suele tener Whaticket.
//
//   { "pc":"P4" }            la oficina (por defecto P4)
//   { "pc":"P4", "id":"…" }  una línea puntual; si no, toma la primera que devuelva /whatsapps
const B = "https://api.whaticket.com/api/v1";
const PREFIJO = "WHATICKET_MONITOR_";

// Nombres de campos + forma, nunca el valor.
function forma(o: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!o || typeof o !== "object") return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (v === null || v === undefined) { out[k] = "null"; continue; }
    if (typeof v === "object") { out[k] = Array.isArray(v) ? `array(${v.length})` : "objeto"; continue; }
    const s = String(v);
    const dig = s.replace(/[^0-9]/g, "");
    // Lo único que se dice de un valor: si parece un teléfono, cuántos dígitos tiene.
    out[k] = dig.length >= 8 && dig.length <= 15 && dig.length >= s.length - 4
      ? `parece telefono (${dig.length} digitos)`
      : typeof v;
  }
  return out;
}

async function get(T: string, ruta: string) {
  try {
    const r = await fetch(`${B}${ruta}`, {
      headers: { Authorization: `Bearer ${T}`, Accept: "application/json" },
    });
    if (!r.ok) {
      let e = ""; try { e = String((await r.json())?.error ?? "").slice(0, 90); } catch { /* */ }
      return { ruta, status: r.status, error: e || null };
    }
    const j = await r.json();
    const lista = Array.isArray(j) ? j : (j.whatsapps ?? j.data ?? null);
    if (Array.isArray(lista)) {
      return { ruta, status: 200, cuantos: lista.length, campos: forma(lista[0]) };
    }
    return { ruta, status: 200, campos: forma(j) };
  } catch (e) {
    return { ruta, status: 0, error: String(e).slice(0, 120) };
  }
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const pc = (String(body.pc ?? "P4").trim().toUpperCase()) || "P4";
  const T = (Deno.env.get(`${PREFIJO}${pc}`) ?? "").trim();
  if (!T) return Response.json({ ok: false, error: `Falta el secret ${PREFIJO}${pc}` }, { status: 400 });

  let id = String(body.id ?? "").trim();
  const lista = await get(T, "/whatsapps");
  if (!id) {
    try {
      const r = await fetch(`${B}/whatsapps`, { headers: { Authorization: `Bearer ${T}`, Accept: "application/json" } });
      const j = await r.json();
      const arr = Array.isArray(j) ? j : (j.whatsapps ?? j.data ?? []);
      id = String(arr?.[0]?.id ?? "");
    } catch { /* */ }
  }

  const rutas = id
    ? [`/whatsapps/${id}`, `/whatsapps/${id}/session`, `/whatsapp/${id}`, `/settings`]
    : ["/settings"];

  const res = [lista];
  for (const r of rutas) { res.push(await get(T, r)); await new Promise((s) => setTimeout(s, 200)); }

  const conTelefono = res.filter((r) =>
    Object.values((r as { campos?: Record<string, string> }).campos ?? {}).some((v) => String(v).startsWith("parece telefono")));

  return Response.json({
    ok: true, pc,
    hay_telefono_en_la_api: conTelefono.length > 0,
    donde: conTelefono.map((r) => (r as { ruta: string }).ruta),
    detalle: res,
  });
});
