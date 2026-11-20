// El proxy va sólo a la ventana de Agentes (Noelia, 20/11). La 2.1.6 lo había extendido a Chunior y además
// frenaba la apertura de Chunior hasta 8 s esperando el proxy de la oficina.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const proxySrc = fs.readFileSync(path.join(__dirname, '..', 'main', 'proxy.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('el servicio de proxy no toca la sesión de Chunior', () => {
  assert.doesNotMatch(proxySrc, /nodo-chunior|chuniorSes\(/);
});

test('abrir Chunior no espera al proxy de la oficina', () => {
  assert.doesNotMatch(mainSrc, /await officeCredentials\.applyProxyForOffice\(pcCodigoInicial/);
  assert.match(mainSrc, /officeCredentials\.applyProxyForOffice\(pcCodigoInicial, \{ resetOnMissing: false, timeoutMs: 8000 \}\)\.then\(/);
});
