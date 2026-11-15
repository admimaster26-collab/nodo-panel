'use strict';

function createSessionHeaders({ session, backends }) {
  const isDomain = (url, domain) => {
    try { const host = new URL(url).hostname; return host === domain || host.endsWith('.' + domain); }
    catch (_) { return false; }
  };
  function configurarSesionAgentesDrex(win, { chunior = false } = {}) {
    try {
      const cur       = win.webContents.getUserAgent();
      const chromeTok = (cur.match(/Chrome\/[\d.]+/) || ['Chrome/124.0.0.0'])[0];
      const major     = (chromeTok.match(/\d+/) || ['124'])[0];
      const ua        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' + chromeTok + ' Safari/537.36';
      const secChUa   = '"Chromium";v="' + major + '", "Google Chrome";v="' + major + '", "Not.A/Brand";v="99"';
      win.webContents.setUserAgent(ua); // por-webContents (Agentes y Chunior)
      const ses = win.webContents.session;
      if (chunior && !ses.__nodoChuniorHook) {
        ses.__nodoChuniorHook = true;
        ses.webRequest.onBeforeSendHeaders((details, cb) => {
          try {
            const h = details.requestHeaders || {};
            if (isDomain(details.url, 'chunior.com')) { // SOLO Chunior; Supabase sin tocar
              h['User-Agent']         = ua;
              h['sec-ch-ua']          = secChUa;
              h['sec-ch-ua-mobile']   = '?0';
              h['sec-ch-ua-platform'] = '"Windows"';
              if (!h['Accept-Language']) h['Accept-Language'] = 'es-AR,es;q=0.9,en;q=0.8';
            }
            cb({ requestHeaders: h });
          } catch (_e) { cb({ requestHeaders: (details && details.requestHeaders) || {} }); }
        });
      }

      // BET300: Cloudflare de agentesbet.net bloquea por el client-hint sec-ch-ua "Electron".
      // Reescribimos UA + sec-ch-ua SOLO para agentesbet.net y SOLO con el flag bet300 activo
      // (casinodrex 100% intacto: con casinodrex este hook ni se instala).
      if (!chunior && ses !== session.defaultSession && backends.current.spa && !ses.__nodoBet300Hook) {
        ses.__nodoBet300Hook = true;
        ses.webRequest.onBeforeSendHeaders((details, cb) => {
          try {
            const h = details.requestHeaders || {};
            if (isDomain(details.url, 'agentesbet.net') || isDomain(details.url, 'agentesbet.io')) {
              h['User-Agent']         = ua;
              h['sec-ch-ua']          = secChUa;
              h['sec-ch-ua-mobile']   = '?0';
              h['sec-ch-ua-platform'] = '"Windows"';
              if (!h['Accept-Language']) h['Accept-Language'] = 'es-AR,es;q=0.9,en;q=0.8';
            }
            cb({ requestHeaders: h });
          } catch (_e) { cb({ requestHeaders: (details && details.requestHeaders) || {} }); }
        });
      }
    } catch (e) {
      console.warn('[main] configurarSesionAgentesDrex:', e && e.message);
    }
  }

  return { configure: configurarSesionAgentesDrex };
}

module.exports = { createSessionHeaders };
