// La columna del chat se estira arrastrando el borde.
//
// Juan, 25/10: "deberias tambien de integrar algo para darle mas mobilidad a la aplicacion, poder
// estirar el chat hasta donde el operador quiera para la comodidad, que se auto ajusten las cosas
// en el interior para que no se rompa nada, que tenga un tamaño minimo y un tamaño maximo para que
// no haya errores."
//
// El ancho estaba escrito a mano —405px— en cuatro lugares de base.css. Ahora es la variable
// --chat-w: esto la pisa en <html> y la grilla se reacomoda sola, porque la columna del medio ya
// era `minmax(0,1fr)`. Por eso no hay que tocar nada de adentro para que no se rompa.
//
// El tope de arriba no es un capricho: sin él, arrastrando hasta el borde la columna de la
// izquierda —la bandeja, las billeteras, todo— quedaba en cero y el panel se volvía inusable sin
// forma de volver atrás. El mínimo es para que el chat siga siendo un chat y no una ranura.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else {
    const api = factory();
    (root.NodoDomain||(root.NodoDomain={})).anchoChat = api;
    // Una manija para estirar el chat no vale romper el arranque del panel.
    if(root.document) { try{ api._instalar(root); }catch(_e){} }
  }
})(globalThis, function(){
  'use strict';

  const POR_DEFECTO = 405;
  const LLAVE       = 'nodo.chat.ancho';
  // Lo que la columna de la izquierda necesita para seguir sirviendo: la barra de íconos (66) más
  // el ancho mínimo donde una fila de la bandeja todavía se lee (360).
  const RESERVA_IZQ = 426;

  // ── LO ÚNICO QUE DECIDE ALGO ──────────────────────────────────────────────────────────────
  // Puro: entra un número, sale un número. Se puede probar con node, sin pantalla.
  function limpiar(ancho, anchoVentana, min, max){
    // null y "" hay que rechazarlos a mano: Number(null) y Number("") dan CERO, no NaN, así que
    // un valor vacío guardado se colaba como un ancho de 0 y salía pegado al mínimo en vez de
    // avisar que no había nada. El que llama tiene que poder distinguir "no hay valor" de "hay
    // un valor fuera de rango" para caer en el ancho por defecto.
    if(ancho === null || ancho === undefined) return null;
    if(typeof ancho === 'string' && ancho.trim() === '') return null;
    const n = Number(ancho);
    if(!Number.isFinite(n)) return null;
    const piso  = Number(min) > 0 ? Number(min) : 300;
    const techo = Math.min(
      Number(max) > 0 ? Number(max) : 900,
      Number(anchoVentana) - RESERVA_IZQ
    );
    // Ventana más chica que piso+reserva: manda el piso. El chat sigue usable y la izquierda se
    // aprieta — al revés dejaría un chat de 80px, que no sirve para nada.
    if(!Number.isFinite(techo) || techo < piso) return piso;
    return Math.round(Math.min(Math.max(n, piso), techo));
  }

  function _instalar(win){
    const doc = win.document;
    let manija = null, arrastrando = false, bordeDerecho = 0;

    // Nada de esto puede tirar al cargar: el bundle del panel se arranca también en entornos
    // pelados (la prueba de arranque lo corre en una ventana de mentira, sin getComputedStyle),
    // y un error acá dejaría sin definir TODO lo que viene después en el mismo <script>.
    const leerVar = (nombre, siNo) => {
      try{
        if(typeof win.getComputedStyle !== 'function') return siNo;
        const v = parseInt(win.getComputedStyle(doc.documentElement).getPropertyValue(nombre), 10);
        return Number.isFinite(v) && v > 0 ? v : siNo;
      }catch(_e){ return siNo; }
    };

    function aplicar(ancho, guardar){
      const ventana = Number(win.innerWidth) > 0 ? Number(win.innerWidth) : 1920;
      const n = limpiar(ancho, ventana, leerVar('--chat-w-min', 300), leerVar('--chat-w-max', 900));
      if(n === null) return;
      try{ doc.documentElement.style.setProperty('--chat-w', n + 'px'); }catch(_e){}
      if(guardar){ try{ win.localStorage.setItem(LLAVE, String(n)); }catch(_e){} }
      return n;
    }

    function estilos(){
      if(doc.getElementById('chatManijaCss')) return;
      const st = doc.createElement('style');
      st.id = 'chatManijaCss';
      st.textContent = `
        /* La regla del "V16 clean pass" deja #viewChat en static!important; la manija va adentro
           en posición absoluta, así que hace falta devolverle el relative. */
        #viewChat{position:relative!important}
        #chatManija{
          position:absolute;left:0;top:0;bottom:0;width:9px;
          cursor:col-resize;z-index:40;background:transparent;touch-action:none;
        }
        #chatManija::after{
          content:'';position:absolute;left:3px;top:50%;transform:translateY(-50%);
          width:3px;height:36px;border-radius:3px;background:rgba(255,255,255,.14);
          transition:background .15s ease,height .15s ease;
        }
        #chatManija:hover::after,#chatManija.arrastrando::after{background:var(--blue);height:76px}
        /* Expandido el chat ocupa casi toda la ventana: ahí no hay nada que estirar. */
        body.chat-expanded #chatManija{display:none}
        /* Mientras se arrastra: que no se seleccione medio panel ni parpadee el cursor. */
        body.chat-arrastrando,body.chat-arrastrando *{user-select:none!important;cursor:col-resize!important}
        @media(max-width:1100px){ #chatManija{display:none} }
      `;
      doc.head.appendChild(st);
    }

    function fin(e){
      if(!arrastrando) return;
      arrastrando = false;
      doc.body.classList.remove('chat-arrastrando');
      manija.classList.remove('arrastrando');
      try{ manija.releasePointerCapture(e.pointerId); }catch(_e){}
      try{ win.localStorage.setItem(LLAVE, String(leerVar('--chat-w', POR_DEFECTO))); }catch(_e){}
    }

    function montar(){
      const chat = doc.getElementById('viewChat');
      if(!chat || doc.getElementById('chatManija')) return !!doc.getElementById('chatManija');
      estilos();
      manija = doc.createElement('div');
      manija.id = 'chatManija';
      manija.title = 'Arrastrá para ensanchar el chat · doble clic vuelve al ancho normal';
      manija.setAttribute('role', 'separator');
      manija.setAttribute('aria-label', 'Ancho del chat');

      manija.addEventListener('pointerdown', function(e){
        if(e.button !== 0) return;
        e.preventDefault();
        // El borde derecho se mide UNA vez: durante el arrastre el elemento cambia de ancho, y
        // medirlo en cada movimiento hacía que el chat se "escapara" del puntero.
        bordeDerecho = chat.getBoundingClientRect().right;
        arrastrando = true;
        doc.body.classList.add('chat-arrastrando');
        manija.classList.add('arrastrando');
        // Captura: sin esto, al pasar por encima de un webview los movimientos se los come él y
        // el arrastre se corta a la mitad.
        try{ manija.setPointerCapture(e.pointerId); }catch(_e){}
      });
      manija.addEventListener('pointermove', function(e){
        if(!arrastrando) return;
        aplicar(bordeDerecho - e.clientX, false);
      });
      manija.addEventListener('pointerup', fin);
      manija.addEventListener('pointercancel', fin);
      manija.addEventListener('dblclick', function(){
        aplicar(POR_DEFECTO, true);
      });

      chat.appendChild(manija);
      return true;
    }

    // Lo guardado se vuelve a limpiar contra la ventana de AHORA: la PC pudo quedar en otra
    // resolución, o el panel abrirse en una pantalla más chica que la de ayer.
    let guardado = POR_DEFECTO;
    try{
      const v = parseInt(win.localStorage.getItem(LLAVE), 10);
      if(Number.isFinite(v) && v > 0) guardado = v;
    }catch(_e){}
    aplicar(guardado, false);

    // Si la ventana se achica, el chat se achica con ella. Sin esto, con un ancho guardado grande
    // y la ventana chica, la columna de la izquierda quedaba en cero.
    let pendiente = null;
    if(typeof win.addEventListener === 'function'){
      win.addEventListener('resize', function(){
        if(pendiente) win.clearTimeout(pendiente);
        pendiente = win.setTimeout(function(){
          aplicar(leerVar('--chat-w', POR_DEFECTO), false);
        }, 120);
      });
    }

    if(typeof doc.createElement !== 'function' || typeof win.setInterval !== 'function') return;
    if(!montar()){
      // El panel arma las vistas en varios pasos; reintentamos un rato corto y largamos.
      let intentos = 0;
      const t = win.setInterval(function(){
        if(montar() || ++intentos > 40) win.clearInterval(t);
      }, 250);
    }
  }

  return { limpiar, POR_DEFECTO, RESERVA_IZQ, _instalar };
});
