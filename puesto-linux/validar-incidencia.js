// Valida incidencias en fichero sin abrir el navegador.
//
//   node puesto-linux/validar-incidencia.js mi-incidencia.json [otra.json ...]
//   node puesto-linux/validar-incidencia.js --catalogo     (tipos de avería y sus parámetros)
//   node puesto-linux/validar-incidencia.js --lang=en ...  (o PUESTO_IDIOMA=en: mensajes en inglés)
//
// Hace exactamente lo mismo que el botón «Importar» del Puesto: comprueba el
// formato, pasa el validador del catálogo y ensaya la solución de referencia.
// Sale con código 1 si alguna no se acepta, para poder usarlo en un gancho.
const fs = require('fs'), path = require('path');
let args = process.argv.slice(2);
const opLang = args.find(a => /^--lang=/.test(a));
args = args.filter(a => a !== opLang);
const idioma = (opLang ? opLang.slice(7) : process.env.PUESTO_IDIOMA) === 'en' ? 'en' : 'es';
const D = __dirname, win = { PUESTO: { idioma } };
['motor.js', 'cmd-ceph.js', 'cmd-openstack.js', 'cmd-auto.js', 'averias.js', 'escenarios.js', 'incidencias.js'].forEach(f => new Function('window', fs.readFileSync(path.join(D, f), 'utf8'))(win));
const P = win.PUESTO, T = P.T;

if (args[0] === '--catalogo') {
  P.catalogoLegible().forEach(c => {
    console.log('\n' + c.tipo + (c.condicion ? T('  (condición: prepara, no rompe)', '  (condition: sets the scene, breaks nothing)') : '') + ' — ' + c.titulo);
    if (c.descripcion) console.log('  ' + c.descripcion);
    Object.keys(c.params).forEach(k => console.log('    ' + k.padEnd(18) + c.params[k]));
    console.log(T('  ejemplo: ', '  example: ') + JSON.stringify(c.ejemplo));
  });
  process.exit(0);
}
if (!args.length) { console.error(T('uso: node validar-incidencia.js fichero.json [...]   |   --catalogo', 'usage: node validar-incidencia.js file.json [...]   |   --catalogo   [--lang=en]')); process.exit(2); }

let malas = 0;
args.forEach(f => {
  let texto;
  try { texto = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('✕ ' + f + T(': no se puede leer', ': cannot be read')); malas++; return; }
  const r = P.cargarIncidencia(texto);
  if (r.ok) {
    const e = r.escenario, n = r.ensayo;
    console.log('✓ ' + f + '  ' + e.id + ' · ' + P.prioridad(e).p + ' · ' + T('«' + e.asunto + '»', '"' + e.asunto + '"'));
    console.log('    ' + T(n.averias + ' averías y ' + n.condiciones + ' condiciones · ' + n.alertas + ' alertas · su solución de referencia la resuelve en ' + n.comandos + ' comandos (' + n.minutos + ' min simulados)',
      n.averias + ' faults and ' + n.condiciones + ' conditions · ' + n.alertas + ' alerts · its reference solution resolves it in ' + n.comandos + ' commands (' + n.minutos + ' simulated min)'));
  } else { console.error('✕ ' + f); r.errores.forEach(x => console.error('    · ' + x)); malas++; }
  (r.avisos || []).forEach(x => console.log('    ! ' + x));
});
process.exit(malas ? 1 : 0);
