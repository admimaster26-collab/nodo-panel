'use strict';
// Las pruebas de regresión no deben operar contra oficinas reales por un mock ausente.
// Los ensayos remotos explícitos son scripts separados y usan una fixture identificada.
const isLocal=input=>{
  try{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);return ['localhost','127.0.0.1','[::1]'].includes(url.hostname);}
  catch{return false;}
};
const realFetch=globalThis.fetch;
globalThis.fetch=(input,...args)=>isLocal(input)?realFetch(input,...args):Promise.reject(Object.assign(new Error('TEST_EXTERNAL_NETWORK_BLOCKED'),{code:'TEST_EXTERNAL_NETWORK_BLOCKED'}));
