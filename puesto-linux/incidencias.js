// Puesto · incidencias en fichero.
//
// Una incidencia es un .json que combina averías del catálogo (averias.js) con
// los textos del ticket. Es sólo datos: no se ejecuta nada que venga del
// fichero. Aun así, no se acepta a ciegas:
//
//   1. estructura, tipos y tamaños (nada de textos de 1 MB ni campos raros)
//   2. el validador del catálogo (tipos que existen, nodos y servicios reales,
//      dos averías que no pisen la misma cosa)
//   3. un ENSAYO: se aplica sobre una plataforma nueva, tiene que romper algo,
//      y su solución de referencia (los arreglos de sus averías, encadenados)
//      tiene que dejarla resuelta. Si nadie podría cerrarla, no entra.
//
// Lo que el fichero no trae (pistas, causa, lección, buenas prácticas) se
// genera a partir de las averías.
(function (P) {
'use strict';
const U = P.u, L = U.L;
P.FORMATO_INCIDENCIA = 'puesto-incidencia/1';
const MAX_AVERIAS = 12;

// ------------------------------------------------------------------ campos derivados
const CEPH = ['disco-muerto', 'flag-ceph', 'balancer-apagado', 'config-ceph'];
const AUTO = ['rabbit-debug', 'fuga-memoria', 'certificado-caducado', 'regla-a-mano'];
const esCeph = a => CEPH.indexOf(a.tipo) >= 0 || /^ceph/.test(a.servicio || '') || /^ceph0/.test(a.nodo || '');
const rompen = lista => lista.filter(a => !P.averias[a.tipo].condicion);
function funcionesDe(lista) {
  const f = ['incid'];
  if (lista.some(esCeph)) f.unshift('ceph');
  if (lista.some(a => !esCeph(a) && a.tipo !== 'reloj-desfasado' && a.tipo !== 'registro-ceph')) f.unshift('openstack');
  if (lista.some(a => AUTO.indexOf(a.tipo) >= 0)) f.push('auto');
  return f;
}
function areaDe(lista) {
  const a = [];
  if (lista.some(esCeph)) a.push('Ceph');
  if (lista.some(x => /^(ctl|cmp)/.test(x.nodo || '') || ['volumen-atascado', 'vm-borrada', 'certificado-caducado', 'fuga-memoria', 'regla-a-mano'].indexOf(x.tipo) >= 0)) a.push('OpenStack');
  if (lista.some(x => ['disco-lleno', 'reloj-desfasado'].indexOf(x.tipo) >= 0)) a.push('Linux');
  return a.join(' · ') || 'Plataforma';
}
// Dónde hay que mirar, sin decir qué: la segunda pista.
function sitios(lista) {
  const s = [];
  rompen(lista).forEach(a => {
    const t = a.nodo ? a.nodo : a.tipo === 'disco-muerto' ? 'el clúster Ceph (y el nodo del osd.' + a.osd + ')' : CEPH.indexOf(a.tipo) >= 0 ? 'el clúster Ceph' : a.tipo === 'certificado-caducado' ? 'la API (los controladores)' : a.tipo === 'fuga-memoria' ? 'los controladores' : a.tipo === 'regla-a-mano' ? 'los grupos de seguridad y Terraform' : 'OpenStack';
    if (s.indexOf(t) < 0) s.push(t);
  });
  return s;
}
const PRACTICAS = () => {
  const { antes, despues } = P.ayudasEscenario;
  const MIRAR = /amtool|ceph (-s|status|health|osd (tree|df))|systemctl status|journalctl|\bdf\b|\bdu\b|openstack .*(list|show)|\bfree\b|\btop\b|ps aux|dmesg|timedatectl|chronyc tracking/;
  const TOCAR = /systemctl (start|restart|enable|reset-failed)|truncate|\brm\b|ansible-playbook|terraform apply|ceph osd (out|in|unset|set)|ceph balancer on|ceph config (set|rm)|volume (set|delete)|server create|chronyc makestep/;
  return [
    { t: 'Miraste antes de tocar: alertas, estado o logs antes del primer cambio', ok: st => antes(st, MIRAR, TOCAR) },
    { t: 'Comprobaste que estaba arreglado después del último cambio', ok: st => despues(st, MIRAR, TOCAR) },
    { t: 'No reiniciaste nodos enteros para arreglarlo', ok: st => !st.hechos.reinicios.length },
  ];
};

// ------------------------------------------------------------------ construir
function construir(d) {
  const lista = d.averias;
  const hace = d.hace != null ? d.hace : Math.max(0, ...lista.map(a => a.hace || 0).filter(x => x <= 10080));
  const e = {
    id: d.id || ('EXT-' + U.hex(d.asunto + JSON.stringify(lista), 4).toUpperCase()),
    clave: 'importada', importada: true, autor: d.autor || '', fuente: d,
    tipo: d.tipo || 'incidente', nivel: d.nivel || 2, area: d.area || areaDe(lista), funciones: d.funciones || funcionesDe(lista),
    impacto: d.impacto, urgencia: d.urgencia, de: d.de || 'Incidencia importada', asunto: d.asunto, cuerpo: d.cuerpo,
    inicio: -hace, abierto: -(d.abiertoHace != null ? d.abiertoHace : Math.min(hace, 10)),
    averias: lista, trampas: [], practicas: PRACTICAS(),
    causa: d.causa || 'Varias cosas a la vez: ' + rompen(lista).map(a => P.averias[a.tipo].titulo.toLowerCase() + (a.nodo ? ' (' + (a.servicio ? a.servicio + ' en ' : '') + a.nodo + ')' : a.osd != null ? ' (osd.' + a.osd + ')' : '')).join('; ') + '.',
    solucion: d.solucion || 'Arreglar cada avería de abajo arriba: primero lo que otros necesitan (servicios base, discos, flags), luego lo que depende de ello y al final los recursos. Y comprobar al terminar.',
    leccion: d.leccion || 'Cuando fallan varias cosas a la vez, el orden importa: lo que otros necesitan va primero. Y una alerta que desaparece no es un arreglo comprobado: se mira el estado al terminar.',
  };
  // La solución de referencia: mirar, arreglar cada avería en orden, comprobar.
  e.guion = st => ['amtool alert'].concat(P.arregloAverias(st, e.averias), ['amtool alert']);
  P.normalizarEscenario(e);
  if (Array.isArray(d.pistas) && d.pistas.length === 3) e.pistas = d.pistas.slice();
  else {
    const st = P.preparar(e), sol = P.arregloAverias(st, lista).filter(c => !/^(exit|cd|sleep)\b/.test(c));
    e.pistas = [
      'Empieza por lo que ven las alertas: amtool alert. Si Ceph está implicado, ceph -s y ceph health detail.',
      'Hay que mirar en: ' + sitios(lista).join(', ') + '. Antes de arreglar, averigua qué necesita cada cosa para funcionar: lo que otros necesitan va primero.',
      'Una solución, en orden: ' + sol.join(' · '),
    ];
  }
  return e;
}

// ------------------------------------------------------------------ cargar
P.cargarIncidencia = function (entrada) {
  const errores = [], avisos = [];
  let d = entrada;
  if (typeof entrada === 'string') {
    if (entrada.length > 200000) return { ok: false, errores: ['El fichero es demasiado grande para ser una incidencia'], avisos };
    try { d = JSON.parse(entrada); } catch (e) { return { ok: false, errores: ['No es un JSON válido: ' + e.message], avisos }; }
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, errores: ['El fichero tiene que contener un objeto { … }'], avisos };

  // 1. estructura
  if (d.formato !== P.FORMATO_INCIDENCIA) errores.push('formato: tiene que ser "' + P.FORMATO_INCIDENCIA + '"' + (d.formato ? ' (pone "' + d.formato + '")' : ''));
  const texto = (k, max, obligatorio) => {
    const v = d[k];
    if (v == null) { if (obligatorio) errores.push(k + ': falta'); return; }
    if (typeof v !== 'string' || !v.trim()) errores.push(k + ': tiene que ser un texto');
    else if (v.length > max) errores.push(k + ': demasiado largo (' + v.length + ' caracteres, máximo ' + max + ')');
  };
  texto('asunto', 160, true); texto('de', 120); texto('area', 60); texto('autor', 80);
  texto('causa', 1500); texto('solucion', 1500); texto('leccion', 1500);
  if (d.id != null) {
    if (typeof d.id !== 'string' || !/^[A-Z]{2,5}-[0-9A-Z]{2,8}$/.test(d.id)) errores.push('id: con la forma EXT-001 (mayúsculas, guion y números)');
    else if (P.escenarios.some(e => e.id === d.id)) errores.push('id: ' + d.id + ' ya es un ticket del puesto; usa otro');
  }
  if (!Array.isArray(d.cuerpo) || !d.cuerpo.length || d.cuerpo.length > 6 || d.cuerpo.some(x => typeof x !== 'string' || !x.trim() || x.length > 1000)) errores.push('cuerpo: entre 1 y 6 párrafos de texto (máximo 1000 caracteres cada uno)');
  if (['alto', 'medio', 'bajo'].indexOf(d.impacto) < 0) errores.push('impacto: alto, medio o bajo');
  if (['alta', 'media', 'baja'].indexOf(d.urgencia) < 0) errores.push('urgencia: alta, media o baja');
  if (d.tipo != null && ['incidente', 'peticion', 'cambio'].indexOf(d.tipo) < 0) errores.push('tipo: incidente, peticion o cambio');
  if (d.nivel != null && [1, 2, 3].indexOf(d.nivel) < 0) errores.push('nivel: 1, 2 o 3');
  ['hace', 'abiertoHace'].forEach(k => { if (d[k] != null && !(Number.isInteger(d[k]) && d[k] >= 0 && d[k] <= 10080)) errores.push(k + ': minutos enteros entre 0 y 10080 (una semana)'); });
  if (d.hace != null && d.abiertoHace != null && d.abiertoHace > d.hace) errores.push('abiertoHace: el ticket no puede abrirse antes de que empiece la avería');
  if (d.pistas != null && (!Array.isArray(d.pistas) || d.pistas.length !== 3 || d.pistas.some(x => typeof x !== 'string' || !x.trim() || x.length > 400))) errores.push('pistas: exactamente 3 textos (máximo 400 caracteres cada uno), o ninguna para que se generen');
  if (d.funciones != null && (!Array.isArray(d.funciones) || d.funciones.some(f => !P.funciones.some(x => x.id === f)))) errores.push('funciones: una lista con ' + P.funciones.map(f => f.id).join(', '));
  const conocidos = ['formato', 'id', 'tipo', 'asunto', 'de', 'cuerpo', 'impacto', 'urgencia', 'nivel', 'area', 'funciones', 'hace', 'abiertoHace', 'averias', 'pistas', 'causa', 'solucion', 'leccion', 'autor'];
  Object.keys(d).filter(k => conocidos.indexOf(k) < 0).forEach(k => avisos.push('campo desconocido «' + k + '»: se ignora'));
  if (!Array.isArray(d.averias) || !d.averias.length) errores.push('averias: hace falta una lista con al menos una avería');
  else if (d.averias.length > MAX_AVERIAS) errores.push('averias: como mucho ' + MAX_AVERIAS);
  else if (d.averias.some(a => !a || typeof a !== 'object' || Array.isArray(a) || typeof a.tipo !== 'string')) errores.push('averias: cada una tiene que ser un objeto con su "tipo"');
  if (errores.length) return { ok: false, errores, avisos };

  // 2. el catálogo
  P.validarAverias(d.averias).forEach(x => errores.push(x));
  if (errores.length) return { ok: false, errores, avisos };

  // 3. ensayo
  let e;
  try { e = construir(d); } catch (x) { return { ok: false, errores: ['No se ha podido montar: ' + x.message], avisos }; }
  const st = P.preparar(e), antes = e.resuelto(st, P), alertas = P.alertasActivas(st).length;
  if (!antes.length) errores.push('No rompe nada: al aplicarla, la plataforma sigue sana (¿sólo tiene condiciones?)');
  if (e.tipo === 'incidente' && !alertas) avisos.push('No dispara ninguna alerta: se puede jugar con el ticket delante, pero en guardia nadie la encontraría');
  if (-e.abierto >= P.prioridad(e).sla / 2) errores.push('abiertoHace: con prioridad ' + P.prioridad(e).p + ' el ticket nacería con más de medio SLA gastado');
  const ses = P.nuevaSesion(), guion = P.guionDe(e, st), raros = [];
  guion.forEach(c => { const r = P.ejecutar(st, ses, c); if (r.lineas.some(l => /: command not found/.test(l.t))) raros.push(c); P.expulsar(st, ses); });
  if (raros.length) errores.push('Su solución usa comandos que no existen: ' + raros.join(', '));
  const quedan = e.resuelto(st, P);
  if (quedan.length && antes.length) errores.push('Su solución de referencia no la resuelve, así que nadie podría cerrarla: ' + quedan.join(' · '));
  const ensayo = { averias: rompen(d.averias).length, condiciones: d.averias.length - rompen(d.averias).length, alertas, pendientes: antes.length, comandos: guion.length, minutos: st.reloj };
  return { ok: !errores.length, errores, avisos, escenario: errores.length ? null : e, ensayo };
};

// Un ticket del puesto hecho sólo de averías, como fichero: sirve de plantilla.
P.exportarIncidencia = e => {
  const d = { formato: P.FORMATO_INCIDENCIA, id: e.importada ? e.id : 'EXT-' + e.id.split('-')[1], tipo: e.tipo, asunto: e.asunto, de: e.de, cuerpo: e.cuerpo.slice(), impacto: e.impacto, urgencia: e.urgencia, nivel: e.nivel, area: e.area, hace: -e.inicio, abiertoHace: -e.abierto, averias: JSON.parse(JSON.stringify(e.averias)), pistas: e.pistas.slice(), causa: e.causa, solucion: e.solucion, leccion: e.leccion };
  if (e.autor) d.autor = e.autor;
  return d;
};
P.construirIncidencia = construir;   // para la vista previa del compositor, aunque el ensayo falle
P.exportables = () => P.escenarios.filter(e => !e.objetivo && e.averias.some(a => !P.averias[a.tipo].condicion));

// Para quien escribe incidencias: el catálogo, legible.
P.catalogoLegible = () => Object.keys(P.averias).map(t => { const a = P.averias[t]; return { tipo: t, titulo: a.titulo, descripcion: a.descripcion || '', condicion: a.condicion, params: a.params, ejemplo: Object.assign({ tipo: t }, a.ejemplo) }; });

})(window.PUESTO = window.PUESTO || {});
