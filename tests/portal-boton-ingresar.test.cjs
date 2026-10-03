const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// El botón "Ingresar" que manda el operador se muestra SIEMPRE.
//
// Juan, 3/10: "deberia de mostrarse igual, no tiene sentido que este el bloqueo".
//
// La página lo escondía cuando se creía que el jugador ya estaba adentro. El problema es
// justamente cuando se lo cree y no lo está: marcado de una sesión anterior, de otra oficina, o
// de un dato viejo. Ahí el jugador ve que no le aparece la billetera Y se queda sin el único
// botón que lo destraba. Que sobre un botón no le rompe nada a nadie; que falte, sí.

const PORTAL = fs.readFileSync(process.env.PORTAL_A_PROBAR || path.join(__dirname, '..', 'Portal'), 'utf8');

function sacar(firma){
  const i = PORTAL.indexOf(firma);
  assert.notEqual(i, -1, 'no está en el Portal: ' + firma);
  const j = PORTAL.indexOf('{', i);
  let n = 0, fin = -1;
  for(let k = j; k < PORTAL.length; k++){
    if(PORTAL[k] === '{') n++;
    else if(PORTAL[k] === '}'){ n--; if(!n){ fin = k + 1; break; } }
  }
  assert.notEqual(fin, -1, 'no cierra: ' + firma);
  return PORTAL.slice(i, fin);
}

// Pantalla de mentira: alcanza con saber si el botón se agregó o no.
function armar(nivelAcceso){
  const agregados = [];
  const nodo = () => ({ className:'', innerHTML:'', closest(){ return null; } });
  const ctx = {
    state: { usuario:'joelgoat', nivelAcceso: nivelAcceso, screen:'chat' },
    document: { createElement(){ return nodo(); } },
    $: (id) => {
      if(id === 'messages') return { appendChild(n){ agregados.push(n); } };
      if(id === 'btnIngresarValidado') return null;      // todavía no hay ninguno puesto
      if(id === 'widget') return { classList:{ contains(){ return true; } } };
      return null;
    },
    esc: (s) => String(s==null?'':s),
    now: () => '12:00',
    scrollChat(){}, bumpUnread(){}, showOperatorBubble(){},
    String, Object
  };
  vm.createContext(ctx);
  vm.runInContext(sacar('function mostrarBotonIngresar('), ctx);
  return { ctx, seDibujo: () => agregados.length > 0 };
}

test('el jugador que NO esta adentro recibe el boton', () => {
  const c = armar('SOPORTE');
  c.ctx.mostrarBotonIngresar('joelgoat', '1158956858');
  assert.ok(c.seDibujo(), 'es el caso de siempre: tiene que aparecer');
});

test('el que la pagina CREE que ya esta adentro, tambien', () => {
  // Este es el que fallaba. Si ese "OK" esta mal —sesion vieja, otra oficina, dato viejo— el
  // jugador no ve la billetera y encima no le aparece el boton que lo arregla.
  const c = armar('OK');
  c.ctx.mostrarBotonIngresar('joelgoat', '1158956858');
  assert.ok(c.seDibujo(), 'el operador lo mando: se muestra');
});

test('sin nivel de acceso guardado, tambien', () => {
  const c = armar('');
  c.ctx.mostrarBotonIngresar('joelgoat', '1158956858');
  assert.ok(c.seDibujo());
});

test('no se duplica si ya hay uno puesto', () => {
  const agregados = [];
  const ctx = {
    state: { usuario:'joelgoat', nivelAcceso:'SOPORTE', screen:'chat', _ingresarUserShown:'joelgoat' },
    document: { createElement: () => ({ className:'', innerHTML:'', closest(){ return null; } }) },
    $: (id) => {
      if(id === 'messages') return { appendChild(n){ agregados.push(n); } };
      if(id === 'btnIngresarValidado') return { closest(){ return null; } };  // ya hay uno
      if(id === 'widget') return { classList:{ contains(){ return true; } } };
      return null;
    },
    esc: (s) => String(s==null?'':s), now: () => '12:00',
    scrollChat(){}, bumpUnread(){}, showOperatorBubble(){}, String, Object
  };
  vm.createContext(ctx);
  vm.runInContext(sacar('function mostrarBotonIngresar('), ctx);
  ctx.mostrarBotonIngresar('joelgoat', '1158956858');
  assert.equal(agregados.length, 0, 'uno solo alcanza');
});
