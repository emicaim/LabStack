// Comprueba el Puesto en inglés, sin navegador.
//
//   node puesto-linux/ingles-test.js            todo
//   node puesto-linux/ingles-test.js tickets    sólo las zonas cuyo nombre contiene «tickets»
//
// Carga el motor con P.idioma = 'en' y recorre todo lo que ve quien juega:
// los datos (tickets, catálogo, familias, glosario, solucionario, ayudas de los
// comandos), lo que se calcula (alertas, pendientes, prácticas, mensajes del
// validador) y la salida de cada solución de referencia. Cualquier texto que
// parezca español es un fallo. También resuelve los 20 tickets en inglés: el
// idioma no puede cambiar lo que arregla un comando.
const fs = require('fs'), path = require('path');
const D = __dirname;
const win = { PUESTO: { idioma: 'en' } };
['motor.js', 'cmd-ceph.js', 'cmd-openstack.js', 'cmd-auto.js', 'averias.js', 'escenarios.js', 'incidencias.js', 'guardia.js', 'soluciones.js'].forEach(f => new Function('window', fs.readFileSync(path.join(D, f), 'utf8'))(win));
const P = win.PUESTO;
const filtro = process.argv[2] || '';

// Lo que delata español. Las palabras van con límites para no cazar trozos de
// inglés o de comandos («la» de «ls -la» no está en la lista a propósito).
const ACENTOS = /[áéíóúñÁÉÍÓÚÑ¿¡«»]/;
const PALABRAS = /(^|[^a-zA-Z\-_./])(el|los|las|que|para|con|sin|una|del|está|hay|pero|cuando|también|ahora|equipo|nodo|nodos|servicio|falta|tiene|debe|puede|sigue|todavía|arreglar|arreglo|avería|averías|disco|reinicia|comprueba|mira|antes|después|porque|sólo|solo|nada|todo|cada)(?=$|[^a-zA-Z\-_./])/i;
// Los nombres propios conservan su tilde en inglés.
const NOMBRES = /García/g;
const pareceEs = s => { s = s.replace(NOMBRES, ''); return ACENTOS.test(s) || PALABRAS.test(s); };

const fallos = {};
let total = 0;
const nota = (zona, donde, s) => {
  if (filtro && zona.indexOf(filtro) < 0) return;
  if (typeof s !== 'string') return;
  // «missing servicio»: tras «missing» van claves de parámetro, que son datos.
  if (!pareceEs(s.replace(/\bmissing [a-zA-Z, ]+$/, 'missing'))) return;
  (fallos[zona] = fallos[zona] || []).push(donde + ': ' + s.replace(/\s+/g, ' ').slice(0, 160));
  total++;
};
// Recorre un dato entero. Las funciones no se miran (se prueban ejecutándolas).
const SALTAR = { guion: 1, cmd: 1, comando: 1, id: 1, tipo: 1, servicio: 1, nodo: 1 };
function recorrer(zona, x, ruta, vistos) {
  vistos = vistos || new Set();
  if (typeof x === 'string') return nota(zona, ruta, x);
  if (!x || typeof x !== 'object' || vistos.has(x)) return;
  vistos.add(x);
  if (Array.isArray(x)) return x.forEach((v, i) => recorrer(zona, v, ruta + '[' + i + ']', vistos));
  Object.keys(x).forEach(k => { if (!SALTAR[k]) recorrer(zona, x[k], ruta + '.' + k, vistos); });
}

// ------------------------------------------------------------ datos
P.escenarios.forEach(e => recorrer('tickets', e, e.id));
recorrer('tickets', P.funciones, 'funciones');
Object.keys(P.averias).forEach(t => { const a = P.averias[t]; ['titulo', 'descripcion'].forEach(k => nota('catalogo', t + '.' + k, a[k])); recorrer('catalogo', a.params, t + '.params'); });
Object.keys(P.camposAveria).forEach(t => recorrer('catalogo', P.camposAveria[t].map(c => c.etiqueta || ''), t + '.campos'));
P.familias.forEach(f => recorrer('guardia', { titulo: f.titulo, leccion: f.leccion }, 'familia ' + f.id));
recorrer('guardia', P.nivelesGuardia, 'niveles');
// En cada paso [comando, fase, texto] sólo se lee el texto: el comando es el del
// guion y la fase es un valor ('arreglo'…) que la página traduce al pintarla.
Object.keys(P.soluciones).forEach(id => { const s = P.soluciones[id]; recorrer('solucionario', Object.assign({}, s, { pasos: (s.pasos || []).map(p => p[2]) }), 'soluciones.' + id); });
recorrer('solucionario', P.glosario, 'glosario');
Object.keys(P.comandos).forEach(c => { const x = P.comandos[c]; ['ayuda', 'fuera', 'grupo'].forEach(k => nota('comandos', c + '.' + k, x[k])); });

// ------------------------------------------------------------ lo que se calcula al jugar
let malResuelto = 0;
[...P.escenarios, P.generarGuardia(1, 11).escenario, P.generarGuardia(2, 22).escenario, P.generarGuardia(3, 33).escenario].forEach(e => {
  const st = P.preparar(e), ses = P.nuevaSesion();
  recorrer('tickets', { asunto: e.asunto, cuerpo: e.cuerpo, pistas: e.pistas, causa: e.causa, solucion: e.solucion, leccion: e.leccion, de: e.de }, e.id + ' (preparado)');
  P.alertasActivas(st).forEach(a => nota('alertas', e.id + ' ' + a.nombre, a.res));
  e.resuelto(st, P).forEach((x, i) => nota('pendientes', e.id + ' antes #' + i, x));
  P.guionDe(e, st).forEach(c => {
    const r = P.ejecutar(st, ses, c);
    if (ses.pendiente) nota('terminal', e.id + ' $ ' + c + ' (pregunta)', ses.pendiente.prompt || '');
    r.lineas.forEach(l => nota('terminal', e.id + ' $ ' + c, l.t));
    P.expulsar(st, ses);
  });
  const ev = P.evaluar(st, e);
  ev.pendientes.forEach(x => nota('pendientes', e.id + ' después', x));
  ev.practicas.forEach(x => nota('tickets', e.id + ' práctica', x.t));
  if (ev.pendientes.length || ev.practicas.some(x => !x.ok)) { malResuelto++; (fallos['resolver'] = fallos['resolver'] || []).push(e.id + ': en inglés su guion no lo resuelve o falla prácticas: ' + ev.pendientes.concat(ev.practicas.filter(x => !x.ok).map(x => x.t)).join(' · ')); total++; }
});

// Lo que se lee en la terminal fuera de los guiones: ayudas, ficheros del bastión, avisos.
{
  const st = P.crear();
  ['bastion', 'ctl01', 'cmp01', 'ceph01', 'mon01'].forEach(h => {
    P.correrEn(st, h, 'help').lineas.forEach(l => nota('terminal', h + ' $ help', l.t));
    Object.keys(P.vfs(st, st.hosts[h]).f).forEach(f => { if (!/\.gz$/.test(f)) P.correrEn(st, h, 'cat ' + f).lineas.forEach(l => nota('ficheros', h + ':' + f, l.t)); });
  });
  // un comando en el nodo equivocado, sin sudo y sin credenciales
  [['bastion', 'ceph -s'], ['bastion', 'virsh list'], ['ctl01', 'systemctl restart nova-api'], ['bastion', 'openstack server list'], ['bastion', 'nosuchcommand']].forEach(([h, c]) => P.correrEn(st, h, c).lineas.forEach(l => nota('terminal', h + ' $ ' + c, l.t)));
  const ses = P.nuevaSesion();
  P.ejecutar(st, ses, '').lineas.forEach(l => nota('terminal', 'bienvenida', l.t));
}

// ------------------------------------------------------------ validador de incidencias
{
  const malos = [
    '{ roto', '[]', { formato: 'x' },
    { formato: P.FORMATO_INCIDENCIA, asunto: 'x', cuerpo: ['y'], impacto: 'z', urgencia: 'alta', averias: [] },
    { formato: P.FORMATO_INCIDENCIA, asunto: 'x', cuerpo: ['y'], impacto: 'alto', urgencia: 'alta', averias: [{ tipo: 'servicio-caido', nodo: 'cmp02' }] },
    { formato: P.FORMATO_INCIDENCIA, asunto: 'x', cuerpo: ['y'], impacto: 'alto', urgencia: 'alta', averias: [{ tipo: 'uso-volumenes', proyecto: 'analitica', gb: 10 }] },
  ];
  malos.forEach((m, i) => { const r = P.cargarIncidencia(typeof m === 'string' ? m : JSON.parse(JSON.stringify(m))); r.errores.concat(r.avisos || []).forEach(x => nota('validador', 'caso ' + i, x)); });
  const bueno = P.cargarIncidencia({ formato: P.FORMATO_INCIDENCIA, asunto: 'Checkout errors', cuerpo: ['Customers cannot pay.'], impacto: 'medio', urgencia: 'alta', averias: [{ tipo: 'servicio-caido', nodo: 'ctl02', servicio: 'mariadb', motivo: 'oom' }] });
  if (bueno.ok) recorrer('validador', { pistas: bueno.escenario.pistas, causa: bueno.escenario.causa, solucion: bueno.escenario.solucion, leccion: bueno.escenario.leccion, practicas: bueno.escenario.practicas.map(p => p.t), avisos: bueno.avisos }, 'generada');
  else (fallos['validador'] = fallos['validador'] || []).push('una incidencia válida no se acepta en inglés: ' + bueno.errores.join(' | '));
}

// ------------------------------------------------------------ informe
const zonas = Object.keys(fallos);
zonas.forEach(z => {
  console.log('\n  ' + z + ' (' + fallos[z].length + '):');
  fallos[z].slice(0, process.env.TODO ? 1e9 : 25).forEach(x => console.log('    ✕ ' + x));
  if (!process.env.TODO && fallos[z].length > 25) console.log('    … y ' + (fallos[z].length - 25) + ' más (TODO=1 para verlos todos)');
});
console.log('\n' + (total ? total + ' textos en español en la versión inglesa' + (malResuelto ? ', ' + malResuelto + ' tickets sin resolver' : '') : 'Todo en inglés: ' + P.escenarios.length + ' tickets resueltos y ninguna frase en español'));
process.exit(total ? 1 : 0);
