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
const U = P.u;
P.averias = {};

// orden: en qué fase se arregla al encadenar varias. Lo de abajo primero
// (servicios base, discos, flags), luego lo que depende de ello, al final los
// recursos. Así libvirtd se levanta antes que nova-compute.
const def = (id, o) => { P.averias[id] = Object.assign({ id, orden: 1, condicion: false, params: {}, toca: () => [], pendientes: () => [], arreglo: () => [] }, o); };
const hace = (a, d) => -(a.hace != null ? a.hace : (d || 0));
const svc = (st, a) => st.hosts[a.nodo] && st.hosts[a.nodo].svcs[a.servicio];
const valNodo = (st, a) => !st.hosts[a.nodo] ? 'no existe el nodo «' + a.nodo + '»' : null;
const valSvc = (st, a) => valNodo(st, a) || (!svc(st, a) ? a.nodo + ' no tiene el servicio «' + a.servicio + '»' : null);
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
  titulo: 'Servicio caído', orden: 2,
  descripcion: 'Una unidad de systemd en failed, con el rastro de por qué en el journal. Con crashes, además, el aviso RECENT_CRASH de Ceph.',
  params: { nodo: 'nodo', servicio: 'unidad de systemd', motivo: 'por qué cayó (oom, sin-espacio, osd-suicidio, mon-abort…)', hace: 'minutos', crashes: '[minutos] (sólo Ceph)', efecto: 'qué provoca, para el aviso', nota: '{hace, src, t}' },
  ejemplo: { nodo: 'ceph02', servicio: 'ceph-osd@4', motivo: 'osd-suicidio', hace: 3, crashes: [6, 5, 3] },
  validar: (st, a) => valSvc(st, a) || (a.motivo && !P.motivos[a.motivo] ? 'motivo desconocido «' + a.motivo + '»' : null),
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
      if (!U.osdUp(st, o)) return ['osd.' + o.id + ' sigue down (ceph osd tree)' + efecto(a)];
      return o.in ? [] : ['osd.' + o.id + ' está up pero fuera del clúster (out): no guarda datos. ceph osd in ' + o.id];
    }
    const h = st.hosts[a.nodo];
    if (a.servicio === 'mariadb' && h.extra.splitBrain) return [a.nodo + ' ha formado un clúster Galera propio de 1 nodo (split-brain): dos bases de datos que ya no se hablan'];
    return h.svcs[a.servicio].estado === 'active' ? [] : [nombre(a) + ' sigue caído en ' + a.nodo + efecto(a)];
  },
  arreglo: (a, st) => ['ssh ' + a.nodo, 'sudo systemctl reset-failed ' + a.servicio, 'sudo systemctl start ' + a.servicio]
    .concat(dependientes(st, a).map(d => 'sudo systemctl restart ' + d), ['exit'], /^ceph-/.test(a.servicio) ? ['sleep 60'] : [], a.crashes && a.crashes.length ? ['ceph crash archive-all'] : []),
});
def('servicio-parado', {
  titulo: 'Servicio parado (y quizá deshabilitado)', orden: 1,
  descripcion: 'Alguien lo paró, o un paquete al actualizarse, y nadie lo volvió a arrancar. Deshabilitado, además, no vuelve solo tras un reinicio.',
  params: { nodo: 'nodo', servicio: 'unidad de systemd', hace: 'minutos', deshabilitado: 'true / false', exigirHabilitado: 'si hace falta dejarlo habilitado (por defecto, sí cuando está deshabilitado)', efecto: 'qué provoca', nota: '{hace, src, t}' },
  ejemplo: { nodo: 'cmp02', servicio: 'libvirtd', hace: 840, deshabilitado: true },
  validar: valSvc,
  toca: a => ['svc:' + a.nodo + ':' + a.servicio],
  aplicar(st, a) { nota(st, a); P.parado(st, a.nodo, a.servicio, hace(a, 60), !!a.deshabilitado); cascada(st, a, hace(a, 60) + 1); },
  pendientes(st, a) {
    const s = svc(st, a);
    if (s.estado !== 'active') return [nombre(a) + ' sigue parado en ' + a.nodo + efecto(a)];
    const exigir = a.exigirHabilitado != null ? a.exigirHabilitado : !!a.deshabilitado;
    return exigir && !s.enabled ? [nombre(a) + ' está arrancado pero deshabilitado en ' + a.nodo + ': volverá a caer en el próximo reinicio'] : [];
  },
  arreglo: (a, st) => ['ssh ' + a.nodo, 'sudo systemctl enable --now ' + a.servicio].concat(dependientes(st, a).map(d => 'sudo systemctl restart ' + d), ['exit']),
});

// ------------------------------------------------------------------ discos y logs
def('disco-lleno', {
  titulo: 'Un fichero llena un disco', orden: 1,
  descripcion: 'Un log (o cualquier fichero) crece hasta llenar su sistema de ficheros. Los servicios que escriben ahí dejan de poder arrancar.',
  params: { nodo: 'nodo', fichero: 'ruta', mb: 'tamaño en MB' },
  ejemplo: { nodo: 'ctl02', fichero: '/var/log/rabbitmq/rabbit@ctl02.log', mb: 31000 },
  validar: (st, a) => valNodo(st, a) || (!/^\/var\/log\//.test(a.fichero || '') ? 'el fichero tiene que estar en /var/log (es lo único que se puede borrar)' : !(a.mb > 0) ? 'mb tiene que ser un número' : null),
  toca: a => ['fichero:' + a.nodo + ':' + a.fichero],
  aplicar(st, a) { st.hosts[a.nodo].logs[a.fichero] = a.mb; },
  pendientes(st, a) { const h = st.hosts[a.nodo], m = U.montaje(h, a.fichero), p = U.pctDisco(h, m); return p >= 85 ? [m + ' de ' + a.nodo + ' sigue al ' + p + ' %'] : []; },
  arreglo: a => ['ssh ' + a.nodo, 'sudo truncate -s 0 ' + a.fichero, 'exit'],
});
def('rabbit-debug', {
  titulo: 'RabbitMQ en nivel debug', orden: 1,
  descripcion: 'Su log crece unos 150 MB por minuto mientras RabbitMQ corre: tarde o temprano llena /var. Se corrige con el playbook logrotate.yml.',
  params: { nodo: 'controlador' },
  ejemplo: { nodo: 'ctl02' },
  validar: (st, a) => CTLS.indexOf(a.nodo) < 0 ? 'RabbitMQ sólo vive en los controladores' : null,
  toca: a => ['debug:' + a.nodo],
  aplicar(st, a) { st.hosts[a.nodo].extra.rabbitDebug = true; },
  pendientes: (st, a) => st.hosts[a.nodo].extra.rabbitDebug ? ['RabbitMQ de ' + a.nodo + ' sigue en nivel debug: su log volverá a llenar /var'] : [],
  arreglo: a => ['cd ~/infra', 'ansible-playbook playbooks/logrotate.yml -l ' + a.nodo, 'cd'],
});
def('config-ceph', {
  titulo: 'Opción de Ceph mal puesta', orden: 1,
  descripcion: 'Un ceph config set olvidado. Afecta a todos los demonios del tipo a la vez; con debug_mon en 20/20, los tres monitores empiezan a llenar su disco.',
  params: { quien: 'mon, osd…', opcion: 'nombre de la opción', valor: 'valor', hace: 'minutos', efecto: 'qué provoca' },
  ejemplo: { quien: 'mon', opcion: 'debug_mon', valor: '20/20' },
  validar: (st, a) => !a.quien || !a.opcion || a.valor == null ? 'faltan quien, opcion o valor' : null,
  toca: a => ['cephcfg:' + a.quien + '/' + a.opcion],
  aplicar(st, a) {
    st.ceph.config[a.quien + '/' + a.opcion] = a.valor;
    st.ceph.historial.push({ min: hace(a, 10080), sev: 'INF', t: 'from=\'client.admin\' cmd=[{"prefix": "config set", "who": "' + a.quien + '", "name": "' + a.opcion + '", "value": "' + a.valor + '"}]: finished' });
  },
  pendientes: (st, a) => st.ceph.config[a.quien + '/' + a.opcion] === a.valor ? [a.opcion + ' sigue en ' + a.valor + ' para ' + a.quien + efecto(a)] : [],
  arreglo: a => ['ceph config rm ' + a.quien + ' ' + a.opcion],
});

// ------------------------------------------------------------------ tiempo
def('reloj-desfasado', {
  titulo: 'Reloj desfasado', orden: 1,
  descripcion: 'chrony parado y deshabilitado: la hora deriva. En un nodo Ceph, el monitor lo detecta (MON_CLOCK_SKEW); en los demás, sólo Prometheus.',
  params: { nodo: 'nodo', segundos: 'desfase en segundos', hace: 'minutos' },
  ejemplo: { nodo: 'ceph03', segundos: 0.912, hace: 300 },
  validar: (st, a) => valNodo(st, a) || (!(a.segundos > 0.05) ? 'el desfase tiene que superar 0.05 s para notarse' : null),
  toca: a => ['svc:' + a.nodo + ':chrony'],
  aplicar(st, a) { P.parado(st, a.nodo, 'chrony', hace(a, 60), true); const h = st.hosts[a.nodo]; h.ntp.sync = false; h.ntp.offset = a.segundos; h.ntp.deriva = 0.002; },
  pendientes(st, a) { const h = st.hosts[a.nodo]; return h.up && !U.ntpOk(h) ? [a.nodo + ': reloj sin sincronizar (' + Math.abs(h.ntp.offset).toFixed(3) + ' s de desfase, chrony ' + (h.svcs.chrony.estado === 'active' ? 'corrigiendo poco a poco' : 'parado') + ')'] : []; },
  arreglo: a => ['ssh ' + a.nodo, 'sudo systemctl enable --now chrony', 'sudo chronyc makestep', 'exit'],
});

// ------------------------------------------------------------------ Ceph
def('disco-muerto', {
  titulo: 'Disco de un OSD muerto', orden: 3,
  descripcion: 'El SSD falla: el OSD no arranca, SMART dice FAILED y dmesg se llena de errores de E/S. No se arregla reiniciando: se saca el OSD y se reconstruye.',
  params: { osd: '0-8', hace: 'minutos' },
  ejemplo: { osd: 7, hace: 95 },
  validar: (st, a) => !(a.osd >= 0 && a.osd <= 8) ? 'osd tiene que ser de 0 a 8' : null,
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
    if (o.in) return ['osd.' + o.id + ' sigue dentro (in) con el disco muerto: mientras esté in, Ceph no reconstruye sus réplicas en otro sitio'];
    return c.rec ? ['Ceph aún está reconstruyendo las réplicas (ceph -s): deja pasar el tiempo con sleep'] : [];
  },
  arreglo: a => ['ceph osd out ' + a.osd, 'sleep 600', 'ceph crash archive-all'],
});
def('flag-ceph', {
  titulo: 'Flag de mantenimiento olvidado', orden: 1,
  descripcion: 'noout, norebalance… útiles durante un mantenimiento y dañinos después: impiden que Ceph reaccione por su cuenta.',
  params: { flag: 'noout, norebalance, nobackfill…', hace: 'minutos', efecto: 'qué provoca' },
  ejemplo: { flag: 'noout', hace: 720 },
  validar: (st, a) => ['noout', 'norebalance', 'nobackfill', 'norecover', 'noscrub', 'nodeep-scrub'].indexOf(a.flag) < 0 ? 'flag desconocido «' + a.flag + '»' : null,
  toca: a => ['flag:' + a.flag],
  aplicar(st, a) { st.ceph.flags[a.flag] = true; st.ceph.historial.push({ min: hace(a, 60), sev: 'WRN', t: 'Health check failed: ' + a.flag + ' flag(s) set (OSDMAP_FLAGS)' }); },
  pendientes: (st, a) => st.ceph.flags[a.flag] ? [a.flag + ' sigue puesto' + efecto(a)] : [],
  arreglo: a => ['ceph osd unset ' + a.flag],
});
def('balancer-apagado', {
  titulo: 'Balancer apagado y un OSD sobrecargado', orden: 1,
  descripcion: 'Sin balancer, el reparto natural de CRUSH deja un OSD muy por encima de la media hasta pasar el umbral de casi lleno.',
  params: { osd: '0-8', exceso: 'puntos de uso de más (29.5 lo deja al 87 %)' },
  ejemplo: { osd: 7, exceso: 29.5 },
  validar: (st, a) => !(a.osd >= 0 && a.osd <= 8) ? 'osd tiene que ser de 0 a 8' : !(a.exceso > 0 && a.exceso < 35) ? 'exceso entre 0 y 35' : null,
  toca: () => ['balancer'],
  aplicar(st, a) {
    const c = st.ceph; c.balancer.activo = false;
    c.osds.forEach(o => { o.sesgo = P.SESGO[o.id] + (o.id === a.osd ? a.exceso : -a.exceso / 8); });
    c.historial.push({ min: -10080, sev: 'INF', t: 'mgr.balancer: balancer is now off (by client.admin)' });
  },
  pendientes(st) {
    const c = st.ceph, p = [], usos = U.usos(st), max = Math.max(...c.osds.filter(o => o.in).map(o => usos[o.id]));
    if (c.nearfull > 0.85) p.push('nearfull_ratio está en ' + c.nearfull + ': has movido el umbral, no los datos. Déjalo en 0.85 (ceph osd set-nearfull-ratio 0.85)');
    if (max >= 85) p.push('osd.' + c.osds.find(o => usos[o.id] === max).id + ' sigue al ' + max.toFixed(1) + ' % (ceph osd df)');
    return p;
  },
  arreglo: () => ['ceph balancer on', 'sleep 420'],
});

// ------------------------------------------------------------------ OpenStack
def('certificado-caducado', {
  titulo: 'Certificado de la API caducado', orden: 3,
  descripcion: 'El certificado TLS de api.retail.local caduca en los tres controladores: todos los clientes empiezan a rechazar la API a la vez.',
  params: { hace: 'minutos desde que caducó' },
  ejemplo: { hace: 52 },
  toca: () => ['cert:api'],
  aplicar(st, a) { CTLS.forEach(n => { st.hosts[n].extra.cert = { fichero: hace(a, 1), cargado: hace(a, 1) }; }); },
  pendientes(st) {
    const p = [];
    CTLS.forEach(n => {
      const c = st.hosts[n].extra.cert;
      if (c.fichero <= st.reloj) p.push(n + ': el certificado en disco sigue caducado');
      else if (c.cargado <= st.reloj) p.push(n + ': el certificado nuevo está en disco, pero HAProxy sigue sirviendo el viejo (hay que recargarlo)');
    });
    return p;
  },
  arreglo: () => ['cd ~/infra', 'ansible-playbook playbooks/certs.yml', 'cd'],
});
def('fuga-memoria', {
  titulo: 'Fuga de memoria en nova-api', orden: 3,
  descripcion: 'nova 29.2.0 pierde memoria con cada petición. Reiniciar la devuelve; sólo el parche 29.2.1, instalado y cargado, la corrige.',
  params: { memoria: '{ ctl01: GB, ctl02: GB, ctl03: GB } ya perdidos' },
  ejemplo: { memoria: { ctl01: 31, ctl02: 22, ctl03: 61 } },
  validar: (st, a) => !a.memoria || Object.keys(a.memoria).some(n => CTLS.indexOf(n) < 0) ? 'memoria tiene que ser { ctl01: GB, ... }' : null,
  toca: () => ['nova-version'],
  aplicar(st, a) { CTLS.forEach(n => { const h = st.hosts[n]; h.extra.novaInstalada = '29.2.0'; h.extra.novaCargada = '29.2.0'; h.extra.novaMem = a.memoria[n] != null ? a.memoria[n] : 1.2; }); },
  pendientes(st) {
    const p = [];
    CTLS.forEach(n => {
      const h = st.hosts[n], pct = Math.round(U.ramUsada(st, h) / U.ramTotal(h) * 100);
      if (h.extra.novaInstalada === '29.2.0') p.push(n + ' sigue con nova 29.2.0: la fuga seguirá aunque reinicies');
      else if (h.extra.novaCargada !== h.extra.novaInstalada) p.push(n + ': la 29.2.1 está instalada, pero nova-api sigue corriendo el código viejo (hay que reiniciarlo)');
      if (pct >= 80) p.push(n + ' sigue al ' + pct + ' % de memoria');
    });
    return p;
  },
  arreglo: () => ['cd ~/infra', 'ansible-playbook playbooks/nova-patch.yml', 'cd'],
});
def('regla-a-mano', {
  titulo: 'Puerto abierto a mano, fuera de Terraform', orden: 3,
  descripcion: 'Alguien borra desde Horizon la regla de SSH gestionada por Terraform y abre el 22 a todo internet. Terraform ve la que falta, no la que sobra.',
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
    if (sg.reglas.some(r => r.dir === 'ingress' && r.puerto === 22 && r.remoto === '0.0.0.0/0')) p.push('El puerto 22 de sg-pos-backend sigue abierto a 0.0.0.0/0 (openstack security group rule list sg-pos-backend)');
    if (P.planTf(st).length) p.push(sg.reglas.some(r => r.puerto === 22 && r.remoto === '10.20.0.0/16') ? 'La regla de SSH desde 10.20.0.0/16 existe, pero creada a mano: Terraform no la conoce y terraform plan sigue queriendo crearla' : 'Falta la regla de SSH de administración (10.20.0.0/16): terraform plan la echa en falta');
    return p;
  },
  arreglo: () => ['source ~/admin-openrc', 'cd ~/infra/terraform', 'terraform apply -auto-approve', 'openstack security group rule delete ' + U.uuid('manual-ssh-world'), 'cd'],
});
def('volumen-atascado', {
  titulo: 'Volumen atascado en «deleting»', orden: 3,
  descripcion: 'Un borrado que se quedó a medias. Si además el cinder-volume que lo gestiona está caído, nadie puede terminarlo.',
  params: { nombre: 'nombre del volumen', proyecto: 'proyecto', gb: 'tamaño', nodo: 'controlador cuyo cinder-volume lo gestiona', hace: 'minutos' },
  ejemplo: { nombre: 'pedidos-db-old', proyecto: 'tienda-online', gb: 400, nodo: 'ctl02', hace: 1080 },
  validar: (st, a) => CTLS.indexOf(a.nodo) < 0 ? 'nodo tiene que ser un controlador' : !st.os.proyectos[a.proyecto] ? 'no existe el proyecto «' + a.proyecto + '»' : st.os.volumenes.some(v => v.nombre === a.nombre) ? 'ya existe un volumen «' + a.nombre + '»' : null,
  toca: a => ['vol:' + a.nombre],
  aplicar(st, a) { st.os.volumenes.push({ id: U.uuid('vol' + a.nombre), nombre: a.nombre, proyecto: a.proyecto, gb: a.gb, estado: 'deleting', servidor: null, host: a.nodo, desde: hace(a, 60) }); },
  pendientes(st, a) { const v = st.os.volumenes.find(x => x.nombre === a.nombre); return v ? [a.nombre + ' sigue existiendo, en estado ' + v.estado] : []; },
  arreglo: a => ['source ~/admin-openrc', 'openstack volume set --state error ' + a.nombre, 'openstack volume delete ' + a.nombre, 'sleep 60'],
});
def('vm-borrada', {
  titulo: 'VM de producción borrada por error', orden: 3,
  descripcion: 'La VM desaparece; queda su copia nocturna como imagen. Hay que restaurarla igual que era: mismo flavor, misma red y en su proyecto.',
  params: { vm: 'nombre de una VM con copia nocturna' },
  ejemplo: { vm: 'redis-carrito-02' },
  validar: (st, a) => !st.os.imagenesExtra.some(i => i.nombre === 'backup-' + a.vm + '-20260923') ? a.vm + ' no tiene copia nocturna (sólo las VMs de datos la tienen)' : null,
  toca: a => ['vm:' + a.vm],
  aplicar(st, a) { st.os.servidores = st.os.servidores.filter(s => s.nombre !== a.vm); },
  pendientes(st, a) {
    const img = st.os.imagenesExtra.find(i => i.nombre === 'backup-' + a.vm + '-20260923');
    const vs = st.os.servidores.filter(s => s.nombre === a.vm);
    if (!vs.length) return [a.vm + ' no existe todavía'];
    const buena = vs.find(s => s.proyecto === img.proyecto && s.imagen === img.nombre && s.flavor === img.flavor && s.red === img.red);
    const p = [];
    if (!buena) {
      const s = vs[vs.length - 1];
      if (s.proyecto !== img.proyecto) p.push(a.vm + ' está en el proyecto ' + s.proyecto + ': el equipo de ' + img.proyecto + ' no la ve (openstack --os-project-name ' + img.proyecto + ' ...)');
      if (s.imagen !== img.nombre) p.push(a.vm + ' ha arrancado desde ' + s.imagen + ', no desde la copia de esta noche: sus datos no están');
      if (s.flavor !== img.flavor) p.push(a.vm + ' tiene el flavor ' + s.flavor + '; la original era ' + img.flavor);
      if (s.red !== img.red) p.push(a.vm + ' está en la red ' + s.red + '; la original estaba en ' + img.red);
      return p;
    }
    if (buena.estado !== 'ACTIVE') p.push(a.vm + ' aún no está ACTIVE (' + buena.estado + '): openstack server show ' + a.vm);
    vs.filter(s => s !== buena).forEach(s => p.push('Sobra una ' + a.vm + ' de un intento anterior en el proyecto ' + s.proyecto + ': bórrala (openstack server delete ' + s.id + ')'));
    return p;
  },
  arreglo: (a, st) => {
    const img = st.os.imagenesExtra.find(i => i.nombre === 'backup-' + a.vm + '-20260923');
    return ['source ~/admin-openrc', 'openstack --os-project-name ' + img.proyecto + ' server create --flavor ' + img.flavor + ' --image ' + img.nombre + ' --network ' + img.red + ' ' + a.vm, 'sleep 60'];
  },
});

// ------------------------------------------------------------------ condiciones
def('uso-volumenes', {
  titulo: 'Proyecto cerca de su cuota de volúmenes', condicion: true,
  params: { proyecto: 'proyecto', gb: 'GB en uso' },
  ejemplo: { proyecto: 'tienda-online', gb: 950 },
  validar: (st, a) => !st.os.proyectos[a.proyecto] ? 'no existe el proyecto «' + a.proyecto + '»' : null,
  toca: a => ['uso:' + a.proyecto],
  aplicar(st, a) { st.os.proyectos[a.proyecto].vol.gigabytes = a.gb; },
});
def('hipervisores-llenos', {
  titulo: 'Hipervisores casi sin RAM', condicion: true,
  params: { nodos: '[hipervisores]', proyecto: 'proyecto de las VMs de relleno' },
  ejemplo: { nodos: ['cmp01', 'cmp03'], proyecto: 'analitica' },
  validar: (st, a) => (a.nodos || []).some(n => ['cmp01', 'cmp02', 'cmp03'].indexOf(n) < 0) ? 'nodos tiene que ser una lista de cmp01..cmp03' : null,
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
  titulo: 'VMs que fallaron al crearse', condicion: true,
  params: { nombres: '[nombres]', proyecto: 'proyecto', flavor: 'flavor', hace: 'minutos' },
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
  titulo: 'Parche de kernel publicado', condicion: true,
  params: { version: 'versión del kernel' },
  ejemplo: { version: '5.15.0-122-generic' },
  toca: () => ['kernel'],
  aplicar(st, a) { Object.values(st.hosts).forEach(h => { h.kernelDisponible = a.version; }); },
});
def('vm-programada', {
  titulo: 'Un pipeline creará una VM', condicion: true,
  descripcion: 'A los N minutos, una VM nueva entra al scheduler, que la pone donde haya más hueco.',
  params: { en: 'minuto', nombre: 'nombre', proyecto: 'proyecto', flavor: 'flavor' },
  ejemplo: { en: 6, nombre: 'ci-runner-17', proyecto: 'analitica', flavor: 'm1.large' },
  toca: a => ['vm:' + a.nombre],
  aplicar(st, a) {
    st.programados = (st.programados || []).concat([{ min: a.en, fn: s2 => { const vm = s2.os.nuevaVm(a.nombre, a.proyecto, a.flavor, null, 'retail-net', 'BUILD', s2.reloj); s2.os.servidores.push(vm); P.programar(s2, vm); } }]);
  },
});
def('registro-ceph', {
  titulo: 'Líneas de contexto en el log del clúster', condicion: true,
  params: { lineas: '[{ hace, sev, t }]' },
  ejemplo: { lineas: [{ hace: 7, sev: 'DBG', t: '2.7f deep-scrub starts' }] },
  aplicar(st, a) { (a.lineas || []).forEach(l => st.ceph.historial.push({ min: -l.hace, sev: l.sev || 'INF', t: l.t })); },
});

// ------------------------------------------------------------------ campos
// Qué tipo de campo es cada parámetro, para el compositor (compositor.js).
// `params` explica en palabras; `campos` dice cómo se edita. puesto-test.js
// exige que cubran lo mismo: un parámetro sin campo no se podría componer.
const campoHace = { k: 'hace', t: 'num', min: 0, max: 10080, def: 30, etiqueta: 'hace (min)' };
const efectoC = { k: 'efecto', t: 'texto', opcional: true, etiqueta: 'efecto (para el aviso)' };
P.camposAveria = {
  'servicio-caido': [{ k: 'nodo', t: 'nodo' }, { k: 'servicio', t: 'servicio' }, { k: 'motivo', t: 'motivo', opcional: true }, campoHace, { k: 'crashes', t: 'minutos', opcional: true, etiqueta: 'crashes (min, sólo Ceph)' }, efectoC],
  'servicio-parado': [{ k: 'nodo', t: 'nodo' }, { k: 'servicio', t: 'servicio' }, campoHace, { k: 'deshabilitado', t: 'bool', etiqueta: 'además, deshabilitado' }, { k: 'exigirHabilitado', t: 'bool', opcional: true, etiqueta: 'exigir que quede habilitado' }, efectoC],
  'disco-lleno': [{ k: 'nodo', t: 'nodo' }, { k: 'fichero', t: 'fichero' }, { k: 'mb', t: 'num', min: 1, max: 60000, def: 31000, etiqueta: 'tamaño (MB)' }],
  'rabbit-debug': [{ k: 'nodo', t: 'nodo', roles: ['ctl'] }],
  'config-ceph': [{ k: 'quien', t: 'opciones', opciones: ['mon', 'osd', 'mgr'], def: 'mon' }, { k: 'opcion', t: 'texto', def: 'debug_mon' }, { k: 'valor', t: 'texto', def: '20/20' }, Object.assign({}, campoHace, { def: 10080 }), efectoC],
  'reloj-desfasado': [{ k: 'nodo', t: 'nodo' }, { k: 'segundos', t: 'num', min: 0.06, max: 5, paso: 0.001, def: 0.5, etiqueta: 'desfase (s)' }, Object.assign({}, campoHace, { def: 300 })],
  'disco-muerto': [{ k: 'osd', t: 'osd' }, campoHace],
  'flag-ceph': [{ k: 'flag', t: 'opciones', opciones: ['noout', 'norebalance', 'nobackfill', 'norecover', 'noscrub', 'nodeep-scrub'], def: 'noout' }, Object.assign({}, campoHace, { def: 720 }), efectoC],
  'balancer-apagado': [{ k: 'osd', t: 'osd' }, { k: 'exceso', t: 'num', min: 1, max: 34, paso: 0.5, def: 29.5, etiqueta: 'exceso (puntos de uso)' }],
  'certificado-caducado': [campoHace],
  'fuga-memoria': [{ k: 'memoria', t: 'memoria', etiqueta: 'memoria ya perdida (GB)' }],
  'regla-a-mano': [],
  'volumen-atascado': [{ k: 'nombre', t: 'texto', def: 'vol-viejo' }, { k: 'proyecto', t: 'proyecto' }, { k: 'gb', t: 'num', min: 1, max: 2000, def: 200, etiqueta: 'tamaño (GB)' }, { k: 'nodo', t: 'nodo', roles: ['ctl'], etiqueta: 'cinder-volume de' }, Object.assign({}, campoHace, { def: 600 })],
  'vm-borrada': [{ k: 'vm', t: 'vm' }],
  'uso-volumenes': [{ k: 'proyecto', t: 'proyecto' }, { k: 'gb', t: 'num', min: 0, max: 5000, def: 950, etiqueta: 'GB en uso' }],
  'hipervisores-llenos': [{ k: 'nodos', t: 'nodos', roles: ['cmp'] }, { k: 'proyecto', t: 'proyecto', def: 'analitica' }],
  'vms-en-error': [{ k: 'nombres', t: 'lista', def: ['app-v2-01'], etiqueta: 'nombres (separados por comas)' }, { k: 'proyecto', t: 'proyecto' }, { k: 'flavor', t: 'flavor', def: 'm1.xlarge' }, Object.assign({}, campoHace, { def: 15 })],
  'kernel-disponible': [{ k: 'version', t: 'texto', def: '5.15.0-122-generic' }],
  'vm-programada': [{ k: 'en', t: 'num', min: 1, max: 120, def: 6, etiqueta: 'en el minuto' }, { k: 'nombre', t: 'texto', def: 'ci-runner-17' }, { k: 'proyecto', t: 'proyecto', def: 'analitica' }, { k: 'flavor', t: 'flavor', def: 'm1.large' }],
  'registro-ceph': [{ k: 'lineas', t: 'lineas', etiqueta: 'líneas del log de Ceph (una por línea: minutos | texto)' }],
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
      p.push(u + ' sigue en failed en ' + h.nombre + ' (systemctl --failed)');
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
  if (!Array.isArray(lista) || !lista.length) return ['una incidencia necesita al menos una avería'];
  lista.forEach((a, i) => {
    const t = a && P.averias[a.tipo], n = 'avería ' + (i + 1);
    if (!t) { errores.push(n + ': tipo desconocido «' + (a && a.tipo) + '»'); return; }
    // Lo que no tiene valor por defecto ni es opcional, tiene que venir (el esquema es el de P.camposAveria).
    const falta = (P.camposAveria[a.tipo] || []).filter(c => !c.opcional && c.def == null && c.t !== 'bool' && (a[c.k] == null || a[c.k] === '' || (Array.isArray(a[c.k]) && !a[c.k].length))).map(c => c.k);
    if (falta.length) { errores.push(n + ' (' + a.tipo + '): falta ' + falta.join(', ')); return; }
    const e = t.validar && t.validar(st, a);
    if (e) errores.push(n + ' (' + a.tipo + '): ' + e);
    t.toca(a).forEach(k => { if (toques[k] != null) errores.push('las averías ' + (toques[k] + 1) + ' y ' + (i + 1) + ' tocan lo mismo (' + k + ')'); else toques[k] = i; });
  });
  return errores;
};

})(window.PUESTO = window.PUESTO || {});
