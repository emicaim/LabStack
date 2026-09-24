// Puesto · escenarios: las tareas del puesto, una por ticket.
//
// Cada escenario parte de la plataforma sana y le aplica una avería (o un
// cambio pendiente). No hay respuesta que elegir: se da por resuelto cuando el
// estado de la plataforma lo está, se llegue como se llegue.
//
//   averias           la lista de averías del catálogo (averias.js) que la
//                     componen, con sus parámetros. Rompen y se comprueban solas
//   objetivo(st, P)   sólo peticiones y cambios: lo que se pide que exista
//                     (un proyecto, un kernel nuevo…). Lista de lo que falta
//   practicas         lo que distingue a quien sabe de quien acierta; se mira
//                     en el registro de comandos, no se pregunta
//   guion             una solución de referencia. puesto-test.js la ejecuta y
//                     exige que resuelva el ticket y cumpla todas las prácticas
//   trampas           arreglos a medias que NO deben cerrarlo
(function (P) {
'use strict';
const U = P.u;
const T = P.T;

// ------------------------------------------------------------------ ayudas
const idx = (st, re, desde) => { for (let i = desde || 0; i < st.registro.length; i++) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const ultimo = (st, re) => { for (let i = st.registro.length - 1; i >= 0; i--) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const usado = (st, re) => idx(st, re) >= 0;
const antes = (st, a, b) => { const i = idx(st, a), j = idx(st, b); return i >= 0 && (j < 0 || i < j); };
const despues = (st, a, b) => { const j = ultimo(st, b); return j >= 0 && idx(st, a, j + 1) >= 0; };
const pb = (st, nombre, check) => st.hechos.playbooks.filter(p => p.pb === nombre && !!p.check === !!check && !p.fallo);
const clientesApagados = st => st.os.servidores.filter(s => s.estado === 'SHUTOFF' && s.proyecto !== 'admin');
const comunes = st => clientesApagados(st).length ? [T('Hay VMs de clientes apagadas tras un reinicio: ', 'Customer VMs left powered off after a reboot: ') + clientesApagados(st).map(s => s.nombre).join(', ') + ' (openstack server start)'] : [];
P.ayudasEscenario = { usado, antes, despues, idx, ultimo };

// Dos horas distintas: `inicio` es cuándo empezó la avería (lo que ven las
// alertas) y `abierto` cuándo se registró el ticket. El SLA cuenta desde el
// ticket, como en cualquier herramienta ITSM: el INC-4847 lleva 95 minutos
// degradado, pero nadie lo abrió hasta que empezó tu turno.
//
// Matriz ITIL: la prioridad no se elige, sale de impacto × urgencia.
const MATRIZ = { 'alto|alta': 'P1', 'alto|media': 'P2', 'medio|alta': 'P2', 'alto|baja': 'P3', 'medio|media': 'P3', 'bajo|alta': 'P3', 'medio|baja': 'P4', 'bajo|media': 'P4', 'bajo|baja': 'P4' };
const SLA = { P1: 60, P2: 240, P3: 480, P4: 1440 };
P.prioridad = e => { const p = MATRIZ[e.impacto + '|' + e.urgencia]; return { p, sla: SLA[p] }; };

P.funciones = [
  { id: 'openstack', titulo: T('Despliegue y mantenimiento de OpenStack', 'OpenStack deployment and maintenance'), corto: 'OpenStack' },
  { id: 'ceph', titulo: T('Administración y monitorización de Ceph', 'Ceph administration and monitoring'), corto: 'Ceph' },
  { id: 'auto', titulo: T('Automatización con Ansible y Terraform', 'Automation with Ansible and Terraform'), corto: 'Ansible · Terraform' },
  { id: 'incid', titulo: T('Monitorización y resolución de incidencias', 'Monitoring and incident resolution'), corto: T('Incidencias', 'Incidents') },
];

P.escenarios = [
// ============================================================================ 1
{
  id: 'INC-4821', clave: 'osd-caido', tipo: 'incidente', nivel: 1, area: 'Ceph', funciones: ['ceph', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Monitorización (Alertmanager)', 'Monitoring (Alertmanager)'),
  asunto: T('CephOSDDown: osd.4 en ceph02', 'CephOSDDown: osd.4 on ceph02'),
  cuerpo: [T('Alertmanager avisa de que osd.4 (ceph02) está down y Ceph ha pasado a HEALTH_WARN con datos degradados. No hay ningún mantenimiento programado.', 'Alertmanager reports that osd.4 (ceph02) is down and Ceph has gone to HEALTH_WARN with degraded data. There is no scheduled maintenance.'),
    T('Los datos siguen disponibles (hay tres copias), pero corre el reloj: si el OSD sigue caído a los 10 minutos, Ceph lo marcará out y empezará a mover más de 1 TiB.', 'The data is still available (there are three copies), but the clock is ticking: if the OSD is still down after 10 minutes, Ceph will mark it out and start moving more than 1 TiB.')],
  inicio: -3, abierto: -3,
  averias: [
    { tipo: 'servicio-caido', nodo: 'ceph02', servicio: 'ceph-osd@4', motivo: 'osd-suicidio', hace: 3, crashes: [6, 5, 3] },
    { tipo: 'registro-ceph', lineas: [{ hace: 7, sev: 'DBG', t: '2.7f deep-scrub starts' }, { hace: 3, t: 'osd.4 marked itself down and dead' }, { hace: 3, sev: 'WRN', t: 'Health check failed: 1 osds down (OSD_DOWN)' }, { hace: 3, sev: 'WRN', t: 'Health check failed: Degraded data redundancy: 270810/2437290 objects degraded (11.111%), 160 pgs degraded (PG_DEGRADED)' }, { hace: 3, sev: 'WRN', t: 'Health check failed: 3 daemons have recently crashed (RECENT_CRASH)' }] },
  ],
  practicas: [
    { t: T('Miraste por qué cayó (journal, status o crash info) antes de levantarlo', 'You checked why it went down (journal, status or crash info) before bringing it back up'), ok: st => antes(st, /journalctl.*ceph-osd@4|systemctl status ceph-osd@4|crash info|ceph-osd\.4\.log/, /systemctl (re)?start ceph-osd@4|reset-failed ceph-osd@4/) },
    { t: T('Descartaste el disco antes de darlo por bueno (smartctl o dmesg)', 'You ruled out the disk before trusting it (smartctl or dmesg)'), ok: st => usado(st, /smartctl|dmesg/) },
    { t: T('Lo levantaste antes de que Ceph lo marcara out: cero datos movidos', 'You brought it up before Ceph marked it out: zero data moved'), ok: st => st.ceph.movimientos === 0 },
    { t: T('Comprobaste con ceph -s o ceph health que volvió a HEALTH_OK', 'You checked with ceph -s or ceph health that it was back to HEALTH_OK'), ok: st => despues(st, /ceph (-s|status|health)/, /(reset-failed|start|restart) ceph-osd@4|crash archive/) },
  ],
  pistas: [
    T('Empieza por la foto general: ceph -s y ceph osd tree te dicen qué OSD falla y en qué nodo.', 'Start with the big picture: ceph -s and ceph osd tree tell you which OSD is failing and on which node.'),
    T('Entra en ceph02 y pregunta a systemd: systemctl status ceph-osd@4 y journalctl -u ceph-osd@4. ¿Por qué cayó y por qué no se ha vuelto a levantar solo? Descarta el disco: sudo smartctl -a /dev/sdc.', 'Log in to ceph02 and ask systemd: systemctl status ceph-osd@4 and journalctl -u ceph-osd@4. Why did it go down, and why hasn\'t it come back on its own? Rule out the disk: sudo smartctl -a /dev/sdc.'),
    T('systemd dejó de reintentarlo tras tres caídas seguidas: sudo systemctl reset-failed ceph-osd@4 y sudo systemctl start ceph-osd@4. Después queda RECENT_CRASH: cuando lo hayas leído (ceph crash ls), ceph crash archive-all.', 'systemd stopped retrying after three crashes in a row: sudo systemctl reset-failed ceph-osd@4 and sudo systemctl start ceph-osd@4. RECENT_CRASH remains afterwards: once you have read it (ceph crash ls), ceph crash archive-all.'),
  ],
  causa: T('osd.4 se colgó tres veces seguidas durante un deep-scrub (el hilo de operaciones superó el suicide timeout) y systemd dejó de reintentarlo al alcanzar el límite de arranques. El disco estaba sano.', 'osd.4 hung three times in a row during a deep-scrub (the op thread exceeded the suicide timeout) and systemd stopped retrying once it hit the start limit. The disk was healthy.'),
  solucion: T('reset-failed y start de ceph-osd@4, comprobación con ceph -s y archivo de los crashes después de leerlos.', 'reset-failed and start of ceph-osd@4, check with ceph -s, and the crashes archived after reading them.'),
  leccion: T('Un OSD caído no pone en riesgo los datos (hay tres copias), pero el reloj corre: a los 10 minutos Ceph lo marca out y mueve más de 1 TiB. Levantarlo a tiempo evita ese movimiento. Y un HEALTH_WARN después de arreglarlo casi siempre es RECENT_CRASH: se lee, se archiva, no se ignora.', 'A down OSD does not put the data at risk (there are three copies), but the clock is ticking: after 10 minutes Ceph marks it out and moves more than 1 TiB. Bringing it back in time avoids that movement. And a HEALTH_WARN after the fix is almost always RECENT_CRASH: you read it, you archive it, you don\'t ignore it.'),
  guion: ['ceph -s', 'ssh ceph02', 'journalctl -u ceph-osd@4 -n 20', 'sudo smartctl -a /dev/sdc', 'sudo systemctl reset-failed ceph-osd@4', 'sudo systemctl start ceph-osd@4', 'exit', 'ceph crash ls', 'ceph crash archive-all', 'sleep 60', 'ceph -s'],
  trampas: [
    { cmds: ['ssh ceph02', 'sudo systemctl restart ceph-osd@4'], porque: T('restart sin reset-failed choca con el límite de arranques de systemd', 'restart without reset-failed hits the systemd start limit') },
    { cmds: ['ceph osd out 4', 'sleep 900'], porque: T('sacar el OSD del clúster no lo arregla', 'taking the OSD out of the cluster does not fix it') },
  ],
},
// ============================================================================ 2
{
  id: 'REQ-1307', clave: 'cuota', tipo: 'peticion', nivel: 1, area: 'OpenStack', funciones: ['openstack'],
  impacto: 'bajo', urgencia: 'media', de: T('Equipo tienda online (Marta Ruiz)', 'Online store team (Marta Ruiz)'),
  asunto: T('Ampliar la cuota de volúmenes de tienda-online en 500 GB', 'Raise the tienda-online volume quota by 500 GB'),
  cuerpo: [T('Vamos a montar la nueva base de datos de pedidos, con un volumen de 500 GB, y al crearlo nos da VolumeLimitExceeded: "Maximum number of gigabytes exceeded".', 'We are setting up the new orders database with a 500 GB volume, and creating it fails with VolumeLimitExceeded: "Maximum number of gigabytes exceeded".'),
    T('¿Podéis ampliarnos la cuota? Lo necesitamos para el despliegue de esta tarde.', 'Could you raise our quota? We need it for this afternoon\'s deployment.')],
  inicio: 0, abierto: 0,
  averias: [{ tipo: 'uso-volumenes', proyecto: 'tienda-online', gb: 950 }],
  objetivo(st) {
    const lim = st.os.proyectos['tienda-online'].cuota.gigabytes;
    return (lim !== -1 && lim < 1450) ? [T('La cuota de gigabytes de tienda-online es ' + lim + ': con 950 usados no caben 500 más (hace falta al menos 1450)', 'The gigabytes quota for tienda-online is ' + lim + ': with 950 used, another 500 do not fit (at least 1450 needed)')] : [];
  },
  practicas: [
    { t: T('Miraste el uso real antes de tocar la cuota (quota show --usage)', 'You checked actual usage before touching the quota (quota show --usage)'), ok: st => antes(st, /quota show/, /quota set/) },
    { t: T('Comprobaste que Ceph tiene sitio para esos 500 GB (ceph df)', 'You checked that Ceph has room for those 500 GB (ceph df)'), ok: st => antes(st, /ceph (df|osd df|-s|status)/, /quota set/) },
    { t: T('Ampliaste lo justo: ni ilimitada (-1) ni el doble', 'You raised it just enough: neither unlimited (-1) nor double'), ok: st => { const l = st.os.proyectos['tienda-online'].cuota.gigabytes; return l !== -1 && l <= 2000; } },
  ],
  pistas: [
    T('Una cuota es un límite administrativo, no espacio real. Mira primero cuánto usan: openstack quota show --usage tienda-online (antes, source ~/admin-openrc).', 'A quota is an administrative limit, not real space. First check how much they use: openstack quota show --usage tienda-online (source ~/admin-openrc first).'),
    T('Antes de prometer 500 GB, comprueba que existen: ceph df, columna MAX AVAIL del pool volumes. Recuerda que con réplica 3 cada GB de volumen son 3 en crudo.', 'Before promising 500 GB, check that they exist: ceph df, MAX AVAIL column of the volumes pool. Remember that with 3x replication every GB of volume is 3 GB raw.'),
    T('openstack quota set --gigabytes 1500 tienda-online. Deja un margen razonable sin regalar espacio que no tienes.', 'openstack quota set --gigabytes 1500 tienda-online. Leave a reasonable margin without giving away space you don\'t have.'),
  ],
  causa: T('El proyecto tenía usados 950 de sus 1000 GB de cuota: un volumen de 500 GB no cabía.', 'The project had used 950 of its 1000 GB quota: a 500 GB volume did not fit.'),
  solucion: T('Comprobación del uso y de la capacidad real de Ceph, y ampliación de la cuota a un valor ajustado.', 'Checked usage and Ceph\'s real capacity, and raised the quota to a tight value.'),
  leccion: T('Cuota y capacidad son dos cosas distintas: la cuota es lo que prometes, la capacidad es lo que tienes. Antes de decir que sí, se miran las dos. Y con réplica 3, 500 GB de volumen son 1,5 TB en crudo.', 'Quota and capacity are two different things: quota is what you promise, capacity is what you have. Before saying yes, check both. And with 3x replication, 500 GB of volume is 1.5 TB raw.'),
  guion: ['source ~/admin-openrc', 'openstack quota show --usage tienda-online', 'ceph df', 'openstack quota set --gigabytes 1500 tienda-online', 'openstack quota show tienda-online'],
  trampas: [{ cmds: ['source ~/admin-openrc', 'openstack quota set --gigabytes 1200 tienda-online'], porque: T('1200 no llega: 950 + 500 = 1450', '1200 is not enough: 950 + 500 = 1450') }],
},
// ============================================================================ 2b
{
  id: 'REQ-1315', clave: 'proyecto', tipo: 'peticion', nivel: 1, area: 'OpenStack', funciones: ['openstack'],
  impacto: 'bajo', urgencia: 'media', de: T('Negocio (apertura de franquicias)', 'Business (franchise openings)'),
  asunto: T('Proyecto nuevo para la franquicia de Valencia', 'New project for the Valencia franchise'),
  cuerpo: [T('Abrimos la franquicia de Valencia y necesita su propio espacio en la nube: un proyecto tienda-valencia y un usuario para su técnico, Javier García (jgarcia, jgarcia@retail.es).', 'We are opening the Valencia franchise and it needs its own space in the cloud: a tienda-valencia project and a user for its technician, Javier García (jgarcia, jgarcia@retail.es).'),
    T('Que pueda trabajar en su proyecto sin tocar nada de los demás. Cuota: 10 instancias, 40 cores y 500 GB de volúmenes.', 'He should be able to work in his project without touching anyone else\'s. Quota: 10 instances, 40 cores and 500 GB of volumes.')],
  inicio: 0, abierto: 0,
  averias: [],
  objetivo(st) {
    const p = [], pr = st.os.proyectos['tienda-valencia'];
    if (!pr) return [T('El proyecto tienda-valencia no existe (openstack project create)', 'Project tienda-valencia does not exist (openstack project create)')];
    if (!st.os.usuarios.jgarcia) p.push(T('El usuario jgarcia no existe (openstack user create)', 'User jgarcia does not exist (openstack user create)'));
    else {
      const r = st.os.roles.filter(x => x.u === 'jgarcia');
      if (r.some(x => x.r === 'admin')) p.push(T('jgarcia tiene el rol admin: en OpenStack, admin en un proyecto es admin de toda la nube', 'jgarcia has the admin role: in OpenStack, admin on one project is admin of the whole cloud'));
      if (!r.some(x => x.p === 'tienda-valencia' && x.r === 'member')) p.push(T('jgarcia no tiene el rol member en tienda-valencia: no podrá trabajar en su proyecto', 'jgarcia does not have the member role on tienda-valencia: he will not be able to work in his project'));
    }
    const q = pr.cuota;
    if (q.instances !== 10 || q.cores !== 40 || q.gigabytes !== 500) p.push(T('La cuota de tienda-valencia es de ' + q.instances + ' instancias, ' + q.cores + ' cores y ' + q.gigabytes + ' GB; se pidieron 10, 40 y 500', 'The tienda-valencia quota is ' + q.instances + ' instances, ' + q.cores + ' cores and ' + q.gigabytes + ' GB; 10, 40 and 500 were requested'));
    return p;
  },
  practicas: [
    { t: T('Contraseña con --password-prompt, no en la línea de comandos (quedaría en el historial)', 'Password via --password-prompt, not on the command line (it would stay in the history)'), ok: st => !st.hechos.passwordEnLinea && usado(st, /user create.*--password-prompt/) },
    { t: T('Comprobaste las asignaciones de rol', 'You checked the role assignments'), ok: st => despues(st, /role assignment list/, /role add/) },
    { t: T('Comprobaste la cuota final', 'You checked the final quota'), ok: st => despues(st, /quota show/, /quota set/) },
  ],
  pistas: [
    T('Son tres piezas de Keystone y una de cuota: proyecto, usuario y rol que los une. Empieza por source ~/admin-openrc y openstack project create.', 'It takes three Keystone pieces and one quota: project, user, and the role that ties them together. Start with source ~/admin-openrc and openstack project create.'),
    T('openstack user create con --project y --password-prompt (así la contraseña no queda en el historial). Después, openstack role add une usuario y proyecto. ¿Qué rol? Mira el RUNBOOK.', 'openstack user create with --project and --password-prompt (so the password does not end up in the history). Then openstack role add ties user and project together. Which role? Check the RUNBOOK.'),
    T('Rol member, nunca admin: en OpenStack, admin da poder sobre toda la nube. La cuota por defecto es de 1000 GB y 20 cores: openstack quota set --instances 10 --cores 40 --gigabytes 500 tienda-valencia.', 'The member role, never admin: in OpenStack, admin grants power over the whole cloud. The default quota is 1000 GB and 20 cores: openstack quota set --instances 10 --cores 40 --gigabytes 500 tienda-valencia.'),
  ],
  causa: T('Petición de alta: proyecto, usuario, rol y cuota para una franquicia nueva.', 'Onboarding request: project, user, role and quota for a new franchise.'),
  solucion: T('Proyecto creado, usuario con contraseña por prompt, rol member en su proyecto, cuota ajustada a lo pedido y comprobación de roles y cuota.', 'Project created, user with a prompted password, member role on his project, quota set to what was requested, and roles and quota checked.'),
  leccion: T('Dar acceso es fácil; darlo justo es el oficio. member en su proyecto y nada más, porque admin en OpenStack no se queda en el proyecto donde lo asignas. La cuota por defecto no es la pedida: 1000 GB de regalo son capacidad prometida que nadie ha planificado. Y una contraseña escrita en la línea de comandos vive para siempre en el historial.', 'Granting access is easy; granting just enough is the craft. member on his project and nothing more, because admin in OpenStack does not stay in the project where you assign it. The default quota is not the requested one: 1000 GB given away is promised capacity nobody has planned for. And a password typed on the command line lives forever in the history.'),
  guion: ['source ~/admin-openrc', 'openstack project create --description "Franquicia Valencia" tienda-valencia', 'openstack user create --project tienda-valencia --email jgarcia@retail.es --password-prompt jgarcia', 'Temporal-2026!', 'Temporal-2026!', 'openstack role add --project tienda-valencia --user jgarcia member', 'openstack role assignment list --project tienda-valencia --names', 'openstack quota set --instances 10 --cores 40 --gigabytes 500 tienda-valencia', 'openstack quota show tienda-valencia'],
  trampas: [
    { cmds: ['source ~/admin-openrc', 'openstack project create tienda-valencia', 'openstack user create --project tienda-valencia --password Temporal-2026! jgarcia', 'openstack role add --project tienda-valencia --user jgarcia admin', 'openstack quota set --instances 10 --cores 40 --gigabytes 500 tienda-valencia'], porque: T('el rol admin no se queda en el proyecto: es admin de toda la nube', 'the admin role does not stay in the project: it is admin of the whole cloud') },
    { cmds: ['source ~/admin-openrc', 'openstack project create tienda-valencia', 'openstack user create --project tienda-valencia --password Temporal-2026! jgarcia', 'openstack role add --project tienda-valencia --user jgarcia member'], porque: T('sin fijar la cuota, el proyecto se queda con la de por defecto', 'without setting the quota, the project keeps the default one') },
  ],
},
// ============================================================================ 3
{
  id: 'INC-4830', clave: 'no-valid-host', tipo: 'incidente', nivel: 2, area: 'OpenStack', funciones: ['openstack', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Desarrollo (pipeline de despliegue)', 'Development (deployment pipeline)'),
  asunto: T('No podemos desplegar pedidos-api v2: "No valid host was found"', 'Can\'t deploy pedidos-api v2: "No valid host was found"'),
  cuerpo: [T('El pipeline de esta mañana intenta crear dos VMs m1.xlarge en tienda-online y las dos acaban en ERROR con "No valid host was found. There are not enough hosts available". Ayer funcionaba.', 'This morning\'s pipeline tries to create two m1.xlarge VMs in tienda-online and both end up in ERROR with "No valid host was found. There are not enough hosts available". It worked yesterday.'),
    T('Si os sirve, podéis borrar las dos VMs fallidas (pedidos-api-v2-01 y pedidos-api-v2-02): el pipeline las vuelve a crear.', 'If it helps, you can delete the two failed VMs (pedidos-api-v2-01 and pedidos-api-v2-02): the pipeline will create them again.')],
  inicio: -15, abierto: -10,
  averias: [
    { tipo: 'servicio-parado', nodo: 'cmp02', servicio: 'libvirtd', hace: 840, deshabilitado: true, exigirHabilitado: false, efecto: T('nova-compute no puede hablar con el hipervisor', 'nova-compute cannot talk to the hypervisor'), nota: { hace: 841, t: 'libvirtd.service: Unit is being upgraded (libvirt-daemon-system 8.0.0-1ubuntu7.10 -> 8.0.0-1ubuntu7.11)' } },
    { tipo: 'servicio-caido', nodo: 'cmp02', servicio: 'nova-compute', motivo: 'sin-libvirt', hace: 839, efecto: T('el scheduler no le manda VMs (openstack compute service list)', 'the scheduler sends it no VMs (openstack compute service list)') },
    { tipo: 'hipervisores-llenos', nodos: ['cmp01', 'cmp03'], proyecto: 'analitica' },
    { tipo: 'vms-en-error', nombres: ['pedidos-api-v2-01', 'pedidos-api-v2-02'], proyecto: 'tienda-online', flavor: 'm1.xlarge', hace: 15 },
  ],
  practicas: [
    { t: T('Leíste el error de nova-compute antes de tocar nada', 'You read the nova-compute error before touching anything'), ok: st => antes(st, /journalctl.*nova-compute|systemctl status nova-compute|nova-compute\.log/, /systemctl (start|restart|enable).*(libvirtd|nova-compute)|nova-compute\.yml/) },
    { t: T('libvirtd queda habilitado: sobrevivirá al próximo reinicio', 'libvirtd is left enabled: it will survive the next reboot'), ok: st => st.hosts.cmp02.svcs.libvirtd.enabled },
    { t: T('Comprobaste que el scheduler vuelve a ver cmp02 (compute service list, hypervisor list o una VM de prueba)', 'You checked that the scheduler sees cmp02 again (compute service list, hypervisor list or a test VM)'), ok: st => despues(st, /compute service list|hypervisor list|server create|server show/, /(start|restart|enable).*(nova-compute|libvirtd)|nova-compute\.yml/) },
    { t: T('Limpiaste las VMs en ERROR que el ticket te autorizaba a borrar', 'You cleaned up the VMs in ERROR that the ticket authorized you to delete'), ok: st => ['pedidos-api-v2-01', 'pedidos-api-v2-02'].every(n => !st.os.servidores.some(s => s.nombre === n)) },
  ],
  pistas: [
    T('"No valid host" significa que el scheduler no encontró sitio. Pregunta a OpenStack qué hipervisores ve y cuánta RAM les queda: openstack compute service list y openstack hypervisor list --long.', '"No valid host" means the scheduler found no room. Ask OpenStack which hypervisors it sees and how much RAM they have left: openstack compute service list and openstack hypervisor list --long.'),
    T('cmp02 aparece down. Entra (ssh cmp02) y lee el error: systemctl status nova-compute. ¿Con quién no consigue hablar?', 'cmp02 shows as down. Log in (ssh cmp02) and read the error: systemctl status nova-compute. What can\'t it talk to?'),
    T('libvirtd está parado y deshabilitado desde la actualización de ayer. sudo systemctl enable --now libvirtd y después sudo systemctl restart nova-compute. O de golpe: desde ~/infra, ansible-playbook playbooks/nova-compute.yml -l cmp02.', 'libvirtd has been stopped and disabled since yesterday\'s upgrade. sudo systemctl enable --now libvirtd and then sudo systemctl restart nova-compute. Or all at once: from ~/infra, ansible-playbook playbooks/nova-compute.yml -l cmp02.'),
  ],
  causa: T('La actualización de libvirt de ayer en cmp02 dejó libvirtd parado y deshabilitado. nova-compute no arranca sin él, así que cmp02 salió del scheduler; cmp01 y cmp03 están casi llenos y una VM de 16 GB ya no cabía en ningún sitio.', 'Yesterday\'s libvirt upgrade on cmp02 left libvirtd stopped and disabled. nova-compute does not start without it, so cmp02 dropped out of the scheduler; cmp01 and cmp03 are nearly full and a 16 GB VM no longer fit anywhere.'),
  solucion: T('libvirtd habilitado y arrancado, nova-compute reiniciado, comprobación en compute service list y limpieza de las VMs en ERROR.', 'libvirtd enabled and started, nova-compute restarted, checked in compute service list, and the VMs in ERROR cleaned up.'),
  leccion: T('"No valid host" casi nunca es falta de hardware: es falta de hardware disponible para el scheduler. Un hipervisor caído no molesta a nadie hasta que los demás se llenan. Y un servicio que arranca a mano pero no está habilitado es una avería aplazada hasta el próximo reinicio.', '"No valid host" is almost never a lack of hardware: it is a lack of hardware available to the scheduler. A down hypervisor bothers nobody until the others fill up. And a service that starts by hand but is not enabled is an outage postponed until the next reboot.'),
  guion: ['source ~/admin-openrc', 'openstack compute service list', 'openstack hypervisor list --long', 'ssh cmp02', 'systemctl status nova-compute', 'sudo systemctl enable --now libvirtd', 'sudo systemctl restart nova-compute', 'exit', 'openstack compute service list', 'openstack server delete pedidos-api-v2-01 pedidos-api-v2-02'],
  trampas: [
    { cmds: ['ssh cmp02', 'sudo systemctl restart nova-compute'], porque: T('sin libvirtd, nova-compute vuelve a caer', 'without libvirtd, nova-compute goes down again') },
    { cmds: ['ssh cmp02', 'sudo reboot', 'sleep 300'], porque: T('reiniciar no arranca un servicio deshabilitado y además apaga las VMs', 'rebooting does not start a disabled service, and it shuts down the VMs too') },
  ],
},
// ============================================================================ 4
{
  id: 'INC-4833', clave: 'disco-lleno', tipo: 'incidente', nivel: 2, area: 'Linux · OpenStack', funciones: ['openstack', 'incid', 'auto'],
  impacto: 'alto', urgencia: 'alta', de: T('Atención al cliente (tiendas)', 'Customer support (stores)'),
  asunto: T('Horizon va lentísimo y a ratos da error 500', 'Horizon is extremely slow and intermittently returns error 500'),
  cuerpo: [T('Desde hace unos 40 minutos varias tiendas se quejan de que el panel va muy lento, y algunas operaciones fallan con un error 500. Si repites la misma acción, a veces funciona.', 'For about 40 minutes several stores have been complaining that the dashboard is very slow, and some operations fail with a 500 error. If you repeat the same action, it sometimes works.'),
    T('El equipo de desarrollo dice que no han desplegado nada hoy.', 'The development team says they haven\'t deployed anything today.')],
  inicio: -41, abierto: -12,
  averias: [
    { tipo: 'rabbit-debug', nodo: 'ctl02', soloPractica: true },
    { tipo: 'disco-lleno', nodo: 'ctl02', fichero: '/var/log/rabbitmq/rabbit@ctl02.log', mb: 31000 },
    { tipo: 'servicio-caido', nodo: 'ctl02', servicio: 'rabbitmq-server', motivo: 'sin-espacio', hace: 41, efecto: 'systemctl status rabbitmq-server' },
  ],
  practicas: [
    { t: T('Buscaste qué ocupa el espacio (du) antes de borrar nada', 'You found what was taking up the space (du) before deleting anything'), ok: st => antes(st, /\bdu\b/, /\brm\b|truncate|vacuum|logrotate\.yml/) },
    { t: T('Corregiste la causa: RabbitMQ ya no escribe en debug (logrotate.yml)', 'You fixed the cause: RabbitMQ no longer logs at debug level (logrotate.yml)'), ok: st => !st.hosts.ctl02.extra.rabbitDebug },
    { t: T('Comprobaste que el clúster de RabbitMQ vuelve a tener sus tres nodos', 'You checked that the RabbitMQ cluster has its three nodes again'), ok: st => usado(st, /rabbitmqctl cluster_status/) },
  ],
  pistas: [
    T('Errores intermitentes detrás de un balanceador suelen ser un nodo malo de tres. Mira las alertas de la flota (amtool alert) y ve al nodo que se queja.', 'Intermittent errors behind a load balancer usually mean one bad node out of three. Check the fleet alerts (amtool alert) and go to the node that is complaining.'),
    T('En ctl02: df -h, y luego du -sh /var/log/* para encontrar al culpable. Mira también systemctl status rabbitmq-server.', 'On ctl02: df -h, then du -sh /var/log/* to find the culprit. Also check systemctl status rabbitmq-server.'),
    T('El log de RabbitMQ pesa 30 GB porque alguien lo dejó en debug. Desde ~/infra, ansible-playbook playbooks/logrotate.yml -l ctl02 lo pone en info, rota el log y reinicia RabbitMQ. A mano: sudo truncate -s 0 del log y sudo systemctl restart rabbitmq-server, pero el debug seguiría ahí.', 'The RabbitMQ log is 30 GB because someone left it at debug level. From ~/infra, ansible-playbook playbooks/logrotate.yml -l ctl02 sets it to info, rotates the log and restarts RabbitMQ. By hand: sudo truncate -s 0 on the log and sudo systemctl restart rabbitmq-server, but debug would still be on.'),
  ],
  causa: T('Alguien dejó RabbitMQ en nivel debug en ctl02 durante una prueba. El log creció hasta 30 GB, llenó /var y RabbitMQ se cayó. Los servicios de ctl02 se quedan sin cola de mensajes y una de cada tres peticiones a la API acaba en 500.', 'Someone left RabbitMQ at debug level on ctl02 during a test. The log grew to 30 GB, filled /var and RabbitMQ went down. The services on ctl02 are left without a message queue, and one in three API requests ends in a 500.'),
  solucion: T('Localización del log con du, playbook logrotate.yml (nivel info, rotación y reinicio de RabbitMQ) y comprobación del clúster con rabbitmqctl.', 'Log located with du, logrotate.yml playbook (info level, rotation and RabbitMQ restart), and cluster checked with rabbitmqctl.'),
  leccion: T('Un disco lleno es un síntoma: la pregunta es quién lo llena y por qué. Liberar espacio sin corregir el nivel de log compra horas, no una solución. Y fíjate en el patrón: fallos intermitentes = un nodo de tres está mal.', 'A full disk is a symptom: the question is who is filling it and why. Freeing space without fixing the log level buys you hours, not a solution. And notice the pattern: intermittent failures = one node out of three is bad.'),
  guion: ['amtool alert', 'ssh ctl02', 'df -h', 'du -sh /var/log/*', 'du -sh /var/log/rabbitmq/*', 'exit', 'cd infra', 'ansible-playbook playbooks/logrotate.yml -l ctl02', 'ssh ctl02', 'sudo rabbitmqctl cluster_status'],
  trampas: [
    { cmds: ['ssh ctl02', 'sudo systemctl restart rabbitmq-server'], porque: T('sin espacio no arranca', 'with no space left it won\'t start') },
    { cmds: ['ssh ctl02', 'sudo journalctl --vacuum-size=100M', 'sudo systemctl restart rabbitmq-server'], porque: T('el journal no es lo que llena /var', 'the journal is not what is filling /var') },
  ],
},
// ============================================================================ 5
{
  id: 'INC-4836', clave: 'reloj', tipo: 'incidente', nivel: 2, area: 'Ceph · Ansible', funciones: ['ceph', 'auto', 'incid'],
  impacto: 'medio', urgencia: 'media', de: T('Monitorización (Alertmanager)', 'Monitoring (Alertmanager)'),
  asunto: T('Ceph en HEALTH_WARN: clock skew detected on mon.ceph03', 'Ceph in HEALTH_WARN: clock skew detected on mon.ceph03'),
  cuerpo: [T('Ceph ha pasado a HEALTH_WARN por desfase horario en uno de sus monitores. Por ahora el clúster funciona, pero si el desfase crece los monitores pueden perder el quórum.', 'Ceph has gone to HEALTH_WARN due to clock skew on one of its monitors. The cluster works for now, but if the skew grows the monitors may lose quorum.'),
    T('Esta madrugada hubo pruebas con los servidores NTP internos.', 'There were tests on the internal NTP servers early this morning.')],
  inicio: -47, abierto: -20,
  averias: [
    { tipo: 'reloj-desfasado', nodo: 'ceph03', segundos: 0.912, hace: 300 },
    { tipo: 'reloj-desfasado', nodo: 'cmp01', segundos: 0.341, hace: 290 },
  ],
  practicas: [
    { t: T('Miraste las alertas de toda la flota, no sólo la de Ceph', 'You checked the alerts for the whole fleet, not just Ceph\'s'), ok: st => usado(st, /amtool alert|ansible .*(timedatectl|chronyc)/) },
    { t: T('Arreglaste la flota con Ansible (chrony.yml), no nodo a nodo', 'You fixed the fleet with Ansible (chrony.yml), not node by node'), ok: st => pb(st, 'chrony.yml').length > 0 },
    { t: T('chrony queda habilitado en los dos nodos', 'chrony is left enabled on both nodes'), ok: st => st.hosts.ceph03.svcs.chrony.enabled && st.hosts.cmp01.svcs.chrony.enabled },
  ],
  pistas: [
    T('MON_CLOCK_SKEW: un monitor de Ceph tiene la hora mal. Lee ceph health detail y después las alertas de toda la flota: amtool alert.', 'MON_CLOCK_SKEW: a Ceph monitor has the wrong time. Read ceph health detail and then the alerts for the whole fleet: amtool alert.'),
    T('En ceph03: timedatectl y chronyc tracking. ¿Está chrony corriendo? ¿Y en los demás? Desde ~/infra, ansible all -m shell -a "timedatectl | grep synchronized" te lo dice de una vez.', 'On ceph03: timedatectl and chronyc tracking. Is chrony running? What about the others? From ~/infra, ansible all -m shell -a "timedatectl | grep synchronized" tells you in one go.'),
    T('chrony está parado y deshabilitado en ceph03 y en cmp01. Desde ~/infra, ansible-playbook playbooks/chrony.yml lo arranca, lo habilita y fuerza la sincronización en toda la flota. A mano harían falta enable --now y chronyc makestep en cada nodo.', 'chrony is stopped and disabled on ceph03 and cmp01. From ~/infra, ansible-playbook playbooks/chrony.yml starts it, enables it and forces a sync across the whole fleet. By hand you would need enable --now and chronyc makestep on each node.'),
  ],
  causa: T('chrony quedó parado y deshabilitado en ceph03 y en cmp01 tras las pruebas de NTP de esta madrugada. Ceph detecta el desfase en su monitor de ceph03; el de cmp01 sólo lo ve Prometheus.', 'chrony was left stopped and disabled on ceph03 and cmp01 after this morning\'s NTP tests. Ceph detects the skew on its ceph03 monitor; the one on cmp01 is only seen by Prometheus.'),
  solucion: T('Playbook chrony.yml en toda la flota: chrony arrancado y habilitado donde faltaba y sincronización forzada.', 'chrony.yml playbook across the whole fleet: chrony started and enabled where it was missing, and a sync forced.'),
  leccion: T('El síntoma te enseña un nodo; el problema puede estar en varios. Para eso existen las herramientas de flota: un playbook idempotente arregla los que están mal y no toca los que están bien. Y chrony corrige despacio a propósito: si necesitas la hora ya, makestep.', 'The symptom shows you one node; the problem may be on several. That is what fleet tools are for: an idempotent playbook fixes the ones that are wrong and leaves the healthy ones alone. And chrony corrects slowly on purpose: if you need the right time now, makestep.'),
  guion: ['ceph health detail', 'amtool alert', 'cd infra', 'ansible all -m shell -a "timedatectl | grep synchronized"', 'ansible-playbook playbooks/chrony.yml', 'ceph -s'],
  trampas: [{ cmds: ['ssh ceph03', 'sudo systemctl start chrony'], porque: T('arranca, pero sin makestep tarda media hora en corregir y cmp01 sigue mal', 'it starts, but without makestep it takes half an hour to correct and cmp01 is still wrong') }],
},
// ============================================================================ 6
{
  id: 'INC-4840', clave: 'nearfull', tipo: 'incidente', nivel: 2, area: 'Ceph', funciones: ['ceph', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Monitorización (Alertmanager)', 'Monitoring (Alertmanager)'),
  asunto: T('CephOSDNearFull: osd.7 al 87 %', 'CephOSDNearFull: osd.7 at 87%'),
  cuerpo: [T('Alertmanager avisa de que osd.7 ha pasado el umbral de casi lleno. Ceph está en HEALTH_WARN con todos los pools marcados nearfull.', 'Alertmanager reports that osd.7 has crossed the nearfull threshold. Ceph is in HEALTH_WARN with every pool flagged nearfull.'),
    T('Si ese OSD llega al 95 %, el clúster entero dejará de aceptar escrituras.', 'If that OSD reaches 95%, the whole cluster will stop accepting writes.')],
  inicio: -95, abierto: -30,
  averias: [
    { tipo: 'balancer-apagado', osd: 7, exceso: 29.5 },
    { tipo: 'registro-ceph', lineas: [{ hace: 95, sev: 'WRN', t: 'Health check failed: 1 nearfull osd(s) (OSD_NEARFULL)' }] },
  ],
  practicas: [
    { t: T('Miraste el reparto por OSD (ceph osd df) antes de actuar', 'You checked the per-OSD distribution (ceph osd df) before acting'), ok: st => antes(st, /ceph osd df/, /balancer on|reweight|set-nearfull/) },
    { t: T('Encendiste el balancer: arreglas la causa, no sólo este OSD', 'You turned the balancer on: you fixed the cause, not just this OSD'), ok: st => st.ceph.balancer.activo },
    { t: T('No tocaste los umbrales para callar la alarma', 'You did not touch the thresholds to silence the alarm'), ok: st => !st.hechos.umbralSubido },
  ],
  pistas: [
    T('Un clúster al 60 % no debería tener un OSD casi lleno. Mira el reparto: ceph osd df. Fíjate en la columna VAR y en STDDEV.', 'A cluster at 60% should not have a nearly full OSD. Check the distribution: ceph osd df. Look at the VAR column and at STDDEV.'),
    T('Un OSD muy por encima de la media es un problema de reparto, no de capacidad. ¿Quién reparte en Ceph? ceph balancer status.', 'An OSD far above the average is a distribution problem, not a capacity one. Who distributes data in Ceph? ceph balancer status.'),
    T('El balancer está apagado desde una migración. ceph balancer on y deja que trabaje (sleep 420, luego ceph osd df). Si hubiera prisa, ceph osd reweight-by-utilization quita peso al OSD cargado mientras tanto.', 'The balancer has been off since a migration. ceph balancer on and let it work (sleep 420, then ceph osd df). If you were in a hurry, ceph osd reweight-by-utilization takes weight off the loaded OSD in the meantime.'),
  ],
  causa: T('El balancer se apagó durante la migración de la semana pasada y nadie lo volvió a encender. Sin él, CRUSH reparte con varianza y osd.7 fue acumulando datos hasta el 87 %.', 'The balancer was switched off during last week\'s migration and nobody turned it back on. Without it, CRUSH distributes with variance and osd.7 kept accumulating data up to 87%.'),
  solucion: T('Balancer encendido (modo upmap) y espera a que redistribuya; comprobación con ceph osd df.', 'Balancer turned on (upmap mode) and waited for it to redistribute; checked with ceph osd df.'),
  leccion: T('Ceph se llena por el OSD más lleno, no por la media: con uno al 95 % el clúster deja de escribir aunque queden 6 TiB libres. Mira siempre ceph osd df, no sólo ceph df. Y subir nearfull_ratio es quitarle las pilas al detector de humo porque pita.', 'Ceph fills up by its fullest OSD, not by the average: with one at 95% the cluster stops writing even with 6 TiB free. Always check ceph osd df, not just ceph df. And raising nearfull_ratio is pulling the batteries out of the smoke detector because it beeps.'),
  guion: ['ceph health detail', 'ceph osd df', 'ceph balancer status', 'ceph balancer on', 'sleep 420', 'ceph osd df', 'ceph -s'],
  trampas: [{ cmds: ['ceph osd set-nearfull-ratio 0.9'], porque: T('calla la alarma sin mover un byte', 'silences the alarm without moving a single byte') }],
},
// ============================================================================ 6b
{
  id: 'INC-4861', clave: 'certificado', tipo: 'incidente', nivel: 2, area: 'OpenStack · Ansible', funciones: ['openstack', 'auto', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Desarrollo y atención al cliente', 'Development and customer support'),
  asunto: T('La API de OpenStack rechaza las conexiones: "certificate has expired"', 'The OpenStack API rejects connections: "certificate has expired"'),
  cuerpo: [T('Desde las 08:20 ningún pipeline consigue hablar con OpenStack y Horizon muestra un aviso de seguridad en el navegador. El error es siempre el mismo: CERTIFICATE_VERIFY_FAILED, certificate has expired.', 'Since 08:20 no pipeline can talk to OpenStack, and Horizon shows a security warning in the browser. The error is always the same: CERTIFICATE_VERIFY_FAILED, certificate has expired.'),
    T('Las VMs que ya estaban funcionando siguen funcionando.', 'VMs that were already running are still running.')],
  inicio: -52, abierto: -12,
  averias: [{ tipo: 'certificado-caducado', hace: 52 }],
  practicas: [
    { t: T('Confirmaste la caducidad (curl u openssl) antes de tocar nada', 'You confirmed the expiry (curl or openssl) before touching anything'), ok: st => antes(st, /openssl|curl/, /certs\.yml|(restart|reload) haproxy/) },
    { t: T('Renovaste con Ansible en los tres controladores, no sólo en el de la VIP', 'You renewed with Ansible on all three controllers, not just the one holding the VIP'), ok: st => pb(st, 'certs.yml').some(x => !x.limite || /controllers|all/.test(x.limite)) },
    { t: T('Comprobaste desde fuera que la API vuelve a responder', 'You checked from outside that the API responds again'), ok: st => despues(st, /openssl s_client|curl|openstack /, /certs\.yml|(restart|reload) haproxy/) },
  ],
  pistas: [
    T('El error lo dice todo, pero confírmalo tú: curl -I https://api.retail.local:5000, u openssl s_client -connect api.retail.local:5000. ¿Qué fecha tiene el certificado?', 'The error says it all, but confirm it yourself: curl -I https://api.retail.local:5000, or openssl s_client -connect api.retail.local:5000. What dates does the certificate show?'),
    T('La VIP de la API la sirve HAProxy en los controladores. En ctl01: openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates. Dónde está el certificado renovado lo dice el RUNBOOK (cat ~/RUNBOOK.md).', 'The API VIP is served by HAProxy on the controllers. On ctl01: openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates. The RUNBOOK says where the renewed certificate is (cat ~/RUNBOOK.md).'),
    T('Desde ~/infra, ansible-playbook playbooks/certs.yml copia el certificado renovado a los tres controladores y recarga HAProxy. Reiniciar HAProxy sin cambiar el fichero no sirve: volvería a cargar el caducado.', 'From ~/infra, ansible-playbook playbooks/certs.yml copies the renewed certificate to all three controllers and reloads HAProxy. Restarting HAProxy without changing the file does not help: it would load the expired one again.'),
  ],
  causa: T('El certificado de api.retail.local caducó a las 08:20. Se renovaba con un cron en ctl01 que desapareció al reinstalar el nodo en agosto; el certificado nuevo llevaba un mes en el repositorio de Ansible sin que nadie lo desplegara.', 'The api.retail.local certificate expired at 08:20. It used to be renewed by a cron job on ctl01 that disappeared when the node was reinstalled in August; the new certificate had been sitting in the Ansible repository for a month without anyone deploying it.'),
  solucion: T('Confirmación con curl y openssl, despliegue con certs.yml en los tres controladores (copia y recarga de HAProxy) y comprobación desde fuera.', 'Confirmed with curl and openssl, deployed with certs.yml to all three controllers (copy and HAProxy reload), and checked from outside.'),
  leccion: T('Un certificado caduca a una hora exacta y lo tumba todo a la vez: por eso se vigila con una alerta a 30 días, no el día que falla. Y fíjate en las dos mitades: el fichero en disco y lo que el servicio tiene cargado en memoria. Hasta que HAProxy no recarga, el certificado nuevo no existe para nadie.', 'A certificate expires at an exact time and takes everything down at once: that is why it is monitored with an alert 30 days ahead, not on the day it fails. And notice the two halves: the file on disk and what the service has loaded in memory. Until HAProxy reloads, the new certificate does not exist for anyone.'),
  guion: ['source ~/admin-openrc', 'openstack server list --all-projects', 'curl -I https://api.retail.local:5000', 'ssh ctl01', 'openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates', 'exit', 'cd infra', 'ansible-playbook playbooks/certs.yml', 'openssl s_client -connect api.retail.local:5000', 'openstack server list --all-projects'],
  trampas: [
    { cmds: ['ssh ctl01', 'sudo systemctl restart haproxy'], porque: T('reiniciar vuelve a cargar el mismo certificado caducado', 'restarting loads the same expired certificate again') },
    { cmds: ['cd infra', 'ansible-playbook playbooks/certs.yml -l ctl01'], porque: T('sólo arregla el controlador de la VIP: si keepalived la mueve, vuelve el error', 'it only fixes the controller holding the VIP: if keepalived moves it, the error comes back') },
  ],
},
// ============================================================================ 6c
{
  id: 'INC-4866', clave: 'galera', tipo: 'incidente', nivel: 2, area: 'OpenStack · MariaDB', funciones: ['openstack', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Monitorización (Alertmanager)', 'Monitoring (Alertmanager)'),
  asunto: T('GaleraClusterSizeLow: la base de datos de OpenStack va con 2 de 3 nodos', 'GaleraClusterSizeLow: the OpenStack database is running on 2 of 3 nodes'),
  cuerpo: [T('mysqld_exporter avisa de que el clúster Galera que usan todos los servicios de OpenStack ha bajado a 2 nodos. Todo sigue funcionando: con 2 de 3 hay quórum.', 'mysqld_exporter reports that the Galera cluster used by every OpenStack service has dropped to 2 nodes. Everything still works: with 2 of 3 there is quorum.'),
    T('Pero si cae otro, la base de datos se detiene y con ella toda la nube.', 'But if another one fails, the database stops, and the whole cloud with it.')],
  inicio: -18, abierto: -15,
  averias: [{ tipo: 'servicio-caido', nodo: 'ctl03', servicio: 'mariadb', motivo: 'oom', hace: 18 }],
  practicas: [
    { t: T('Miraste el tamaño del clúster antes de tocar nada', 'You checked the cluster size before touching anything'), ok: st => antes(st, /wsrep/, /(start|restart) mariadb|galera_new_cluster/) },
    { t: T('Buscaste por qué cayó: el OOM killer (dmesg o journal)', 'You looked for why it went down: the OOM killer (dmesg or journal)'), ok: st => antes(st, /dmesg|journalctl.*mariadb|status mariadb/, /(start|restart) mariadb|galera_new_cluster/) },
    { t: T('No usaste galera_new_cluster con el clúster vivo', 'You did not use galera_new_cluster with the cluster alive'), ok: st => !usado(st, /galera_new_cluster/) },
  ],
  pistas: [
    T('Pregunta a la base de datos desde un nodo sano: en ctl01, sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'". ¿Cuántos miembros ve y quién falta?', 'Ask the database from a healthy node: on ctl01, sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'". How many members does it see, and who is missing?'),
    T('En ctl03: systemctl status mariadb y sudo dmesg | tail. ¿Qué mató a mariadbd?', 'On ctl03: systemctl status mariadb and sudo dmesg | tail. What killed mariadbd?'),
    T('Con el clúster vivo, un nodo caído se une solo con un arranque normal: sudo systemctl start mariadb. galera_new_cluster sirve para arrancar un clúster desde cero: con los otros dos en marcha crearías dos bases de datos separadas.', 'With the cluster alive, a down node rejoins on its own with a normal start: sudo systemctl start mariadb. galera_new_cluster is for bootstrapping a cluster from scratch: with the other two running you would create two separate databases.'),
  ],
  causa: T('El OOM killer de ctl03 mató mariadbd: nova-api tenía una fuga de memoria y el kernel eligió al proceso que más ocupaba. El clúster Galera siguió con dos nodos.', 'The OOM killer on ctl03 killed mariadbd: nova-api had a memory leak and the kernel picked the process using the most memory. The Galera cluster carried on with two nodes.'),
  solucion: T('Tamaño del clúster comprobado desde ctl01, OOM confirmado en ctl03, arranque normal de mariadb (se une por IST) y comprobación de wsrep_cluster_size = 3. Queda un problema aparte: la fuga de memoria de nova-api.', 'Cluster size checked from ctl01, OOM confirmed on ctl03, normal start of mariadb (it rejoins via IST) and wsrep_cluster_size = 3 verified. A separate problem remains: the nova-api memory leak.'),
  leccion: T('Galera aguanta perder un nodo de tres, no dos: un nodo caído es un aviso con reloj. A un clúster vivo se vuelve con un arranque normal; galera_new_cluster crea un clúster nuevo, y hacerlo con los demás en marcha es la forma más rápida de tener dos bases de datos que divergen. Y el OOM killer mata al que más memoria ocupa, no al culpable.', 'Galera survives losing one node out of three, not two: a down node is a warning with a clock on it. You rejoin a live cluster with a normal start; galera_new_cluster creates a new cluster, and doing that with the others running is the fastest way to end up with two diverging databases. And the OOM killer kills whoever uses the most memory, not the culprit.'),
  guion: ['amtool alert', 'ssh ctl01', 'sudo mysql -e "SHOW STATUS LIKE \'wsrep_cluster_size\'"', 'exit', 'ssh ctl03', 'sudo dmesg | tail -n 5', 'systemctl status mariadb', 'sudo systemctl start mariadb', 'sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'"'],
  trampas: [{ cmds: ['ssh ctl03', 'sudo galera_new_cluster'], porque: T('arrancar un clúster nuevo con los otros vivos provoca un split-brain', 'bootstrapping a new cluster while the others are alive causes a split-brain') }],
},
// ============================================================================ 6d
{
  id: 'INC-4875', clave: 'sin-red', tipo: 'incidente', nivel: 2, area: T('OpenStack · Red', 'OpenStack · Networking'), funciones: ['openstack', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Equipo tienda online', 'Online store team'),
  asunto: T('web-tienda-01 y pedidos-api-01 no responden, pero están ACTIVE', 'web-tienda-01 and pedidos-api-01 are not responding, but they are ACTIVE'),
  cuerpo: [T('El balanceador ha sacado web-tienda-01 y pedidos-api-01 porque no responden. En OpenStack aparecen ACTIVE y en la consola se ven arrancadas. Las demás web siguen bien.', 'The load balancer has pulled web-tienda-01 and pedidos-api-01 because they are not responding. In OpenStack they show as ACTIVE and on the console they look booted. The other web servers are fine.'),
    T('No hemos tocado nada.', 'We haven\'t touched anything.')],
  inicio: -26, abierto: -8,
  averias: [
    { tipo: 'servicio-caido', nodo: 'cmp01', servicio: 'openvswitch-switch', motivo: 'ovs-lock', hace: 26, efecto: T('sin él no hay red para las VMs', 'without it the VMs have no network'), nota: { hace: 27, t: 'openvswitch-switch.service: unattended-upgrades: openvswitch-switch 2.17.9-0ubuntu0.22.04.1 -> 2.17.9-0ubuntu0.22.04.2, restarting' } },
    { tipo: 'servicio-caido', nodo: 'cmp01', servicio: 'neutron-openvswitch-agent', motivo: 'sin-ovs', hace: 26, efecto: 'openstack network agent list' },
  ],
  practicas: [
    { t: T('Acotaste el radio: sólo fallan las VMs de un hipervisor', 'You narrowed the blast radius: only the VMs on one hypervisor are failing'), ok: st => usado(st, /^ping 10\.|server list.*--host|network agent list/) },
    { t: T('Leíste el error del agente antes de reiniciar nada', 'You read the agent\'s error before restarting anything'), ok: st => antes(st, /journalctl.*(neutron|openvswitch)|status (neutron-openvswitch-agent|openvswitch-switch)/, /(start|restart) (neutron-openvswitch-agent|openvswitch-switch)|nova-compute\.yml/) },
    { t: T('Comprobaste la red al final (ovs-vsctl, network agent list o ping)', 'You checked the network at the end (ovs-vsctl, network agent list or ping)'), ok: st => despues(st, /network agent list|ovs-vsctl show|^ping 10\./, /(start|restart) (neutron-openvswitch-agent|openvswitch-switch)|nova-compute\.yml/) },
  ],
  pistas: [
    T('¿Fallan todas las VMs o sólo algunas? Mira dónde viven las que no responden (openstack server show web-tienda-01) y haz ping a su IP y a la de una web de otro hipervisor.', 'Are all VMs failing or only some? Check where the unresponsive ones live (openstack server show web-tienda-01) and ping their IP and that of a web server on another hypervisor.'),
    T('openstack network agent list: el agente de Open vSwitch de cmp01 aparece XXX. En cmp01, systemctl status neutron-openvswitch-agent: ¿a qué no consigue conectarse?', 'openstack network agent list: the Open vSwitch agent on cmp01 shows XXX. On cmp01, systemctl status neutron-openvswitch-agent: what can\'t it connect to?'),
    T('El agente necesita Open vSwitch, y Open vSwitch no volvió tras la actualización de esta mañana. Primero sudo systemctl start openvswitch-switch, después sudo systemctl restart neutron-openvswitch-agent. Compruébalo con sudo ovs-vsctl show.', 'The agent needs Open vSwitch, and Open vSwitch did not come back after this morning\'s upgrade. First sudo systemctl start openvswitch-switch, then sudo systemctl restart neutron-openvswitch-agent. Verify with sudo ovs-vsctl show.'),
  ],
  causa: T('La actualización automática de Open vSwitch de esta mañana reinició el servicio en cmp01 mientras otro proceso aún tenía bloqueada su base de datos, y no volvió a arrancar. Sin Open vSwitch cayó también el agente de neutron, y las VMs de cmp01 se quedaron sin red aunque seguían encendidas.', 'This morning\'s automatic Open vSwitch upgrade restarted the service on cmp01 while another process still held a lock on its database, and it did not come back up. Without Open vSwitch the neutron agent went down too, and the VMs on cmp01 lost their network even though they were still running.'),
  solucion: T('Radio del fallo acotado a cmp01 (ping y network agent list), Open vSwitch arrancado primero y el agente después, y comprobación con ovs-vsctl show y ping.', 'Blast radius narrowed to cmp01 (ping and network agent list), Open vSwitch started first and the agent after, and checked with ovs-vsctl show and ping.'),
  leccion: T('Una VM puede estar ACTIVE y sin red a la vez: el estado de nova habla de la máquina, no de su conectividad. Cuando algo falla, primero se acota el radio (¿una VM, un nodo, todo?) y después se sigue la cadena de dependencias de abajo arriba: Open vSwitch antes que el agente que lo usa.', 'A VM can be ACTIVE and have no network at the same time: the nova state describes the machine, not its connectivity. When something fails, first narrow the blast radius (one VM, one node, everything?) and then follow the dependency chain from the bottom up: Open vSwitch before the agent that uses it.'),
  guion: st => { const ip = n => st.os.servidores.find(s => s.nombre === n).ip; return ['source ~/admin-openrc', 'openstack server show web-tienda-01', 'ping ' + ip('web-tienda-01'), 'ping ' + ip('web-tienda-02'), 'openstack network agent list', 'ssh cmp01', 'systemctl status neutron-openvswitch-agent', 'sudo systemctl start openvswitch-switch', 'sudo systemctl restart neutron-openvswitch-agent', 'sudo ovs-vsctl show', 'exit', 'ping ' + ip('web-tienda-01')]; },
  trampas: [
    { cmds: ['ssh cmp01', 'sudo systemctl restart neutron-openvswitch-agent'], porque: T('sin Open vSwitch, el agente vuelve a caer', 'without Open vSwitch, the agent goes down again') },
    { cmds: ['ssh cmp01', 'sudo reboot', 'sleep 300'], porque: T('reiniciar el hipervisor apaga las VMs de los clientes', 'rebooting the hypervisor shuts down the customers\' VMs') },
  ],
},
// ============================================================================ 6e
{
  id: 'REQ-1319', clave: 'restaurar', tipo: 'peticion', nivel: 2, area: T('OpenStack · Copias', 'OpenStack · Backups'), funciones: ['openstack'],
  impacto: 'alto', urgencia: 'media', de: T('Equipo tienda online (Marta Ruiz)', 'Online store team (Marta Ruiz)'),
  asunto: T('Restaurar redis-carrito-02, borrada por error', 'Restore redis-carrito-02, deleted by mistake'),
  cuerpo: [T('Esta mañana, limpiando VMs de pruebas, borramos redis-carrito-02 por error: el filtro cogió "redis-carrito-0*". El carrito funciona con la otra, pero sin redundancia.', 'This morning, while cleaning up test VMs, we deleted redis-carrito-02 by mistake: the filter matched "redis-carrito-0*". The cart works with the other one, but without redundancy.'),
    T('Necesitamos que vuelva con los datos de la copia de esta noche, con el mismo nombre y en nuestro proyecto. La IP da igual: la aplicación la encuentra por DNS.', 'We need it back with the data from last night\'s backup, with the same name and in our project. The IP doesn\'t matter: the application finds it through DNS.')],
  inicio: -95, abierto: -20,
  averias: [{ tipo: 'vm-borrada', vm: 'redis-carrito-02' }],
  practicas: [
    { t: T('Buscaste las copias disponibles (image list)', 'You looked for the available backups (image list)'), ok: st => usado(st, /image list/) },
    { t: T('Leíste en la copia cómo era la VM original (image show) antes de recrearla', 'You read from the backup what the original VM looked like (image show) before recreating it'), ok: st => antes(st, /image show backup-redis-carrito-02/, /server create/) },
    { t: T('Comprobaste que arrancó (server show o server list)', 'You checked that it booted (server show or server list)'), ok: st => despues(st, /server (show|list)/, /server create/) },
  ],
  pistas: [
    T('Las copias nocturnas son imágenes: openstack image list (tras source ~/admin-openrc). Busca la más reciente de esa VM.', 'The nightly backups are images: openstack image list (after source ~/admin-openrc). Find the most recent one for that VM.'),
    T('openstack image show de la copia te dice cómo era la VM original: flavor, red y proyecto. Con esos datos se recrea igual.', 'openstack image show on the backup tells you what the original VM looked like: flavor, network and project. With that data you recreate it exactly.'),
    T('Cuidado con el proyecto: con las credenciales de admin, la VM nacería en admin y tienda-online no la vería. openstack --os-project-name tienda-online server create --flavor m1.medium --image backup-redis-carrito-02-20260923 --network retail-net redis-carrito-02.', 'Watch the project: with admin credentials, the VM would be created in admin and tienda-online would not see it. openstack --os-project-name tienda-online server create --flavor m1.medium --image backup-redis-carrito-02-20260923 --network retail-net redis-carrito-02.'),
  ],
  causa: T('Una limpieza de VMs de pruebas con un filtro demasiado amplio (redis-carrito-0*) borró una VM de producción. La copia nocturna de las 03:00 estaba disponible como imagen.', 'A cleanup of test VMs with an overly broad filter (redis-carrito-0*) deleted a production VM. The 03:00 nightly backup was available as an image.'),
  solucion: T('Copia localizada con image list, datos de la VM original leídos con image show, VM recreada desde la copia en su proyecto con el mismo flavor y la misma red, y comprobación de que arranca.', 'Backup located with image list, original VM details read with image show, VM recreated from the backup in its project with the same flavor and network, and checked that it boots.'),
  leccion: T('Restaurar no es sólo tener la copia: es dejar las cosas como estaban, en el mismo proyecto, con el mismo tamaño y en la misma red. Y todo lo escrito entre las 03:00 y el borrado se ha perdido: por eso importa cada cuánto se hace la copia (el RPO), no sólo que exista.', 'Restoring is not just having the backup: it is putting things back as they were, in the same project, with the same size and on the same network. And everything written between 03:00 and the deletion is lost: that is why how often you back up (the RPO) matters, not just that a backup exists.'),
  guion: ['source ~/admin-openrc', 'openstack server list --project tienda-online', 'openstack image list', 'openstack image show backup-redis-carrito-02-20260923', 'openstack --os-project-name tienda-online server create --flavor m1.medium --image backup-redis-carrito-02-20260923 --network retail-net redis-carrito-02', 'sleep 60', 'openstack server show redis-carrito-02'],
  trampas: [
    { cmds: ['source ~/admin-openrc', 'openstack server create --flavor m1.medium --image backup-redis-carrito-02-20260923 --network retail-net redis-carrito-02', 'sleep 60'], porque: T('con las credenciales de admin nace en el proyecto admin', 'with admin credentials it is created in the admin project') },
    { cmds: ['source ~/admin-openrc', 'openstack --os-project-name tienda-online server create --flavor m1.medium --image ubuntu-22.04 --network retail-net redis-carrito-02', 'sleep 60'], porque: T('una imagen limpia no tiene los datos', 'a clean image doesn\'t have the data') },
  ],
},
// ============================================================================ 6f
{
  id: 'INC-4880', clave: 'volumen-atascado', tipo: 'incidente', nivel: 2, area: 'OpenStack · Cinder', funciones: ['openstack', 'incid'],
  impacto: 'medio', urgencia: 'media', de: T('Equipo tienda online (Marta Ruiz)', 'Online store team (Marta Ruiz)'),
  asunto: T('El volumen pedidos-db-old lleva desde ayer en «deleting»', 'Volume pedidos-db-old has been stuck in "deleting" since yesterday'),
  cuerpo: [T('Ayer por la tarde borramos pedidos-db-old (400 GB) y sigue en «deleting». Nos cuenta en la cuota y no podemos crear el volumen de la nueva base de datos.', 'Yesterday afternoon we deleted pedidos-db-old (400 GB) and it is still in "deleting". It counts against our quota and we can\'t create the volume for the new database.'),
    T('Hemos intentado borrarlo otra vez y OpenStack no nos deja.', 'We tried deleting it again and OpenStack won\'t let us.')],
  inicio: -1082, abierto: -30,
  averias: [
    { tipo: 'uso-volumenes', proyecto: 'tienda-online', gb: 1000 },
    { tipo: 'servicio-caido', nodo: 'ctl02', servicio: 'cinder-volume', motivo: 'rados-timeout', hace: 1082, efecto: T('nadie puede terminar las operaciones de sus volúmenes', 'nobody can finish the operations on its volumes') },
    { tipo: 'volumen-atascado', nombre: 'pedidos-db-old', proyecto: 'tienda-online', gb: 400, nodo: 'ctl02', hace: 1080 },
  ],
  practicas: [
    { t: T('Miraste qué servicio gestiona el volumen y si está vivo (volume show y volume service list)', 'You checked which service manages the volume and whether it is alive (volume show and volume service list)'), ok: st => usado(st, /volume show/) && antes(st, /volume service list/, /volume set --state|volume delete/) },
    { t: T('Levantaste cinder-volume antes de reintentar el borrado', 'You brought cinder-volume up before retrying the deletion'), ok: st => antes(st, /(start|restart) cinder-volume/, /volume set --state/) },
    { t: T('Comprobaste que desapareció y que la cuota bajó', 'You checked that it disappeared and that the quota usage went down'), ok: st => despues(st, /volume list|quota show/, /volume delete/) },
  ],
  pistas: [
    T('Mira el volumen por dentro: openstack volume show pedidos-db-old (tras source ~/admin-openrc). ¿Qué servicio de cinder se encarga de él (os-vol-host-attr:host)?', 'Look inside the volume: openstack volume show pedidos-db-old (after source ~/admin-openrc). Which cinder service is in charge of it (os-vol-host-attr:host)?'),
    T('openstack volume service list: el cinder-volume de ctl02 está down desde ayer. Nadie puede terminar ese borrado. En ctl02, systemctl status cinder-volume: ¿por qué murió?', 'openstack volume service list: the cinder-volume on ctl02 has been down since yesterday. Nobody can finish that deletion. On ctl02, systemctl status cinder-volume: why did it die?'),
    T('Levanta el servicio (sudo systemctl restart cinder-volume en ctl02) y reintenta. Un volumen en deleting no se puede volver a borrar: primero openstack volume set --state error pedidos-db-old y después openstack volume delete pedidos-db-old.', 'Bring the service up (sudo systemctl restart cinder-volume on ctl02) and retry. A volume in deleting cannot be deleted again: first openstack volume set --state error pedidos-db-old and then openstack volume delete pedidos-db-old.'),
  ],
  causa: T('Durante el reinicio de los monitores de Ceph de ayer por la tarde, el cinder-volume de ctl02 perdió la conexión con el clúster en mitad del borrado de pedidos-db-old y murió. El volumen quedó en «deleting» para siempre: la base de datos de Cinder esperaba a un servicio que ya no existía.', 'During yesterday afternoon\'s Ceph monitor restart, the cinder-volume on ctl02 lost its connection to the cluster in the middle of deleting pedidos-db-old and died. The volume was left in "deleting" forever: the Cinder database was waiting for a service that no longer existed.'),
  solucion: T('Volumen y servicio responsable identificados (volume show, volume service list), cinder-volume levantado en ctl02, estado del volumen reiniciado a error y borrado de nuevo, y comprobación del volumen y de la cuota.', 'Volume and responsible service identified (volume show, volume service list), cinder-volume brought up on ctl02, volume state reset to error and deleted again, and volume and quota checked.'),
  leccion: T('Un estado transitorio que no avanza («deleting», «creating», «migrating») casi siempre significa que el servicio que tenía que terminar la operación murió a mitad. Primero se levanta quien hace el trabajo; después se corrige el estado. Cambiar el estado sin levantar el servicio sólo mueve el atasco un paso más allá.', 'A transient state that never advances ("deleting", "creating", "migrating") almost always means the service that was supposed to finish the operation died halfway. First bring up whoever does the work; then fix the state. Changing the state without bringing up the service only moves the jam one step further.'),
  guion: ['source ~/admin-openrc', 'openstack volume list --all-projects', 'openstack volume show pedidos-db-old', 'openstack volume service list', 'ssh ctl02', 'systemctl status cinder-volume', 'sudo systemctl restart cinder-volume', 'exit', 'openstack volume set --state error pedidos-db-old', 'openstack volume delete pedidos-db-old', 'sleep 60', 'openstack volume list --project tienda-online', 'openstack quota show --usage tienda-online'],
  trampas: [
    { cmds: ['source ~/admin-openrc', 'openstack volume delete pedidos-db-old'], porque: T('un volumen en deleting no se puede volver a borrar', 'a volume in deleting cannot be deleted again') },
    { cmds: ['source ~/admin-openrc', 'openstack volume set --state error pedidos-db-old', 'openstack volume delete pedidos-db-old', 'sleep 120'], porque: T('sin cinder-volume vivo, el borrado se vuelve a quedar colgado', 'without a live cinder-volume, the deletion hangs again') },
  ],
},
// ============================================================================ 6g
{
  id: 'INC-4884', clave: 'fuga-memoria', tipo: 'incidente', nivel: 2, area: 'OpenStack · Linux', funciones: ['openstack', 'auto', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Monitorización (Alertmanager)', 'Monitoring (Alertmanager)'),
  asunto: T('NodeMemoryHighUtilization: ctl03 al 92 %', 'NodeMemoryHighUtilization: ctl03 at 92%'),
  cuerpo: [T('La memoria de ctl03 lleva días subiendo sin parar y ya pasa del 90 %. Hace poco el OOM killer mató MariaDB en ese mismo nodo (INC-4866).', 'Memory on ctl03 has been climbing steadily for days and is now above 90%. Recently the OOM killer killed MariaDB on this same node (INC-4866).'),
    T('ctl01 y ctl02 también suben, más despacio. Nadie ha desplegado nada.', 'ctl01 and ctl02 are climbing too, more slowly. Nobody has deployed anything.')],
  inicio: -180, abierto: -10,
  averias: [{ tipo: 'fuga-memoria', memoria: { ctl01: 31, ctl02: 22, ctl03: 61 } }],
  practicas: [
    { t: T('Identificaste el proceso que se come la memoria (top, ps o systemctl status)', 'You identified the process eating the memory (top, ps or systemctl status)'), ok: st => antes(st, /\btop\b|ps aux|systemctl status nova-api/, /nova-patch\.yml|restart nova-api|apt (full-|dist-)?upgrade/) },
    { t: T('Buscaste si había una corrección publicada (apt list --upgradable o apt changelog)', 'You looked for a published fix (apt list --upgradable or apt changelog)'), ok: st => usado(st, /apt (list|changelog)/) },
    { t: T('Parcheaste y reiniciaste de uno en uno, sin tirar la API (nova-patch.yml)', 'You patched and restarted one at a time, without taking the API down (nova-patch.yml)'), ok: st => pb(st, 'nova-patch.yml').length > 0 },
  ],
  pistas: [
    T('free -h dice cuánto; lo que importa es quién. En ctl03: ps aux --sort=-rss | head -5, o top.', 'free -h tells you how much; what matters is who. On ctl03: ps aux --sort=-rss | head -5, or top.'),
    T('nova-api ocupa decenas de GB y crece. ¿Es un fallo conocido? apt list --upgradable y apt changelog nova-api en ctl03.', 'nova-api is using tens of GB and growing. Is it a known bug? apt list --upgradable and apt changelog nova-api on ctl03.'),
    T('La 29.2.1 corrige la fuga. Instalarla no basta: el proceso que corre sigue con el código viejo hasta que se reinicia. Desde ~/infra, ansible-playbook playbooks/nova-patch.yml actualiza y reinicia los tres controladores de uno en uno.', '29.2.1 fixes the leak. Installing it is not enough: the running process keeps the old code until it restarts. From ~/infra, ansible-playbook playbooks/nova-patch.yml upgrades and restarts the three controllers one at a time.'),
  ],
  causa: T('nova 29.2.0 tiene una fuga de memoria en nova-api al listar servidores con muchos puertos (LP#2071234): cada petición deja memoria sin liberar. ctl03 recibe más peticiones y va por delante; ctl01 y ctl02 van detrás. La 29.2.1, ya en el repositorio, lo corrige.', 'nova 29.2.0 has a memory leak in nova-api when listing servers with many ports (LP#2071234): every request leaves memory unreleased. ctl03 gets more requests and is further along; ctl01 and ctl02 trail behind. 29.2.1, already in the repository, fixes it.'),
  solucion: T('Proceso identificado (ps, top), fallo confirmado en el changelog, y nova-patch.yml: actualización a 29.2.1 y reinicio de nova-api controlador a controlador.', 'Process identified (ps, top), bug confirmed in the changelog, and nova-patch.yml: upgrade to 29.2.1 and nova-api restarted controller by controller.'),
  leccion: T('Ante una fuga hay dos tiempos: mitigar (reiniciar devuelve la memoria, pero la fuga vuelve) y corregir (el parche). Entre instalar y reiniciar hay un hueco: un paquete nuevo no cambia el proceso que ya está corriendo. Y un servicio detrás de un balanceador se reinicia de uno en uno, para que la API no se caiga.', 'A leak has two phases: mitigate (restarting gives the memory back, but the leak returns) and fix (the patch). There is a gap between installing and restarting: a new package does not change the process that is already running. And a service behind a load balancer is restarted one node at a time, so the API stays up.'),
  guion: ['amtool alert', 'ssh ctl03', 'free -h', 'ps aux --sort=-rss | head -5', 'apt list --upgradable', 'apt changelog nova-api', 'exit', 'cd infra', 'ansible-playbook playbooks/nova-patch.yml', 'ssh ctl03', 'free -h'],
  trampas: [
    { cmds: ['ssh ctl03', 'sudo systemctl restart nova-api'], porque: T('la memoria baja, pero sin parche la fuga vuelve', 'memory drops, but without the patch the leak comes back') },
    { cmds: ['ssh ctl03', 'sudo apt full-upgrade -y'], porque: T('instalado no es cargado: nova-api sigue corriendo la versión vieja', 'installed is not loaded: nova-api keeps running the old version') },
  ],
},
// ============================================================================ 7
{
  id: 'CHG-0218', clave: 'kernel', tipo: 'cambio', nivel: 2, area: 'Ceph · Ansible', funciones: ['ceph', 'auto'],
  impacto: 'medio', urgencia: 'baja', de: T('Seguridad (aprobado en el CAB)', 'Security (approved by the CAB)'),
  asunto: T('Parche de kernel en ceph02 (USN-7022-1) y reinicio', 'Kernel patch on ceph02 (USN-7022-1) and reboot'),
  cuerpo: [T('Cambio aprobado en el CAB de ayer: instalar el kernel 5.15.0-122 en ceph02 y reiniciar. Ventana: ahora, en horario de baja carga.', 'Change approved at yesterday\'s CAB: install kernel 5.15.0-122 on ceph02 and reboot. Window: now, during low-load hours.'),
    T('Criterio de éxito: ceph02 arranca con el kernel nuevo y Ceph vuelve a HEALTH_OK sin mover datos. El resto de nodos Ceph se hará la semana que viene.', 'Success criteria: ceph02 boots with the new kernel and Ceph returns to HEALTH_OK without moving data. The rest of the Ceph nodes will be done next week.')],
  inicio: 0, abierto: 0,
  averias: [{ tipo: 'kernel-disponible', version: '5.15.0-122-generic' }],
  objetivo(st) {
    const h = st.hosts.ceph02, p = [];
    if (!h.up) p.push(T('ceph02 aún está arrancando (tarda unos 12 minutos): sleep y ceph -s', 'ceph02 is still booting (it takes about 12 minutes): sleep and ceph -s'));
    else if (h.kernel !== '5.15.0-122-generic') p.push(h.kernelNuevo ? T('El kernel nuevo está instalado pero ceph02 no se ha reiniciado (uname -r)', 'The new kernel is installed but ceph02 has not been rebooted (uname -r)') : T('ceph02 sigue con el kernel ' + h.kernel + ' (uname -r)', 'ceph02 is still on kernel ' + h.kernel + ' (uname -r)'));
    if (st.ceph.flags.noout) p.push(T('noout sigue puesto: quítalo al terminar (ceph osd unset noout)', 'noout is still set: unset it when you are done (ceph osd unset noout)'));
    return p;
  },
  practicas: [
    { t: T('Comprobaste que Ceph estaba sano antes de empezar', 'You checked that Ceph was healthy before starting'), ok: st => antes(st, /ceph (-s|status|health)|ceph-reboot\.yml/, /\breboot\b|shutdown -r|set noout/) || pb(st, 'ceph-reboot.yml').length > 0 },
    { t: T('Pusiste noout antes de reiniciar', 'You set noout before rebooting'), ok: st => { const r = st.hechos.reinicios.filter(x => x.host === 'ceph02'); return r.length > 0 && r.every(x => x.noout); } },
    { t: T('Ceph no movió datos: cero rebalanceos', 'Ceph moved no data: zero rebalancing'), ok: st => st.ceph.movimientos === 0 },
    { t: T('Usaste la automatización del equipo (os-update.yml o ceph-reboot.yml)', 'You used the team\'s automation (os-update.yml or ceph-reboot.yml)'), ok: st => pb(st, 'os-update.yml').length > 0 || pb(st, 'ceph-reboot.yml').length > 0 },
  ],
  pistas: [
    T('Un cambio empieza comprobando que el punto de partida está sano: ceph -s. Después instala el parche en ceph02 (sudo apt update y sudo apt full-upgrade -y, o desde ~/infra playbooks/os-update.yml -l ceph02).', 'A change starts by checking that the starting point is healthy: ceph -s. Then install the patch on ceph02 (sudo apt update and sudo apt full-upgrade -y, or from ~/infra playbooks/os-update.yml -l ceph02).'),
    T('Ceph marca out un OSD que lleva 10 minutos caído, y un nodo Ceph tarda unos 12 en volver. ¿Qué pasará si reinicias sin más? El RUNBOOK lo cuenta: cat ~/RUNBOOK.md.', 'Ceph marks out an OSD that has been down for 10 minutes, and a Ceph node takes about 12 to come back. What will happen if you just reboot? The RUNBOOK explains it: cat ~/RUNBOOK.md.'),
    T('ceph osd set noout, sudo reboot en ceph02, espera (sleep 780 y ceph -s hasta que vuelvan los OSD) y ceph osd unset noout. O todo en uno desde ~/infra: ansible-playbook playbooks/ceph-reboot.yml -l ceph02.', 'ceph osd set noout, sudo reboot on ceph02, wait (sleep 780 and ceph -s until the OSDs are back) and ceph osd unset noout. Or all in one from ~/infra: ansible-playbook playbooks/ceph-reboot.yml -l ceph02.'),
  ],
  causa: T('Cambio planificado: parche de seguridad del kernel.', 'Planned change: kernel security patch.'),
  solucion: T('Parche instalado con os-update.yml y reinicio ordenado con ceph-reboot.yml: noout, reinicio, espera a los OSD y a la recuperación, unset noout.', 'Patch installed with os-update.yml and orderly reboot with ceph-reboot.yml: noout, reboot, wait for the OSDs and recovery, unset noout.'),
  leccion: T('En almacenamiento distribuido, reiniciar un nodo no es "reiniciar un servidor": es avisar al clúster de que no se alarme. noout convierte 12 minutos de nodo caído en 12 minutos de redundancia reducida, en vez de más de 3 TiB copiándose de un lado a otro y luego de vuelta.', 'In distributed storage, rebooting a node is not "rebooting a server": it is telling the cluster not to panic. noout turns 12 minutes of a down node into 12 minutes of reduced redundancy, instead of more than 3 TiB being copied from one place to another and then back again.'),
  guion: ['ceph -s', 'cd infra', 'ansible-playbook playbooks/os-update.yml -l ceph02', 'ansible-playbook playbooks/ceph-reboot.yml -l ceph02', 'ceph -s', 'ssh ceph02', 'uname -r'],
  trampas: [{ cmds: ['ceph -s', 'ssh ceph02', 'sudo apt full-upgrade -y', 'sudo reboot', 'sleep 900', 'sleep 900'], porque: T('sin noout se resuelve, pero moviendo datos', 'without noout it gets resolved, but by moving data'), practicas: [1, 2] }],
},
// ============================================================================ 8
{
  id: 'INC-4847', clave: 'disco-muerto', tipo: 'incidente', nivel: 3, area: 'Ceph', funciones: ['ceph', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Monitorización (Alertmanager)', 'Monitoring (Alertmanager)'),
  asunto: T('Ceph lleva hora y media degradado', 'Ceph has been degraded for an hour and a half'),
  cuerpo: [T('El turno de noche dejó una nota: "osd.7 caído, Ceph se recuperará solo". Pero Ceph sigue en HEALTH_WARN con datos degradados desde hace 95 minutos.', 'The night shift left a note: "osd.7 down, Ceph will recover on its own". But Ceph has been in HEALTH_WARN with degraded data for 95 minutes.'),
    T('Un tercio de las réplicas vive en sólo dos copias. Si falla otro disco en otro nodo, habrá datos inaccesibles.', 'A third of the replicas are down to only two copies. If another disk fails on another node, some data will become inaccessible.')],
  inicio: -95, abierto: 0,
  averias: [
    { tipo: 'flag-ceph', flag: 'noout', hace: 720, efecto: T('es lo que impidió que Ceph marcara out el OSD por su cuenta', 'this is what stopped Ceph from marking the OSD out on its own') },
    { tipo: 'disco-muerto', osd: 7, hace: 95 },
    { tipo: 'registro-ceph', lineas: [{ hace: 700, t: T('CHG-0217: reinicio de mon01 terminado', 'CHG-0217: mon01 restart completed') }] },
  ],
  practicas: [
    { t: T('Comprobaste el disco (smartctl, dmesg o el log del OSD) antes de insistir con arranques', 'You checked the disk (smartctl, dmesg or the OSD log) before retrying starts'), ok: st => !usado(st, /(start|restart) ceph-osd@7/) || antes(st, /smartctl|dmesg|journalctl.*ceph-osd@7|systemctl status ceph-osd@7|ceph-osd\.7\.log/, /(start|restart) ceph-osd@7/) },
    { t: T('Identificaste el disco físico para el cambio (ceph osd metadata o ceph-volume)', 'You identified the physical disk for the replacement (ceph osd metadata or ceph-volume)'), ok: st => usado(st, /ceph osd metadata 7|ceph-volume lvm list/) },
    { t: T('Leíste ceph health detail entero: el noout estaba ahí', 'You read ceph health detail in full: the noout was right there'), ok: st => usado(st, /health detail/) },
    { t: T('Archivaste el crash después de leerlo', 'You archived the crash after reading it'), ok: st => antes(st, /crash (info|ls)/, /crash archive/) },
  ],
  pistas: [
    T('Con un OSD caído, Ceph debería haberse curado solo a los 10 minutos. Si lleva 95 degradado, algo se lo impide. Lee ceph health detail entero, línea a línea.', 'With one OSD down, Ceph should have healed itself after 10 minutes. If it has been degraded for 95, something is stopping it. Read ceph health detail in full, line by line.'),
    T('Hay dos problemas. Uno: un OSD que no arranca (ceph osd metadata 7 dice qué disco es; en ceph03, sudo smartctl -a sobre ese disco). Dos: un flag que impide que Ceph reaccione.', 'There are two problems. One: an OSD that won\'t start (ceph osd metadata 7 tells you which disk it is; on ceph03, sudo smartctl -a on that disk). Two: a flag that stops Ceph from reacting.'),
    T('El disco de osd.7 está muerto: no lo arranques más. ceph osd unset noout y ceph osd out 7, espera a la reconstrucción (sleep 600, ceph -s) y archiva el crash (ceph crash archive-all).', 'The osd.7 disk is dead: stop trying to start it. ceph osd unset noout and ceph osd out 7, wait for the rebuild (sleep 600, ceph -s) and archive the crash (ceph crash archive-all).'),
  ],
  causa: T('El SSD de osd.7 (/dev/sdc en ceph03) murió hace hora y media. Ceph habría marcado out el OSD a los 10 minutos y reconstruido las réplicas, pero el flag noout seguía puesto desde el cambio de anoche: el clúster no reaccionó.', 'The osd.7 SSD (/dev/sdc on ceph03) died an hour and a half ago. Ceph would have marked the OSD out after 10 minutes and rebuilt the replicas, but the noout flag was still set from last night\'s change: the cluster did not react.'),
  solucion: T('Diagnóstico del disco con smartctl, noout retirado, osd.7 marcado out, espera a la reconstrucción y crash archivado. Pendiente: ticket a hardware para cambiar /dev/sdc de ceph03.', 'Disk diagnosed with smartctl, noout removed, osd.7 marked out, waited for the rebuild, and crash archived. Pending: a ticket to hardware to replace /dev/sdc on ceph03.'),
  leccion: T('Los flags de mantenimiento son deuda: noout protege durante un reinicio y estorba el resto del tiempo. Lee health detail entero, porque la línea que explica por qué no se arregla solo suele estar al lado de la que grita. Y un disco con SMART FAILED no se reinicia: se saca y se cambia.', 'Maintenance flags are debt: noout protects you during a reboot and gets in the way the rest of the time. Read health detail in full, because the line explaining why it won\'t fix itself is usually right next to the one that is shouting. And a disk with SMART FAILED is not restarted: it is pulled and replaced.'),
  guion: ['ceph health detail', 'ceph osd metadata 7', 'ssh ceph03', 'sudo smartctl -a /dev/sdc', 'exit', 'ceph crash ls', 'ceph osd unset noout', 'ceph osd out 7', 'sleep 600', 'ceph crash archive-all', 'ceph -s'],
  trampas: [
    { cmds: ['ssh ceph03', 'sudo systemctl reset-failed ceph-osd@7', 'sudo systemctl start ceph-osd@7'], porque: T('el disco está muerto: no arranca', 'the disk is dead: it won\'t start') },
    { cmds: ['ceph osd out 7', 'ceph crash archive-all', 'sleep 900'], porque: T('sin quitar noout el ticket no se cierra', 'without removing noout the ticket does not close') },
  ],
},
// ============================================================================ 8b
{
  id: 'INC-4871', clave: 'quorum', tipo: 'incidente', nivel: 3, area: 'Ceph', funciones: ['ceph', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Monitorización (Alertmanager)', 'Monitoring (Alertmanager)'),
  asunto: T('Ceph no responde: ceph -s se queda colgado', 'Ceph is not responding: ceph -s hangs'),
  cuerpo: [T('Desde hace unos 20 minutos, cualquier comando de Ceph se queda colgado y acaba en "RADOS timed out". Las VMs siguen funcionando, pero no se pueden crear volúmenes nuevos y la monitorización de Ceph está a ciegas.', 'For about 20 minutes, every Ceph command hangs and ends with "RADOS timed out". VMs are still running, but new volumes cannot be created and Ceph monitoring is blind.'),
    T('Hace tres días hubo un mantenimiento en ceph02 (CHG-0215).', 'There was maintenance on ceph02 three days ago (CHG-0215).')],
  inicio: -22, abierto: -10,
  averias: [
    { tipo: 'servicio-parado', nodo: 'ceph02', servicio: 'ceph-mon@ceph02', hace: 4320, deshabilitado: true, nota: { hace: 4322, src: 'sudo[4411]', t: 'admin : TTY=pts/0 ; PWD=/home/admin ; USER=root ; COMMAND=/usr/bin/systemctl disable --now ceph-mon@ceph02' } },
    { tipo: 'servicio-caido', nodo: 'ceph03', servicio: 'ceph-mon@ceph03', motivo: 'mon-abort', hace: 22, crashes: [23] },
    { tipo: 'registro-ceph', lineas: [{ hace: 4320, sev: 'WRN', t: 'Health check failed: 1/3 mons down, quorum ceph01,ceph03 (MON_DOWN)' }, { hace: 22, sev: 'WRN', t: 'mon.ceph01 calling monitor election' }] },
  ],
  practicas: [
    { t: T('Miraste los monitores desde su nodo (socket de administración) en vez de esperar a ceph -s', 'You checked the monitors from their own nodes (admin socket) instead of waiting on ceph -s'), ok: st => usado(st, /ceph daemon mon\./) },
    { t: T('Averiguaste por qué mon.ceph02 llevaba días parado', 'You found out why mon.ceph02 had been stopped for days'), ok: st => usado(st, /journalctl.*ceph-mon@ceph02|status ceph-mon@ceph02/) },
    { t: T('Comprobaste el quórum al terminar', 'You checked quorum at the end'), ok: st => despues(st, /ceph (mon stat|-s|status|health)|mon_status|quorum_status/, /(start|enable).*ceph-mon/) },
  ],
  pistas: [
    T('Si ceph -s se cuelga, no hay quórum: dos de los tres monitores no responden. Las alertas dicen dónde mirar (amtool alert).', 'If ceph -s hangs, there is no quorum: two of the three monitors are not responding. The alerts tell you where to look (amtool alert).'),
    T('Sin quórum, pregunta a cada monitor en su nodo: en ceph01, sudo ceph daemon mon.ceph01 mon_status. En ceph02 y ceph03, systemctl status y journalctl del monitor: ¿por qué está parado cada uno?', 'Without quorum, ask each monitor on its own node: on ceph01, sudo ceph daemon mon.ceph01 mon_status. On ceph02 and ceph03, systemctl status and journalctl for the monitor: why is each one stopped?'),
    T('mon.ceph03 se cayó tres veces y systemd lo dejó: sudo systemctl reset-failed ceph-mon@ceph03 y sudo systemctl start ceph-mon@ceph03. mon.ceph02 lleva tres días deshabilitado: sudo systemctl enable --now ceph-mon@ceph02. Después, ceph crash archive-all.', 'mon.ceph03 crashed three times and systemd gave up on it: sudo systemctl reset-failed ceph-mon@ceph03 and sudo systemctl start ceph-mon@ceph03. mon.ceph02 has been disabled for three days: sudo systemctl enable --now ceph-mon@ceph02. Then, ceph crash archive-all.'),
  ],
  causa: T('mon.ceph02 se quedó parado y deshabilitado tras el mantenimiento de hace tres días (CHG-0215), y el aviso MON_DOWN se ignoró porque con 2 de 3 seguía habiendo quórum. Hoy mon.ceph03 se cayó por un fallo de Paxos: con un solo monitor vivo, el clúster perdió el quórum.', 'mon.ceph02 was left stopped and disabled after the maintenance three days ago (CHG-0215), and the MON_DOWN warning was ignored because with 2 of 3 there was still quorum. Today mon.ceph03 went down due to a Paxos failure: with only one monitor alive, the cluster lost quorum.'),
  solucion: T('Estado de cada monitor mirado en su nodo (socket de administración y systemctl), mon.ceph03 levantado con reset-failed y start, mon.ceph02 habilitado y arrancado, crash archivado y quórum comprobado.', 'State of each monitor checked on its node (admin socket and systemctl), mon.ceph03 brought up with reset-failed and start, mon.ceph02 enabled and started, crash archived and quorum verified.'),
  leccion: T('Un clúster de tres aguanta un fallo, no dos. El primer fallo no rompe nada y por eso se ignora; es el segundo el que se lo lleva todo. Un aviso de redundancia perdida es una incidencia, no ruido. Y cuando la herramienta del clúster se cuelga, se baja a los nodos: systemctl y el socket de administración funcionan sin quórum.', 'A three-node cluster survives one failure, not two. The first failure breaks nothing, and that is why it gets ignored; it is the second one that takes everything down. A lost-redundancy warning is an incident, not noise. And when the cluster tool hangs, you go down to the nodes: systemctl and the admin socket work without quorum.'),
  guion: ['amtool alert', 'ssh ceph01', 'sudo ceph daemon mon.ceph01 mon_status', 'exit', 'ssh ceph03', 'systemctl status ceph-mon@ceph03', 'sudo systemctl reset-failed ceph-mon@ceph03', 'sudo systemctl start ceph-mon@ceph03', 'exit', 'ssh ceph02', 'journalctl -u ceph-mon@ceph02 -n 5', 'sudo systemctl enable --now ceph-mon@ceph02', 'exit', 'ceph crash archive-all', 'ceph -s'],
  trampas: [
    { cmds: ['ssh ceph03', 'sudo systemctl reset-failed ceph-mon@ceph03', 'sudo systemctl start ceph-mon@ceph03'], porque: T('vuelve el quórum, pero con 2 de 3: el mismo fallo latente que lo ha tumbado todo', 'quorum comes back, but with 2 of 3: the same latent fault that took everything down') },
    { cmds: ['ssh ceph02', 'sudo systemctl start ceph-mon@ceph02', 'exit', 'ssh ceph03', 'sudo systemctl reset-failed ceph-mon@ceph03', 'sudo systemctl start ceph-mon@ceph03', 'exit', 'ceph crash archive-all'], porque: T('arrancado sin habilitar: el próximo reinicio lo deja otra vez fuera', 'started without enabling it: the next reboot leaves it out again') },
  ],
},
// ============================================================================ 8c
{
  id: 'INC-4889', clave: 'mon-disco', tipo: 'incidente', nivel: 3, area: 'Ceph', funciones: ['ceph', 'auto', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Monitorización (Alertmanager)', 'Monitoring (Alertmanager)'),
  asunto: T('mon.ceph01 caído y / de ceph01 al 100 %', 'mon.ceph01 down and / on ceph01 at 100%'),
  cuerpo: [T('El monitor de Ceph de ceph01 se ha apagado y el disco raíz del nodo está lleno. El clúster sigue funcionando con 2 de 3 monitores.', 'The Ceph monitor on ceph01 has shut down and the node\'s root disk is full. The cluster is still running with 2 of 3 monitors.'),
    T('La semana pasada se estuvo depurando un problema de elecciones de monitores.', 'Last week someone was debugging a monitor election problem.')],
  inicio: -40, abierto: -12,
  averias: [
    { tipo: 'config-ceph', quien: 'mon', opcion: 'debug_mon', valor: '20/20', hace: 10080, efecto: T('los logs de los tres monitores siguen creciendo', 'the logs of all three monitors keep growing') },
    { tipo: 'disco-lleno', nodo: 'ceph01', fichero: '/var/log/ceph/ceph-mon.ceph01.log', mb: 35500 },
    { tipo: 'disco-lleno', nodo: 'ceph02', fichero: '/var/log/ceph/ceph-mon.ceph02.log', mb: 22000 },
    { tipo: 'disco-lleno', nodo: 'ceph03', fichero: '/var/log/ceph/ceph-mon.ceph03.log', mb: 18000 },
    { tipo: 'servicio-caido', nodo: 'ceph01', servicio: 'ceph-mon@ceph01', motivo: 'mon-sin-espacio', hace: 40 },
    { tipo: 'registro-ceph', lineas: [{ hace: 40, sev: 'WRN', t: 'Health check failed: 1/3 mons down, quorum ceph02,ceph03 (MON_DOWN)' }] },
  ],
  practicas: [
    { t: T('Buscaste qué llenaba el disco (du) antes de borrar nada', 'You found what was filling the disk (du) before deleting anything'), ok: st => antes(st, /\bdu\b/, /truncate|\brm\b/) },
    { t: T('Encontraste la causa en la configuración central de Ceph (ceph config)', 'You found the cause in Ceph\'s central configuration (ceph config)'), ok: st => usado(st, /ceph config (dump|get)/) },
    { t: T('Limpiaste también los monitores que aún aguantaban', 'You also cleaned up the monitors that were still holding on'), ok: st => ['ceph02', 'ceph03'].every(n => st.hosts[n].logs['/var/log/ceph/ceph-mon.' + n + '.log'] < 5000) },
  ],
  pistas: [
    T('Empieza por ceph health detail: además del monitor caído, ¿cómo andan de disco los otros dos? En ceph01, df -h y sudo du -sh /var/log/ceph/*.', 'Start with ceph health detail: besides the down monitor, how are the other two doing on disk? On ceph01, df -h and sudo du -sh /var/log/ceph/*.'),
    T('Un log de 35 GB es un log en debug. En Ceph el nivel de log es configuración central, no un fichero: ceph config dump. ¿Quién tiene debug_mon en 20?', 'A 35 GB log is a log in debug. In Ceph the log level is central configuration, not a file: ceph config dump. Who has debug_mon at 20?'),
    T('ceph config set mon debug_mon 1/5 corta el grifo en los tres monitores. Después vacía sus logs en los tres (desde ~/infra: ansible ceph -b -m shell -a "truncate -s 0 /var/log/ceph/ceph-mon.*.log") y arranca el de ceph01 (sudo systemctl start ceph-mon@ceph01).', 'ceph config set mon debug_mon 1/5 turns off the tap on all three monitors. Then empty their logs on all three (from ~/infra: ansible ceph -b -m shell -a "truncate -s 0 /var/log/ceph/ceph-mon.*.log") and start the one on ceph01 (sudo systemctl start ceph-mon@ceph01).'),
  ],
  causa: T('La semana pasada alguien subió debug_mon a 20/20 con ceph config set para depurar unas elecciones de monitores y no lo devolvió a su valor. Los tres monitores empezaron a escribir cientos de MB por minuto; el de ceph01 llenó el disco y se apagó solo para protegerse, y los otros dos iban por el mismo camino.', 'Last week someone raised debug_mon to 20/20 with ceph config set to debug some monitor elections and never set it back. All three monitors started writing hundreds of MB per minute; the one on ceph01 filled the disk and shut itself down to protect itself, and the other two were heading the same way.'),
  solucion: T('Causa localizada con du y ceph config dump, debug_mon devuelto a 1/5, logs de los tres monitores vaciados con Ansible y mon.ceph01 arrancado.', 'Cause located with du and ceph config dump, debug_mon set back to 1/5, logs of all three monitors emptied with Ansible, and mon.ceph01 started.'),
  leccion: T('Ceph se configura en un sitio central: un ceph config set afecta a todos los demonios del tipo, estén donde estén. Por eso el síntoma aparece en un nodo y la causa vive en el clúster, y por eso hay que mirar a los otros monitores antes de que caigan. Y un nivel de debug es una herramienta de un rato: se sube, se mira y se baja.', 'Ceph is configured in one central place: a ceph config set affects every daemon of that type, wherever it runs. That is why the symptom shows up on one node while the cause lives in the cluster, and why you have to check the other monitors before they go down too. And a debug level is a short-term tool: you raise it, look, and lower it.'),
  guion: ['ceph health detail', 'ssh ceph01', 'df -h', 'sudo du -sh /var/log/ceph/*', 'exit', 'ceph config dump', 'ceph config set mon debug_mon 1/5', 'cd infra', 'ansible ceph -b -m shell -a "truncate -s 0 /var/log/ceph/ceph-mon.*.log"', 'ssh ceph01', 'sudo systemctl start ceph-mon@ceph01', 'exit', 'ceph -s'],
  trampas: [
    { cmds: ['ssh ceph01', 'sudo systemctl start ceph-mon@ceph01'], porque: T('sin espacio, el monitor no arranca', 'with no space left, the monitor won\'t start') },
    { cmds: ['ssh ceph01', 'sudo truncate -s 0 /var/log/ceph/ceph-mon.ceph01.log', 'sudo systemctl start ceph-mon@ceph01'], porque: T('sin corregir debug_mon, el log vuelve a crecer y los otros dos monitores van por el mismo camino', 'without fixing debug_mon, the log grows again and the other two monitors are heading the same way') },
  ],
},
// ============================================================================ 9
{
  id: 'INC-4852', clave: 'terraform-sg', tipo: 'incidente', nivel: 3, area: T('Terraform · Seguridad', 'Terraform · Security'), funciones: ['auto', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Seguridad (escáner externo)', 'Security (external scanner)'),
  asunto: T('Puerto 22 expuesto a internet en 185.47.12.20 (pos-backend-01)', 'Port 22 exposed to the internet on 185.47.12.20 (pos-backend-01)'),
  cuerpo: [T('El escáner externo de esta mañana detecta SSH abierto a internet en 185.47.12.20, la IP pública del backend de los TPV. Ese puerto sólo debería aceptar conexiones desde la red de administración (10.20.0.0/16).', 'This morning\'s external scan detected SSH open to the internet on 185.47.12.20, the public IP of the POS backend. That port should only accept connections from the management network (10.20.0.0/16).'),
    T('El grupo de seguridad de ese servidor se gestiona con Terraform. Cerradlo cuanto antes y dejad constancia.', 'That server\'s security group is managed with Terraform. Please close it as soon as possible and document the change.')],
  inicio: -130, abierto: -15,
  averias: [{ tipo: 'regla-a-mano' }],
  practicas: [
    { t: T('terraform plan antes de terraform apply', 'terraform plan before terraform apply'), ok: st => { const t = st.hechos.tf; const i = t.findIndex(x => x.accion === 'plan'), j = t.findIndex(x => x.accion === 'apply'); return i >= 0 && (j < 0 || i < j); } },
    { t: T('Comprobaste las reglas reales en OpenStack', 'You checked the actual rules in OpenStack'), ok: st => usado(st, /security group rule list/) },
    { t: T('Cerraste con un terraform plan limpio (No changes)', 'You finished with a clean terraform plan (No changes)'), ok: st => { const t = st.hechos.tf, u = t[t.length - 1]; return !!u && u.accion === 'plan' && u.pendientes === 0; } },
  ],
  pistas: [
    T('Mira qué reglas tiene de verdad el grupo del servidor: openstack security group rule list sg-pos-backend (con las credenciales cargadas: source ~/admin-openrc).', 'Check which rules the server\'s group actually has: openstack security group rule list sg-pos-backend (with credentials loaded: source ~/admin-openrc).'),
    T('Ese grupo lo gestiona Terraform. Desde ~/infra/terraform, terraform plan te dice qué ha cambiado fuera de él. Compara su respuesta con lo que ves en OpenStack: ¿menciona la regla abierta?', 'That group is managed by Terraform. From ~/infra/terraform, terraform plan tells you what has changed outside of it. Compare its answer with what you see in OpenStack: does it mention the open rule?'),
    T('Terraform ve que falta ssh_admin y la recreará (terraform apply), pero no sabe nada de la regla 0.0.0.0/0 que alguien creó a mano: bórrala tú (openstack security group rule delete <ID>) y termina con un terraform plan que diga No changes.', 'Terraform sees that ssh_admin is missing and will recreate it (terraform apply), but it knows nothing about the 0.0.0.0/0 rule someone created by hand: delete it yourself (openstack security group rule delete <ID>) and finish with a terraform plan that says No changes.'),
  ],
  causa: T('Alguien depuró un problema de acceso a pos-backend-01 desde Horizon: borró la regla de SSH restringida y abrió el 22 a todo internet "de forma temporal". Terraform detecta la regla que falta, pero no la que sobra: nunca estuvo en su estado.', 'Someone debugged an access problem on pos-backend-01 from Horizon: they deleted the restricted SSH rule and opened port 22 to the whole internet "temporarily". Terraform detects the missing rule, but not the extra one: it was never in its state.'),
  solucion: T('terraform plan para ver la deriva, terraform apply para recrear ssh_admin, borrado manual de la regla abierta al mundo y plan final sin cambios.', 'terraform plan to see the drift, terraform apply to recreate ssh_admin, manual deletion of the world-open rule, and a final plan with no changes.'),
  leccion: T('La infraestructura como código sólo te protege de lo que declara. Terraform compara con la realidad los recursos que conoce; lo creado a mano es invisible para él. Por eso un cambio a mano en producción es peligroso dos veces: rompe algo y además se esconde.', 'Infrastructure as code only protects you from what it declares. Terraform compares the resources it knows about against reality; anything created by hand is invisible to it. That is why a manual change in production is dangerous twice over: it breaks something and it hides as well.'),
  guion: st => ['source ~/admin-openrc', 'openstack security group rule list sg-pos-backend', 'cd infra/terraform', 'terraform plan', 'terraform apply -auto-approve', 'openstack security group rule delete ' + U.uuid('manual-ssh-world'), 'terraform plan'],
  trampas: [{ cmds: ['source ~/admin-openrc', 'cd infra/terraform', 'terraform apply -auto-approve'], porque: T('Terraform no borra lo que no conoce', 'Terraform does not delete what it does not know about') }],
},
// ============================================================================ 10
{
  id: 'CHG-0221', clave: 'alta-cmp04', tipo: 'cambio', nivel: 3, area: 'OpenStack · Ansible', funciones: ['openstack', 'auto'],
  impacto: 'bajo', urgencia: 'media', de: T('Plataforma (planificación de capacidad)', 'Platform (capacity planning)'),
  asunto: T('Alta de cmp04 como hipervisor', 'Onboard cmp04 as a hypervisor'),
  cuerpo: [T('cmp04 ya está en el rack con Ubuntu 22.04 y la red configurada, y aparece en el inventario de Ansible, en el grupo compute_nuevos. Hay que darlo de alta como hipervisor para absorber el crecimiento de analítica.', 'cmp04 is already racked with Ubuntu 22.04 and networking configured, and it is in the Ansible inventory, in the compute_nuevos group. It needs to be onboarded as a hypervisor to absorb the growth of the analytics workloads.'),
    T('Criterio de éxito: cmp04 aparece up en openstack hypervisor list y el scheduler puede colocar VMs en él.', 'Success criteria: cmp04 shows as up in openstack hypervisor list and the scheduler can place VMs on it.')],
  inicio: 0, abierto: 0,
  averias: [],
  objetivo(st) {
    const h = st.hosts.cmp04, p = [];
    if (!h.provisionado) p.push(T('cmp04 aún no tiene OpenStack instalado (playbooks/alta-compute.yml)', 'cmp04 does not have OpenStack installed yet (playbooks/alta-compute.yml)'));
    else if (!U.novaUp(st, 'cmp04')) p.push(T('nova-compute no está activo en cmp04', 'nova-compute is not active on cmp04'));
    if (h.provisionado && !st.os.mapeados.cmp04) p.push(T('cmp04 no está mapeado en la celda: el scheduler no le mandará VMs (nova-manage cell_v2 discover_hosts, en un controlador)', 'cmp04 is not mapped in the cell: the scheduler will not send it VMs (nova-manage cell_v2 discover_hosts, on a controller)'));
    return p;
  },
  practicas: [
    { t: T('Probaste el acceso con Ansible antes de nada (ansible ... -m ping)', 'You tested access with Ansible before anything else (ansible ... -m ping)'), ok: st => { const i = idx(st, /^ansible .*-m ping/), j = idx(st, /alta-compute\.yml/); return i >= 0 && (j < 0 || i < j); } },
    { t: T('Ensayaste con --check antes de aplicar', 'You did a dry run with --check before applying'), ok: st => { const p = st.hechos.playbooks.filter(x => x.pb === 'alta-compute.yml'); const i = p.findIndex(x => x.check), j = p.findIndex(x => !x.check); return i >= 0 && (j < 0 || i < j); } },
    { t: T('Comprobaste que aparece en OpenStack después del mapeo', 'You checked that it shows up in OpenStack after the mapping'), ok: st => despues(st, /hypervisor list|compute service list/, /discover_hosts/) },
  ],
  pistas: [
    T('Un alta empieza comprobando que llegas al nodo: cd ~/infra y ansible cmp04 -m ping. Lee el playbook antes de lanzarlo: cat playbooks/alta-compute.yml.', 'Onboarding starts by checking that you can reach the node: cd ~/infra and ansible cmp04 -m ping. Read the playbook before running it: cat playbooks/alta-compute.yml.'),
    T('ansible-playbook playbooks/alta-compute.yml -l cmp04 --check te dice qué cambiaría; sin --check, lo aplica. Lee el mensaje de la última tarea.', 'ansible-playbook playbooks/alta-compute.yml -l cmp04 --check tells you what would change; without --check, it applies it. Read the message from the last task.'),
    T('Falta un paso que el playbook no hace: en un controlador (ssh ctl01), sudo nova-manage cell_v2 discover_hosts --verbose. Comprueba después con openstack hypervisor list.', 'There is one step the playbook does not do: on a controller (ssh ctl01), sudo nova-manage cell_v2 discover_hosts --verbose. Then verify with openstack hypervisor list.'),
  ],
  causa: T('Cambio planificado: ampliación de capacidad.', 'Planned change: capacity expansion.'),
  solucion: T('Ping con Ansible, ensayo con --check, alta-compute.yml sobre cmp04, mapeo en la celda con nova-manage y comprobación en hypervisor list.', 'Ansible ping, dry run with --check, alta-compute.yml on cmp04, cell mapping with nova-manage, and check in hypervisor list.'),
  leccion: T('En OpenStack, que un servicio esté "up" no significa que reciba trabajo. nova-compute se registra solo, pero mapearlo en la celda es un paso explícito. Los playbooks de alta siempre tienen un "después de esto" que conviene leer antes de lanzarlos.', 'In OpenStack, a service being "up" does not mean it gets work. nova-compute registers itself, but mapping it into the cell is an explicit step. Onboarding playbooks always have an "after this" section worth reading before you run them.'),
  guion: ['cd infra', 'ansible cmp04 -m ping', 'cat playbooks/alta-compute.yml', 'ansible-playbook playbooks/alta-compute.yml -l cmp04 --check', 'ansible-playbook playbooks/alta-compute.yml -l cmp04', 'ssh ctl01', 'sudo nova-manage cell_v2 discover_hosts --verbose', 'exit', 'source ~/admin-openrc', 'openstack hypervisor list'],
  trampas: [{ cmds: ['cd infra', 'ansible-playbook playbooks/alta-compute.yml -l cmp04'], porque: T('sin discover_hosts no recibe VMs', 'without discover_hosts it gets no VMs') }],
},
// ============================================================================ 11
{
  id: 'CHG-0224', clave: 'vaciar-hipervisor', tipo: 'cambio', nivel: 3, area: 'OpenStack', funciones: ['openstack'],
  impacto: 'medio', urgencia: 'media', de: T('Plataforma (hardware)', 'Platform (hardware)'),
  asunto: T('Firmware de cmp03: reiniciar sin cortar ninguna VM', 'cmp03 firmware: reboot without interrupting any VM'),
  cuerpo: [T('El proveedor pide aplicar una actualización de firmware de la controladora de cmp03, que se instala en el siguiente reinicio. Ventana: ahora.', 'The vendor asks us to apply a firmware update to the cmp03 storage controller, which is installed on the next reboot. Window: now.'),
    T('Criterio de éxito: cmp03 reiniciado, ninguna VM de cliente apagada por el camino y cmp03 de vuelta en el scheduler. Ojo: el pipeline de analítica sigue creando VMs mientras tanto.', 'Success criteria: cmp03 rebooted, no customer VM shut down along the way, and cmp03 back in the scheduler. Heads-up: the analytics pipeline keeps creating VMs in the meantime.')],
  inicio: 0, abierto: 0,
  averias: [{ tipo: 'vm-programada', en: 6, nombre: 'ci-runner-17', proyecto: 'analitica', flavor: 'm1.large' }],
  objetivo(st) {
    const h = st.hosts.cmp03, p = [];
    if (!st.hechos.reinicios.some(r => r.host === 'cmp03')) p.push(T('cmp03 no se ha reiniciado: el firmware no se aplica hasta el reinicio', 'cmp03 has not been rebooted: the firmware is not applied until the reboot'));
    else if (!h.up) p.push(T('cmp03 aún está arrancando (unos 4 minutos)', 'cmp03 is still booting (about 4 minutes)'));
    if (st.os.deshabilitados.cmp03) p.push(T('cmp03 sigue deshabilitado: el scheduler no le mandará VMs (openstack compute service set --enable)', 'cmp03 is still disabled: the scheduler will not send it VMs (openstack compute service set --enable)'));
    return p;
  },
  practicas: [
    { t: T('Deshabilitaste cmp03 en el scheduler antes de vaciarlo', 'You disabled cmp03 in the scheduler before draining it'), ok: st => antes(st, /compute service set.*--disable/, /host-evacuate-live|server migrate/) },
    { t: T('Comprobaste que cmp03 estaba vacío antes de reiniciarlo', 'You checked that cmp03 was empty before rebooting it'), ok: st => { const m = ultimo(st, /host-evacuate-live|server migrate/), r = idx(st, /reboot|shutdown -r/), c = idx(st, /server list.*--host cmp03|hypervisor show cmp03|virsh list/, m + 1); return m >= 0 && r >= 0 && c >= 0 && c < r; } },
    { t: T('Lo devolviste al servicio y comprobaste que está enabled y up', 'You returned it to service and checked that it is enabled and up'), ok: st => despues(st, /compute service list/, /compute service set.*--enable/) },
  ],
  pistas: [
    T('Primero, qué hay dentro: openstack server list --all-projects --host cmp03. Y que no entre nada nuevo mientras trabajas: el procedimiento está en el RUNBOOK (cat ~/RUNBOOK.md).', 'First, what is on it: openstack server list --all-projects --host cmp03. And make sure nothing new lands on it while you work: the procedure is in the RUNBOOK (cat ~/RUNBOOK.md).'),
    T('openstack compute service set --disable --disable-reason "CHG-0224" cmp03 nova-compute lo saca del scheduler, y nova host-evacuate-live cmp03 migra en vivo todas sus VMs. Comprueba que ha quedado vacío antes de reiniciar.', 'openstack compute service set --disable --disable-reason "CHG-0224" cmp03 nova-compute takes it out of the scheduler, and nova host-evacuate-live cmp03 live-migrates all its VMs. Check that it is empty before rebooting.'),
    T('Con cmp03 vacío: ssh cmp03 y sudo reboot. Cuando vuelva (unos 4 minutos), openstack compute service set --enable cmp03 nova-compute, y compruébalo con openstack compute service list.', 'With cmp03 empty: ssh cmp03 and sudo reboot. When it comes back (about 4 minutes), openstack compute service set --enable cmp03 nova-compute, and verify with openstack compute service list.'),
  ],
  causa: T('Cambio planificado: actualización de firmware.', 'Planned change: firmware update.'),
  solucion: T('Hipervisor deshabilitado en el scheduler, vaciado con migración en vivo, reinicio con cero VMs dentro y vuelta al servicio.', 'Hypervisor disabled in the scheduler, drained with live migration, rebooted with zero VMs on it, and returned to service.'),
  leccion: T('Un hipervisor con VMs no se reinicia: se vacía. La migración en vivo mueve la VM sin apagarla, y deshabilitar el nodo antes evita que el scheduler te meta una VM nueva mientras lo vacías: el hueco que dejas es justo el sitio más libre de la nube. Y un nodo deshabilitado y olvidado es capacidad perdida: se devuelve al servicio al terminar.', 'You don\'t reboot a hypervisor with VMs on it: you drain it. Live migration moves the VM without shutting it down, and disabling the node first keeps the scheduler from placing a new VM on it while you drain it: the room you free up is exactly the emptiest spot in the cloud. And a disabled, forgotten node is lost capacity: return it to service when you are done.'),
  guion: ['source ~/admin-openrc', 'openstack server list --all-projects --host cmp03', 'openstack compute service set --disable --disable-reason "CHG-0224 firmware" cmp03 nova-compute', 'nova host-evacuate-live cmp03', 'openstack server list --all-projects --host cmp03', 'ssh cmp03', 'sudo reboot', 'sleep 300', 'openstack compute service set --enable cmp03 nova-compute', 'openstack compute service list'],
  trampas: [
    { cmds: ['source ~/admin-openrc', 'ssh cmp03', 'sudo reboot', 'sleep 300'], porque: T('reiniciar sin vaciar apaga las VMs de los clientes', 'rebooting without draining shuts down the customers\' VMs') },
    { cmds: ['source ~/admin-openrc', 'nova host-evacuate-live cmp03', 'sleep 300', 'ssh cmp03', 'sudo reboot', 'sleep 300'], porque: T('sin deshabilitarlo, el pipeline le mete una VM nueva justo antes del reinicio', 'without disabling it, the pipeline places a new VM on it right before the reboot') },
  ],
},
];

// ------------------------------------------------------------------ uso
// Cada escenario se monta sobre el catálogo: aplicar = sus averías; resuelto =
// lo que falta de sus averías + su objetivo + Ceph sano + ningún cliente apagado.
// Las incidencias importadas (incidencias.js) se montan igual.
P.normalizarEscenario = e => {
  e.averias = e.averias || [];
  e.aplicar = st => P.aplicarAverias(st, e.averias);
  e.resuelto = st => {
    const p = P.pendientesAverias(st, e.averias).concat(e.objetivo ? e.objetivo(st, P) : []);
    return p.concat(p.length ? [] : P.pendientesSalud(st).concat(P.pendientesUnidades(st)), comunes(st));
  };
  return e;
};
P.escenarios.forEach(P.normalizarEscenario);
P.importadas = P.importadas || [];
P.escenario = id => P.escenarios.concat(P.importadas).find(e => e.id === id || (!e.importada && e.clave === id));
P.preparar = function (e) {
  const st = P.crear();
  if (e) { st.inicioFallo = e.inicio || 0; e.aplicar(st, P); st.alertasDesde = {}; P.refrescarAlertas(st); }
  return st;
};
P.evaluar = function (st, e) {
  return { pendientes: e.resuelto(st, P), practicas: e.practicas.map(x => ({ t: x.t, ok: !!x.ok(st) })) };
};
P.guionDe = (e, st) => typeof e.guion === 'function' ? e.guion(st) : e.guion;

})(window.PUESTO = window.PUESTO || {});
