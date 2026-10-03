const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// El control del titular no puede dejar a nadie sin poder cargar.
//
// Juan, 3/10, con la foto de la pantalla: una jugadora escribió "Yamila Muhamad" -- el nombre de
// su propia cuenta bancaria -- y el portal se lo rechazó diciéndole "ese es tu usuario de juego".
// No tenía salida: ESE es el titular de su cuenta, no hay otra cosa que pueda escribir.
//
// Dos reglas lo causaban, las dos buscando "¿aparece adentro de?" en vez de "¿es?":
//   1. Si el usuario aparecía en cualquier parte del titular. Muchísima gente usa su propio
//      nombre como usuario, así que el titular de su cuenta lo contiene casi siempre.
//   2. Si algún dato nuestro aparecía en el titular, con TRES letras y para los dos lados.
//      Nuestras billeteras se llaman GIORDANO, PERNA PP, MATRELO: cualquiera que se apellide
//      parecido quedaba trabado.
//
// Lo que sí hay que seguir frenando: que escriba su usuario de juego, o que copie nuestro alias
// o CBU en el campo del titular.

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

// La billetera de P4 tal cual está en producción.
const BILLETERA_P4 = {
  titular: 'Pablo Leones Giordano',
  alias: 'pablo.910.bujes.mp',
  cbu: '0000003100083186380803',
  nombre_visible: 'GIORDANO',
  nombre: 'GIORDANO'
};

function armar(usuario, billetera){
  const ctx = {
    TITULAR_MIN_LETRAS: 5,
    state: { usuario: usuario, billetera: billetera || BILLETERA_P4 },
    String, Array, Object
  };
  vm.createContext(ctx);
  // La prueba tiene que poder correr TAMBIEN la version anterior, si no no demuestra nada: un
  // error por "esa funcion no existe" no es lo mismo que un rechazo equivocado. Por eso los
  // ayudantes se cargan si estan, con el nombre que tengan.
  vm.runInContext(sacar('function _normComparar('), ctx);
  for(const f of ['function _identificadoresPropios(', 'function _nombresPropios(',
                  'function _datosPropiosNormalizados(']){
    if(PORTAL.indexOf(f) !== -1) vm.runInContext(sacar(f), ctx);
  }
  vm.runInContext(sacar('function validarTitular('), ctx);
  vm.runInContext(sacar('function _titularEsNuestro('), ctx);
  // Devuelve el motivo del rechazo, o '' si deja pasar.
  return (titular) => {
    const porTexto = ctx.validarTitular(titular);
    if(porTexto) return porTexto;
    return ctx._titularEsNuestro(titular) ? 'NUESTRA cuenta' : '';
  };
}

test('el caso de la foto: su propio nombre, con su nombre de usuario adentro', () => {
  // "Yamila Muhamad" con usuario "yamila2024". El usuario esta adentro del titular -- como en
  // casi todos los que usan su nombre de usuario -- y la trababa sin salida.
  const revisar = armar('yamila2024');
  assert.equal(revisar('Yamila Muhamad'), '', 'tiene que poder cargar');
});

test('compartir un apellido con una billetera nuestra no es un error', () => {
  // Nuestra billetera de P4 se llama GIORDANO. Un jugador apellidado Giordano quedaba trabado.
  const revisar = armar('marcos77');
  assert.equal(revisar('Martin Giordano'), '', 'su apellido no es culpa suya');
  assert.equal(revisar('Giordano Martinez'), '', 'ni aunque vaya primero');
});

test('varios nombres reales que contienen el usuario', () => {
  const casos = [
    ['rocio88',      'Rocio Benitez'],
    ['lucas_tradi',  'Lucas Fernandez'],
    ['ana2070',      'Ana Maria Lopez'],
    ['pablo910',     'Pablo Sosa']      // "pablo" tambien esta en NUESTRO alias
  ];
  for(const [usuario, titular] of casos){
    assert.equal(armar(usuario)(titular), '', usuario + ' -> ' + titular + ' tiene que pasar');
  }
});

test('lo que SI hay que seguir frenando', () => {
  // Escribio su usuario de juego en vez del titular: una sola palabra, y es el usuario.
  assert.notEqual(armar('yamila2024')('yamila2024'), '', 'su usuario de juego, no');
  // Copio NUESTRO alias en el campo del titular.
  assert.notEqual(armar('marcos77')('pablo.910.bujes.mp'), '', 'nuestro alias, no');
  // Copio NUESTRO cbu.
  assert.notEqual(armar('marcos77')('0000003100083186380803'), '', 'nuestro cbu, no');
  // Copio el titular de NUESTRA cuenta, completo.
  assert.notEqual(armar('marcos77')('Pablo Leones Giordano'), '', 'nuestro titular exacto, no');
});

test('sigue pidiendo un nombre de verdad', () => {
  assert.notEqual(armar('marcos77')('xy'), '', 'dos letras no son un nombre');
  assert.notEqual(armar('marcos77')('123'), '', 'ni un numero');
});
