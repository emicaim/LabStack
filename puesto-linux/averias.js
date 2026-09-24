// Puesto · catálogo de averías.
//
// Una avería es una pieza suelta que sabe tres cosas:
//   aplicar(st, a)       romper la plataforma
//   pendientes(st, a)    qué falta para darla por arreglada (vacío = arreglada)
//   arreglo(a, st)       una solución de referencia, en comandos
//
// Una incidencia es una lista de averías con parámetros. Las averías se
// combinan solas porque el motor ya conoce las dependencias: sin libvirt cae
// nova-compute, sin espacio no arranca RabbitMQ, sin quórum Ceph se cuelga.
// Nadie escribe la interacción: sale del estado.
//
// Las «condiciones» no rompen nada: preparan el escenario (un proyecto casi
// en su cuota, hipervisores llenos, una VM que un pipeline creará dentro de
// 6 minutos). No tienen pendientes ni arreglo.
//
// Todo es declarativo: una incidencia puede venir de un fichero de datos sin
// ejecutar código ajeno. puesto-test.js aplica cada avería sola, ejecuta su
// arreglo y exige que la plataforma vuelva a quedar sana.
(function (P) {
'use strict';
const U = P.u, T = P.T;
P.averias = {};

// orden: en qué fase se arregla al encadenar varias. Lo de abajo primero
// (servicios base, discos, flags), luego lo que depende de ello, al final los
// recursos. Así libvirtd se levanta antes que nova-compute.
const def = (id, o) => { P.averias[id] = Object.assign({ id, orden: 1, condicion: false, params: {}, toca: () => [], pendientes: () => [], arreglo: () => [] }, o); };
const hace = (a, d) => -(a.hace != null ? a.hace : (d || 0));
const svc = (st, a) => st.hosts[a.nodo] && st.hosts[a.nodo].svcs[a.servicio];
const valNodo = (st, a) => !st.hosts[a.nodo] ? T('no existe el nodo «' + a.nodo + '»', "node '" + a.nodo + "' does not exist") : null;
const valSvc = (st, a) => valNodo(st, a) || (!svc(st, a) ? T(a.nodo + ' no tiene el servicio «' + a.servicio + '»', a.nodo + " has no service '" + a.servicio + "'") : null);
const nombre = a => { const m = /^ceph-(osd|mon|mgr)@(.+)$/.exec(a.servicio); return m ? m[1] + '.' + m[2] : a.servicio; };
const efecto = a => a.efecto ? ': ' + a.efecto : '';
// Una línea de contexto en el journal de la unidad («alguien hizo disable»...)
const nota = (st, a) => { if (a.nota) U.logSvc(st.hosts[a.nodo], a.servicio, -a.nota.hace, a.nota.src || 'systemd[1]', a.nota.t); };
const CTLS = ['ctl01', 'ctl02', 'ctl03'];
// Lo que cae arrastra a lo que depende de ello, con la misma hora: una avería
// generada se propaga igual que una real (sin libvirt, nova-compute cae).
const cascada = (st, a, min) => {
  const h = st.hosts[a.nodo], r = st.reloj;
  st.reloj = min; (P.alCaer || []).forEach(f => f(st, h, a.servicio)); st.reloj = r;
};
// Al arreglar algo, se reinicia lo que depende de ello en ese nodo.
const dependientes = (st, a) => st ? (P.dependientes[a.servicio] || []).filter(d => st.hosts[a.nodo].svcs[d]) : [];

// ------------------------------------------------------------------ servicios
def('servicio-caido', {
  titulo: T('Servicio caído', 'Service down'), orden: 2,
  descripcion: T('Una unidad de systemd en failed, con el rastro de por qué en el journal. Con crashes, además, el aviso RECENT_CRASH de Ceph.', 'A systemd unit in failed state, with the reason in the journal. With crashes, also the Ceph RECENT_CRASH warning.'),
  params: { nodo: T('nodo', 'node'), servicio: T('unidad de systemd', 'systemd unit'), motivo: T('por qué cayó (oom, sin-espacio, osd-suicidio, mon-abort…)', 'why it went down (oom, sin-espacio, osd-suicidio, mon-abort…)'), hace: T('minutos', 'minutes ago'), crashes: T('[minutos] (sólo Ceph)', '[minutes] (Ceph only)'), efecto: T('qué provoca, para el aviso', 'what it causes, for the warning'), nota: '{hace, src, t}' },
  ejemplo: { nodo: 'ceph02', servicio: 'ceph-osd@4', motivo: 'osd-suicidio', hace: 3, crashes: [6, 5, 3] },
  validar: (st, a) => valSvc(st, a) || (a.motivo && !P.motivos[a.motivo] ? T('motivo desconocido «' + a.motivo + '»', "unknown motivo '" + a.motivo + "'") : null),
  toca: a => ['svc:' + a.nodo + ':' + a.servicio],
  aplicar(st, a) {
    const min = hace(a); nota(st, a);
    // ya tumbada por otra avería (en cadena): no se tumba dos veces
    if (svc(st, a).estado !== 'failed') P.fallar(st, a.nodo, a.servicio, a.motivo, min);
    cascada(st, a, min);
    const osd = /^ceph-osd@(\d+)$/.exec(a.servicio), mon = /^ceph-mon@(.+)$/.exec(a.servicio);
    if (osd) st.ceph.osds[+osd[1]].downDesde = min;
    (a.crashes || []).forEach(m => { if (osd) P.cephCrash(st, +osd[1], -m, 'timeout'); else if (mon) P.cephCrashMon(st, mon[1], -m); });
  },
  pendientes(st, a) {
    const osd = /^ceph-osd@(\d+)$/.exec(a.servicio);
    if (osd) {
      const o = st.ceph.osds[+osd[1]];
      if (!U.osdUp(st, o)) return [T('osd.' + o.id + ' sigue down (ceph osd tree)', 'osd.' + o.id + ' is still down (ceph osd tree)') + efecto(a)];
      return o.in ? [] : [T('osd.' + o.id + ' está up pero fuera del clúster (out): no guarda datos. ceph osd in ' + o.id, 'osd.' + o.id + ' is up but out of the cluster: it stores no data. ceph osd in ' + o.id)];
    }
    const h = st.hosts[a.nodo];
    if (a.servicio === 'mariadb' && h.extra.splitBrain) return [T(a.nodo + ' ha formado un clúster Galera propio de 1 nodo (split-brain): dos bases de datos que ya no se hablan', a.nodo + ' has formed its own 1-node Galera cluster (split-brain): two databases that no longer talk to each other')];
    return h.svcs[a.servicio].estado === 'active' ? [] : [T(nombre(a) + ' sigue caído en ' + a.nodo, nombre(a) + ' is still down on ' + a.nodo) + efecto(a)];
  },
  arreglo: (a, st) => ['ssh ' + a.nodo, 'sudo systemctl reset-failed ' + a.servicio, 'sudo systemctl start ' + a.servicio]
    .concat(dependientes(st, a).map(d => 'sudo systemctl restart ' + d), ['exit'], /^ceph-/.test(a.servicio) ? ['sleep 60'] : [], a.crashes && a.crashes.length ? ['ceph crash archive-all'] : []),
});
def('servicio-parado', {
  titulo: T('Servicio parado (y quizá deshabilitado)', 'Service stopped (and maybe disabled)'), orden: 1,
  descripcion: T('Alguien lo paró, o un paquete al actualizarse, y nadie lo volvió a arrancar. Deshabilitado, además, no vuelve solo tras un reinicio.', 'Someone stopped it, or a package upgrade did, and nobody started it again. If it is also disabled, it will not come back by itself after a reboot.'),
  params: { nodo: T('nodo', 'node'), servicio: T('unidad de systemd', 'systemd unit'), hace: T('minutos', 'minutes ago'), deshabilitado: 'true / false', exigirHabilitado: T('si hace falta dejarlo habilitado (por defecto, sí cuando está deshabilitado)', 'whether it must be left enabled (default: yes when it is disabled)'), efecto: T('qué provoca', 'what it causes'), nota: '{hace, src, t}' },
  ejemplo: { nodo: 'cmp02', servicio: 'libvirtd', hace: 840, deshabilitado: true },
  validar: valSvc,
  toca: a => ['svc:' + a.nodo + ':' + a.servicio],
  aplicar(st, a) { nota(st, a); P.parado(st, a.nodo, a.servicio, hace(a, 60), !!a.deshabilitado); cascada(st, a, hace(a, 60) + 1); },
  pendientes(st, a) {
    const s = svc(st, a);
    if (s.estado !== 'active') return [T(nombre(a) + ' sigue parado en ' + a.nodo, nombre(a) + ' is still stopped on ' + a.nodo) + efecto(a)];
    const exigir = a.exigirHabilitado != null ? a.exigirHabilitado : !!a.deshabilitado;
    return exigir && !s.enabled ? [T(nombre(a) + ' está arrancado pero deshabilitado en ' + a.nodo + ': volverá a caer en el próximo reinicio', nombre(a) + ' is running but disabled on ' + a.nodo + ': it will go down again on the next reboot')] : [];
  },
  arreglo: (a, st) => ['ssh ' + a.nodo, 'sudo systemctl enable --now ' + a.servicio].concat(dependientes(st, a).map(d => 'sudo systemctl restart ' + d), ['exit']),
});

// ------------------------------------------------------------------ discos y logs
def('disco-lleno', {
  titulo: T('Un fichero llena un disco', 'A file fills up a disk'), orden: 1,
  descripcion: T('Un log (o cualquier fichero) crece hasta llenar su sistema de ficheros. Los servicios que escriben ahí dejan de poder arrancar.', 'A log (or any file) grows until it fills its filesystem. Services that write there can no longer start.'),
  params: { nodo: T('nodo', 'node'), fichero: T('ruta', 'path'), mb: T('tamaño en MB', 'size in MB') },
  ejemplo: { nodo: 'ctl02', fichero: '/var/log/rabbitmq/rabbit@ctl02.log', mb: 31000 },
  validar: (st, a) => valNodo(st, a) || (!/^\/var\/log\//.test(a.fichero || '') ? T('el fichero tiene que estar en /var/log (es lo único que se puede borrar)', 'the file must be under /var/log (the only thing that can be deleted)') : !(a.mb > 0) ? T('mb tiene que ser un número', 'mb must be a number') : null),
  toca: a => ['fichero:' + a.nodo + ':' + a.fichero],
  aplicar(st, a) { st.hosts[a.nodo].logs[a.fichero] = a.mb; },
  pendientes(st, a) { const h = st.hosts[a.nodo], m = U.montaje(h, a.fichero), p = U.pctDisco(h, m); return p >= 85 ? [T(m + ' de ' + a.nodo + ' sigue al ' + p + ' %', m + ' on ' + a.nodo + ' is still at ' + p + '%')] : []; },
  arreglo: a => ['ssh ' + a.nodo, 'sudo truncate -s 0 ' + a.fichero, 'exit'],
});
def('rabbit-debug', {
  titulo: T('RabbitMQ en nivel debug', 'RabbitMQ at debug level'), orden: 1,
  descripcion: T('Su log crece unos 150 MB por minuto mientras RabbitMQ corre: tarde o temprano llena /var. Se corrige con el playbook logrotate.yml.', 'Its log grows about 150 MB per minute while RabbitMQ runs: sooner or later it fills /var. The logrotate.yml playbook fixes it.'),
  params: { nodo: T('controlador', 'controller') },
  ejemplo: { nodo: 'ctl02' },
  validar: (st, a) => CTLS.indexOf(a.nodo) < 0 ? T('RabbitMQ sólo vive en los controladores', 'RabbitMQ only runs on the controllers') : null,
  toca: a => ['debug:' + a.nodo],
  aplicar(st, a) { st.hosts[a.nodo].extra.rabbitDebug = true; },
  pendientes: (st, a) => st.hosts[a.nodo].extra.rabbitDebug ? [T('RabbitMQ de ' + a.nodo + ' sigue en nivel debug: su log volverá a llenar /var', 'RabbitMQ on ' + a.nodo + ' is still at debug level: its log will fill /var again')] : [],
  arreglo: a => ['cd ~/infra', 'ansible-playbook playbooks/logrotate.yml -l ' + a.nodo, 'cd'],
});
def('config-ceph', {
  titulo: T('Opción de Ceph mal puesta', 'Ceph option set wrong'), orden: 1,
  descripcion: T('Un ceph config set olvidado. Afecta a todos los demonios del tipo a la vez; con debug_mon en 20/20, los tres monitores empiezan a llenar su disco.', 'A forgotten ceph config set. It affects every daemon of that type at once; with debug_mon at 20/20, all three monitors start filling their disks.'),
  params: { quien: 'mon, osd…', opcion: T('nombre de la opción', 'option name'), valor: T('valor', 'value'), hace: T('minutos', 'minutes ago'), efecto: T('qué provoca', 'what it causes') },
  ejemplo: { quien: 'mon', opcion: 'debug_mon', valor: '20/20' },
  validar: (st, a) => !a.quien || !a.opcion || a.valor == null ? T('faltan quien, opcion o valor', 'missing quien, opcion or valor') : null,
  toca: a => ['cephcfg:' + a.quien + '/' + a.opcion],
  aplicar(st, a) {
    st.ceph.config[a.quien + '/' + a.opcion] = a.valor;
    st.ceph.historial.push({ min: hace(a, 10080), sev: 'INF', t: 'from=\'client.admin\' cmd=[{"prefix": "config set", "who": "' + a.quien + '", "name": "' + a.opcion + '", "value": "' + a.valor + '"}]: finished' });
  },
  pendientes: (st, a) => st.ceph.config[a.quien + '/' + a.opcion] === a.valor ? [T(a.opcion + ' sigue en ' + a.valor + ' para ' + a.quien, a.opcion + ' is still ' + a.valor + ' for ' + a.quien) + efecto(a)] : [],
  arreglo: a => ['ceph config rm ' + a.quien + ' ' + a.opcion],
});

// ------------------------------------------------------------------ tiempo
def('reloj-desfasado', {
  titulo: T('Reloj desfasado', 'Clock skew'), orden: 1,
  descripcion: T('chrony parado y deshabilitado: la hora deriva. En un nodo Ceph, el monitor lo detecta (MON_CLOCK_SKEW); en los demás, sólo Prometheus.', 'chrony stopped and disabled: the clock drifts. On a Ceph node the monitor detects it (MON_CLOCK_SKEW); elsewhere, only Prometheus does.'),
  params: { nodo: T('nodo', 'node'), segundos: T('desfase en segundos', 'offset in seconds'), hace: T('minutos', 'minutes ago') },
  ejemplo: { nodo: 'ceph03', segundos: 0.912, hace: 300 },
  validar: (st, a) => valNodo(st, a) || (!(a.segundos > 0.05) ? T('el desfase tiene que superar 0.05 s para notarse', 'the offset must exceed 0.05 s to be noticeable') : null),
  toca: a => ['svc:' + a.nodo + ':chrony'],
  aplicar(st, a) { P.parado(st, a.nodo, 'chrony', hace(a, 60), true); const h = st.hosts[a.nodo]; h.ntp.sync = false; h.ntp.offset = a.segundos; h.ntp.deriva = 0.002; },
  pendientes(st, a) {
    const h = st.hosts[a.nodo], off = Math.abs(h.ntp.offset).toFixed(3), activo = h.svcs.chrony.estado === 'active';
    return h.up && !U.ntpOk(h) ? [T(a.nodo + ': reloj sin sincronizar (' + off + ' s de desfase, chrony ' + (activo ? 'corrigiendo poco a poco' : 'parado') + ')', a.nodo + ': clock not synchronized (' + off + ' s offset, chrony ' + (activo ? 'slowly correcting' : 'stopped') + ')')] : [];
  },
  arreglo: a => ['ssh ' + a.nodo, 'sudo systemctl enable --now chrony', 'sudo chronyc makestep', 'exit'],
});

// ------------------------------------------------------------------ Ceph
def('disco-muerto', {
  titulo: T('Disco de un OSD muerto', 'Dead OSD disk'), orden: 3,
  descripcion: T('El SSD falla: el OSD no arranca, SMART dice FAILED y dmesg se llena de errores de E/S. No se arregla reiniciando: se saca el OSD y se reconstruye.', 'The SSD fails: the OSD will not start, SMART says FAILED and dmesg fills with I/O errors. Restarting does not fix it: the OSD is marked out and the data is rebuilt.'),
  params: { osd: '0-8', hace: T('minutos', 'minutes ago') },
  ejemplo: { osd: 7, hace: 95 },
  validar: (st, a) => !(a.osd >= 0 && a.osd <= 8) ? T('osd tiene que ser de 0 a 8', 'osd must be between 0 and 8') : null,
  toca: a => ['osd:' + a.osd],
  aplicar(st, a) {
    const o = st.ceph.osds[a.osd], min = hace(a);
    o.disco = 'muerto'; o.downDesde = min;
    P.fallar(st, o.host, 'ceph-osd@' + o.id, 'disco-muerto', min);
    P.cephCrash(st, o.id, min - 1, 'disco');
    st.ceph.historial.push({ min: min - 1, sev: 'INF', t: 'osd.' + o.id + ' marked itself down and dead' }, { min, sev: 'WRN', t: 'Health check failed: 1 osds down (OSD_DOWN)' });
  },
  pendientes(st, a) {
    const c = st.ceph, o = c.osds[a.osd];
    if (o.in) return [T('osd.' + o.id + ' sigue dentro (in) con el disco muerto: mientras esté in, Ceph no reconstruye sus réplicas en otro sitio', 'osd.' + o.id + ' is still in with a dead disk: while it is in, Ceph will not rebuild its replicas elsewhere')];
    return c.rec ? [T('Ceph aún está reconstruyendo las réplicas (ceph -s): deja pasar el tiempo con sleep', 'Ceph is still rebuilding the replicas (ceph -s): let time pass with sleep')] : [];
  },
  arreglo: a => ['ceph osd out ' + a.osd, 'sleep 600', 'ceph crash archive-all'],
});
def('flag-ceph', {
  titulo: T('Flag de mantenimiento olvidado', 'Forgotten maintenance flag'), orden: 1,
  descripcion: T('noout, norebalance… útiles durante un mantenimiento y dañinos después: impiden que Ceph reaccione por su cuenta.', 'noout, norebalance… useful during maintenance and harmful afterwards: they stop Ceph from reacting on its own.'),
  params: { flag: 'noout, norebalance, nobackfill…', hace: T('minutos', 'minutes ago'), efecto: T('qué provoca', 'what it causes') },
  ejemplo: { flag: 'noout', hace: 720 },
  validar: (st, a) => ['noout', 'norebalance', 'nobackfill', 'norecover', 'noscrub', 'nodeep-scrub'].indexOf(a.flag) < 0 ? T('flag desconocido «' + a.flag + '»', "unknown flag '" + a.flag + "'") : null,
  toca: a => ['flag:' + a.flag],
  aplicar(st, a) { st.ceph.flags[a.flag] = true; st.ceph.historial.push({ min: hace(a, 60), sev: 'WRN', t: 'Health check failed: ' + a.flag + ' flag(s) set (OSDMAP_FLAGS)' }); },
  pendientes: (st, a) => st.ceph.flags[a.flag] ? [T(a.flag + ' sigue puesto', a.flag + ' is still set') + efecto(a)] : [],
  arreglo: a => ['ceph osd unset ' + a.flag],
});
def('balancer-apagado', {
  titulo: T('Balancer apagado y un OSD sobrecargado', 'Balancer off and an overloaded OSD'), orden: 1,
  descripcion: T('Sin balancer, el reparto natural de CRUSH deja un OSD muy por encima de la media hasta pasar el umbral de casi lleno.', 'Without the balancer, the natural CRUSH distribution leaves one OSD far above the average, past the nearfull threshold.'),
  params: { osd: '0-8', exceso: T('puntos de uso de más (29.5 lo deja al 87 %)', 'extra usage points (29.5 leaves it at 87%)') },
  ejemplo: { osd: 7, exceso: 29.5 },
  validar: (st, a) => !(a.osd >= 0 && a.osd <= 8) ? T('osd tiene que ser de 0 a 8', 'osd must be between 0 and 8') : !(a.exceso > 0 && a.exceso < 35) ? T('exceso entre 0 y 35', 'exceso must be between 0 and 35') : null,
  toca: () => ['balancer'],
  aplicar(st, a) {
    const c = st.ceph; c.balancer.activo = false;
    c.osds.forEach(o => { o.sesgo = P.SESGO[o.id] + (o.id === a.osd ? a.exceso : -a.exceso / 8); });
    c.historial.push({ min: -10080, sev: 'INF', t: 'mgr.balancer: balancer is now off (by client.admin)' });
  },
  pendientes(st) {
    const c = st.ceph, p = [], usos = U.usos(st), max = Math.max(...c.osds.filter(o => o.in).map(o => usos[o.id]));
    if (c.nearfull > 0.85) p.push(T('nearfull_ratio está en ' + c.nearfull + ': has movido el umbral, no los datos. Déjalo en 0.85 (ceph osd set-nearfull-ratio 0.85)', 'nearfull_ratio is at ' + c.nearfull + ': you moved the threshold, not the data. Set it back to 0.85 (ceph osd set-nearfull-ratio 0.85)'));
    if (max >= 85) { const id = c.osds.find(o => usos[o.id] === max).id; p.push(T('osd.' + id + ' sigue al ' + max.toFixed(1) + ' % (ceph osd df)', 'osd.' + id + ' is still at ' + max.toFixed(1) + '% (ceph osd df)')); }
    return p;
  },
  arreglo: () => ['ceph balancer on', 'sleep 420'],
});

// ------------------------------------------------------------------ OpenStack
def('certificado-caducado', {
  titulo: T('Certificado de la API caducado', 'Expired API certificate'), orden: 3,
  descripcion: T('El certificado TLS de api.retail.local caduca en los tres controladores: todos los clientes empiezan a rechazar la API a la vez.', 'The TLS certificate for api.retail.local expires on all three controllers: every client starts rejecting the API at once.'),
  params: { hace: T('minutos desde que caducó', 'minutes since it expired') },
  ejemplo: { hace: 52 },
  toca: () => ['cert:api'],
  aplicar(st, a) { CTLS.forEach(n => { st.hosts[n].extra.cert = { fichero: hace(a, 1), cargado: hace(a, 1) }; }); },
  pendientes(st) {
    const p = [];
    CTLS.forEach(n => {
      const c = st.hosts[n].extra.cert;
      if (c.fichero <= st.reloj) p.push(T(n + ': el certificado en disco sigue caducado', n + ': the certificate on disk is still expired'));
      else if (c.cargado <= st.reloj) p.push(T(n + ': el certificado nuevo está en disco, pero HAProxy sigue sirviendo el viejo (hay que recargarlo)', n + ': the new certificate is on disk, but HAProxy is still serving the old one (it needs a reload)'));
    });
    return p;
  },
  arreglo: () => ['cd ~/infra', 'ansible-playbook playbooks/certs.yml', 'cd'],
});
def('fuga-memoria', {
  titulo: T('Fuga de memoria en nova-api', 'Memory leak in nova-api'), orden: 3,
  descripcion: T('nova 29.2.0 pierde memoria con cada petición. Reiniciar la devuelve; sólo el parche 29.2.1, instalado y cargado, la corrige.', 'nova 29.2.0 leaks memory on every request. A restart gets it back; only the 29.2.1 patch, installed and loaded, fixes it.'),
  params: { memoria: T('{ ctl01: GB, ctl02: GB, ctl03: GB } ya perdidos', '{ ctl01: GB, ctl02: GB, ctl03: GB } already leaked') },
  ejemplo: { memoria: { ctl01: 31, ctl02: 22, ctl03: 61 } },
  validar: (st, a) => !a.memoria || Object.keys(a.memoria).some(n => CTLS.indexOf(n) < 0) ? T('memoria tiene que ser { ctl01: GB, ... }', 'memoria must be { ctl01: GB, ... }') : null,
  toca: () => ['nova-version'],
  aplicar(st, a) { CTLS.forEach(n => { const h = st.hosts[n]; h.extra.novaInstalada = '29.2.0'; h.extra.novaCargada = '29.2.0'; h.extra.novaMem = a.memoria[n] != null ? a.memoria[n] : 1.2; }); },
  pendientes(st) {
    const p = [];
    CTLS.forEach(n => {
      const h = st.hosts[n], pct = Math.round(U.ramUsada(st, h) / U.ramTotal(h) * 100);
      if (h.extra.novaInstalada === '29.2.0') p.push(T(n + ' sigue con nova 29.2.0: la fuga seguirá aunque reinicies', n + ' is still on nova 29.2.0: the leak will continue even if you restart'));
      else if (h.extra.novaCargada !== h.extra.novaInstalada) p.push(T(n + ': la 29.2.1 está instalada, pero nova-api sigue corriendo el código viejo (hay que reiniciarlo)', n + ': 29.2.1 is installed, but nova-api is still running the old code (it needs a restart)'));
      if (pct >= 80) p.push(T(n + ' sigue al ' + pct + ' % de memoria', n + ' is still at ' + pct + '% memory'));
    });
    return p;
  },
  arreglo: () => ['cd ~/infra', 'ansible-playbook playbooks/nova-patch.yml', 'cd'],
});
def('regla-a-mano', {
  titulo: T('Puerto abierto a mano, fuera de Terraform', 'Port opened by hand, outside Terraform'), orden: 3,
  descripcion: T('Alguien borra desde Horizon la regla de SSH gestionada por Terraform y abre el 22 a todo internet. Terraform ve la que falta, no la que sobra.', 'Someone deletes the Terraform-managed SSH rule from Horizon and opens port 22 to the whole internet. Terraform sees the missing rule, not the extra one.'),
  params: {},
  ejemplo: {},
  toca: () => ['sg:sg-pos-backend'],
  aplicar(st) {
    const sg = st.os.sgs['sg-pos-backend'];
    sg.reglas = sg.reglas.filter(r => r.tf !== 'ssh_admin');
    sg.reglas.push({ id: U.uuid('manual-ssh-world'), dir: 'ingress', eth: 'IPv4', proto: 'tcp', puerto: 22, remoto: '0.0.0.0/0' });
  },
  pendientes(st) {
    const sg = st.os.sgs['sg-pos-backend'], p = [];
    if (sg.reglas.some(r => r.dir === 'ingress' && r.puerto === 22 && r.remoto === '0.0.0.0/0')) p.push(T('El puerto 22 de sg-pos-backend sigue abierto a 0.0.0.0/0 (openstack security group rule list sg-pos-backend)', 'Port 22 on sg-pos-backend is still open to 0.0.0.0/0 (openstack security group rule list sg-pos-backend)'));
    if (P.planTf(st).length) p.push(sg.reglas.some(r => r.puerto === 22 && r.remoto === '10.20.0.0/16') ? T('La regla de SSH desde 10.20.0.0/16 existe, pero creada a mano: Terraform no la conoce y terraform plan sigue queriendo crearla', 'The SSH rule from 10.20.0.0/16 exists, but it was created by hand: Terraform does not know it and terraform plan still wants to create it') : T('Falta la regla de SSH de administración (10.20.0.0/16): terraform plan la echa en falta', 'The admin SSH rule (10.20.0.0/16) is missing: terraform plan reports it'));
    return p;
  },
  arreglo: () => ['source ~/admin-openrc', 'cd ~/infra/terraform', 'terraform apply -auto-approve', 'openstack security group rule delete ' + U.uuid('manual-ssh-world'), 'cd'],
});
def('volumen-atascado', {
  titulo: T('Volumen atascado en «deleting»', "Volume stuck in 'deleting'"), orden: 3,
  descripcion: T('Un borrado que se quedó a medias. Si además el cinder-volume que lo gestiona está caído, nadie puede terminarlo.', 'A deletion left half done. If the cinder-volume that manages it is also down, nobody can finish it.'),
  params: { nombre: T('nombre del volumen', 'volume name'), proyecto: T('proyecto', 'project'), gb: T('tamaño', 'size'), nodo: T('controlador cuyo cinder-volume lo gestiona', 'controller whose cinder-volume manages it'), hace: T('minutos', 'minutes ago') },
  ejemplo: { nombre: 'pedidos-db-old', proyecto: 'tienda-online', gb: 400, nodo: 'ctl02', hace: 1080 },
  validar: (st, a) => CTLS.indexOf(a.nodo) < 0 ? T('nodo tiene que ser un controlador', 'the node must be a controller') : !st.os.proyectos[a.proyecto] ? T('no existe el proyecto «' + a.proyecto + '»', "project '" + a.proyecto + "' does not exist") : st.os.volumenes.some(v => v.nombre === a.nombre) ? T('ya existe un volumen «' + a.nombre + '»', "a volume '" + a.nombre + "' already exists") : null,
  toca: a => ['vol:' + a.nombre],
  aplicar(st, a) { st.os.volumenes.push({ id: U.uuid('vol' + a.nombre), nombre: a.nombre, proyecto: a.proyecto, gb: a.gb, estado: 'deleting', servidor: null, host: a.nodo, desde: hace(a, 60) }); },
  pendientes(st, a) { const v = st.os.volumenes.find(x => x.nombre === a.nombre); return v ? [T(a.nombre + ' sigue existiendo, en estado ' + v.estado, a.nombre + ' still exists, in state ' + v.estado)] : []; },
  arreglo: a => ['source ~/admin-openrc', 'openstack volume set --state error ' + a.nombre, 'openstack volume delete ' + a.nombre, 'sleep 60'],
});
def('vm-borrada', {
  titulo: T('VM de producción borrada por error', 'Production VM deleted by mistake'), orden: 3,
  descripcion: T('La VM desaparece; queda su copia nocturna como imagen. Hay que restaurarla igual que era: mismo flavor, misma red y en su proyecto.', 'The VM is gone; its nightly backup remains as an image. It must be restored exactly as it was: same flavor, same network and in its own project.'),
  params: { vm: T('nombre de una VM con copia nocturna', 'name of a VM with a nightly backup') },
  ejemplo: { vm: 'redis-carrito-02' },
  validar: (st, a) => !st.os.imagenesExtra.some(i => i.nombre === 'backup-' + a.vm + '-20260923') ? T(a.vm + ' no tiene copia nocturna (sólo las VMs de datos la tienen)', a.vm + ' has no nightly backup (only data VMs have one)') : null,
  toca: a => ['vm:' + a.vm],
  aplicar(st, a) { st.os.servidores = st.os.servidores.filter(s => s.nombre !== a.vm); },
  pendientes(st, a) {
    const img = st.os.imagenesExtra.find(i => i.nombre === 'backup-' + a.vm + '-20260923');
    const vs = st.os.servidores.filter(s => s.nombre === a.vm);
    if (!vs.length) return [T(a.vm + ' no existe todavía', a.vm + ' does not exist yet')];
    const buena = vs.find(s => s.proyecto === img.proyecto && s.imagen === img.nombre && s.flavor === img.flavor && s.red === img.red);
    const p = [];
    if (!buena) {
      const s = vs[vs.length - 1];
      if (s.proyecto !== img.proyecto) p.push(T(a.vm + ' está en el proyecto ' + s.proyecto + ': el equipo de ' + img.proyecto + ' no la ve (openstack --os-project-name ' + img.proyecto + ' ...)', a.vm + ' is in project ' + s.proyecto + ': the ' + img.proyecto + ' team cannot see it (openstack --os-project-name ' + img.proyecto + ' ...)'));
      if (s.imagen !== img.nombre) p.push(T(a.vm + ' ha arrancado desde ' + s.imagen + ', no desde la copia de esta noche: sus datos no están', a.vm + ' booted from ' + s.imagen + ', not from last night\'s backup: its data is missing'));
      if (s.flavor !== img.flavor) p.push(T(a.vm + ' tiene el flavor ' + s.flavor + '; la original era ' + img.flavor, a.vm + ' has flavor ' + s.flavor + '; the original was ' + img.flavor));
      if (s.red !== img.red) p.push(T(a.vm + ' está en la red ' + s.red + '; la original estaba en ' + img.red, a.vm + ' is on network ' + s.red + '; the original was on ' + img.red));
      return p;
    }
    if (buena.estado !== 'ACTIVE') p.push(T(a.vm + ' aún no está ACTIVE (' + buena.estado + '): openstack server show ' + a.vm, a.vm + ' is not ACTIVE yet (' + buena.estado + '): openstack server show ' + a.vm));
    vs.filter(s => s !== buena).forEach(s => p.push(T('Sobra una ' + a.vm + ' de un intento anterior en el proyecto ' + s.proyecto + ': bórrala (openstack server delete ' + s.id + ')', 'There is a leftover ' + a.vm + ' from an earlier attempt in project ' + s.proyecto + ': delete it (openstack server delete ' + s.id + ')')));
    return p;
  },
  arreglo: (a, st) => {
    const img = st.os.imagenesExtra.find(i => i.nombre === 'backup-' + a.vm + '-20260923');
    return ['source ~/admin-openrc', 'openstack --os-project-name ' + img.proyecto + ' server create --flavor ' + img.flavor + ' --image ' + img.nombre + ' --network ' + img.red + ' ' + a.vm, 'sleep 60'];
  },
});

// ------------------------------------------------------------------ condiciones
def('uso-volumenes', {
  titulo: T('Proyecto cerca de su cuota de volúmenes', 'Project close to its volume quota'), condicion: true,
  params: { proyecto: T('proyecto', 'project'), gb: T('GB en uso', 'GB in use') },
  ejemplo: { proyecto: 'tienda-online', gb: 950 },
  validar: (st, a) => !st.os.proyectos[a.proyecto] ? T('no existe el proyecto «' + a.proyecto + '»', "project '" + a.proyecto + "' does not exist") : null,
  toca: a => ['uso:' + a.proyecto],
  aplicar(st, a) { st.os.proyectos[a.proyecto].vol.gigabytes = a.gb; },
});
def('hipervisores-llenos', {
  titulo: T('Hipervisores casi sin RAM', 'Hypervisors almost out of RAM'), condicion: true,
  params: { nodos: T('[hipervisores]', '[hypervisors]'), proyecto: T('proyecto de las VMs de relleno', 'project for the filler VMs') },
  ejemplo: { nodos: ['cmp01', 'cmp03'], proyecto: 'analitica' },
  validar: (st, a) => (a.nodos || []).some(n => ['cmp01', 'cmp02', 'cmp03'].indexOf(n) < 0) ? T('nodos tiene que ser una lista de cmp01..cmp03', 'the nodes must be a list of cmp01..cmp03') : null,
  toca: a => (a.nodos || []).map(n => 'ram:' + n),
  aplicar(st, a) {
    let n = 1;
    const meter = (h, fl) => { st.os.servidores.push(st.os.nuevaVm('etl-batch-' + String(n++).padStart(2, '0'), a.proyecto || 'analitica', fl, h, 'retail-net', 'ACTIVE', -600)); };
    a.nodos.forEach(h => {
      while (P.ramLibreHost(st, h) - 32768 >= 8192) meter(h, 'm1.2xlarge');
      while (P.ramLibreHost(st, h) >= 16384) meter(h, 'm1.large');
    });
  },
});
def('vms-en-error', {
  titulo: T('VMs que fallaron al crearse', 'VMs that failed to create'), condicion: true,
  params: { nombres: T('[nombres]', '[names]'), proyecto: T('proyecto', 'project'), flavor: 'flavor', hace: T('minutos', 'minutes ago') },
  ejemplo: { nombres: ['pedidos-api-v2-01'], proyecto: 'tienda-online', flavor: 'm1.xlarge', hace: 15 },
  toca: a => (a.nombres || []).map(n => 'vm:' + n),
  aplicar(st, a) {
    a.nombres.forEach((nm, i) => {
      const min = hace(a) + i;
      const vm = st.os.nuevaVm(nm, a.proyecto, a.flavor, null, 'retail-net', 'ERROR', min);
      vm.fault = { code: 500, created: U.iso(min) + 'Z', message: 'No valid host was found. There are not enough hosts available.' };
      st.os.servidores.push(vm);
      st.os.logSched.push({ min, t: U.iso(min).replace('T', ' ') + '.212 ' + U.pid('sched') + ' INFO nova.scheduler.manager [None req-' + U.uuid('nv' + i) + ' pipeline ' + a.proyecto + '] Got no allocation candidates from the Placement API. This could be due to insufficient resources or a temporary occurrence as compute nodes start up.' });
    });
  },
});
def('kernel-disponible', {
  titulo: T('Parche de kernel publicado', 'Kernel patch released'), condicion: true,
  params: { version: T('versión del kernel', 'kernel version') },
  ejemplo: { version: '5.15.0-122-generic' },
  toca: () => ['kernel'],
  aplicar(st, a) { Object.values(st.hosts).forEach(h => { h.kernelDisponible = a.version; }); },
});
def('vm-programada', {
  titulo: T('Un pipeline creará una VM', 'A pipeline will create a VM'), condicion: true,
  descripcion: T('A los N minutos, una VM nueva entra al scheduler, que la pone donde haya más hueco.', 'After N minutes, a new VM reaches the scheduler, which places it wherever there is most room.'),
  params: { en: T('minuto', 'minute'), nombre: T('nombre', 'name'), proyecto: T('proyecto', 'project'), flavor: 'flavor' },
  ejemplo: { en: 6, nombre: 'ci-runner-17', proyecto: 'analitica', flavor: 'm1.large' },
  toca: a => ['vm:' + a.nombre],
  aplicar(st, a) {
    st.programados = (st.programados || []).concat([{ min: a.en, fn: s2 => { const vm = s2.os.nuevaVm(a.nombre, a.proyecto, a.flavor, null, 'retail-net', 'BUILD', s2.reloj); s2.os.servidores.push(vm); P.programar(s2, vm); } }]);
  },
});
def('registro-ceph', {
  titulo: T('Líneas de contexto en el log del clúster', 'Context lines in the cluster log'), condicion: true,
  params: { lineas: '[{ hace, sev, t }]' },
  ejemplo: { lineas: [{ hace: 7, sev: 'DBG', t: '2.7f deep-scrub starts' }] },
  aplicar(st, a) { (a.lineas || []).forEach(l => st.ceph.historial.push({ min: -l.hace, sev: l.sev || 'INF', t: l.t })); },
});

// ------------------------------------------------------------------ campos
// Qué tipo de campo es cada parámetro, para el compositor (compositor.js).
// `params` explica en palabras; `campos` dice cómo se edita. puesto-test.js
// exige que cubran lo mismo: un parámetro sin campo no se podría componer.
const campoHace = { k: 'hace', t: 'num', min: 0, max: 10080, def: 30, etiqueta: T('hace (min)', 'minutes ago') };
const efectoC = { k: 'efecto', t: 'texto', opcional: true, etiqueta: T('efecto (para el aviso)', 'effect (for the warning)') };
P.camposAveria = {
  'servicio-caido': [{ k: 'nodo', t: 'nodo' }, { k: 'servicio', t: 'servicio' }, { k: 'motivo', t: 'motivo', opcional: true }, campoHace, { k: 'crashes', t: 'minutos', opcional: true, etiqueta: T('crashes (min, sólo Ceph)', 'crashes (min, Ceph only)') }, efectoC],
  'servicio-parado': [{ k: 'nodo', t: 'nodo' }, { k: 'servicio', t: 'servicio' }, campoHace, { k: 'deshabilitado', t: 'bool', etiqueta: T('además, deshabilitado', 'also disabled') }, { k: 'exigirHabilitado', t: 'bool', opcional: true, etiqueta: T('exigir que quede habilitado', 'require it to be left enabled') }, efectoC],
  'disco-lleno': [{ k: 'nodo', t: 'nodo' }, { k: 'fichero', t: 'fichero' }, { k: 'mb', t: 'num', min: 1, max: 60000, def: 31000, etiqueta: T('tamaño (MB)', 'size (MB)') }],
  'rabbit-debug': [{ k: 'nodo', t: 'nodo', roles: ['ctl'] }],
  'config-ceph': [{ k: 'quien', t: 'opciones', opciones: ['mon', 'osd', 'mgr'], def: 'mon' }, { k: 'opcion', t: 'texto', def: 'debug_mon' }, { k: 'valor', t: 'texto', def: '20/20' }, Object.assign({}, campoHace, { def: 10080 }), efectoC],
  'reloj-desfasado': [{ k: 'nodo', t: 'nodo' }, { k: 'segundos', t: 'num', min: 0.06, max: 5, paso: 0.001, def: 0.5, etiqueta: T('desfase (s)', 'offset (s)') }, Object.assign({}, campoHace, { def: 300 })],
  'disco-muerto': [{ k: 'osd', t: 'osd' }, campoHace],
  'flag-ceph': [{ k: 'flag', t: 'opciones', opciones: ['noout', 'norebalance', 'nobackfill', 'norecover', 'noscrub', 'nodeep-scrub'], def: 'noout' }, Object.assign({}, campoHace, { def: 720 }), efectoC],
  'balancer-apagado': [{ k: 'osd', t: 'osd' }, { k: 'exceso', t: 'num', min: 1, max: 34, paso: 0.5, def: 29.5, etiqueta: T('exceso (puntos de uso)', 'excess (usage points)') }],
  'certificado-caducado': [campoHace],
  'fuga-memoria': [{ k: 'memoria', t: 'memoria', etiqueta: T('memoria ya perdida (GB)', 'memory already leaked (GB)') }],
  'regla-a-mano': [],
  'volumen-atascado': [{ k: 'nombre', t: 'texto', def: 'vol-viejo' }, { k: 'proyecto', t: 'proyecto' }, { k: 'gb', t: 'num', min: 1, max: 2000, def: 200, etiqueta: T('tamaño (GB)', 'size (GB)') }, { k: 'nodo', t: 'nodo', roles: ['ctl'], etiqueta: T('cinder-volume de', 'cinder-volume on') }, Object.assign({}, campoHace, { def: 600 })],
  'vm-borrada': [{ k: 'vm', t: 'vm' }],
  'uso-volumenes': [{ k: 'proyecto', t: 'proyecto' }, { k: 'gb', t: 'num', min: 0, max: 5000, def: 950, etiqueta: T('GB en uso', 'GB in use') }],
  'hipervisores-llenos': [{ k: 'nodos', t: 'nodos', roles: ['cmp'] }, { k: 'proyecto', t: 'proyecto', def: 'analitica' }],
  'vms-en-error': [{ k: 'nombres', t: 'lista', def: ['app-v2-01'], etiqueta: T('nombres (separados por comas)', 'names (comma-separated)') }, { k: 'proyecto', t: 'proyecto' }, { k: 'flavor', t: 'flavor', def: 'm1.xlarge' }, Object.assign({}, campoHace, { def: 15 })],
  'kernel-disponible': [{ k: 'version', t: 'texto', def: '5.15.0-122-generic' }],
  'vm-programada': [{ k: 'en', t: 'num', min: 1, max: 120, def: 6, etiqueta: T('en el minuto', 'at minute') }, { k: 'nombre', t: 'texto', def: 'ci-runner-17' }, { k: 'proyecto', t: 'proyecto', def: 'analitica' }, { k: 'flavor', t: 'flavor', def: 'm1.large' }],
  'registro-ceph': [{ k: 'lineas', t: 'lineas', etiqueta: T('líneas del log de Ceph (una por línea: minutos | texto)', 'Ceph log lines (one per line: minutes | text)') }],
};

// ------------------------------------------------------------------ incidencias
P.aplicarAverias = (st, lista) => (lista || []).forEach(a => P.averias[a.tipo].aplicar(st, a));
// soloPractica: la avería se aplica y tiene arreglo, pero no bloquea el cierre
// (arreglarla cuenta como buena práctica, no como requisito).
// Nada puede quedar en failed sin explicación, aunque ninguna avería lo
// nombre: es lo que atrapa los efectos en cadena. Un OSD fuera del clúster con
// el disco muerto sí está explicado: espera a que hardware cambie el disco.
P.pendientesUnidades = st => {
  const p = [];
  Object.values(st.hosts).forEach(h => {
    if (!h.up) return;
    Object.keys(h.svcs).forEach(u => {
      if (h.svcs[u].estado !== 'failed') return;
      const osd = /^ceph-osd@(\d+)$/.exec(u);
      if (osd && !st.ceph.osds[+osd[1]].in && st.ceph.osds[+osd[1]].disco !== 'ok') return;
      p.push(T(u + ' sigue en failed en ' + h.nombre + ' (systemctl --failed)', u + ' is still failed on ' + h.nombre + ' (systemctl --failed)'));
    });
  });
  return p;
};
P.pendientesAverias = (st, lista) => [].concat(...(lista || []).filter(a => !a.soloPractica).map(a => P.averias[a.tipo].pendientes(st, a)));
// La solución de referencia de una incidencia compuesta: los arreglos de sus
// averías, de abajo arriba.
P.arregloAverias = (st, lista) => (lista || []).map((a, i) => ({ a, i, o: P.averias[a.tipo].orden }))
  .sort((x, y) => x.o - y.o || x.i - y.i)
  .reduce((out, x) => out.concat(P.averias[x.a.tipo].arreglo(x.a, st)), []);
// Antes de aceptar una incidencia: tipos que existen, parámetros con sentido
// y dos averías que no toquen lo mismo (parar y tumbar la misma unidad, por ejemplo).
P.validarAverias = lista => {
  const st = P.crear(), errores = [], toques = {};
  if (!Array.isArray(lista) || !lista.length) return [T('una incidencia necesita al menos una avería', 'an incident needs at least one fault')];
  lista.forEach((a, i) => {
    const t = a && P.averias[a.tipo], n = T('avería ', 'fault ') + (i + 1);
    if (!t) { errores.push(n + T(': tipo desconocido «' + (a && a.tipo) + '»', ": unknown type '" + (a && a.tipo) + "'")); return; }
    // Lo que no tiene valor por defecto ni es opcional, tiene que venir (el esquema es el de P.camposAveria).
    const falta = (P.camposAveria[a.tipo] || []).filter(c => !c.opcional && c.def == null && c.t !== 'bool' && (a[c.k] == null || a[c.k] === '' || (Array.isArray(a[c.k]) && !a[c.k].length))).map(c => c.k);
    if (falta.length) { errores.push(n + ' (' + a.tipo + '): ' + T('falta ', 'missing ') + falta.join(', ')); return; }
    const e = t.validar && t.validar(st, a);
    if (e) errores.push(n + ' (' + a.tipo + '): ' + e);
    t.toca(a).forEach(k => { if (toques[k] != null) errores.push(T('las averías ' + (toques[k] + 1) + ' y ' + (i + 1) + ' tocan lo mismo (' + k + ')', 'faults ' + (toques[k] + 1) + ' and ' + (i + 1) + ' touch the same thing (' + k + ')')); else toques[k] = i; });
  });
  return errores;
};

})(window.PUESTO = window.PUESTO || {});
