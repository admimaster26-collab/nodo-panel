/* ============================================================
   NODO · VISTA PREVIA Y APROBACIÓN DE SOLICITUDES EN EL CHAT
   - Menú desplegable (modo reducido y modo completo).
   - Semáforo visual estricto:
       * Verde: Comprobante bancario verificado, reciente (<60m),
                sin duplicados hoy y sin transferencia programada.
       * Ámbar: Sin comprobante, comprobante emitido hace horas (>60m),
                o imagen que no parece un comprobante bancario.
       * Rojo: Monto ya procesado hoy para este usuario, monto no coincide,
               o transferencia programada (no debitada).
       * Azul: Analizando comprobante con IA en curso.
   - Extracción con Gemini Vision (con modelos fallback: 3.5-flash / flash-latest / 3.5-flash-lite).
   - Autocompleta Monto y Titular si la solicitud venía con $0 o vacía.
   ============================================================ */
(function(root){
  'use strict';

  // 11/10 · Acá había una clave de API de Google escrita a mano. GitHub frenó el push y con
  // razón: este archivo se empaqueta en la app que va a las 25 PCs y el repo es PÚBLICO. Una
  // clave de API paga en el código es plata de cualquiera que la lea.
  //
  // Mismo criterio que el resto de los secretos del panel: sale de la configuración de la PC.
  // Y SIN valor por defecto: si no está configurada, la lectura con IA no corre y se dice por
  // consola. Prefiero que la función no ande antes que volver a dejar una clave adentro.
  const GEMINI_API_KEY = (function(){
    try{ return String(localStorage.getItem('nodo_gemini_api_key') || '').trim(); }
    catch(_e){ return ''; }
  })();
  const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

  // Cache en memoria por URL de imagen para no volver a consultar a la IA
  const ocrCache = new Map();
  let demoModo = null;
  let desplegado = false;

  function esc(s){
    try{ if(typeof escapeHtml === 'function') return escapeHtml(s); }catch(_e){}
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function fmtMoney(v){
    const n = Math.abs(Number(v || 0));
    return '$' + n.toLocaleString('es-AR');
  }

  // ── 1. Validación estricta de solicitud financiera ──────────────────────────
  function esSolicitudFinancieraValida(s){
    if(!s) return false;

    // Regla A: No admitir tipos que sean explícitamente SOPORTE o consultas generales
    const tipo = String(s.TIPO || s.tipo || s.tipo_solicitud || '').trim().toUpperCase();
    if(tipo && tipo !== 'CARGA' && tipo !== 'RETIRO') return false;

    // Regla B: Estado pendiente de resolver por el cajero
    const est = String(s.ESTADO || s.estado || '').trim().toUpperCase();
    const estadosPendientes = ['PENDIENTE', 'EN_REVISION', 'NUEVA', 'EN_ESPERA', 'ABIERTA'];
    if(!estadosPendientes.includes(est)) return false;

    // Regla C: Monto positivo O comprobante adjunto reciente
    const monto = Number(s.MONTO_REAL || s.MONTO_DECLARADO || s.monto || 0);
    const tieneImgDirecta = Boolean(s.COMPROBANTE_URL || s.comprobante_url || s.IMAGEN_URL || s.imagen_url);

    if((isNaN(monto) || monto <= 0) && !tieneImgDirecta){
      // Si no tiene monto ni foto directa, solo se admite si el chat tiene imagen reciente (< 2 horas)
      const tieneImgChat = window.__nodoChatCurrentTicket && Array.isArray(window.__nodoChatCurrentTicket.thread) &&
        window.__nodoChatCurrentTicket.thread.some(m => {
          const rol = String(m.origen || m.remitente || m.role || '').toUpperCase();
          const mFechaMs = m.fecha ? new Date(m.fecha).getTime() : 0;
          return rol !== 'OPERADOR' && rol !== 'SISTEMA' && Boolean(m.imagen_url) && (!isNaN(mFechaMs) ? (Date.now() - mFechaMs) <= (2 * 3600 * 1000) : true);
        });
      if(!tieneImgChat) return false;
    }

    // Regla D: Límite temporal de vigencia (máximo 48 horas de antigüedad para evitar zombis)
    const fechaStr = s.FECHA_CREACION || s.created_at || s.fecha || null;
    if(fechaStr){
      const fechaMs = new Date(fechaStr).getTime();
      const hace48hs = Date.now() - (48 * 60 * 60 * 1000);
      if(!isNaN(fechaMs) && fechaMs < hace48hs) return false;
    }

    return true;
  }

  // ── 2. Buscar solicitud pendiente para un usuario ───────────────────────────
  function buscarSolicitudPendiente(usuario){
    if(demoModo) return demoSolicitud(demoModo);
    if(!usuario) return null;
    const u = String(usuario).trim().toLowerCase();

    // Prioridad 1: Buscar en la lista oficial de solicitudes del panel
    const lista = (window.V154P && Array.isArray(window.V154P.solicitudes))
      ? window.V154P.solicitudes
      : (Array.isArray(window.solicitudes) ? window.solicitudes : []);

    const solOficial = lista.find(s => {
      const uSol = String(s.USUARIO || s.usuario || '').trim().toLowerCase();
      return uSol === u && esSolicitudFinancieraValida(s);
    });
    if(solOficial) return solOficial;

    // Prioridad 2: Buscar en los items del ticket actual
    if(window.__nodoChatCurrentTicket && Array.isArray(window.__nodoChatCurrentTicket.items)){
      const solTicket = window.__nodoChatCurrentTicket.items.find(s => esSolicitudFinancieraValida(s));
      if(solTicket) return solTicket;
    }

    // Prioridad 3: Si el ticket actual de chat tiene una imagen reciente enviada por el usuario
    if(window.__nodoChatCurrentTicket && Array.isArray(window.__nodoChatCurrentTicket.thread)){
      const hace2hs = Date.now() - (2 * 3600 * 1000);
      const imgReciente = window.__nodoChatCurrentTicket.thread.find(m => {
        const rol = String(m.origen || m.remitente || m.role || '').toUpperCase();
        const mFechaMs = m.fecha ? new Date(m.fecha).getTime() : 0;
        return rol !== 'OPERADOR' && rol !== 'SISTEMA' && Boolean(m.imagen_url) && (!isNaN(mFechaMs) ? mFechaMs >= hace2hs : true);
      });
      if(imgReciente){
        return {
          ID: window.__nodoChatCurrentTicket.masterId || window.__nodoChatCurrentTicket.solicitudId || 'CHAT',
          USUARIO: usuario,
          TIPO: 'CARGA',
          MONTO_DECLARADO: 0,
          COMPROBANTE_URL: imgReciente.imagen_url,
          FECHA_CREACION: imgReciente.fecha || new Date().toISOString()
        };
      }
    }

    return null;
  }

  // ── 3. Datos de prueba interactivos para modo Dev ───────────────────────────
  function demoSolicitud(tipo){
    const now = new Date();
    if(tipo === 'verde'){
      return {
        _isDemo: true,
        _demoTipo: 'verde',
        ID: 9941,
        USUARIO: 'demo_jugador',
        TIPO: 'CARGA',
        MONTO_REAL: 15000,
        MONTO_DECLARADO: 15000,
        TITULAR: 'JUAN CARLOS PEREZ',
        BILLETERA_NOMBRE: 'BAPRO',
        FECHA_CREACION: new Date(now - 7*60000).toISOString(),
        COMPROBANTE_URL: 'https://placehold.co/600x400/10131a/22c55e?text=Comprobante+Reciente+$15.000',
        _simOcr: {
          esComprobante: true,
          monto: 15000,
          titular: 'JUAN CARLOS PEREZ',
          banco: 'Mercado Pago',
          idOp: '89324823901',
          minutosAtras: 7,
          hora: new Date(now - 7*60000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
          esProgramada: false
        }
      };
    }
    if(tipo === 'ambar'){
      return {
        _isDemo: true,
        _demoTipo: 'ambar',
        ID: 9942,
        USUARIO: 'demo_jugador',
        TIPO: 'CARGA',
        MONTO_REAL: 25000,
        MONTO_DECLARADO: 25000,
        TITULAR: 'MARIA ELENA GONZALEZ',
        BILLETERA_NOMBRE: 'MERCADOPAGO',
        FECHA_CREACION: new Date(now - 250*60000).toISOString(),
        COMPROBANTE_URL: 'https://placehold.co/600x400/10131a/eab308?text=Comprobante+Viejo+(4+Horas)+$25.000',
        _simOcr: {
          esComprobante: true,
          monto: 25000,
          titular: 'MARIA ELENA GONZALEZ',
          banco: 'Cuenta DNI',
          idOp: '48201948201',
          minutosAtras: 245,
          hora: new Date(now - 245*60000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
          esProgramada: false
        }
      };
    }
    if(tipo === 'rojo'){
      return {
        _isDemo: true,
        _demoTipo: 'rojo',
        ID: 9943,
        USUARIO: 'demo_jugador',
        TIPO: 'CARGA',
        MONTO_REAL: 10000,
        MONTO_DECLARADO: 10000,
        TITULAR: 'ROBERTO CARLOS DIAZ',
        BILLETERA_NOMBRE: 'MERCADOPAGO',
        FECHA_CREACION: new Date(now - 12*60000).toISOString(),
        COMPROBANTE_URL: 'https://placehold.co/600x400/10131a/ef4444?text=Transferencia+Programada+$10.000',
        _yaProcesadoPrevio: {
          hora: '14:20',
          opId: '88391',
          monto: 10000
        },
        _simOcr: {
          esComprobante: true,
          monto: 10000,
          titular: 'ROBERTO CARLOS DIAZ',
          banco: 'Mercado Pago',
          idOp: '11029482001',
          minutosAtras: 3,
          hora: new Date(now - 3*60000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
          esProgramada: true
        }
      };
    }
    return null;
  }

  // ── 4. Chequeo anti-duplicados en historial ──────────────────────────────────
  function verificarSiMontoYaProcesado(usuario, monto, tipo){
    if(!usuario || !monto) return null;
    const u = String(usuario).trim().toLowerCase();
    const t = String(tipo || 'CARGA').toUpperCase();
    const mNum = Math.abs(Number(monto));

    const hist = Array.isArray(window._historialData)
      ? window._historialData
      : (Array.isArray(window._histUnificadoCache) ? window._histUnificadoCache : []);

    const hace12hs = Date.now() - (12 * 60 * 60 * 1000);

    for(const h of hist){
      const uH = String(h.usuario || h.USUARIO || '').trim().toLowerCase();
      const tH = String(h.tipo || h.TIPO || '').toUpperCase();
      const mH = Math.abs(Number(h.monto || h.MONTO || 0));
      const fechaMs = new Date(h.created_at || h.fecha || 0).getTime();

      if(uH === u && tH === t && mH === mNum && fechaMs >= hace12hs){
        const fechaTxt = new Date(fechaMs).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
        return {
          hora: fechaTxt,
          opId: h.id || h.solicitud_id || '—',
          monto: mH
        };
      }
    }
    return null;
  }

  // ── 5. Análisis con Gemini Vision (con fallback automático de modelos) ───────
  async function analizarComprobanteConGemini(urlOBase64){
    // Sin clave configurada no se sale a internet. Esto manda la IMAGEN DEL COMPROBANTE del
    // jugador a Google, así que si la PC no tiene la clave puesta a propósito, no se manda nada.
    if(!GEMINI_API_KEY){
      console.warn("[comprobante] lectura con IA apagada: falta nodo_gemini_api_key en esta PC");
      return { error: "sin_clave" };
    }
    if(!urlOBase64) return null;
    if(ocrCache.has(urlOBase64)) return ocrCache.get(urlOBase64);

    try{
      let base64Data = '';
      let mimeType = 'image/jpeg';

      if(urlOBase64.startsWith('data:')){
        const commaIdx = urlOBase64.indexOf(',');
        if(commaIdx !== -1){
          const header = urlOBase64.slice(0, commaIdx);
          const mimeMatch = header.match(/^data:([^;]+)/);
          mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          base64Data = urlOBase64.slice(commaIdx + 1).replace(/\s+/g, '');
        }
      } else {
        const resp = await fetch(urlOBase64);
        const blob = await resp.blob();
        mimeType = blob.type || 'image/jpeg';
        const buffer = await blob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for(let i = 0; i < len; i++){ binary += String.fromCharCode(bytes[i]); }
        base64Data = btoa(binary);
      }

      if(!base64Data) return null;

      const prompt = `Analiza este comprobante de transferencia bancaria de Argentina.
Responde ÚNICAMENTE un JSON válido (sin markdown, sin bloques de código, sin texto extra) con este esquema exacto:
{
  "es_comprobante": true,
  "monto": 0,
  "titular_origen": "",
  "banco_origen": "",
  "id_transaccion": "",
  "hora_texto": "HH:MM",
  "minutos_hace": 0,
  "es_programada": false,
  "duda_o_sospecha": ""
}`;

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mimeType, data: base64Data } }
          ]
        }]
      };

      let aiData = null;
      // Probar modelos en orden de disponibilidad
      for(const model of GEMINI_MODELS){
        try{
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
          const aiResp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if(aiResp.ok){
            aiData = await aiResp.json();
            break;
          }
          console.warn(`[Gemini Vision] ${model} respondió ${aiResp.status}, probando siguiente modelo...`);
        }catch(modelErr){
          console.warn(`[Gemini Vision] Error con ${model}:`, modelErr);
        }
      }

      if(!aiData) throw new Error('Todos los modelos de Gemini fallaron o están agotados');

      const rawText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = rawText.replace(/```json/gi,'').replace(/```/g,'').trim();
      const parsed = JSON.parse(cleanJson);

      const resObj = {
        esComprobante: (parsed.es_comprobante === true || parsed.es_comprobante === 'true'),
        monto: Number(parsed.monto || 0),
        titular: parsed.titular_origen || '',
        banco: parsed.banco_origen || '',
        idOp: parsed.id_transaccion || '',
        hora: parsed.hora_texto || '',
        minutosAtras: (parsed.minutos_hace != null && !isNaN(parsed.minutos_hace)) ? Number(parsed.minutos_hace) : null,
        esProgramada: Boolean(parsed.es_programada),
        sospecha: parsed.duda_o_sospecha || null
      };

      ocrCache.set(urlOBase64, resObj);
      return resObj;
    }catch(err){
      console.warn('[Gemini Vision] Error analizando comprobante:', err);
      const errObj = { error: true, esComprobante: false };
      ocrCache.set(urlOBase64, errObj);
      return errObj;
    }
  }

  // ── 6. Renderizado del banner desplegable ────────────────────────────────────
  async function renderBannerSolicitud(contenedorId, usuarioActual){
    const container = document.getElementById(contenedorId);
    if(!container) return;

    const sol = buscarSolicitudPendiente(usuarioActual);
    if(!sol){
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }

    container.classList.remove('hidden');

    const solId = sol.ID || sol.SOLICITUD_ID || sol.id || '—';
    const tipo = String(sol.TIPO || sol.tipo || 'CARGA').toUpperCase();
    const montoDeclarado = Number(sol.MONTO_REAL || sol.MONTO_DECLARADO || sol.monto || 0);
    const titularDeclarado = String(sol.TITULAR || sol.NOMBRE_COMPLETO || '—').trim();
    const cbu = String(sol.CBU || sol.CVU || sol.CBU_ALIAS || sol.ALIAS_CBU || '').trim();
    const billeteraDeclarada = String(sol.BILLETERA_NOMBRE || sol.billetera || sol.DESTINO || '').trim();

    // Obtener comprobante: de la solicitud o del último mensaje reciente con foto del chat
    let comprobanteUrl = sol.COMPROBANTE_URL || sol.comprobante_url || sol.IMAGEN_URL || sol.imagen_url || null;
    if(!comprobanteUrl && window.__nodoChatCurrentTicket && Array.isArray(window.__nodoChatCurrentTicket.thread)){
      const hace2hs = Date.now() - (2 * 3600 * 1000);
      const userImgs = window.__nodoChatCurrentTicket.thread.filter(m => {
        const rol = String(m.origen || m.remitente || m.role || '').toUpperCase();
        const mFechaMs = m.fecha ? new Date(m.fecha).getTime() : 0;
        return rol !== 'OPERADOR' && rol !== 'SISTEMA' && Boolean(m.imagen_url) && (!isNaN(mFechaMs) ? mFechaMs >= hace2hs : true);
      });
      if(userImgs.length){
        comprobanteUrl = userImgs[userImgs.length - 1].imagen_url;
      }
    }

    // Análisis de comprobante (en memoria o dispara consulta)
    let ocr = sol._simOcr || null;
    if(!ocr && comprobanteUrl){
      ocr = ocrCache.get(comprobanteUrl) || null;
      if(!ocr){
        analizarComprobanteConGemini(comprobanteUrl).finally(() => {
          renderBannerSolicitud(contenedorId, usuarioActual);
        });
      }
    }

    // Autocompletar datos usando OCR si la solicitud venía con $0 o sin titular
    const monto = (montoDeclarado > 0) ? montoDeclarado : (ocr && ocr.monto > 0 ? ocr.monto : 0);
    const titular = (titularDeclarado !== '—' && titularDeclarado !== '') ? titularDeclarado : ((ocr && ocr.titular) ? ocr.titular : '—');
    const billetera = (billeteraDeclarada !== '—' && billeteraDeclarada !== '') ? billeteraDeclarada : ((ocr && ocr.banco) ? ocr.banco : '—');

    // Chequeo de duplicados en el día
    const prev = sol._yaProcesadoPrevio || (monto > 0 ? verificarSiMontoYaProcesado(usuarioActual, monto, tipo) : null);

    // Determinar Semáforo (Verde, Ámbar, Rojo, Azul)
    let semaforo = 'ambar';
    let resumenEstado = '⚠️ Pendiente de verificación';

    const fechaSolStr = sol.FECHA_CREACION || sol.created_at || sol.fecha || null;
    const horasDesdeCreacion = fechaSolStr ? (Date.now() - new Date(fechaSolStr).getTime()) / 3600000 : null;

    if(prev){
      semaforo = 'rojo';
      resumenEstado = `⛔ ALERTA: Monto de ${fmtMoney(monto)} ya procesado a las ${prev.hora} (Op #${prev.opId})`;
    } else if(ocr && ocr.esProgramada){
      semaforo = 'rojo';
      resumenEstado = '⛔ ALERTA: Transferencia PROGRAMADA (no debitada)';
    } else if(montoDeclarado > 0 && ocr && ocr.monto && Math.abs(ocr.monto - montoDeclarado) > 10){
      semaforo = 'rojo';
      resumenEstado = `⛔ ALERTA: Comprobante indica ${fmtMoney(ocr.monto)} (declaró ${fmtMoney(montoDeclarado)})`;
    } else if(ocr && ocr.esComprobante === false){
      semaforo = 'ambar';
      resumenEstado = '⚠️ La imagen adjunta no parece un comprobante bancario';
    } else if(ocr && ocr.minutosAtras != null && ocr.minutosAtras > 60){
      semaforo = 'ambar';
      resumenEstado = `⚠️ REVISAR: Comprobante emitido hace ${ocr.minutosAtras > 120 ? Math.round(ocr.minutosAtras/60) + ' horas' : ocr.minutosAtras + ' minutos'}`;
    } else if(horasDesdeCreacion != null && horasDesdeCreacion > 24){
      semaforo = 'ambar';
      resumenEstado = `⚠️ Solicitud demorada (${Math.round(horasDesdeCreacion)} horas atrás)`;
    } else if(!comprobanteUrl){
      semaforo = 'ambar';
      resumenEstado = tipo === 'CARGA'
        ? '⚠️ Sin comprobante adjunto · Verificar cuenta bancaria'
        : 'ℹ️ Retiro pendiente · Verificar fondos antes de transferir';
    } else if(comprobanteUrl && !ocr){
      semaforo = 'azul';
      resumenEstado = '🤖 Analizando comprobante con IA…';
    } else if(ocr && ocr.esComprobante){
      semaforo = 'verde';
      resumenEstado = `🟢 Comprobante verificado (${ocr.hora || 'Reciente'}) · Todo en orden`;
    }

    // Estilos visuales según semáforo
    const colorBorder = semaforo === 'rojo'
      ? '#ef4444'
      : (semaforo === 'ambar'
          ? '#eab308'
          : (semaforo === 'azul' ? '#38bdf8' : '#22c55e'));

    const colorBg = semaforo === 'rojo'
      ? 'rgba(239,68,68,0.12)'
      : (semaforo === 'ambar'
          ? 'rgba(234,179,8,0.12)'
          : (semaforo === 'azul' ? 'rgba(56,189,248,0.10)' : 'rgba(34,197,94,0.10)'));

    const badgeBg = tipo === 'RETIRO' ? 'rgba(251,146,60,0.2)' : 'rgba(34,197,94,0.2)';
    const badgeColor = tipo === 'RETIRO' ? '#fb923c' : '#22c55e';

    let html = `
      <div class="nodo-sol-pill" style="border:1px solid ${colorBorder};background:${colorBg}">
        <div class="nodo-sol-pill-head" onclick="window.nodoToggleSolBanner('${contenedorId}','${esc(usuarioActual)}')">
          <div class="nodo-sol-pill-left">
            <span class="nodo-sol-badge" style="background:${badgeBg};color:${badgeColor}">
              ${tipo === 'RETIRO' ? '⬇️ RETIRO' : '⬆️ CARGA'} #${solId}
            </span>
            <span class="nodo-sol-monto">${fmtMoney(monto)}</span>
            <span class="nodo-sol-resumen">${esc(resumenEstado)}</span>
          </div>
          <div class="nodo-sol-pill-right" onclick="event.stopPropagation()">
            ${sol._isDemo ? `
              <div class="nodo-dev-sol-tester">
                <button class="mini-btn green" type="button" onclick="window.nodoDemoPreview('verde')" title="Verde: OK">🟢</button>
                <button class="mini-btn yellow" type="button" onclick="window.nodoDemoPreview('ambar')" title="Ámbar: Horario">🟡</button>
                <button class="mini-btn red" type="button" onclick="window.nodoDemoPreview('rojo')" title="Rojo: Duplicado">🔴</button>
                <button class="mini-btn gray" type="button" onclick="window.nodoDemoPreview('off')" title="Cerrar demo">✕</button>
              </div>
            ` : ''}
            <button class="mini-btn gray" type="button" onclick="window.nodoToggleSolBanner('${contenedorId}','${esc(usuarioActual)}')">
              ${desplegado ? '▲ Plegar' : '▼ Detalle'}
            </button>
          </div>
        </div>

        ${desplegado ? `
          <div class="nodo-sol-panel-body">
            <div class="nodo-sol-grid">
              <div class="nodo-sol-col">
                <div class="nodo-sol-item"><span class="lbl">Titular:</span> <b>${esc(titular)}</b></div>
                ${cbu ? `<div class="nodo-sol-item"><span class="lbl">CBU/Alias:</span> <span class="cbu">${esc(cbu)}</span></div>` : ''}
                ${billetera ? `<div class="nodo-sol-item"><span class="lbl">Billetera:</span> <span>${esc(billetera)}</span></div>` : ''}
                ${prev ? `<div class="nodo-sol-alerta-roja">⛔ CUIDADO: Este usuario ya recibió una carga de ${fmtMoney(prev.monto)} hoy a las ${prev.hora} (Op #${prev.opId}).</div>` : ''}
              </div>

              ${comprobanteUrl ? `
                <div class="nodo-sol-col-img">
                  <a href="${esc(comprobanteUrl)}" target="_blank" title="Clic para abrir en tamaño completo">
                    <img src="${esc(comprobanteUrl)}" class="nodo-sol-thumb" alt="Comprobante">
                  </a>
                  <div class="nodo-sol-ocr-box">
                    ${ocr ? `
                      ${ocr.esComprobante === false ? '<div class="ocr-line red">⚠️ <b>NO ES UN COMPROBANTE BANCARIO</b></div>' : ''}
                      <div class="ocr-line">🕒 <b>Hora ticket:</b> ${esc(ocr.hora || 'No visible')} ${ocr.minutosAtras != null ? `(${ocr.minutosAtras}m atrás)` : ''}</div>
                      <div class="ocr-line">🏦 <b>Banco:</b> ${esc(ocr.banco || 'Billetera')}</div>
                      ${ocr.idOp ? `<div class="ocr-line">🔢 <b>Op:</b> ${esc(ocr.idOp)}</div>` : ''}
                      ${ocr.monto ? `<div class="ocr-line">💵 <b>Monto en foto:</b> ${fmtMoney(ocr.monto)}</div>` : ''}
                      ${ocr.esProgramada ? `<div class="ocr-line red">⛔ <b>TRANSFERENCIA PROGRAMADA</b></div>` : ''}
                      ${ocr.sospecha ? `<div class="ocr-line red">⚠️ ${esc(ocr.sospecha)}</div>` : ''}
                    ` : '<div style="color:#38bdf8;font-size:11px">🤖 Analizando comprobante con IA…</div>'}
                  </div>
                </div>
              ` : ''}
            </div>

            <div class="nodo-sol-actions">
              <button class="mini-btn green" type="button" onclick="window.nodoAprobarSolDesdeChat('${solId}', ${monto}, '${esc(titular)}')" ${prev ? 'style="border-color:#ef4444"' : ''}>
                ${prev ? '⚠ Forzar Aprobación' : `⚡ Aprobar (${fmtMoney(monto)})`}
              </button>
              <button class="mini-btn red" type="button" onclick="window.nodoRechazarSolDesdeChat('${solId}')">
                ❌ Rechazar
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    container.innerHTML = html;
  }

  // ── 7. Interacciones y Acciones directas ─────────────────────────────────────
  window.nodoToggleSolBanner = function(contenedorId, usuarioActual){
    desplegado = !desplegado;
    renderBannerSolicitud(contenedorId, usuarioActual);
  };

  window.nodoAprobarSolDesdeChat = function(solId, montoDetectado, titularDetectado){
    if(demoModo){
      if(typeof toast === 'function') toast(`[DEMO PREVIEW] Aprobando solicitud #${solId}`, 'green');
      else alert(`[DEMO PREVIEW] Aprobando solicitud de prueba #${solId}`);
      return;
    }
    // Si la solicitud no traía monto, pre-poblar los datos del OCR en la solicitud en memoria
    if(solId && (montoDetectado > 0 || titularDetectado)){
      try{
        const lista = (window.V154P && Array.isArray(window.V154P.solicitudes)) ? window.V154P.solicitudes : (window.solicitudes || []);
        const s = lista.find(x => String(x.ID || x.SOLICITUD_ID || x.id) === String(solId));
        if(s){
          if((!s.MONTO_REAL && !s.MONTO_DECLARADO) && montoDetectado > 0) s.MONTO_REAL = montoDetectado;
          if(!s.TITULAR && titularDetectado && titularDetectado !== '—') s.TITULAR = titularDetectado;
        }
      }catch(_e){}
    }
    if(typeof abrirModalPortalSolicitud === 'function'){
      abrirModalPortalSolicitud(solId);
    } else {
      if(typeof toast === 'function') toast('Abriendo solicitud #' + solId + ' para aprobación...', 'blue');
      else alert('Abrir solicitud #' + solId + ' para aprobación.');
    }
  };

  window.nodoRechazarSolDesdeChat = function(solId){
    if(demoModo){
      if(typeof toast === 'function') toast(`[DEMO PREVIEW] Rechazando solicitud #${solId}`, 'yellow');
      else alert(`[DEMO PREVIEW] Rechazando solicitud de prueba #${solId}`);
      return;
    }
    if(typeof v154pRechazarSolicitud === 'function'){
      v154pRechazarSolicitud(solId);
    } else {
      if(typeof toast === 'function') toast('Abriendo rechazo de solicitud #' + solId + '...', 'yellow');
      else alert('Abrir rechazo de solicitud #' + solId);
    }
  };

  // ── 8. Hook al abrir o cambiar de chat ───────────────────────────────────────
  window.actualizarPreviewSolicitudChat = function(usuario){
    renderBannerSolicitud('chatSolicitudBanner', usuario);
    renderBannerSolicitud('v15ChatSolicitudBanner', usuario);
  };

  // Interceptar abrirChat clásico
  const oldAbrir = window.abrirChat;
  window.abrirChat = async function(id){
    if(typeof oldAbrir === 'function') await oldAbrir(id);
    const chat = (window.chats || []).find(c => String(c.ID_CHAT || c.id || '') === String(id)) || {};
    window.actualizarPreviewSolicitudChat(chat.USUARIO || chat.usuario || '');
  };

  // ── 9. Switch interactivo para Dev / Demo ────────────────────────────────────
  window.nodoDemoPreview = function(modo){
    demoModo = (modo === 'off' || modo === false) ? null : modo;
    const curUser = (window.__nodoChatCurrentUser || (window.chatActualId && (window.chats || []).find(c => String(c.ID_CHAT || c.id) === String(window.chatActualId))?.USUARIO)) || 'demo_jugador';
    window.actualizarPreviewSolicitudChat(curUser);
    console.log('[NODO Preview] Modo demo:', demoModo || 'APAGADO');
    try{
      if(typeof toast === 'function'){
        toast(demoModo ? `🧪 Preview Demo activo: ${demoModo.toUpperCase()}` : '🧪 Preview Demo desactivado', 'blue');
      }
    }catch(_e){}
  };

  // Atajo de teclado: Ctrl + Shift + S para ciclar Verde -> Ámbar -> Rojo -> Off
  document.addEventListener('keydown', function(e){
    if(e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')){
      e.preventDefault();
      const modos = [null, 'verde', 'ambar', 'rojo'];
      const nextIdx = (modos.indexOf(demoModo) + 1) % modos.length;
      window.nodoDemoPreview(modos[nextIdx]);
    }
  });

})(typeof globalThis !== 'undefined' ? globalThis : window);
