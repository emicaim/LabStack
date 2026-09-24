// Puesto · guardias generadas y caos.
//
// No se mezclan averías sueltas al azar: se eligen FAMILIAS, grupos de averías
// que tienen sentido juntas (un log gigante y el RabbitMQ que no arranca por
// él; un cinder-volume caído y el volumen que dejó atascado). Cada familia tiene
// su nivel y sus parámetros aleatorios.
//
// Todo sale de una semilla: la misma semilla da la misma guardia, así que una
// guardia se puede repetir o pasar a un compañero con un número.
//
// Una guardia generada pasa por el mismo ensayo que una incidencia importada
// (incidencias.js): tiene que romper algo, disparar alertas y su solución de
// referencia tiene que resolverla. Si no, se prueba otra combinación.
(function (P) {
'use strict';
const U = P.u, T = P.T;

// PRNG determinista (mulberry32)
P.azar = semilla => { let a = semilla >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const entre = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const uno = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const CMP = ['cmp01', 'cmp02', 'cmp03'], CTL = ['ctl01', 'ctl02', 'ctl03'], CEPH = ['ceph01', 'ceph02', 'ceph03'];
const NODOS = CTL.concat(CMP, CEPH, ['mon01']);
const hostOsd = o => 'ceph0' + (Math.floor(o / 3) + 1);

P.familias = [
  { id: 'osd-caido', nivel: 1, titulo: T('Un OSD que se cuelga', 'An OSD that crashes'),
    leccion: T('un OSD caído se levanta antes de que Ceph lo marque out (10 minutos), y su RECENT_CRASH se lee y se archiva', 'bring a down OSD back up before Ceph marks it out (10 minutes), then read and archive its RECENT_CRASH'),
    crear: rnd => { const o = entre(rnd, 0, 8), t = entre(rnd, 2, 6); return [{ tipo: 'servicio-caido', nodo: hostOsd(o), servicio: 'ceph-osd@' + o, motivo: 'osd-suicidio', hace: t, crashes: [t + 3, t + 2, t] }]; } },
  { id: 'libvirt-parado', nivel: 1, titulo: T('libvirt parado en un hipervisor', 'libvirt stopped on a hypervisor'),
    leccion: T('sin libvirt no hay nova-compute: primero la base, luego lo que depende de ella, y habilitado para que sobreviva a un reinicio', 'no libvirt means no nova-compute: the foundation first, then what depends on it, and enabled so it survives a reboot'),
    crear: rnd => [{ tipo: 'servicio-parado', nodo: uno(rnd, CMP), servicio: 'libvirtd', hace: entre(rnd, 30, 900), deshabilitado: true }] },
  { id: 'galera-oom', nivel: 1, titulo: T('Un nodo de Galera muerto por falta de memoria', 'A Galera node killed by running out of memory'),
    leccion: T('a un clúster Galera vivo se vuelve con un arranque normal; galera_new_cluster sólo con todo el clúster parado', 'a node rejoins a live Galera cluster with a normal start; galera_new_cluster only when the whole cluster is down'),
    crear: rnd => [{ tipo: 'servicio-caido', nodo: uno(rnd, CTL), servicio: 'mariadb', motivo: 'oom', hace: entre(rnd, 5, 60) }] },
  { id: 'reloj', nivel: 1, titulo: T('Un reloj que deriva', 'A drifting clock'),
    leccion: T('chrony parado y deshabilitado deja la hora a la deriva; makestep la corrige ya, el slew tarda', 'chrony stopped and disabled lets the clock drift; makestep fixes it at once, slewing takes time'),
    crear: rnd => [{ tipo: 'reloj-desfasado', nodo: uno(rnd, NODOS), segundos: +(0.12 + rnd() * 0.8).toFixed(3), hace: entre(rnd, 60, 600) }] },
  { id: 'noout-olvidado', nivel: 1, titulo: T('Un noout olvidado', 'A forgotten noout'),
    leccion: T('los flags de mantenimiento se quitan al terminar: noout impide que Ceph reaccione solo', 'maintenance flags come off when you finish: noout stops Ceph from reacting on its own'),
    crear: rnd => [{ tipo: 'flag-ceph', flag: 'noout', hace: entre(rnd, 300, 1440) }] },
  { id: 'ovs-caido', nivel: 2, titulo: T('Open vSwitch caído en un hipervisor', 'A hypervisor with Open vSwitch down'),
    leccion: T('una VM puede estar ACTIVE y sin red: Open vSwitch antes que el agente que lo usa', 'a VM can be ACTIVE and still have no network: Open vSwitch before the agent that uses it'),
    crear: rnd => [{ tipo: 'servicio-caido', nodo: uno(rnd, CMP), servicio: 'openvswitch-switch', motivo: 'ovs-lock', hace: entre(rnd, 5, 60) }] },
  { id: 'cinder-atascado', nivel: 2, titulo: T('cinder-volume caído y un borrado a medias', 'cinder-volume down and a half-finished deletion'),
    leccion: T('un estado que no avanza es un servicio que murió a mitad: primero se levanta el servicio, luego se corrige el estado', 'a state that never moves on is a service that died halfway: bring the service up first, then fix the state'),
    crear: rnd => { const n = uno(rnd, CTL), h = entre(rnd, 60, 3000); return [{ tipo: 'servicio-caido', nodo: n, servicio: 'cinder-volume', motivo: 'rados-timeout', hace: h }, { tipo: 'volumen-atascado', nombre: 'vol-' + U.hex(n + h, 5), proyecto: uno(rnd, ['tienda-online', 'analitica', 'tpv-tiendas']), gb: entre(rnd, 5, 30) * 10, nodo: n, hace: h - 2 }]; } },
  { id: 'rabbit-lleno', nivel: 2, titulo: T('RabbitMQ sin disco', 'RabbitMQ out of disk'),
    leccion: T('un disco lleno es un síntoma: du encuentra al culpable antes de borrar nada', 'a full disk is a symptom: du finds the culprit before you delete anything'),
    crear: rnd => { const n = uno(rnd, CTL), h = entre(rnd, 10, 60); return [{ tipo: 'disco-lleno', nodo: n, fichero: '/var/log/rabbitmq/rabbit@' + n + '.log', mb: 31000 }, { tipo: 'servicio-caido', nodo: n, servicio: 'rabbitmq-server', motivo: 'sin-espacio', hace: h }]; } },
  { id: 'nearfull', nivel: 2, titulo: T('Un OSD casi lleno con el balancer apagado', 'A nearly full OSD with the balancer off'),
    leccion: T('Ceph se llena por el OSD más lleno, no por la media; se reparte, no se sube el umbral', 'Ceph fills up by its fullest OSD, not by the average; rebalance the data, do not raise the threshold'),
    crear: rnd => [{ tipo: 'balancer-apagado', osd: entre(rnd, 0, 8), exceso: +(28.5 + rnd() * 2.5).toFixed(1) }] },
  { id: 'certificado', nivel: 2, titulo: T('El certificado de la API caducado', 'The expired API certificate'),
    leccion: T('el fichero en disco y lo que el servicio tiene cargado son dos cosas: tras cambiarlo, se recarga', 'the file on disk and what the service has loaded are two different things: after replacing it, reload'),
    crear: rnd => [{ tipo: 'certificado-caducado', hace: entre(rnd, 5, 120) }] },
  { id: 'fuga', nivel: 2, titulo: T('Una fuga de memoria en nova-api', 'A memory leak in nova-api'),
    leccion: T('reiniciar mitiga, el parche corrige, y un paquete instalado no cambia el proceso que ya corre', 'a restart mitigates, the patch fixes, and an installed package does not change the process already running'),
    crear: rnd => { const m = {}; CTL.forEach(n => { m[n] = entre(rnd, 8, 30); }); m[uno(rnd, CTL)] = entre(rnd, 60, 64); return [{ tipo: 'fuga-memoria', memoria: m }]; } },
  { id: 'disco-muerto', nivel: 3, titulo: T('Un disco muerto y un noout que lo tapa', 'A dead disk and a noout hiding it'),
    leccion: T('un disco con SMART FAILED no se reinicia: se saca el OSD; y noout olvidado impide que Ceph se cure solo', 'a disk with SMART FAILED is not restarted: the OSD is marked out; and a forgotten noout stops Ceph from healing itself'),
    crear: rnd => [{ tipo: 'flag-ceph', flag: 'noout', hace: entre(rnd, 300, 900) }, { tipo: 'disco-muerto', osd: entre(rnd, 0, 8), hace: entre(rnd, 30, 200) }] },
  { id: 'quorum', nivel: 3, titulo: T('Dos monitores de Ceph caídos', 'Two Ceph monitors down'),
    leccion: T('un clúster de tres aguanta un fallo, no dos; el primero, ignorado, es el que prepara la caída', 'a three-node cluster survives one failure, not two; the first one, ignored, is what sets up the outage'),
    crear: rnd => { const [a, b] = CEPH.slice().sort(() => rnd() - 0.5); const t = entre(rnd, 10, 40); return [{ tipo: 'servicio-parado', nodo: a, servicio: 'ceph-mon@' + a, hace: entre(rnd, 1440, 5000), deshabilitado: true }, { tipo: 'servicio-caido', nodo: b, servicio: 'ceph-mon@' + b, motivo: 'mon-abort', hace: t, crashes: [t + 1] }]; } },
  { id: 'mon-disco', nivel: 3, titulo: T('debug_mon en 20 y un monitor sin disco', 'debug_mon at 20 and a monitor out of disk'),
    leccion: T('la configuración central afecta a todos los demonios del tipo: el síntoma sale en un nodo y la causa vive en el clúster', 'central configuration affects every daemon of that type: the symptom shows up on one node and the cause lives in the cluster'),
    crear: rnd => { const n = uno(rnd, CEPH); return [{ tipo: 'config-ceph', quien: 'mon', opcion: 'debug_mon', valor: '20/20', hace: 10080 }].concat(CEPH.map(c => ({ tipo: 'disco-lleno', nodo: c, fichero: '/var/log/ceph/ceph-mon.' + c + '.log', mb: c === n ? 35500 : entre(rnd, 12000, 21000) })), [{ tipo: 'servicio-caido', nodo: n, servicio: 'ceph-mon@' + n, motivo: 'mon-sin-espacio', hace: entre(rnd, 10, 60) }]); } },
  { id: 'regla-a-mano', nivel: 3, titulo: T('Un puerto abierto a mano, fuera de Terraform', 'A port opened by hand, outside Terraform'),
    leccion: T('Terraform sólo ve lo que tiene en su estado: lo creado a mano hay que encontrarlo y quitarlo a mano', 'Terraform only sees what is in its state: whatever was created by hand has to be found and removed by hand'),
    crear: () => [{ tipo: 'regla-a-mano' }] },
];

const NOMBRES = { 1: T('Tranquila', 'Quiet'), 2: T('Movida', 'Busy'), 3: T('Infierno', 'Hellish') };
P.nivelesGuardia = NOMBRES;

// Elige familias sin repetir y sin que sus averías pisen lo mismo.
function elegir(rnd, nivel) {
  const cuantas = nivel, lista = [], usadas = [];
  const pool = P.familias.filter(f => f.nivel <= nivel);
  for (let i = 0; i < 40 && usadas.length < cuantas; i++) {
    // la primera familia es del nivel pedido: una guardia de nivel 3 tiene algo de nivel 3
    const cand = usadas.length === 0 ? pool.filter(f => f.nivel === nivel) : pool;
    const f = uno(rnd, cand);
    if (usadas.indexOf(f) >= 0) continue;
    const av = f.crear(rnd);
    if (P.validarAverias(lista.concat(av)).length) continue;
    usadas.push(f); av.forEach(a => lista.push(a));
  }
  return { familias: usadas, averias: lista };
}

// Una guardia completa y ensayada. Si una combinación no sirve, prueba la siguiente.
P.generarGuardia = function (nivel, semilla) {
  nivel = [1, 2, 3].indexOf(nivel) >= 0 ? nivel : 1;
  semilla = (semilla >>> 0) || 1;
  for (let intento = 0; intento < 25; intento++) {
    const rnd = P.azar(semilla * 31 + intento * 7919 + nivel);
    const { familias, averias } = elegir(rnd, nivel);
    if (familias.length < nivel) continue;
    const def = {
      formato: P.FORMATO_INCIDENCIA, id: 'GRD-' + (semilla % 1000000).toString(36).toUpperCase().padStart(4, '0'),
      tipo: 'incidente', asunto: T('Guardia ' + NOMBRES[nivel].toLowerCase() + ' · semilla ' + semilla, NOMBRES[nivel] + ' on-call shift · seed ' + semilla),
      de: T('Busca de guardia', 'On-call pager'), cuerpo: [T('Te ha saltado el busca. No hay ticket: sólo lo que ven las alertas.', 'Your pager just went off. There is no ticket: only what the alerts show.')],
      impacto: nivel === 1 ? 'medio' : 'alto', urgencia: 'alta', nivel, hace: 30, abiertoHace: 0,
      averias,
      causa: T('Pasaban ' + (familias.length === 1 ? 'una cosa' : familias.length + ' cosas a la vez'), familias.length === 1 ? 'One thing was going on' : familias.length + ' things were going on at once') + ': ' + familias.map(f => /^(Un|Una|El|La|Dos|Tres|A|An|The|Two|Three)\b/.test(f.titulo) ? f.titulo.charAt(0).toLowerCase() + f.titulo.slice(1) : f.titulo).join('; ') + '.',
      leccion: familias.map(f => f.leccion.charAt(0).toUpperCase() + f.leccion.slice(1) + '.').join(' '),
    };
    const r = P.cargarIncidencia(def);
    if (!r.ok || !r.ensayo.alertas) continue;
    r.escenario.guardia = { nivel, semilla, familias: familias.map(f => f.id) };
    return { ok: true, def, r, escenario: r.escenario, intentos: intento + 1 };
  }
  return { ok: false };
};

// ------------------------------------------------------------------ caos
// Rompe algo en una plataforma que ya está en marcha, dentro de unos minutos.
// Devuelve lo que ha programado (para comprobar o revelar después).
P.provocarCaos = function (st, semilla, previas) {
  previas = previas || [];
  const rnd = P.azar(semilla);
  for (let i = 0; i < 30; i++) {
    const f = uno(rnd, P.familias.filter(x => x.nivel <= 2));
    const cuando = st.reloj + entre(rnd, 1, 4);
    // las horas de la familia se sustituyen por «ahora mismo»
    const av = f.crear(rnd).map(a => Object.assign({}, a, { hace: -cuando }, a.crashes ? { crashes: [-cuando] } : {}));
    if (P.validarAverias(previas.concat(av).map(a => Object.assign({}, a, { hace: 0 }))).length) continue;
    st.programados = (st.programados || []).concat([{ min: cuando, fn: s2 => { P.aplicarAverias(s2, av); } }]);
    return { familia: f, averias: av, cuando };
  }
  return null;
};
// ¿Queda algo roto de lo provocado (y lo que arrastró)?
P.pendientesCaos = (st, provocadas) => {
  const hechas = provocadas.filter(c => c.cuando <= st.reloj);
  const p = P.pendientesAverias(st, [].concat(...hechas.map(c => c.averias)));
  return p.concat(p.length ? [] : P.pendientesSalud(st).concat(P.pendientesUnidades(st)));
};

})(window.PUESTO = window.PUESTO || {});
