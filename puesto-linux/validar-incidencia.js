// Valida incidencias en fichero sin abrir el navegador.
//
//   node puesto-linux/validar-incidencia.js mi-incidencia.json [otra.json ...]
//   node puesto-linux/validar-incidencia.js --catalogo     (tipos de avería y sus parámetros)
//
// Hace exactamente lo mismo que el botón «Importar» del Puesto: comprueba el
// formato, pasa el validador del catálogo y ensaya la solución de referencia.
// Sale con código 1 si alguna no se acepta, para poder usarlo en un gancho.
const fs = require('fs'), path = require('path');
const D = __dirname, win = {};
['motor.js', 'cmd-ceph.js', 'cmd-openstack.js', 'cmd-auto.js', 'averias.js', 'escenarios.js', 'incidencias.js'].forEach(f => new Function('window', fs.readFileSync(path.join(D, f), 'utf8'))(win));
const P = win.PUESTO;

const args = process.argv.slice(2);
if (args[0] === '--catalogo') {
  P.catalogoLegible().forEach(c => {
    console.log('\n' + c.tipo + (c.condicion ? '  (condición: prepara, no rompe)' : '') + ' — ' + c.titulo);
    if (c.descripcion) console.log('  ' + c.descripcion);
    Object.keys(c.params).forEach(k => console.log('    ' + k.padEnd(18) + c.params[k]));
    console.log('  ejemplo: ' + JSON.stringify(c.ejemplo));
  });
  process.exit(0);
}
if (!args.length) { console.error('uso: node validar-incidencia.js fichero.json [...]   |   --catalogo'); process.exit(2); }

let malas = 0;
args.forEach(f => {
  let texto;
  try { texto = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('✕ ' + f + ': no se puede leer'); malas++; return; }
  const r = P.cargarIncidencia(texto);
  if (r.ok) {
    const e = r.escenario, n = r.ensayo;
    console.log('✓ ' + f + '  ' + e.id + ' · ' + P.prioridad(e).p + ' · «' + e.asunto + '»');
    console.log('    ' + n.averias + ' averías y ' + n.condiciones + ' condiciones · ' + n.alertas + ' alertas · su solución de referencia la resuelve en ' + n.comandos + ' comandos (' + n.minutos + ' min simulados)');
  } else { console.error('✕ ' + f); r.errores.forEach(x => console.error('    · ' + x)); malas++; }
  (r.avisos || []).forEach(x => console.log('    ! ' + x));
});
process.exit(malas ? 1 : 0);
