// Puesto · OpenStack: VMs, hipervisores, servicios, cuotas y grupos de seguridad.
//
// El scheduler es de verdad (a escala): sólo coloca una VM en un hipervisor con
// nova-compute vivo, mapeado en la celda y con RAM libre. Por eso "No valid host"
// aparece o desaparece según lo que arregles, no según un guion.
(function (P) {
'use strict';
const U = P.u, L = U.L, T = P.T;

const FLAVORS = {
  'm1.small': { id: '1', vcpu: 1, ram: 2048, disk: 20 }, 'm1.medium': { id: '2', vcpu: 2, ram: 4096, disk: 40 },
  'm1.large': { id: '3', vcpu: 4, ram: 8192, disk: 80 }, 'm1.xlarge': { id: '4', vcpu: 8, ram: 16384, disk: 160 },
  'm1.2xlarge': { id: '5', vcpu: 16, ram: 32768, disk: 160 },
};
const IMAGENES = ['ubuntu-22.04', 'ubuntu-24.04', 'rocky-9'];
const REDES = { 'retail-net': '10.20', 'pos-net': '10.30', 'ext-net': '185.47.12' };
const COMPUTES = ['cmp01', 'cmp02', 'cmp03', 'cmp04'], CTLS = ['ctl01', 'ctl02', 'ctl03'];
const RAM_HOST = 262144, RAM_RES = 8192, VCPU_HOST = 64;
P.FLAVORS = FLAVORS;

const VMS = [
  ['web-tienda-01', 'tienda-online', 'm1.large', 'cmp01', 'retail-net'], ['web-tienda-02', 'tienda-online', 'm1.large', 'cmp02', 'retail-net'],
  ['web-tienda-03', 'tienda-online', 'm1.large', 'cmp03', 'retail-net'], ['web-tienda-04', 'tienda-online', 'm1.large', 'cmp01', 'retail-net'],
  ['pedidos-api-01', 'tienda-online', 'm1.xlarge', 'cmp01', 'retail-net'], ['pedidos-api-02', 'tienda-online', 'm1.xlarge', 'cmp02', 'retail-net'],
  ['pedidos-api-03', 'tienda-online', 'm1.xlarge', 'cmp03', 'retail-net'], ['catalogo-db-01', 'tienda-online', 'm1.2xlarge', 'cmp02', 'retail-net'],
  ['catalogo-db-02', 'tienda-online', 'm1.2xlarge', 'cmp03', 'retail-net'], ['redis-carrito-01', 'tienda-online', 'm1.medium', 'cmp01', 'retail-net'],
  ['redis-carrito-02', 'tienda-online', 'm1.medium', 'cmp03', 'retail-net'], ['pos-backend-01', 'tpv-tiendas', 'm1.large', 'cmp02', 'pos-net'],
  ['pos-backend-02', 'tpv-tiendas', 'm1.large', 'cmp03', 'pos-net'], ['pos-sync-01', 'tpv-tiendas', 'm1.medium', 'cmp01', 'pos-net'],
  ['etl-ventas-01', 'analitica', 'm1.2xlarge', 'cmp01', 'retail-net'], ['etl-ventas-02', 'analitica', 'm1.2xlarge', 'cmp03', 'retail-net'],
  ['kafka-01', 'analitica', 'm1.xlarge', 'cmp01', 'retail-net'], ['kafka-02', 'analitica', 'm1.xlarge', 'cmp02', 'retail-net'],
  ['kafka-03', 'analitica', 'm1.xlarge', 'cmp03', 'retail-net'], ['grafana-negocio-01', 'analitica', 'm1.medium', 'cmp02', 'retail-net'],
];

P.alCrear.push(st => {
  let n = 0;
  const vm = (nombre, proyecto, flavor, host, red, estado, min) => {
    n++;
    return { id: U.uuid('vm' + nombre), nombre, proyecto, flavor, imagen: 'ubuntu-22.04', red, host, estado: estado || 'ACTIVE', creado: min == null ? -40000 + n * 97 : min,
      ip: REDES[red] + '.' + (1 + (n % 3)) + '.' + (10 + n * 3), instancia: 'instance-' + (0x20 + n).toString(16).padStart(8, '0'), fault: null };
  };
  const sg = (nombre, proyecto, desc, reglas) => ({ id: U.uuid('sg' + nombre), nombre, proyecto, desc, reglas: reglas.map(r => Object.assign({ id: U.uuid('rule' + nombre + (r.tf || r.dir + r.eth + (r.puerto || ''))) }, r)) });
  st.os = {
    servidores: VMS.map(v => vm.apply(null, v)),
    nodos: { cmp01: true, cmp02: true, cmp03: true },     // hay registro de compute node
    mapeados: { cmp01: true, cmp02: true, cmp03: true },  // mapeado en la celda cell1
    llamadas: 0, logSched: [], nuevaVm: vm,
    proyectos: {
      admin: { cuota: { instances: 10, cores: 20, ram: 51200, gigabytes: 1000, volumes: 10, snapshots: 10 }, vol: { gigabytes: 0, volumes: 0, snapshots: 0 } },
      'tienda-online': { cuota: { instances: 40, cores: 160, ram: 327680, gigabytes: 1000, volumes: 60, snapshots: 60 }, vol: { gigabytes: 620, volumes: 18, snapshots: 4 } },
      'tpv-tiendas': { cuota: { instances: 20, cores: 80, ram: 163840, gigabytes: 500, volumes: 30, snapshots: 30 }, vol: { gigabytes: 210, volumes: 6, snapshots: 2 } },
      analitica: { cuota: { instances: 30, cores: 200, ram: 524288, gigabytes: 4000, volumes: 40, snapshots: 40 }, vol: { gigabytes: 2600, volumes: 12, snapshots: 0 } },
    },
    sgs: {
      'sg-pos-backend': sg('sg-pos-backend', 'tpv-tiendas', T('Backend TPV (gestionado por Terraform)', 'POS backend (managed by Terraform)'), [
        { dir: 'egress', eth: 'IPv4', proto: null, puerto: null, remoto: '0.0.0.0/0' },
        { dir: 'egress', eth: 'IPv6', proto: null, puerto: null, remoto: '::/0' },
        { dir: 'ingress', eth: 'IPv4', proto: 'tcp', puerto: 443, remoto: '0.0.0.0/0', tf: 'https_public' },
        { dir: 'ingress', eth: 'IPv4', proto: 'tcp', puerto: 22, remoto: '10.20.0.0/16', tf: 'ssh_admin' },
        { dir: 'ingress', eth: 'IPv4', proto: 'tcp', puerto: 8443, remoto: '10.30.0.0/16', tf: 'api_internal' },
      ]),
      'sg-web-tienda': sg('sg-web-tienda', 'tienda-online', T('Frontales de la tienda online', 'Online store frontends'), [
        { dir: 'egress', eth: 'IPv4', proto: null, puerto: null, remoto: '0.0.0.0/0' },
        { dir: 'ingress', eth: 'IPv4', proto: 'tcp', puerto: 443, remoto: '0.0.0.0/0' },
        { dir: 'ingress', eth: 'IPv4', proto: 'tcp', puerto: 22, remoto: '10.20.0.0/16' },
      ]),
    },
  };
  st.os.servidores.find(s => s.nombre === 'pos-backend-01').ipPublica = '185.47.12.20';
  // Copias nocturnas (snapshots) de las VMs con datos. Las propiedades guardan
  // lo necesario para restaurar: flavor, red y proyecto de la VM original.
  st.os.imagenesExtra = [];
  ['catalogo-db-01', 'catalogo-db-02', 'redis-carrito-01', 'redis-carrito-02'].forEach(n => {
    const vm = st.os.servidores.find(s => s.nombre === n);
    ['20260922', '20260923'].forEach((dia, i) => st.os.imagenesExtra.push({ nombre: 'backup-' + n + '-' + dia, flavor: vm.flavor, red: vm.red, proyecto: vm.proyecto, vm: vm.id, creada: i ? -372 : -1812, gb: vm.flavor === 'm1.2xlarge' ? 94 : 11 }));
  });
  // Volúmenes de Cinder. Cada uno lo gestiona el cinder-volume de un controlador:
  // si ese servicio cae, sus operaciones a medias se quedan colgadas.
  st.os.volumenes = [
    ['catalogo-db-01-data', 'tienda-online', 200, 'in-use', 'catalogo-db-01', 'ctl01'], ['catalogo-db-02-data', 'tienda-online', 200, 'in-use', 'catalogo-db-02', 'ctl02'],
    ['pedidos-db-data', 'tienda-online', 150, 'in-use', 'pedidos-api-01', 'ctl03'], ['pos-backend-01-data', 'tpv-tiendas', 100, 'in-use', 'pos-backend-01', 'ctl01'],
    ['kafka-01-data', 'analitica', 500, 'in-use', 'kafka-01', 'ctl02'], ['etl-scratch', 'analitica', 300, 'available', null, 'ctl03'],
  ].map(v => ({ id: U.uuid('vol' + v[0]), nombre: v[0], proyecto: v[1], gb: v[2], estado: v[3], servidor: v[4], host: v[5], desde: -9000 }));
  CTLS.forEach(n => { st.hosts[n].extra.novaInstalada = '29.2.1'; st.hosts[n].extra.novaCargada = '29.2.1'; st.hosts[n].extra.novaMem = 1.2; });
  st.os.deshabilitados = {};            // hipervisores fuera del scheduler (compute service set --disable)
  st.os.usuarios = { admin: { id: U.hex('adminuser', 32), email: null, proyecto: 'admin' } };
  st.os.roles = [{ u: 'admin', p: 'admin', r: 'admin' }];
  // Certificado TLS de la API: el fichero en disco y el que HAProxy tiene
  // cargado en memoria son dos cosas. Minutos hasta que caduca.
  st.os.certRepo = 525600;
  CTLS.forEach(n => { st.hosts[n].extra.cert = { fichero: 200000, cargado: 200000 }; });
});

// ------------------------------------------------------------------ modelo
U.novaUp = (st, n) => { const h = st.hosts[n], s = h && h.svcs['nova-compute']; return !!(h && h.up && h.provisionado && s && s.estado === 'active'); };
U.ovsOk = (st, n) => { const h = st.hosts[n]; return !!(h && h.up && h.svcs['openvswitch-switch'] && h.svcs['openvswitch-switch'].estado === 'active' && h.svcs['neutron-openvswitch-agent'].estado === 'active'); };
P.buscarIp = (st, ip) => {
  const s = st.os.servidores.find(x => x.ip === ip || x.ipPublica === ip);
  return s ? { vm: s, ok: s.estado === 'ACTIVE' && !!s.host && U.ovsOk(st, s.host) } : null;
};
P.imagenes = st => IMAGENES.concat(st.os.imagenesExtra.map(i => i.nombre));
// nova-api 29.2.0 pierde memoria con cada petición; se recupera al reiniciar.
P.rssUnidad = (st, h, u) => u === 'nova-api' && h.extra.novaMem != null ? h.extra.novaMem : null;
P.ticks.push(st => CTLS.forEach(n => {
  const h = st.hosts[n];
  if (h.up && h.svcs['nova-api'].estado === 'active' && h.extra.novaCargada === '29.2.0') h.extra.novaMem += n === 'ctl03' ? 0.2 : 0.1;
  // cinder-volume termina los borrados que tiene pendientes
  st.os.volumenes.filter(v => v.estado === 'deleting' && v.host === n && h.up && h.svcs['cinder-volume'].estado === 'active' && st.reloj >= v.borrarEn).forEach(v => {
    st.os.volumenes.splice(st.os.volumenes.indexOf(v), 1);
    const pr = st.os.proyectos[v.proyecto]; if (pr) { pr.vol.gigabytes = Math.max(0, pr.vol.gigabytes - v.gb); pr.vol.volumes = Math.max(0, pr.vol.volumes - 1); }
  });
}));
P.alArrancar.push((st, h, u) => { if (u === 'nova-api' && h.extra.novaInstalada) { h.extra.novaCargada = h.extra.novaInstalada; h.extra.novaMem = 1.2; } });
P.ramUsadaHost = (st, n) => st.os.servidores.filter(s => s.host === n && s.estado !== 'ERROR').reduce((a, s) => a + FLAVORS[s.flavor].ram, 0);
P.vcpuUsadaHost = (st, n) => st.os.servidores.filter(s => s.host === n && s.estado !== 'ERROR').reduce((a, s) => a + FLAVORS[s.flavor].vcpu, 0);
P.ramLibreHost = (st, n) => RAM_HOST - RAM_RES - P.ramUsadaHost(st, n);
function usoProyecto(st, p) {
  const vms = st.os.servidores.filter(s => s.proyecto === p && s.estado !== 'ERROR'), v = st.os.proyectos[p].vol;
  return { instances: vms.length, cores: vms.reduce((a, s) => a + FLAVORS[s.flavor].vcpu, 0), ram: vms.reduce((a, s) => a + FLAVORS[s.flavor].ram, 0), gigabytes: v.gigabytes, volumes: v.volumes, snapshots: v.snapshots };
}
P.usoProyecto = usoProyecto;

// Coloca una VM: los filtros son los de nova, en pequeño.
function programar(st, s) {
  const f = FLAVORS[s.flavor], rid = 'req-' + U.uuid('req' + s.id);
  const vivos = COMPUTES.filter(n => st.os.nodos[n] && U.novaUp(st, n) && st.os.mapeados[n] && !st.os.deshabilitados[n]);
  const conRam = vivos.filter(n => P.ramLibreHost(st, n) >= f.ram).sort((a, b) => P.ramLibreHost(st, b) - P.ramLibreHost(st, a));
  const pre = U.iso(st.reloj).replace('T', ' ') + '.' + String(212 + st.reloj % 700).padStart(3, '0') + ' ' + U.pid('sched') + ' ';
  COMPUTES.filter(n => st.os.nodos[n] && U.novaUp(st, n) && !st.os.mapeados[n]).forEach(n => st.os.logSched.push({ min: st.reloj, t: pre + "WARNING nova.scheduler.host_manager [None " + rid + " admin admin] No compute node record found for host " + n + ". If this is the first time this service is starting on this host, then you can ignore this warning." }));
  if (!conRam.length) {
    st.os.logSched.push({ min: st.reloj, t: pre + 'INFO nova.scheduler.manager [None ' + rid + ' admin ' + s.proyecto + '] Got no allocation candidates from the Placement API. This could be due to insufficient resources or a temporary occurrence as compute nodes start up.' });
    s.estado = 'ERROR'; s.host = null; s.fault = { code: 500, created: U.iso(st.reloj) + 'Z', message: 'No valid host was found. There are not enough hosts available.' };
    return false;
  }
  s.estado = 'ACTIVE'; s.host = conRam[0];
  return true;
}
P.ticks.push(st => {
  st.os.servidores.forEach(s => { if (s.estado === 'BUILD' && st.reloj >= s.resolverEn) programar(st, s); });
  // un RabbitMQ en debug escribe sin parar
  CTLS.forEach(n => {
    const h = st.hosts[n], p = '/var/log/rabbitmq/rabbit@' + n + '.log';
    if (h.up && h.extra.rabbitDebug && h.svcs['rabbitmq-server'].estado === 'active' && h.logs[p] != null) {
      h.logs[p] += 150;
      if (U.libreG(h, '/var') < 0.5) P.fallar(st, h, 'rabbitmq-server', 'sin-espacio', st.reloj);
    }
  });
});
P.programar = programar;
// Migración en vivo: la VM sigue corriendo y cambia de hipervisor. El destino
// lo elige el scheduler, nunca el mismo nodo ni uno deshabilitado.
P.migrar = (st, s) => {
  const f = FLAVORS[s.flavor];
  const destinos = COMPUTES.filter(n => n !== s.host && st.os.nodos[n] && U.novaUp(st, n) && st.os.mapeados[n] && !st.os.deshabilitados[n] && P.ramLibreHost(st, n) >= f.ram)
    .sort((a, b) => P.ramLibreHost(st, b) - P.ramLibreHost(st, a));
  if (!destinos.length) return null;
  const origen = s.host; s.host = destinos[0];
  st.hechos.migradas = (st.hechos.migradas || []).concat([{ vm: s.nombre, de: origen, a: s.host, min: st.reloj }]);
  return s.host;
};
P.alArrancar.push((st, h, u) => { if (u === 'nova-compute') st.os.nodos[h.nombre] = true; });
// HAProxy sólo lee el certificado al arrancar o recargar.
P.alArrancar.push((st, h, u) => { if (u === 'haproxy' && h.extra.cert) h.extra.cert.cargado = h.extra.cert.fichero; });
// Galera: un arranque normal se une al clúster que ya existe.
P.alArrancar.push((st, h, u) => {
  if (u !== 'mariadb') return;
  h.extra.splitBrain = false;
  U.logSvc(h, u, st.reloj, 'mariadbd[' + U.pid(h.nombre + 'my' + st.reloj) + ']', '[Note] WSREP: Member ' + CTLS.indexOf(h.nombre) + '.0 (' + h.nombre + ') synced with group.');
});
P.alParar.push((st, h, u) => { if (u === 'libvirtd' && h.svcs['nova-compute'] && h.svcs['nova-compute'].estado === 'active') P.fallar(st, h, 'nova-compute', 'sin-libvirt', st.reloj); });
// Reiniciar un hipervisor apaga sus VMs: vuelven en SHUTOFF, no solas.
P.alVolver.push((st, h) => { if (h.rol === 'cmp') st.os.servidores.forEach(s => { if (s.host === h.nombre && s.estado === 'ACTIVE') { s.estado = 'SHUTOFF'; st.hechos.vmsApagadas = (st.hechos.vmsApagadas || 0) + 1; } }); });

P.provisionar = (st, h) => {
  h.provisionado = true;
  ['libvirtd', 'nova-compute', 'openvswitch-switch', 'neutron-openvswitch-agent'].forEach(u => { if (!h.svcs[u]) { h.svcs[u] = U.nuevoSvc(u, st.reloj); h.svcs[u].estado = 'inactive'; h.svcs[u].enabled = false; h.svcs[u].log = []; } });
  U.logsCompute(h); h.logs['/var/log/nova/nova-compute.log'] = 0.2; h.discos['/var/lib/nova'].baseG = 0.4;
};

P.motivos['sin-libvirt'] = {
  result: 'exit-code', proceso: '(code=exited, status=1/FAILURE)',
  journal: (st, h, u, min) => {
    const src = 'nova-compute[' + U.pid(h.nombre + u + min) + ']', pre = U.iso(min).replace('T', ' ') + '.412 ' + U.pid(h.nombre + u + min) + ' ';
    return [
      { src, t: pre + "ERROR nova.virt.libvirt.host [None req-" + U.uuid('lv' + min) + " - - - - - -] Connection to libvirt failed: Failed to connect socket to '/var/run/libvirt/libvirt-sock': No such file or directory: libvirt.libvirtError: Failed to connect socket to '/var/run/libvirt/libvirt-sock': No such file or directory" },
      { src, t: pre + 'ERROR oslo_service.service [None req-' + U.uuid('lv2' + min) + ' - - - - - -] Error starting thread.: nova.exception.HypervisorUnavailable: Connection to the hypervisor is broken on host' },
      { src: 'systemd[1]', t: u + '.service: Main process exited, code=exited, status=1/FAILURE' },
    ];
  },
};
P.motivos['sin-espacio'] = {
  result: 'exit-code', proceso: '(code=exited, status=1/FAILURE)',
  journal: (st, h, u, min) => {
    const src = U.binario(u) + '[' + U.pid(h.nombre + u + min) + ']';
    if (u === 'rabbitmq-server') return [
      { src, t: U.iso(min).replace('T', ' ') + '.448 [error] <0.231.0> Failed to write to log file /var/log/rabbitmq/rabbit@' + h.nombre + '.log: {error,enospc}' },
      { src, t: 'BOOT FAILED' }, { src, t: '===========' },
      { src, t: 'Error during startup: {error,{cannot_write,"/var/lib/rabbitmq/mnesia/rabbit@' + h.nombre + '/rabbit_durable_queue.DCD",enospc}}' },
      { src: 'systemd[1]', t: u + '.service: Main process exited, code=exited, status=1/FAILURE' },
    ];
    return [{ src, t: "[ERROR] mariadbd: Error writing file './ib_logfile0' (Errcode: 28 \"No space left on device\")" }, { src: 'systemd[1]', t: u + '.service: Main process exited, code=exited, status=1/FAILURE' }];
  },
};
P.motivos.oom = {
  result: 'oom-kill', proceso: '(code=killed, signal=KILL)',
  journal: (st, h, u) => [
    { src: 'systemd[1]', t: u + '.service: A process of this unit has been killed by the OOM killer.' },
    { src: 'systemd[1]', t: u + '.service: Main process exited, code=killed, status=9/KILL' },
  ],
  alFallar: (st, h, u) => {
    const t = (1036500 + (st.reloj + 400) * 60).toFixed(0), pid = U.pid(h.nombre + u);
    h.dmesg.push('[' + t + '.112004] nova-api invoked oom-killer: gfp_mask=0x1100cca(GFP_HIGHUSER_MOVABLE), order=0, oom_score_adj=0');
    h.dmesg.push('[' + t + '.112391] Mem-Info: active_anon:31822941 inactive_anon:112033 free:81220');
    h.dmesg.push('[' + t + '.112688] Out of memory: Killed process ' + pid + ' (' + U.binario(u) + ') total-vm:38211442kB, anon-rss:24116022kB, file-rss:0kB, shmem-rss:0kB, UID:112 pgtables:49212kB oom_score_adj:0');
  },
};
P.motivos['rados-timeout'] = {
  result: 'exit-code', proceso: '(code=exited, status=1/FAILURE)',
  journal: (st, h, u, min) => {
    const src = 'cinder-volume[' + U.pid(h.nombre + u + min) + ']', pre = U.iso(min).replace('T', ' ') + '.118 ' + U.pid(h.nombre + u + min) + ' ';
    return [
      { src, t: pre + 'ERROR cinder.volume.drivers.rbd [req-' + U.uuid('rbd' + min) + ' - - - - - -] Error connecting to ceph cluster.: rados.TimedOut: [errno 110] RADOS timed out (error connecting to the cluster)' },
      { src, t: pre + 'ERROR cinder.volume.manager [req-' + U.uuid('rbd2' + min) + ' - - - - - -] Unable to delete volume ' + U.uuid('volpedidos-db-old') + ': cinder.exception.VolumeBackendAPIException: Bad or unexpected response from the storage volume backend API: Error connecting to ceph cluster.' },
      { src, t: pre + 'CRITICAL cinder [-] Unhandled error: oslo_messaging.exceptions.MessagingTimeout: Timed out waiting for a reply' },
      { src: 'systemd[1]', t: u + '.service: Main process exited, code=exited, status=1/FAILURE' },
    ];
  },
};
P.motivos['ovs-lock'] = {
  result: 'exit-code', proceso: '(code=exited, status=1/FAILURE)',
  journal: (st, h, u, min) => [
    { src: 'systemd[1]', t: 'Stopping Open vSwitch...' },
    { src: 'ovs-ctl[' + U.pid(h.nombre + 'ovs' + min) + ']', t: 'ovsdb-server: /etc/openvswitch/conf.db: cannot lock file: Resource temporarily unavailable (the database is locked by another process)' },
    { src: 'ovs-ctl[' + U.pid(h.nombre + 'ovs' + min) + ']', t: ' * Starting ovsdb-server ... failed!' },
    { src: 'systemd[1]', t: u + '.service: Control process exited, code=exited, status=1/FAILURE' },
  ],
};
P.motivos['sin-ovs'] = {
  result: 'exit-code', proceso: '(code=exited, status=1/FAILURE)',
  journal: (st, h, u, min) => {
    const src = 'neutron-openvswitch-agent[' + U.pid(h.nombre + u + min) + ']', pre = U.iso(min).replace('T', ' ') + '.301 ' + U.pid(h.nombre + u + min) + ' ';
    return [
      { src, t: pre + 'ERROR neutron.agent.common.ovsdb_monitor [-] Error received from OVSDB monitor: ovsdb-client: failed to connect to "unix:/var/run/openvswitch/db.sock" (No such file or directory)' },
      { src, t: pre + 'CRITICAL neutron [-] Unhandled error: ovsdbapp.exceptions.TimeoutException: Commands [DbListCommand(table=Bridge)] exceeded timeout 10 seconds' },
      { src: 'systemd[1]', t: u + '.service: Main process exited, code=exited, status=1/FAILURE' },
    ];
  },
};
// Dependencias entre unidades de un mismo nodo: si cae la de la izquierda,
// caen las de la derecha. Lo usan las averías para propagar y para arreglar.
P.dependientes = { libvirtd: ['nova-compute'], 'openvswitch-switch': ['neutron-openvswitch-agent'] };
P.reglas.push((st, h, u) => (u === 'neutron-openvswitch-agent' && h.svcs['openvswitch-switch'] && h.svcs['openvswitch-switch'].estado !== 'active') ? 'sin-ovs' : null);
P.alCaer = P.alCaer || [];
P.alCaer.push((st, h, u) => { if (u === 'openvswitch-switch' && h.svcs['neutron-openvswitch-agent'] && h.svcs['neutron-openvswitch-agent'].estado === 'active') P.fallar(st, h, 'neutron-openvswitch-agent', 'sin-ovs', st.reloj); });
P.alCaer.push((st, h, u) => { if (u === 'libvirtd' && h.svcs['nova-compute'] && h.svcs['nova-compute'].estado === 'active') P.fallar(st, h, 'nova-compute', 'sin-libvirt', st.reloj); });
P.alParar.push((st, h, u) => { if (u === 'openvswitch-switch' && h.svcs['neutron-openvswitch-agent'] && h.svcs['neutron-openvswitch-agent'].estado === 'active') P.fallar(st, h, 'neutron-openvswitch-agent', 'sin-ovs', st.reloj); });
P.reglas.push((st, h, u) => (u === 'nova-compute' && h.svcs.libvirtd && h.svcs.libvirtd.estado !== 'active') ? 'sin-libvirt' : null);
P.reglas.push((st, h, u) => ((u === 'rabbitmq-server' || u === 'mariadb') && h.discos['/var'] && U.libreG(h, '/var') < 0.5) ? 'sin-espacio' : null);

P.certCaducado = st => { const c = st.hosts.ctl01.extra.cert; return !!c && c.cargado <= st.reloj; };
P.galeraVivos = st => CTLS.filter(n => st.hosts[n].up && st.hosts[n].svcs.mariadb.estado === 'active' && !st.hosts[n].extra.splitBrain);
P.galeraTamano = (st, h) => h.extra.splitBrain ? 1 : P.galeraVivos(st).length;
P.ficheros.push((st, h) => h.rol === 'ctl' && h.extra.cert ? { '/etc/haproxy/certs/api.pem': { lineas: () => ['-----BEGIN CERTIFICATE-----', 'MIIF3zCCA8egAwIBAgIUQ' + U.hex('crt' + h.extra.cert.fichero, 40), '(…)', '-----END CERTIFICATE-----', T('(para leerlo: openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates)', '(to read it: openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates)')] } } : {});
P.detectores.push((st, add) => {
  COMPUTES.forEach(n => { const h = st.hosts[n]; if (h.up && h.provisionado && st.os.nodos[n] && !U.novaUp(st, n)) add('OpenStackNovaComputeDown', 'critical', n, T('nova-compute de ' + n + ' está down: el scheduler no le manda VMs', 'nova-compute on ' + n + ' is down: the scheduler is not sending it VMs'), 'NovaCompute|' + n); });
  CTLS.forEach(n => { const h = st.hosts[n]; if (h.up && h.svcs['rabbitmq-server'].estado !== 'active') add('RabbitMQNodeDown', 'critical', n, T('rabbit@' + n + ' fuera del clúster de RabbitMQ', 'rabbit@' + n + ' is out of the RabbitMQ cluster'), 'Rabbit|' + n); });
  CTLS.forEach(n => { const h = st.hosts[n]; if (h.up && h.svcs['cinder-volume'].estado !== 'active') add('CinderVolumeServiceDown', 'warning', n, T('cinder-volume de ' + n + '@rbd-1 down: sus volúmenes no se pueden crear, borrar ni ampliar', 'cinder-volume on ' + n + '@rbd-1 down: its volumes cannot be created, deleted or extended'), 'Cinder|' + n); });
  CTLS.forEach(n => { const h = st.hosts[n]; if (!h.up) return; const p = U.ramUsada(st, h) / U.ramTotal(h) * 100; if (p >= 80) add('NodeMemoryHighUtilization', p >= 90 ? 'critical' : 'warning', n, T('memoria al ' + Math.round(p) + ' %', 'memory at ' + Math.round(p) + ' %'), 'Mem|' + n); });
  COMPUTES.forEach(n => { const h = st.hosts[n]; if (h.up && h.svcs['neutron-openvswitch-agent'] && st.os.nodos[n] && !U.ovsOk(st, n)) add('NeutronOVSAgentDown', 'critical', n, T('agente de Open vSwitch de ' + n + ' caído: sus VMs se quedan sin red', 'Open vSwitch agent on ' + n + ' is down: its VMs lose networking'), 'OVS|' + n); });
  // La VIP de la API la sirve HAProxy en ctl01 (keepalived).
  if (P.certCaducado(st)) add('SSLCertExpired', 'critical', null, T('https://api.retail.local:5000 presenta un certificado caducado (sonda blackbox)', 'https://api.retail.local:5000 presents an expired certificate (blackbox probe)'), 'SSLCert|api');
  CTLS.forEach(n => {
    const h = st.hosts[n];
    if (!h.up || h.svcs.mariadb.estado !== 'active') return;
    const t = P.galeraTamano(st, h);
    if (t < 3) add('GaleraClusterSizeLow', 'critical', n, 'wsrep_cluster_size = ' + t + T(' (esperado 3)', ' (expected 3)'), 'Galera|' + n);
  });
  // Sonda blackbox desde fuera: el 22 no debería contestar en ninguna IP pública.
  st.os.servidores.filter(s => s.ipPublica).forEach(s => {
    const abierto = Object.values(st.os.sgs).some(g => g.proyecto === s.proyecto && g.reglas.some(r => r.dir === 'ingress' && r.puerto === 22 && r.remoto === '0.0.0.0/0'));
    if (abierto) add('PublicSSHExposed', 'critical', null, s.ipPublica + ':22 (' + s.nombre + T(') responde desde internet (sonda blackbox externa)', ') answers from the internet (external blackbox probe)'), 'PublicSSH|' + s.ipPublica);
  });
});

// ------------------------------------------------------------------ logs
const oslo = (min, pid, niv, mod, t) => U.iso(min).replace('T', ' ') + '.' + String(100 + (Math.abs(min) * 13) % 900) + ' ' + pid + ' ' + niv + ' ' + mod + ' ' + t;
P.generadoresLog.push((st, h, p) => {
  if (h.rol === 'cmp' && /nova-compute\.log$/.test(p)) {
    const s = h.svcs['nova-compute']; if (!s) return [];
    const pid = U.pid(h.nombre + 'nc'), out = [];
    const usada = P.ramUsadaHost(st, h.nombre), vc = P.vcpuUsadaHost(st, h.nombre);
    const res = min => oslo(min, pid, 'INFO', 'nova.compute.resource_tracker', '[None req-' + U.uuid('rt' + min) + ' - - - - - -] Final resource view: name=' + h.nombre + ' phys_ram=' + RAM_HOST + 'MB used_ram=' + (usada + RAM_RES) + 'MB phys_disk=799GB used_disk=' + Math.round(h.discos['/var/lib/nova'].baseG) + 'GB total_vcpus=' + VCPU_HOST + ' used_vcpus=' + vc + ' pci_stats=[]');
    if (s.motivo === 'sin-libvirt') {
      for (let i = 4; i > 0; i--) out.push(res(s.desde - 60 * i));
      out.push(oslo(s.desde - 2, pid, 'INFO', 'oslo_service.service', '[-] Caught SIGTERM, stopping children'));
      for (let i = 0; i < 4; i++) out.push(oslo(s.desde + i * 0, pid + i, 'ERROR', 'nova.virt.libvirt.host', "[None req-" + U.uuid('lvx' + i) + " - - - - - -] Connection to libvirt failed: Failed to connect socket to '/var/run/libvirt/libvirt-sock': No such file or directory"));
      out.push(oslo(s.desde, pid + 4, 'ERROR', 'oslo_service.service', '[-] Error starting thread.: nova.exception.HypervisorUnavailable: Connection to the hypervisor is broken on host'));
      return out;
    }
    const desde = Math.max(s.desde, st.reloj - 5);
    for (let m = desde; m <= st.reloj; m++) out.push(res(m));
    if (s.desde > -17280 && s.desde >= st.reloj - 6) out.splice(0, 0, oslo(s.desde, pid, 'INFO', 'nova.service', '[-] Starting compute node (version 29.2.0)'), oslo(s.desde, pid, 'INFO', 'nova.virt.libvirt.driver', '[-] Connection event \'1\' reason \'None\''));
    return out;
  }
  if (h.rol === 'ctl' && /nova-scheduler\.log$/.test(p)) {
    const pid = U.pid('sched');
    return [oslo(st.reloj - 30, pid, 'INFO', 'nova.scheduler.host_manager', '[None req-' + U.uuid('hm') + ' - - - - - -] Successfully synced instances from host \'cmp01\'.')].concat(st.os.logSched.slice(-12).map(x => x.t));
  }
  if (h.rol === 'ctl' && /nova-conductor\.log$/.test(p)) {
    const pid = U.pid(h.nombre + 'cond'), r = h.svcs['rabbitmq-server'], out = [oslo(st.reloj - 40, pid, 'INFO', 'nova.conductor.manager', '[None req-' + U.uuid('c0') + ' - - - - - -] Rescheduling: no')];
    if (r.estado !== 'active') for (let i = 0; i < 5; i++) out.push(oslo(Math.max(r.desde, st.reloj - 5 + i), pid, 'ERROR', 'oslo.messaging._drivers.impl_rabbit', '[-] [' + U.uuid('amqp' + i) + '] AMQP server on ' + h.nombre + ':5672 is unreachable: [Errno 111] ECONNREFUSED. Trying again in 1 seconds.: ConnectionRefusedError: [Errno 111] ECONNREFUSED'));
    return out;
  }
  const m = /\/var\/log\/rabbitmq\/rabbit@(ctl\d+)\.log$/.exec(p);
  if (m) {
    const r = h.svcs['rabbitmq-server'], out = [], t = min => U.iso(min).replace('T', ' ') + '.' + String(100 + (Math.abs(min) * 7) % 900) + '+00:00';
    if (h.extra.rabbitDebug) for (let i = 6; i > 0; i--) out.push(t(r.desde - i) + ' [debug] <0.' + (1200 + i) + '.0> Supervisor {<0.' + (1200 + i) + '.0>,rabbit_channel_sup_sup} started rabbit_channel_sup:start_link() at pid <0.' + (1300 + i) + '.0>');
    else out.push(t(st.reloj - 20) + ' [info] <0.812.0> accepting AMQP connection <0.812.0> (10.10.1.11:51422 -> 10.10.1.' + h.nombre.slice(-1) + '0:5672)');
    if (r.motivo === 'sin-espacio') { out.push(t(r.desde) + ' [error] <0.231.0> Failed to write to log file: {error,enospc}'); out.push(t(r.desde) + ' [error] <0.231.0> Disk free space insufficient. Free bytes: 0. Limit: 50000000'); }
    return out;
  }
  if (/\/libvirtd\.log$/.test(p)) { const s = h.svcs.libvirtd; return s ? [U.iso(s.desde).replace('T', ' ') + '.211+0000: ' + U.pid(h.nombre + 'lv') + ': info : libvirt version: 8.0.0, package: 1ubuntu7.10'].concat(s.estado !== 'active' ? [U.iso(s.desde).replace('T', ' ') + '.914+0000: ' + U.pid(h.nombre + 'lv') + ': info : Received SIGTERM, shutting down (package upgrade)'] : []) : []; }
  return null;
});

// ------------------------------------------------------------------ comando
const CON_VALOR = ['--flavor', '--image', '--network', '--nic', '--host', '--project', '--service', '--status', '--gigabytes', '--volumes', '--instances', '--cores', '--ram', '--snapshots', '--size', '--format', '-f', '-c', '--column', '--protocol', '--dst-port', '--remote-ip', '--ingress', '--description', '--disable-reason', '--password', '--email', '--user', '--domain', '--role', '--os-project-name', '--state'];
const opensslFecha = min => { const d = U.iso(min), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return M[+d.slice(5, 7) - 1] + ' ' + String(+d.slice(8, 10)).padStart(2) + ' ' + d.slice(11, 19) + ' ' + d.slice(0, 4) + ' GMT'; };
const errorSSL = [L('Failed to discover available identity versions when contacting https://api.retail.local:5000/v3. Attempting to parse version from URL.', 'err'),
  L("SSL exception connecting to https://api.retail.local:5000/v3/auth/tokens: HTTPSConnectionPool(host='api.retail.local', port=5000): Max retries exceeded with url: /v3/auth/tokens (Caused by SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: certificate has expired (_ssl.c:1007)')))", 'err')];
function opciones(args) {
  const o = {}, pos = [];
  for (let i = 0; i < args.length; i++) {
    const x = args[i];
    if (x.indexOf('--') === 0 && x.indexOf('=') > 0) { const k = x.slice(0, x.indexOf('=')); o[k] = x.slice(x.indexOf('=') + 1); continue; }
    if (CON_VALOR.indexOf(x) >= 0 && x !== '--ingress') { o[x] = args[i + 1]; i++; continue; }
    if (x[0] === '-') { o[x] = true; continue; }
    pos.push(x);
  }
  return { o, pos };
}
const rojoSi = (lineas, re) => lineas.map(t => L(t, re && re.test(t) ? 'rojo' : 'out'));
const servidor = (st, ref) => st.os.servidores.find(s => s.nombre === ref || s.id === ref);
const ahora = st => U.iso(st.reloj) + '.000000';

function osCmd(ctx) {
  const st = ctx.st, ses = ctx.ses, a = ctx.args;
  if (!a.length || a[0] === '--help' || a[0] === 'help') return U.ls(['usage: openstack [--version] [-v | -q] [--os-cloud <cloud-config-name>] <command> ...', '', T('Comandos útiles en este puesto:', 'Useful commands on this desk:'), '  server list --all-projects · server show X · server create · compute service list', '  hypervisor list [--long] · network agent list · volume service list', '  quota show --usage P · quota set --gigabytes N P · project list · flavor list', '  security group list · security group rule list SG · security group rule delete ID'], 'dim');
  if (!ses.env.OS_AUTH_URL) return [L('Missing value auth-url required for auth plugin password', 'err'), L(T('(el cliente no sabe a qué nube hablar: carga las credenciales con source ~/admin-openrc)', '(the client does not know which cloud to talk to: load the credentials with source ~/admin-openrc)'), 'dim')];
  if (P.certCaducado(st)) return errorSSL;
  const { o, pos } = opciones(a);
  // Ámbito: el proyecto en el que actúas. Por defecto, el de las credenciales.
  const ambito = o['--os-project-name'] || ses.env.OS_PROJECT_NAME || 'admin';
  if (!st.os.proyectos[ambito]) return [L('The request you have made requires authentication. (HTTP 401)', 'err'), L(T('(el proyecto ' + ambito + ' no existe)', '(project ' + ambito + ' does not exist)'), 'dim')];
  const empieza = p => pos.join(' ').indexOf(p) === 0;
  // RabbitMQ caído en un controlador: 1 de cada 3 llamadas a nova acaba en 500.
  const rabbitCaido = CTLS.some(n => st.hosts[n].up && st.hosts[n].svcs['rabbitmq-server'].estado !== 'active');
  if (/^(server|compute service|hypervisor)/.test(pos.join(' '))) {
    st.os.llamadas++;
    if (rabbitCaido && st.os.llamadas % 3 === 0) return [L('Unexpected API Error. Please report this at http://bugs.launchpad.net/nova/ and attach the Nova API log if possible.', 'err'), L("<class 'oslo_messaging.exceptions.MessagingTimeout'> (HTTP 500) (Request-ID: req-" + U.uuid('500' + st.reloj) + ')', 'err')];
  }

  // ---- identidad: proyectos, usuarios y roles (Keystone)
  if (empieza('project create')) {
    const n = pos[2]; if (!n) return [L('usage: openstack project create [--description <description>] <project-name>', 'err')];
    if (st.os.proyectos[n]) return [L('Conflict occurred attempting to store project - it is not permitted to have two projects with the same name in the same domain : ' + n + '. (HTTP 409)', 'err')];
    st.os.proyectos[n] = { cuota: { instances: 10, cores: 20, ram: 51200, gigabytes: 1000, volumes: 10, snapshots: 10 }, vol: { gigabytes: 0, volumes: 0, snapshots: 0 }, desc: o['--description'] || '' };
    return U.ls(U.campos([['description', o['--description'] || ''], ['domain_id', 'default'], ['enabled', 'True'], ['id', U.hex('proj' + n, 32)], ['is_domain', 'False'], ['name', n], ['parent_id', 'default']]));
  }
  if (empieza('project show')) {
    const n = pos[2], p = st.os.proyectos[n]; if (!p) return [L("No project with a name or ID of '" + (n || '') + "' exists.", 'err')];
    return U.ls(U.campos([['description', p.desc || ''], ['domain_id', 'default'], ['enabled', 'True'], ['id', U.hex('proj' + n, 32)], ['name', n]]));
  }
  if (empieza('user list')) return U.ls(U.tabla(['ID', 'Name'], Object.keys(st.os.usuarios).map(u => [st.os.usuarios[u].id, u])));
  if (empieza('user create')) {
    const n = pos[2]; if (!n) return [L('usage: openstack user create [--project <project>] [--password <password> | --password-prompt] [--email <email>] <name>', 'err')];
    if (st.os.usuarios[n]) return [L('Conflict occurred attempting to store user - Duplicate entry found with name ' + n + ' at domain ID default. (HTTP 409)', 'err')];
    if (o['--project'] && !st.os.proyectos[o['--project']]) return [L("No project with a name or ID of '" + o['--project'] + "' exists.", 'err')];
    const crear = () => { st.os.usuarios[n] = { id: U.hex('user' + n, 32), email: o['--email'] || null, proyecto: o['--project'] || null }; return U.ls(U.campos([['default_project_id', o['--project'] ? U.hex('proj' + o['--project'], 32) : ''], ['domain_id', 'default'], ['email', o['--email'] || ''], ['enabled', 'True'], ['id', st.os.usuarios[n].id], ['name', n], ['password_expires_at', 'None']])); };
    if (o['--password']) { st.hechos.passwordEnLinea = true; return crear(); }
    if (!o['--password-prompt']) return [L(T('(sin contraseña el usuario no podrá entrar: usa --password-prompt)', '(without a password the user cannot log in: use --password-prompt)'), 'dim')].concat(crear());
    ses.pendiente = { prompt: 'User Password:', oculto: true, responder: (s1, ses1, p1) => {
      ses1.pendiente = { prompt: 'Repeat User Password:', oculto: true, responder: (s2, ses2, p2) => p1 && p1 === p2 ? { lineas: crear() } : { lineas: [L('Passwords do not match.', 'err')] } };
      return { lineas: [], minutos: 0 };
    } };
    return { lineas: [], minutos: 0 };
  }
  if (empieza('role list')) return U.ls(U.tabla(['ID', 'Name'], ['admin', 'member', 'reader'].map(r => [U.hex('role' + r, 32), r])));
  if (empieza('role add') || empieza('role remove')) {
    const r = pos[2], u = o['--user'], p = o['--project'];
    if (!r || !u || !p) return [L('usage: openstack role ' + pos[1] + ' --project <project> --user <user> <role>', 'err')];
    if (['admin', 'member', 'reader'].indexOf(r) < 0) return [L("No role with a name or ID of '" + r + "' exists.", 'err')];
    if (!st.os.usuarios[u]) return [L("No user with a name or ID of '" + u + "' exists.", 'err')];
    if (!st.os.proyectos[p]) return [L("No project with a name or ID of '" + p + "' exists.", 'err')];
    st.os.roles = st.os.roles.filter(x => !(x.u === u && x.p === p && x.r === r));
    if (pos[1] === 'add') st.os.roles.push({ u, p, r });
    return [];
  }
  if (empieza('role assignment list')) {
    let lista = st.os.roles;
    if (o['--project']) lista = lista.filter(x => x.p === o['--project']);
    if (o['--user']) lista = lista.filter(x => x.u === o['--user']);
    const nombres = o['--names'];
    return U.ls(U.tabla(['Role', 'User', 'Group', 'Project', 'Domain', 'System', 'Inherited'], lista.map(x => [nombres ? x.r : U.hex('role' + x.r, 32), nombres ? x.u + '@Default' : st.os.usuarios[x.u].id, '', nombres ? x.p + '@Default' : U.hex('proj' + x.p, 32), '', '', 'False'])));
  }
  // ---- volúmenes (Cinder)
  const volumen = ref => st.os.volumenes.find(v => v.nombre === ref || v.id === ref);
  if (empieza('volume list')) {
    let l = st.os.volumenes;
    if (o['--project']) l = l.filter(v => v.proyecto === o['--project']); else if (!o['--all-projects'] && !o['--all']) l = l.filter(v => v.proyecto === ambito);
    return U.tabla(['ID', 'Name', 'Status', 'Size', 'Attached to'], l.map(v => [v.id, v.nombre, v.estado, v.gb, v.servidor ? 'Attached to ' + v.servidor + ' on /dev/vdb' : ''])).map(t => L(t, /\| (deleting|error) /.test(t) ? 'ambar' : 'out'));
  }
  if (empieza('volume show')) {
    const v = volumen(pos[2]); if (!v) return [L("No volume with a name or ID of '" + (pos[2] || '') + "' exists.", 'err')];
    return U.campos([['attachments', v.servidor ? "[{'server_id': '" + (servidor(st, v.servidor) || {}).id + "', 'device': '/dev/vdb'}]" : '[]'], ['id', v.id], ['name', v.nombre], ['os-vol-host-attr:host', v.host + '@rbd-1#rbd-1'], ['os-vol-tenant-attr:tenant_id', U.hex('proj' + v.proyecto, 32)], ['size', v.gb], ['status', v.estado], ['updated_at', U.iso(v.desde) + '.000000'], ['volume_type', 'ceph-ssd']]).map(t => L(t, /status +\| (deleting|error)/.test(t) ? 'ambar' : 'out'));
  }
  if (empieza('volume set')) {
    const v = volumen(pos[2]); if (!v) return [L("No volume with a name or ID of '" + (pos[2] || '') + "' exists.", 'err')];
    const e = o['--state']; if (!e) return [L(T('(en el simulador: openstack volume set --state error <volumen>)', '(in the simulator: openstack volume set --state error <volume>)'), 'dim')];
    if (['available', 'error', 'in-use', 'deleting', 'error_deleting'].indexOf(e) < 0) return [L("Failed to set volume state: Invalid status '" + e + "'", 'err')];
    v.estado = e; v.desde = st.reloj; st.hechos.resetEstado = (st.hechos.resetEstado || []).concat([{ vol: v.nombre, estado: e, min: st.reloj }]);
    return [];
  }
  if (empieza('volume delete')) {
    const out = [];
    pos.slice(2).forEach(ref => {
      const v = volumen(ref);
      if (!v) { out.push(L("Failed to delete volume with name or ID '" + ref + "': No volume with a name or ID of '" + ref + "' exists.", 'err')); return; }
      if (['available', 'error', 'error_deleting'].indexOf(v.estado) < 0) { out.push(L("Failed to delete volume with name or ID '" + ref + "': Invalid volume: Volume status must be available or error or error_restoring or error_extending or error_managing and must not be migrating, attached, belong to a group, have snapshots or be disassociated from snapshots after volume transfer. (HTTP 400)", 'err')); return; }
      v.estado = 'deleting'; v.desde = st.reloj; v.borrarEn = st.reloj + 1;
    });
    if (out.length) out.push(L(out.length + ' of ' + (pos.length - 2) + ' volumes failed to delete.', 'err'));
    return out;
  }
  // ---- mantenimiento de hipervisores
  if (empieza('compute service set')) {
    const host = pos[3], bin = pos[4];
    if (!host || bin !== 'nova-compute') return [L('usage: openstack compute service set [--enable | --disable] [--disable-reason <reason>] <host> <service>', 'err')];
    if (!st.os.nodos[host]) return [L('Compute service nova-compute of host ' + host + ' failed to set.', 'err')];
    if (o['--disable']) { st.os.deshabilitados[host] = o['--disable-reason'] || T('sin motivo', 'no reason'); st.hechos.deshabilitado = (st.hechos.deshabilitado || []).concat([{ host, min: st.reloj }]); }
    else if (o['--enable']) delete st.os.deshabilitados[host];
    else return [L(T('(indica --enable o --disable)', '(pass --enable or --disable)'), 'dim')];
    return [];
  }
  if (empieza('server migrate')) {
    const s = servidor(st, pos[2]); if (!s) return [L("No server with a name or ID of '" + (pos[2] || '') + "' exists.", 'err')];
    if (!o['--live-migration'] && !o['--live']) return [L(T('(en este puesto las migraciones son en vivo: openstack server migrate --live-migration ' + s.nombre + ')', '(on this desk migrations are live: openstack server migrate --live-migration ' + s.nombre + ')'), 'dim')];
    if (s.estado !== 'ACTIVE') return [L("Cannot 'os-migrateLive' instance " + s.id + ' while it is in vm_state ' + s.estado.toLowerCase() + ' (HTTP 409)', 'err')];
    if (!P.migrar(st, s)) return [L('No valid host was found. There are not enough hosts available. (HTTP 400)', 'err')];
    return o['--wait'] ? [L('Progress: 100'), L('Complete')] : [];
  }
  if (empieza('token issue')) return U.ls(U.campos([['expires', U.iso(st.reloj + 60) + '+0000'], ['id', 'gAAAAABm' + U.hex('tok' + st.reloj, 40)], ['project_id', U.hex('admin', 32)], ['user_id', U.hex('adminuser', 32)]]));
  if (empieza('project list')) return U.ls(U.tabla(['ID', 'Name'], Object.keys(st.os.proyectos).map(p => [U.hex('proj' + p, 32), p])));
  if (empieza('flavor list')) return U.ls(U.tabla(['ID', 'Name', 'RAM', 'Disk', 'Ephemeral', 'VCPUs', 'Is Public'], Object.keys(FLAVORS).map(k => [FLAVORS[k].id, k, FLAVORS[k].ram, FLAVORS[k].disk, 0, FLAVORS[k].vcpu, 'True'])));
  if (empieza('image list')) return U.ls(U.tabla(['ID', 'Name', 'Status'], P.imagenes(st).map(i => [U.uuid('img' + i), i, 'active'])));
  if (empieza('image show')) {
    const n = pos[2], x = st.os.imagenesExtra.find(i => i.nombre === n);
    if (IMAGENES.indexOf(n) >= 0) return U.ls(U.campos([['name', n], ['status', 'active'], ['disk_format', 'qcow2'], ['size', '2361393152'], ['visibility', 'public'], ['properties', "os_distro='ubuntu'"]]));
    if (!x) return [L("Could not find resource " + (n || ''), 'err')];
    return U.ls(U.campos([['created_at', U.iso(x.creada) + 'Z'], ['disk_format', 'raw'], ['id', U.uuid('img' + n)], ['name', n], ['owner', U.hex('proj' + x.proyecto, 32)], ['properties', "image_type='snapshot', instance_uuid='" + x.vm + "', owner_project_name='" + x.proyecto + "', instance_flavor='" + x.flavor + "', instance_network='" + x.red + "'"], ['size', String(x.gb * 1073741824)], ['status', 'active'], ['visibility', 'private']]));
  }
  if (empieza('network list')) return U.ls(U.tabla(['ID', 'Name', 'Subnets'], Object.keys(REDES).map(r => [U.uuid('net' + r), r, U.uuid('sub' + r)])));

  if (empieza('server list')) {
    const todos = o['--all-projects'] || o['--all'];
    let lista = st.os.servidores.filter(s => todos ? true : s.proyecto === ambito);
    if (o['--project']) lista = st.os.servidores.filter(s => s.proyecto === o['--project']);
    if (o['--host']) lista = lista.filter(s => s.host === o['--host']);
    if (o['--status']) lista = lista.filter(s => s.estado === String(o['--status']).toUpperCase());
    if (!lista.length) return todos || o['--project'] || o['--host'] || ambito !== 'admin' ? [] : [L(T('(el proyecto admin no tiene VMs propias; las de los clientes se ven con --all-projects)', '(the admin project has no VMs of its own; customer VMs show up with --all-projects)'), 'dim')];
    const filas = lista.map(s => [s.id, s.nombre, s.estado, s.red + '=' + s.ip + (s.ipPublica ? ', ' + s.ipPublica : ''), s.imagen, s.flavor]);
    return rojoSi(U.tabla(['ID', 'Name', 'Status', 'Networks', 'Image', 'Flavor'], filas), /\| (ERROR|SHUTOFF) /);
  }
  if (empieza('server show')) {
    const s = servidor(st, pos[2]); if (!s) return [L("No server with a name or ID of '" + (pos[2] || '') + "' exists.", 'err')];
    const f = FLAVORS[s.flavor];
    const campos = [['OS-EXT-AZ:availability_zone', s.host ? 'nova' : ''], ['OS-EXT-SRV-ATTR:host', s.host || 'None'], ['OS-EXT-SRV-ATTR:hypervisor_hostname', s.host || 'None'], ['OS-EXT-SRV-ATTR:instance_name', s.instancia],
      ['OS-EXT-STS:vm_state', { ACTIVE: 'active', ERROR: 'error', BUILD: 'building', SHUTOFF: 'stopped' }[s.estado]], ['addresses', s.estado === 'ERROR' ? '' : s.red + '=' + s.ip], ['created', U.iso(s.creado) + 'Z'],
      ['flavor', s.flavor + ' (' + f.id + ')'], ['id', s.id], ['image', s.imagen + ' (' + U.uuid('img' + s.imagen) + ')'], ['name', s.nombre], ['project_id', U.hex('proj' + s.proyecto, 32)], ['status', s.estado]];
    if (s.fault) campos.splice(7, 0, ['fault', "{'code': " + s.fault.code + ", 'created': '" + s.fault.created + "', 'message': '" + s.fault.message + "'}"]);
    return rojoSi(U.campos(campos), /(ERROR|No valid host|stopped)/);
  }
  if (empieza('server create')) {
    const nombre = pos[2], fl = o['--flavor'], im = o['--image'], red = o['--network'] || (o['--nic'] ? String(o['--nic']).replace(/^net-id=/, '') : null);
    if (!nombre || !fl || !im) return [L('usage: openstack server create --flavor <flavor> --image <image> --network <network> <server-name>', 'err')];
    if (!FLAVORS[fl]) return [L('No Flavor found for ' + fl, 'err')];
    if (P.imagenes(st).indexOf(im) < 0) return [L('No Image found for ' + im, 'err')];
    if (!red || !REDES[red]) return [L(red ? 'No Network found for ' + red : 'Multiple possible networks found, use a Network ID to be more specific. (HTTP 409)', 'err')];
    const u = usoProyecto(st, ambito), q = st.os.proyectos[ambito].cuota, f = FLAVORS[fl];
    if (u.cores + f.vcpu > q.cores) return [L('Quota exceeded for cores: Requested ' + f.vcpu + ', but already used ' + u.cores + ' of ' + q.cores + ' cores (HTTP 403) (Request-ID: req-' + U.uuid('q' + st.reloj) + ')', 'err')];
    if (u.instances + 1 > q.instances) return [L('Quota exceeded for instances: Requested 1, but already used ' + u.instances + ' of ' + q.instances + ' instances (HTTP 403)', 'err')];
    const s = st.os.nuevaVm(nombre, ambito, fl, null, red, 'BUILD', st.reloj); s.imagen = im; s.resolverEn = st.reloj + 1;
    st.os.servidores.push(s); st.hechos.pruebaVm = (st.hechos.pruebaVm || 0) + 1;
    if (o['--wait']) programar(st, s);
    const campos = [['OS-EXT-SRV-ATTR:host', s.host || 'None'], ['OS-EXT-STS:vm_state', s.estado === 'ACTIVE' ? 'active' : s.estado === 'ERROR' ? 'error' : 'building'], ['adminPass', U.hex('pw' + s.id, 12)], ['created', U.iso(st.reloj) + 'Z'], ['flavor', fl + ' (' + f.id + ')'], ['id', s.id], ['image', im + ' (' + U.uuid('img' + im) + ')'], ['name', nombre], ['status', s.estado]];
    const out = rojoSi(U.campos(campos), /ERROR/);
    if (s.estado === 'ERROR') out.push(L('Error creating server: ' + nombre, 'err'), L('Error creating server', 'err'));
    else if (s.estado === 'BUILD') out.push(L(T('(la VM se está construyendo: mira cómo acaba con openstack server show ' + nombre + ')', '(the VM is building: see how it ends with openstack server show ' + nombre + ')'), 'dim'));
    return out;
  }
  if (empieza('server delete')) {
    const out = [];
    pos.slice(2).forEach(ref => { const s = servidor(st, ref); if (!s) { out.push(L("No server with a name or ID of '" + ref + "' exists.", 'err')); return; } st.os.servidores.splice(st.os.servidores.indexOf(s), 1); st.hechos.vmBorrada = (st.hechos.vmBorrada || []).concat([s.nombre]); });
    return out;
  }
  if (empieza('server start')) {
    const s = servidor(st, pos[2]); if (!s) return [L("No server with a name or ID of '" + (pos[2] || '') + "' exists.", 'err')];
    if (s.estado !== 'SHUTOFF') return [L('Cannot \'start\' instance ' + s.id + ' while it is in vm_state ' + s.estado.toLowerCase() + ' (HTTP 409)', 'err')];
    if (!U.novaUp(st, s.host)) return [L('Compute host ' + s.host + ' could not be found. (HTTP 404)', 'err')];
    s.estado = 'ACTIVE'; return [];
  }
  if (empieza('compute service list')) {
    const filas = []; let id = 1;
    CTLS.forEach(n => ['nova-scheduler', 'nova-conductor'].forEach(b => { const h = st.hosts[n], up = h.up && h.svcs[b].estado === 'active'; filas.push([id++, b, n, 'internal', 'enabled', up ? 'up' : 'down', up ? ahora(st) : U.iso(h.svcs[b].desde) + '.000000']); }));
    COMPUTES.forEach(n => { if (!st.os.nodos[n]) return; const h = st.hosts[n], up = U.novaUp(st, n); if (o['--host'] && o['--host'] !== n) return; filas.push([id++, 'nova-compute', n, 'nova', st.os.deshabilitados[n] ? 'disabled' : 'enabled', up ? 'up' : 'down', up ? ahora(st) : U.iso(h.svcs['nova-compute'] ? h.svcs['nova-compute'].desde : st.reloj) + '.000000']); });
    const f = o['--service'] ? filas.filter(x => x[1] === o['--service']) : filas;
    return U.tabla(['ID', 'Binary', 'Host', 'Zone', 'Status', 'State', 'Updated At'], f).map(t => L(t, /\| down /.test(t) ? 'rojo' : /\| disabled /.test(t) ? 'ambar' : 'out'));
  }
  if (empieza('hypervisor list')) {
    const largo = o['--long'];
    const filas = COMPUTES.filter(n => st.os.nodos[n]).map((n, i) => { const up = U.novaUp(st, n), base = [i + 1, n, 'QEMU', st.hosts[n].ip, up ? 'up' : 'down']; return largo ? base.concat([P.vcpuUsadaHost(st, n), VCPU_HOST, P.ramUsadaHost(st, n) + RAM_RES, RAM_HOST]) : base; });
    return rojoSi(U.tabla(['ID', 'Hypervisor Hostname', 'Hypervisor Type', 'Host IP', 'State'].concat(largo ? ['vCPUs Used', 'vCPUs', 'Memory MB Used', 'Memory MB'] : []), filas), /\| down /);
  }
  if (empieza('hypervisor show')) {
    const n = pos[2]; if (!st.os.nodos[n]) return [L('No hypervisor with a name or ID of \'' + (n || '') + '\' exists.', 'err')];
    return rojoSi(U.campos([['hypervisor_hostname', n], ['hypervisor_type', 'QEMU'], ['host_ip', st.hosts[n].ip], ['state', U.novaUp(st, n) ? 'up' : 'down'], ['status', 'enabled'], ['vcpus', VCPU_HOST], ['vcpus_used', P.vcpuUsadaHost(st, n)], ['memory_mb', RAM_HOST], ['memory_mb_used', P.ramUsadaHost(st, n) + RAM_RES], ['free_ram_mb', P.ramLibreHost(st, n)], ['running_vms', st.os.servidores.filter(s => s.host === n && s.estado === 'ACTIVE').length]]), /\| down /);
  }
  if (empieza('network agent list')) {
    const filas = [];
    CTLS.forEach(n => [['L3 agent', 'neutron-l3-agent'], ['DHCP agent', 'neutron-dhcp-agent']].forEach(([t, b]) => { const vivo = st.hosts[n].up && st.hosts[n].svcs[b].estado === 'active'; filas.push([U.uuid('ag' + n + b), t, n, 'nova', vivo ? ':-)' : 'XXX', 'UP', b]); }));
    COMPUTES.forEach(n => { const h = st.hosts[n]; if (!h.svcs['neutron-openvswitch-agent'] || !st.os.nodos[n]) return; const vivo = h.up && h.svcs['neutron-openvswitch-agent'].estado === 'active'; filas.push([U.uuid('ag' + n), 'Open vSwitch agent', n, '', vivo ? ':-)' : 'XXX', 'UP', 'neutron-openvswitch-agent']); });
    const f = o['--host'] ? filas.filter(x => x[2] === o['--host']) : filas;
    return rojoSi(U.tabla(['ID', 'Agent Type', 'Host', 'Availability Zone', 'Alive', 'State', 'Binary'], f), /XXX/);
  }
  if (empieza('volume service list')) {
    const filas = [];
    CTLS.forEach(n => { const h = st.hosts[n]; [['cinder-scheduler', n], ['cinder-volume', n + '@rbd-1']].forEach(([b, host]) => { const up = h.up && h.svcs[b].estado === 'active'; filas.push([b, host, 'nova', 'enabled', up ? 'up' : 'down', up ? ahora(st) : U.iso(h.svcs[b].desde) + '.000000']); }); });
    return rojoSi(U.tabla(['Binary', 'Host', 'Zone', 'Status', 'State', 'Updated At'], filas), /\| down /);
  }
  if (empieza('quota show')) {
    const p = pos[2] || 'admin', pr = st.os.proyectos[p];
    if (!pr) return [L("No project with a name or ID of '" + p + "' exists.", 'err')];
    const u = usoProyecto(st, p), claves = ['cores', 'instances', 'ram', 'volumes', 'snapshots', 'gigabytes', 'backups', 'floating-ips', 'networks', 'ports', 'security-groups', 'security-group-rules'];
    const lim = k => pr.cuota[k] != null ? pr.cuota[k] : { backups: 10, 'floating-ips': 20, networks: 10, ports: 200, 'security-groups': 20, 'security-group-rules': 200 }[k];
    const uso = k => u[k] != null ? u[k] : { backups: 0, 'floating-ips': 2, networks: 2, ports: 30, 'security-groups': 3, 'security-group-rules': 14 }[k];
    if (o['--usage']) return U.tabla(['Resource', 'In Use', 'Reserved', 'Limit'], claves.map(k => [k, uso(k), 0, lim(k)])).map(t => L(t, (() => { const m = /^\| (\S+)\s+\| (\d+)\s+\| \d+\s+\| (-?\d+)/.exec(t); return m && +m[3] > 0 && +m[2] / +m[3] >= 0.9 ? 'ambar' : 'out'; })()));
    return U.ls(U.tabla(['Resource', 'Limit'], claves.map(k => [k, lim(k)])));
  }
  if (empieza('quota set')) {
    const p = pos[2], pr = st.os.proyectos[p];
    if (!p) return [L('usage: openstack quota set [--cores <cores>] [--ram <ram>] [--gigabytes <gigabytes>] ... <project>', 'err')];
    if (!pr) return [L("No project with a name or ID of '" + p + "' exists.", 'err')];
    ['--gigabytes', '--volumes', '--instances', '--cores', '--ram', '--snapshots'].forEach(k => {
      if (o[k] == null) return;
      const v = parseInt(o[k], 10); if (isNaN(v)) return;
      const clave = k.slice(2);
      st.hechos.cuota = (st.hechos.cuota || []).concat([{ proyecto: p, clave, antes: pr.cuota[clave], despues: v, min: st.reloj }]);
      pr.cuota[clave] = v;
    });
    return [];
  }
  if (empieza('security group list')) return U.ls(U.tabla(['ID', 'Name', 'Description', 'Project', 'Tags'], Object.values(st.os.sgs).map(g => [g.id, g.nombre, g.desc, U.hex('proj' + g.proyecto, 32), '[]'])));
  if (empieza('security group rule list')) {
    const g = st.os.sgs[pos[4]] || Object.values(st.os.sgs).find(x => x.id === pos[4]);
    if (!g) return pos[4] ? [L("No SecurityGroup found for " + pos[4], 'err')] : [L(T('(indica el grupo: openstack security group rule list sg-pos-backend)', '(name the group: openstack security group rule list sg-pos-backend)'), 'dim')];
    return rojoSi(U.tabla(['ID', 'IP Protocol', 'Ethertype', 'IP Range', 'Port Range', 'Direction', 'Remote Security Group'], g.reglas.map(r => [r.id, r.proto || 'None', r.eth, r.remoto, r.puerto ? r.puerto + ':' + r.puerto : '', r.dir, 'None'])), /0\.0\.0\.0\/0 +\| 22:22/);
  }
  if (empieza('security group rule delete')) {
    const ids = pos.slice(4), out = []; let fallos = 0;
    if (!ids.length) return [L('usage: openstack security group rule delete <rule> [<rule> ...]', 'err')];
    ids.forEach(id => {
      const g = Object.values(st.os.sgs).find(x => x.reglas.some(r => r.id === id));
      if (!g) { fallos++; out.push(L("Failed to delete rule with ID '" + id + "': No SecurityGroupRule found for " + id, 'err')); return; }
      const r = g.reglas.find(x => x.id === id); g.reglas.splice(g.reglas.indexOf(r), 1);
      st.hechos.reglaBorrada = (st.hechos.reglaBorrada || []).concat([{ id, puerto: r.puerto, remoto: r.remoto, tf: r.tf || null, min: st.reloj }]);
    });
    if (fallos) out.push(L(fallos + ' of ' + ids.length + ' rules failed to delete.', 'err'));
    return out;
  }
  if (empieza('security group rule create')) {
    const g = st.os.sgs[pos[4]] || Object.values(st.os.sgs).find(x => x.id === pos[4]);
    if (!g) return [L('usage: openstack security group rule create --protocol tcp --dst-port 22 --remote-ip 10.20.0.0/16 <group>', 'err')];
    const puerto = parseInt(String(o['--dst-port'] || '').split(':')[0], 10) || null, remoto = o['--remote-ip'] || '0.0.0.0/0', proto = o['--protocol'] || 'tcp';
    const dup = g.reglas.find(r => r.dir === 'ingress' && r.puerto === puerto && r.remoto === remoto && r.proto === proto);
    if (dup) return [L('Error while executing command: ConflictException: 409, Security group rule already exists. Rule id is ' + dup.id + '.', 'err')];
    const r = { id: U.uuid('manual' + g.nombre + puerto + remoto + st.reloj), dir: 'ingress', eth: 'IPv4', proto, puerto, remoto };
    g.reglas.push(r); st.hechos.reglaManual = true;
    return U.ls(U.campos([['direction', 'ingress'], ['ethertype', 'IPv4'], ['id', r.id], ['port_range_max', puerto], ['port_range_min', puerto], ['protocol', proto], ['remote_ip_prefix', remoto], ['security_group_id', g.id]]));
  }
  return [L("openstack: '" + pos.join(' ') + "' is not an openstack command. See 'openstack --help'.", 'err')];
}
const ARBOL = {
  image: ['list', 'show'],
  '': ['server', 'compute', 'hypervisor', 'network', 'volume', 'quota', 'project', 'user', 'role', 'flavor', 'image', 'security', 'token'],
  server: ['list', 'show', 'create', 'delete', 'start', 'migrate'], compute: ['service'], 'compute service': ['list', 'set'], hypervisor: ['list', 'show'],
  user: ['list', 'create'], role: ['list', 'add', 'remove', 'assignment'], 'role assignment': ['list'],
  network: ['agent', 'list'], 'network agent': ['list'], volume: ['service', 'list', 'show', 'set', 'delete'], 'volume service': ['list'], quota: ['show', 'set'],
  project: ['list', 'create', 'show'], flavor: ['list'], image: ['list'], security: ['group'], 'security group': ['list', 'rule'], 'security group rule': ['list', 'delete', 'create'], token: ['issue'],
};
U.cmd('openstack', { ayuda: T('API de OpenStack (antes: source ~/admin-openrc)', 'OpenStack API (first: source ~/admin-openrc)'), grupo: 'OpenStack', donde: ['bastion'], fuera: T('(el cliente de OpenStack está en el bastión: vuelve con exit)', '(the OpenStack client is on the bastion: go back with exit)'), fn: osCmd,
  completar: (st, ses, pal) => {
    const k = pal.filter(x => x[0] !== '-').join(' ');
    if (ARBOL[k]) return ARBOL[k];
    if (/^server (show|delete|start|migrate)$/.test(k)) return st.os.servidores.map(s => s.nombre).concat(k === 'server migrate' ? ['--live-migration'] : []);
    if (/^compute service set/.test(k)) return ['--disable', '--enable', '--disable-reason'].concat(Object.keys(st.os.nodos), ['nova-compute']);
    if (/^quota (show|set)/.test(k)) return Object.keys(st.os.proyectos).concat(['--usage', '--gigabytes']);
    if (/^security group rule (list|create)$/.test(k)) return Object.keys(st.os.sgs);
    if (/^security group rule delete$/.test(k)) return [].concat(...Object.values(st.os.sgs).map(g => g.reglas.map(r => r.id)));
    if (/^hypervisor show$/.test(k)) return Object.keys(st.os.nodos);
    if (/^image show$/.test(k)) return P.imagenes(st);
    if (/^volume (show|set|delete)/.test(k)) return st.os.volumenes.map(v => v.nombre).concat(k === 'volume set' ? ['--state'] : []);
    if (/^server list/.test(k)) return ['--all-projects', '--host', '--project', '--status'];
    if (/^server create/.test(k)) { const ant = pal[pal.length - 1]; return ant === '--flavor' ? Object.keys(FLAVORS) : ant === '--image' ? P.imagenes(st) : ant === '--network' ? Object.keys(REDES) : ['--flavor', '--image', '--network', '--wait']; }
    if (/^hypervisor list/.test(k)) return ['--long'];
    return [];
  } });

// nova-manage: celdas ----------------------------------------------------------
U.cmd('nova-manage', { ayuda: T('celdas de nova: cell_v2 discover_hosts / list_hosts', 'nova cells: cell_v2 discover_hosts / list_hosts'), grupo: 'OpenStack', donde: ['ctl'], fuera: T('(nova-manage se ejecuta en un controlador: ssh ctl01)', '(nova-manage runs on a controller: ssh ctl01)'), fn: ctx => {
  const st = ctx.st, a = ctx.args;
  const d = U.sinRoot(ctx, ['An error has occurred:', 'Traceback (most recent call last):', '  File "/usr/lib/python3/dist-packages/nova/cmd/manage.py", line 3380, in main', "PermissionError: [Errno 13] Permission denied: '/etc/nova/nova.conf'"]); if (d) return d;
  if (a[0] !== 'cell_v2') return [L('usage: nova-manage [-h] {api_db,cell_v2,db,placement,version} ...', 'err')];
  const c1 = U.uuid('cell1');
  if (a[1] === 'list_cells') return U.ls(U.tabla(['Name', 'UUID', 'Transport URL', 'Database Connection', 'Disabled'], [['cell0', '00000000-0000-0000-0000-000000000000', 'none:/', 'mysql+pymysql://nova:****@vip-api/nova_cell0', 'False'], ['cell1', c1, 'rabbit://openstack:****@ctl01:5672,openstack:****@ctl02:5672,openstack:****@ctl03:5672/', 'mysql+pymysql://nova:****@vip-api/nova', 'False']]));
  if (a[1] === 'list_hosts') return U.ls(U.tabla(['Cell Name', 'Cell UUID', 'Hostname'], COMPUTES.filter(n => st.os.mapeados[n]).map(n => ['cell1', c1, n])));
  if (a[1] === 'discover_hosts') {
    const nuevos = COMPUTES.filter(n => st.os.nodos[n] && !st.os.mapeados[n]);
    nuevos.forEach(n => { st.os.mapeados[n] = true; });
    st.hechos.discover = true;
    if (a.indexOf('--verbose') < 0) return [];
    const out = [L('Found 2 cell mappings.'), L('Skipping cell0 since it does not contain hosts.'), L("Getting computes from cell 'cell1': " + c1)];
    nuevos.forEach(n => { const u = U.uuid('cn' + n); out.push(L("Checking host mapping for compute host '" + n + "': " + u)); out.push(L("Creating host mapping for compute host '" + n + "': " + u, 'verde')); });
    out.push(L('Found ' + nuevos.length + ' unmapped computes in cell: ' + c1));
    return out;
  }
  return [L('usage: nova-manage cell_v2 {discover_hosts,list_cells,list_hosts,...}', 'err')];
}, completar: (st, ses, pal) => !pal.length ? ['cell_v2'] : pal.length === 1 ? ['discover_hosts', 'list_hosts', 'list_cells'] : ['--verbose'] });

// Open vSwitch en el hipervisor ------------------------------------------------
U.cmd('ovs-vsctl', { ayuda: T('puentes de Open vSwitch (ovs-vsctl show)', 'Open vSwitch bridges (ovs-vsctl show)'), grupo: 'OpenStack', donde: ['cmp'], provisionado: true, fn: ctx => {
  const st = ctx.st, h = ctx.h;
  const d = U.sinRoot(ctx, ['ovs-vsctl: unix:/var/run/openvswitch/db.sock: database connection failed (Permission denied)']); if (d) return d;
  if (h.svcs['openvswitch-switch'].estado !== 'active') return [L('ovs-vsctl: unix:/var/run/openvswitch/db.sock: database connection failed (No such file or directory)', 'err')];
  if (ctx.args[0] !== 'show') return [L(T('(en el simulador: sudo ovs-vsctl show)', '(in the simulator: sudo ovs-vsctl show)'), 'dim')];
  const agente = h.svcs['neutron-openvswitch-agent'].estado === 'active';
  const out = [L(U.uuid('ovs' + h.nombre)), L('    Manager "ptcp:6640:127.0.0.1"'), L('        is_connected: ' + agente, agente ? 'out' : 'rojo'), L('    Bridge br-int'), L('        Controller "tcp:127.0.0.1:6633"'), L('            is_connected: ' + agente, agente ? 'out' : 'rojo'), L('        fail_mode: secure'), L('        Port patch-tun'), L('            Interface patch-tun'), L('                type: patch')];
  st.os.servidores.filter(s => s.host === h.nombre && s.estado === 'ACTIVE').forEach(s => { const t = 'tap' + s.id.slice(0, 11); out.push(L('        Port ' + t)); out.push(L('            Interface ' + t)); });
  return out.concat([L('    Bridge br-tun'), L('        Port patch-int'), L('            Interface patch-int'), L('                type: patch'), L('    ovs_version: "2.17.9"')]);
} });
// libvirt en el hipervisor -------------------------------------------------------
U.cmd('virsh', { ayuda: T('VMs que corren en este hipervisor (virsh list --all)', 'VMs running on this hypervisor (virsh list --all)'), grupo: 'OpenStack', donde: ['cmp'], provisionado: true, fn: ctx => {
  const st = ctx.st, h = ctx.h;
  if (!h.svcs.libvirtd || h.svcs.libvirtd.estado !== 'active') return [L('error: failed to connect to the hypervisor', 'err'), L("error: Failed to connect socket to '/var/run/libvirt/libvirt-sock': No such file or directory", 'err')];
  if (ctx.args[0] !== 'list') return [L(T('(en el simulador: virsh list --all)', '(in the simulator: virsh list --all)'), 'dim')];
  const todas = ctx.args.indexOf('--all') >= 0, vms = st.os.servidores.filter(s => s.host === h.nombre && (s.estado === 'ACTIVE' || (todas && s.estado === 'SHUTOFF')));
  return [L(' Id   Name                State'), L('------------------------------------')].concat(vms.map((s, i) => L(' ' + (s.estado === 'ACTIVE' ? String(i + 1) : '-').padEnd(4) + ' ' + s.instancia.padEnd(19) + ' ' + (s.estado === 'ACTIVE' ? 'running' : 'shut off'), s.estado === 'ACTIVE' ? 'out' : 'ambar')));
} });
U.cmd('rabbitmqctl', { ayuda: T('estado del clúster de RabbitMQ (cluster_status)', 'RabbitMQ cluster status (cluster_status)'), grupo: 'OpenStack', donde: ['ctl'], fn: ctx => {
  const d = U.sinRoot(ctx, ['Only root or rabbitmq should run rabbitmqctl']); if (d) return d;
  const st = ctx.st, h = ctx.h;
  if (ctx.args[0] !== 'cluster_status') return [L(T('(en el simulador: rabbitmqctl cluster_status)', '(in the simulator: rabbitmqctl cluster_status)'), 'dim')];
  if (h.svcs['rabbitmq-server'].estado !== 'active') return [L("Error: unable to perform an operation on node 'rabbit@" + h.nombre + "'. Please see diagnostics information and suggestions below.", 'err'), L(''), L('Most common reasons for this are:', 'err'), L(''), L(' * Target node is unreachable (e.g. due to hostname resolution, TCP connection or firewall issues)', 'err'), L(' * CLI tool fails to authenticate with the server (e.g. due to CLI tool\'s Erlang cookie not matching that of the server)', 'err'), L(' * Target node is not running', 'err')];
  const vivos = CTLS.filter(n => st.hosts[n].up && st.hosts[n].svcs['rabbitmq-server'].estado === 'active');
  return [L('Cluster status of node rabbit@' + h.nombre + ' ...'), L('Basics'), L(''), L('Cluster name: rabbit@ctl01.retail.local'), L(''), L('Disk Nodes'), L('')].concat(CTLS.map(n => L('rabbit@' + n)))
    .concat([L(''), L('Running Nodes'), L('')]).concat(vivos.map(n => L('rabbit@' + n, 'verde')))
    .concat(vivos.length < 3 ? [L(''), L('(' + CTLS.filter(n => vivos.indexOf(n) < 0).map(n => 'rabbit@' + n).join(', ') + T(' está en Disk Nodes pero no en Running Nodes)', (CTLS.length - vivos.length > 1 ? ' are' : ' is') + ' in Disk Nodes but not in Running Nodes)'), 'dim')] : [])
    .concat([L(''), L('Versions'), L('')]).concat(vivos.map(n => L('rabbit@' + n + ': RabbitMQ 3.12.1 on Erlang 25.3.2.8'))).concat([L(''), L('Alarms'), L(''), L('(none)'), L(''), L('Network Partitions'), L(''), L('(none)')]);
}, completar: () => ['cluster_status'] });
// Galera ---------------------------------------------------------------------
U.cmd('mysql', { ayuda: T('estado de Galera (sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'")', 'Galera status (sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'")'), grupo: 'OpenStack', donde: ['ctl'], fn: ctx => {
  const st = ctx.st, h = ctx.h;
  if (!ctx.sudo) return [L("ERROR 1698 (28000): Access denied for user 'admin'@'localhost'", 'err'), L(T('(MariaDB autentica a root por el socket local: sudo mysql)', '(MariaDB authenticates root through the local socket: sudo mysql)'), 'dim')];
  if (h.svcs.mariadb.estado !== 'active') return [L("ERROR 2002 (HY000): Can't connect to local server through socket '/run/mysqld/mysqld.sock' (2)", 'err')];
  const q = ctx.args.join(' '), m = /LIKE\s+'([^']+)'/i.exec(q);
  if (!/SHOW\s+STATUS/i.test(q) || !m) return [L(T('(en el simulador: sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'")', '(in the simulator: sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'")'), 'dim')];
  const t = P.galeraTamano(st, h), miembros = h.extra.splitBrain ? [h.nombre] : P.galeraVivos(st);
  const vars = [['wsrep_cluster_size', t], ['wsrep_cluster_status', 'Primary'], ['wsrep_connected', 'ON'], ['wsrep_incoming_addresses', miembros.map(n => st.hosts[n].ip + ':3306').join(',')], ['wsrep_local_state_comment', 'Synced'], ['wsrep_ready', 'ON']];
  const re = new RegExp('^' + m[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
  return U.tabla(['Variable_name', 'Value'], vars.filter(v => re.test(v[0]))).map(l => L(l, /cluster_size\s+\| [12] /.test(l) ? 'rojo' : 'out'));
} });
U.cmd('galera_new_cluster', { ayuda: T('arranca un clúster Galera NUEVO (sólo si todo el clúster está parado)', 'bootstraps a NEW Galera cluster (only if the whole cluster is stopped)'), grupo: 'OpenStack', donde: ['ctl'], fn: ctx => {
  const st = ctx.st, h = ctx.h;
  const d = U.sinRoot(ctx, ['Failed to start mariadb.service: Access denied']); if (d) return d;
  if (h.svcs.mariadb.estado === 'active') return [L(T('(mariadb ya está en marcha en ' + h.nombre + ')', '(mariadb is already running on ' + h.nombre + ')'), 'dim')];
  const otros = P.galeraVivos(st).filter(n => n !== h.nombre);
  if (P.arrancar(st, h, 'mariadb')) return [L('Job for mariadb.service failed because the control process exited with error code.', 'err')];
  U.logSvc(h, 'mariadb', st.reloj, 'mariadbd[' + U.pid(h.nombre + 'nc') + ']', '[Note] WSREP: Starting new cluster (bootstrap): wsrep_cluster_address=gcomm://');
  if (otros.length) { h.extra.splitBrain = true; st.hechos.splitBrain = true; U.logSvc(h, 'mariadb', st.reloj, 'mariadbd[' + U.pid(h.nombre + 'nc') + ']', '[Warning] WSREP: this node formed a new Primary Component of 1 member while ' + otros.join(', ') + ' are still running'); }
  return [];
} });
U.cmd('nova', { ayuda: T('cliente antiguo de nova (host-evacuate-live)', 'legacy nova client (host-evacuate-live)'), grupo: 'OpenStack', donde: ['bastion'], fuera: T('(el cliente de OpenStack está en el bastión)', '(the OpenStack client is on the bastion)'), fn: ctx => {
  const st = ctx.st;
  if (!ctx.ses.env.OS_AUTH_URL) return [L('ERROR (CommandError): You must provide a user name/id (via --os-username, --os-user-id, env[OS_USERNAME] or env[OS_USER_ID]) or an auth token (via --os-token).', 'err')];
  if (P.certCaducado(st)) return errorSSL;
  const aviso = L('nova CLI is deprecated and will be removed in a future release', 'ambar');
  if (ctx.args[0] !== 'host-evacuate-live') return [aviso, L(T('(en el simulador: nova host-evacuate-live <hipervisor>)', '(in the simulator: nova host-evacuate-live <hypervisor>)'), 'dim')];
  const host = ctx.args.filter(x => x[0] !== '-').pop();
  if (!st.os.nodos[host]) return [aviso, L('ERROR (NotFound): No hypervisor matching \'' + (host || '') + '\' could be found.', 'err')];
  const vms = st.os.servidores.filter(s => s.host === host && s.estado === 'ACTIVE');
  const filas = vms.map(s => { const ok = P.migrar(st, s); return [s.id, ok ? 'True' : 'False', ok ? '' : 'No valid host was found. There are not enough hosts available.']; });
  return [aviso].concat(U.tabla(['Server UUID', 'Live Migration Accepted', 'Error Message'], filas).map(t => L(t, /False/.test(t) ? 'rojo' : 'out')));
} });
// TLS de la API --------------------------------------------------------------
U.cmd('openssl', { ayuda: T('certificados: x509 -in F -noout -dates / s_client -connect H:P', 'certificates: x509 -in F -noout -dates / s_client -connect H:P'), grupo: 'Red', fn: ctx => {
  const st = ctx.st, a = ctx.args;
  if (a[0] === 'x509') {
    const f = a[a.indexOf('-in') + 1];
    if (a.indexOf('-in') < 0 || !f) return [L(T('(en el simulador: openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates)', '(in the simulator: openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates)'), 'dim')];
    const fs = P.vfs(st, ctx.h), p = U.ruta(ctx.ses.cwd, f, ctx.ses);
    if (!fs.f[p]) return [L("Could not open file or uri for loading certificate from " + f, 'err'), L('No such file or directory', 'err')];
    if (!ctx.h.extra.cert || p !== '/etc/haproxy/certs/api.pem') return [L('Could not read certificate from ' + f, 'err')];
    const v = ctx.h.extra.cert.fichero, cad = v <= st.reloj;
    const out = [];
    if (a.indexOf('-subject') >= 0 || a.indexOf('-text') >= 0) out.push(L('subject=CN = api.retail.local'));
    if (a.indexOf('-dates') >= 0 || a.indexOf('-startdate') >= 0 || a.indexOf('-text') >= 0) out.push(L('notBefore=' + opensslFecha(v - 525600)));
    if (a.indexOf('-dates') >= 0 || a.indexOf('-enddate') >= 0 || a.indexOf('-text') >= 0) out.push(L('notAfter=' + opensslFecha(v), cad ? 'rojo' : 'verde'));
    return out.length ? out : [L(T('(añade -dates para ver la validez)', '(add -dates to see the validity period)'), 'dim')];
  }
  if (a[0] === 's_client') {
    const dest = a[a.indexOf('-connect') + 1] || '';
    if (!/^(api\.retail\.local|vip-api|10\.10\.1\.10):(5000|8774|9696|8776|9292)$/.test(dest)) return [L(T('(en el simulador: openssl s_client -connect api.retail.local:5000)', '(in the simulator: openssl s_client -connect api.retail.local:5000)'), 'dim')];
    const c = st.hosts.ctl01.extra.cert.cargado, cad = c <= st.reloj;
    return [L('CONNECTED(00000003)'), L('depth=1 CN = Retail Internal CA'), L('verify return:1'), L('depth=0 CN = api.retail.local'), cad ? L('verify error:num=10:certificate has expired', 'rojo') : L('verify return:1'), L('notAfter=' + opensslFecha(c), cad ? 'rojo' : 'out'), L('---'), L('Certificate chain'), L(' 0 s:CN = api.retail.local'), L('   i:CN = Retail Internal CA'), L('---'), L('SSL handshake has read 3412 bytes and written 392 bytes'), L('Verify return code: ' + (cad ? '10 (certificate has expired)' : '0 (ok)'), cad ? 'rojo' : 'verde'), L('---'), L('DONE')];
  }
  return [L(T('(en el simulador: openssl x509 … o openssl s_client …)', '(in the simulator: openssl x509 … or openssl s_client …)'), 'dim')];
} });
U.cmd('curl', { ayuda: T('pregunta a un servicio HTTP (curl -I https://api.retail.local:5000)', 'queries an HTTP service (curl -I https://api.retail.local:5000)'), grupo: 'Red', fn: ctx => {
  const url = ctx.args.filter(x => x[0] !== '-').pop() || '';
  if (!/^https?:\/\/(api\.retail\.local|vip-api|10\.10\.1\.10)(:\d+)?/.test(url)) return [L(T('(el simulador sólo sabe hacer curl a la API: curl -I https://api.retail.local:5000)', '(the simulator can only curl the API: curl -I https://api.retail.local:5000)'), 'dim')];
  if (P.certCaducado(ctx.st) && ctx.args.indexOf('-k') < 0 && ctx.args.indexOf('--insecure') < 0) return [L('curl: (60) SSL certificate problem: certificate has expired', 'err'), L('More details here: https://curl.se/docs/sslcerts.html', 'err')];
  return [L('HTTP/1.1 300 Multiple Choices'), L('content-type: application/json'), L('vary: X-Auth-Token'), L('x-openstack-request-id: req-' + U.uuid('curl' + ctx.st.reloj))];
} });

})(window.PUESTO = window.PUESTO || {});
