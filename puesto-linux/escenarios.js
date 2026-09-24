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

// ------------------------------------------------------------------ ayudas
const idx = (st, re, desde) => { for (let i = desde || 0; i < st.registro.length; i++) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const ultimo = (st, re) => { for (let i = st.registro.length - 1; i >= 0; i--) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const usado = (st, re) => idx(st, re) >= 0;
const antes = (st, a, b) => { const i = idx(st, a), j = idx(st, b); return i >= 0 && (j < 0 || i < j); };
const despues = (st, a, b) => { const j = ultimo(st, b); return j >= 0 && idx(st, a, j + 1) >= 0; };
const pb = (st, nombre, check) => st.hechos.playbooks.filter(p => p.pb === nombre && !!p.check === !!check && !p.fallo);
const clientesApagados = st => st.os.servidores.filter(s => s.estado === 'SHUTOFF' && s.proyecto !== 'admin');
const comunes = st => clientesApagados(st).length ? ['Hay VMs de clientes apagadas tras un reinicio: ' + clientesApagados(st).map(s => s.nombre).join(', ') + ' (openstack server start)'] : [];
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
  { id: 'openstack', titulo: 'Despliegue y mantenimiento de OpenStack', corto: 'OpenStack' },
  { id: 'ceph', titulo: 'Administración y monitorización de Ceph', corto: 'Ceph' },
  { id: 'auto', titulo: 'Automatización con Ansible y Terraform', corto: 'Ansible · Terraform' },
  { id: 'incid', titulo: 'Monitorización y resolución de incidencias', corto: 'Incidencias' },
];

P.escenarios = [
// ============================================================================ 1
{
  id: 'INC-4821', clave: 'osd-caido', tipo: 'incidente', nivel: 1, area: 'Ceph', funciones: ['ceph', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: 'Monitorización (Alertmanager)',
  asunto: 'CephOSDDown: osd.4 en ceph02',
  cuerpo: ['Alertmanager avisa de que osd.4 (ceph02) está down y Ceph ha pasado a HEALTH_WARN con datos degradados. No hay ningún mantenimiento programado.',
    'Los datos siguen disponibles (hay tres copias), pero corre el reloj: si el OSD sigue caído a los 10 minutos, Ceph lo marcará out y empezará a mover más de 1 TiB.'],
  inicio: -3, abierto: -3,
  averias: [
    { tipo: 'servicio-caido', nodo: 'ceph02', servicio: 'ceph-osd@4', motivo: 'osd-suicidio', hace: 3, crashes: [6, 5, 3] },
    { tipo: 'registro-ceph', lineas: [{ hace: 7, sev: 'DBG', t: '2.7f deep-scrub starts' }, { hace: 3, t: 'osd.4 marked itself down and dead' }, { hace: 3, sev: 'WRN', t: 'Health check failed: 1 osds down (OSD_DOWN)' }, { hace: 3, sev: 'WRN', t: 'Health check failed: Degraded data redundancy: 270810/2437290 objects degraded (11.111%), 160 pgs degraded (PG_DEGRADED)' }, { hace: 3, sev: 'WRN', t: 'Health check failed: 3 daemons have recently crashed (RECENT_CRASH)' }] },
  ],
  practicas: [
    { t: 'Miraste por qué cayó (journal, status o crash info) antes de levantarlo', ok: st => antes(st, /journalctl.*ceph-osd@4|systemctl status ceph-osd@4|crash info|ceph-osd\.4\.log/, /systemctl (re)?start ceph-osd@4|reset-failed ceph-osd@4/) },
    { t: 'Descartaste el disco antes de darlo por bueno (smartctl o dmesg)', ok: st => usado(st, /smartctl|dmesg/) },
    { t: 'Lo levantaste antes de que Ceph lo marcara out: cero datos movidos', ok: st => st.ceph.movimientos === 0 },
    { t: 'Comprobaste con ceph -s o ceph health que volvió a HEALTH_OK', ok: st => despues(st, /ceph (-s|status|health)/, /(reset-failed|start|restart) ceph-osd@4|crash archive/) },
  ],
  pistas: [
    'Empieza por la foto general: ceph -s y ceph osd tree te dicen qué OSD falla y en qué nodo.',
    'Entra en ceph02 y pregunta a systemd: systemctl status ceph-osd@4 y journalctl -u ceph-osd@4. ¿Por qué cayó y por qué no se ha vuelto a levantar solo? Descarta el disco: sudo smartctl -a /dev/sdc.',
    'systemd dejó de reintentarlo tras tres caídas seguidas: sudo systemctl reset-failed ceph-osd@4 y sudo systemctl start ceph-osd@4. Después queda RECENT_CRASH: cuando lo hayas leído (ceph crash ls), ceph crash archive-all.',
  ],
  causa: 'osd.4 se colgó tres veces seguidas durante un deep-scrub (el hilo de operaciones superó el suicide timeout) y systemd dejó de reintentarlo al alcanzar el límite de arranques. El disco estaba sano.',
  solucion: 'reset-failed y start de ceph-osd@4, comprobación con ceph -s y archivo de los crashes después de leerlos.',
  leccion: 'Un OSD caído no pone en riesgo los datos (hay tres copias), pero el reloj corre: a los 10 minutos Ceph lo marca out y mueve más de 1 TiB. Levantarlo a tiempo evita ese movimiento. Y un HEALTH_WARN después de arreglarlo casi siempre es RECENT_CRASH: se lee, se archiva, no se ignora.',
  guion: ['ceph -s', 'ssh ceph02', 'journalctl -u ceph-osd@4 -n 20', 'sudo smartctl -a /dev/sdc', 'sudo systemctl reset-failed ceph-osd@4', 'sudo systemctl start ceph-osd@4', 'exit', 'ceph crash ls', 'ceph crash archive-all', 'sleep 60', 'ceph -s'],
  trampas: [
    { cmds: ['ssh ceph02', 'sudo systemctl restart ceph-osd@4'], porque: 'restart sin reset-failed choca con el límite de arranques de systemd' },
    { cmds: ['ceph osd out 4', 'sleep 900'], porque: 'sacar el OSD del clúster no lo arregla' },
  ],
},
// ============================================================================ 2
{
  id: 'REQ-1307', clave: 'cuota', tipo: 'peticion', nivel: 1, area: 'OpenStack', funciones: ['openstack'],
  impacto: 'bajo', urgencia: 'media', de: 'Equipo tienda online (Marta Ruiz)',
  asunto: 'Ampliar la cuota de volúmenes de tienda-online en 500 GB',
  cuerpo: ['Vamos a montar la nueva base de datos de pedidos, con un volumen de 500 GB, y al crearlo nos da VolumeLimitExceeded: "Maximum number of gigabytes exceeded".',
    '¿Podéis ampliarnos la cuota? Lo necesitamos para el despliegue de esta tarde.'],
  inicio: 0, abierto: 0,
  averias: [{ tipo: 'uso-volumenes', proyecto: 'tienda-online', gb: 950 }],
  objetivo(st) {
    const lim = st.os.proyectos['tienda-online'].cuota.gigabytes;
    return (lim !== -1 && lim < 1450) ? ['La cuota de gigabytes de tienda-online es ' + lim + ': con 950 usados no caben 500 más (hace falta al menos 1450)'] : [];
  },
  practicas: [
    { t: 'Miraste el uso real antes de tocar la cuota (quota show --usage)', ok: st => antes(st, /quota show/, /quota set/) },
    { t: 'Comprobaste que Ceph tiene sitio para esos 500 GB (ceph df)', ok: st => antes(st, /ceph (df|osd df|-s|status)/, /quota set/) },
    { t: 'Ampliaste lo justo: ni ilimitada (-1) ni el doble', ok: st => { const l = st.os.proyectos['tienda-online'].cuota.gigabytes; return l !== -1 && l <= 2000; } },
  ],
  pistas: [
    'Una cuota es un límite administrativo, no espacio real. Mira primero cuánto usan: openstack quota show --usage tienda-online (antes, source ~/admin-openrc).',
    'Antes de prometer 500 GB, comprueba que existen: ceph df, columna MAX AVAIL del pool volumes. Recuerda que con réplica 3 cada GB de volumen son 3 en crudo.',
    'openstack quota set --gigabytes 1500 tienda-online. Deja un margen razonable sin regalar espacio que no tienes.',
  ],
  causa: 'El proyecto tenía usados 950 de sus 1000 GB de cuota: un volumen de 500 GB no cabía.',
  solucion: 'Comprobación del uso y de la capacidad real de Ceph, y ampliación de la cuota a un valor ajustado.',
  leccion: 'Cuota y capacidad son dos cosas distintas: la cuota es lo que prometes, la capacidad es lo que tienes. Antes de decir que sí, se miran las dos. Y con réplica 3, 500 GB de volumen son 1,5 TB en crudo.',
  guion: ['source ~/admin-openrc', 'openstack quota show --usage tienda-online', 'ceph df', 'openstack quota set --gigabytes 1500 tienda-online', 'openstack quota show tienda-online'],
  trampas: [{ cmds: ['source ~/admin-openrc', 'openstack quota set --gigabytes 1200 tienda-online'], porque: '1200 no llega: 950 + 500 = 1450' }],
},
// ============================================================================ 2b
{
  id: 'REQ-1315', clave: 'proyecto', tipo: 'peticion', nivel: 1, area: 'OpenStack', funciones: ['openstack'],
  impacto: 'bajo', urgencia: 'media', de: 'Negocio (apertura de franquicias)',
  asunto: 'Proyecto nuevo para la franquicia de Valencia',
  cuerpo: ['Abrimos la franquicia de Valencia y necesita su propio espacio en la nube: un proyecto tienda-valencia y un usuario para su técnico, Javier García (jgarcia, jgarcia@retail.es).',
    'Que pueda trabajar en su proyecto sin tocar nada de los demás. Cuota: 10 instancias, 40 cores y 500 GB de volúmenes.'],
  inicio: 0, abierto: 0,
  averias: [],
  objetivo(st) {
    const p = [], pr = st.os.proyectos['tienda-valencia'];
    if (!pr) return ['El proyecto tienda-valencia no existe (openstack project create)'];
    if (!st.os.usuarios.jgarcia) p.push('El usuario jgarcia no existe (openstack user create)');
    else {
      const r = st.os.roles.filter(x => x.u === 'jgarcia');
      if (r.some(x => x.r === 'admin')) p.push('jgarcia tiene el rol admin: en OpenStack, admin en un proyecto es admin de toda la nube');
      if (!r.some(x => x.p === 'tienda-valencia' && x.r === 'member')) p.push('jgarcia no tiene el rol member en tienda-valencia: no podrá trabajar en su proyecto');
    }
    const q = pr.cuota;
    if (q.instances !== 10 || q.cores !== 40 || q.gigabytes !== 500) p.push('La cuota de tienda-valencia es de ' + q.instances + ' instancias, ' + q.cores + ' cores y ' + q.gigabytes + ' GB; se pidieron 10, 40 y 500');
    return p;
  },
  practicas: [
    { t: 'Contraseña con --password-prompt, no en la línea de comandos (quedaría en el historial)', ok: st => !st.hechos.passwordEnLinea && usado(st, /user create.*--password-prompt/) },
    { t: 'Comprobaste las asignaciones de rol', ok: st => despues(st, /role assignment list/, /role add/) },
    { t: 'Comprobaste la cuota final', ok: st => despues(st, /quota show/, /quota set/) },
  ],
  pistas: [
    'Son tres piezas de Keystone y una de cuota: proyecto, usuario y rol que los une. Empieza por source ~/admin-openrc y openstack project create.',
    'openstack user create con --project y --password-prompt (así la contraseña no queda en el historial). Después, openstack role add une usuario y proyecto. ¿Qué rol? Mira el RUNBOOK.',
    'Rol member, nunca admin: en OpenStack, admin da poder sobre toda la nube. La cuota por defecto es de 1000 GB y 20 cores: openstack quota set --instances 10 --cores 40 --gigabytes 500 tienda-valencia.',
  ],
  causa: 'Petición de alta: proyecto, usuario, rol y cuota para una franquicia nueva.',
  solucion: 'Proyecto creado, usuario con contraseña por prompt, rol member en su proyecto, cuota ajustada a lo pedido y comprobación de roles y cuota.',
  leccion: 'Dar acceso es fácil; darlo justo es el oficio. member en su proyecto y nada más, porque admin en OpenStack no se queda en el proyecto donde lo asignas. La cuota por defecto no es la pedida: 1000 GB de regalo son capacidad prometida que nadie ha planificado. Y una contraseña escrita en la línea de comandos vive para siempre en el historial.',
  guion: ['source ~/admin-openrc', 'openstack project create --description "Franquicia Valencia" tienda-valencia', 'openstack user create --project tienda-valencia --email jgarcia@retail.es --password-prompt jgarcia', 'Temporal-2026!', 'Temporal-2026!', 'openstack role add --project tienda-valencia --user jgarcia member', 'openstack role assignment list --project tienda-valencia --names', 'openstack quota set --instances 10 --cores 40 --gigabytes 500 tienda-valencia', 'openstack quota show tienda-valencia'],
  trampas: [
    { cmds: ['source ~/admin-openrc', 'openstack project create tienda-valencia', 'openstack user create --project tienda-valencia --password Temporal-2026! jgarcia', 'openstack role add --project tienda-valencia --user jgarcia admin', 'openstack quota set --instances 10 --cores 40 --gigabytes 500 tienda-valencia'], porque: 'el rol admin no se queda en el proyecto: es admin de toda la nube' },
    { cmds: ['source ~/admin-openrc', 'openstack project create tienda-valencia', 'openstack user create --project tienda-valencia --password Temporal-2026! jgarcia', 'openstack role add --project tienda-valencia --user jgarcia member'], porque: 'sin fijar la cuota, el proyecto se queda con la de por defecto' },
  ],
},
// ============================================================================ 3
{
  id: 'INC-4830', clave: 'no-valid-host', tipo: 'incidente', nivel: 2, area: 'OpenStack', funciones: ['openstack', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: 'Desarrollo (pipeline de despliegue)',
  asunto: 'No podemos desplegar pedidos-api v2: "No valid host was found"',
  cuerpo: ['El pipeline de esta mañana intenta crear dos VMs m1.xlarge en tienda-online y las dos acaban en ERROR con "No valid host was found. There are not enough hosts available". Ayer funcionaba.',
    'Si os sirve, podéis borrar las dos VMs fallidas (pedidos-api-v2-01 y pedidos-api-v2-02): el pipeline las vuelve a crear.'],
  inicio: -15, abierto: -10,
  averias: [
    { tipo: 'servicio-parado', nodo: 'cmp02', servicio: 'libvirtd', hace: 840, deshabilitado: true, exigirHabilitado: false, efecto: 'nova-compute no puede hablar con el hipervisor', nota: { hace: 841, t: 'libvirtd.service: Unit is being upgraded (libvirt-daemon-system 8.0.0-1ubuntu7.10 -> 8.0.0-1ubuntu7.11)' } },
    { tipo: 'servicio-caido', nodo: 'cmp02', servicio: 'nova-compute', motivo: 'sin-libvirt', hace: 839, efecto: 'el scheduler no le manda VMs (openstack compute service list)' },
    { tipo: 'hipervisores-llenos', nodos: ['cmp01', 'cmp03'], proyecto: 'analitica' },
    { tipo: 'vms-en-error', nombres: ['pedidos-api-v2-01', 'pedidos-api-v2-02'], proyecto: 'tienda-online', flavor: 'm1.xlarge', hace: 15 },
  ],
  practicas: [
    { t: 'Leíste el error de nova-compute antes de tocar nada', ok: st => antes(st, /journalctl.*nova-compute|systemctl status nova-compute|nova-compute\.log/, /systemctl (start|restart|enable).*(libvirtd|nova-compute)|nova-compute\.yml/) },
    { t: 'libvirtd queda habilitado: sobrevivirá al próximo reinicio', ok: st => st.hosts.cmp02.svcs.libvirtd.enabled },
    { t: 'Comprobaste que el scheduler vuelve a ver cmp02 (compute service list, hypervisor list o una VM de prueba)', ok: st => despues(st, /compute service list|hypervisor list|server create|server show/, /(start|restart|enable).*(nova-compute|libvirtd)|nova-compute\.yml/) },
    { t: 'Limpiaste las VMs en ERROR que el ticket te autorizaba a borrar', ok: st => ['pedidos-api-v2-01', 'pedidos-api-v2-02'].every(n => !st.os.servidores.some(s => s.nombre === n)) },
  ],
  pistas: [
    '"No valid host" significa que el scheduler no encontró sitio. Pregunta a OpenStack qué hipervisores ve y cuánta RAM les queda: openstack compute service list y openstack hypervisor list --long.',
    'cmp02 aparece down. Entra (ssh cmp02) y lee el error: systemctl status nova-compute. ¿Con quién no consigue hablar?',
    'libvirtd está parado y deshabilitado desde la actualización de ayer. sudo systemctl enable --now libvirtd y después sudo systemctl restart nova-compute. O de golpe: desde ~/infra, ansible-playbook playbooks/nova-compute.yml -l cmp02.',
  ],
  causa: 'La actualización de libvirt de ayer en cmp02 dejó libvirtd parado y deshabilitado. nova-compute no arranca sin él, así que cmp02 salió del scheduler; cmp01 y cmp03 están casi llenos y una VM de 16 GB ya no cabía en ningún sitio.',
  solucion: 'libvirtd habilitado y arrancado, nova-compute reiniciado, comprobación en compute service list y limpieza de las VMs en ERROR.',
  leccion: '"No valid host" casi nunca es falta de hardware: es falta de hardware disponible para el scheduler. Un hipervisor caído no molesta a nadie hasta que los demás se llenan. Y un servicio que arranca a mano pero no está habilitado es una avería aplazada hasta el próximo reinicio.',
  guion: ['source ~/admin-openrc', 'openstack compute service list', 'openstack hypervisor list --long', 'ssh cmp02', 'systemctl status nova-compute', 'sudo systemctl enable --now libvirtd', 'sudo systemctl restart nova-compute', 'exit', 'openstack compute service list', 'openstack server delete pedidos-api-v2-01 pedidos-api-v2-02'],
  trampas: [
    { cmds: ['ssh cmp02', 'sudo systemctl restart nova-compute'], porque: 'sin libvirtd, nova-compute vuelve a caer' },
    { cmds: ['ssh cmp02', 'sudo reboot', 'sleep 300'], porque: 'reiniciar no arranca un servicio deshabilitado y además apaga las VMs' },
  ],
},
// ============================================================================ 4
{
  id: 'INC-4833', clave: 'disco-lleno', tipo: 'incidente', nivel: 2, area: 'Linux · OpenStack', funciones: ['openstack', 'incid', 'auto'],
  impacto: 'alto', urgencia: 'alta', de: 'Atención al cliente (tiendas)',
  asunto: 'Horizon va lentísimo y a ratos da error 500',
  cuerpo: ['Desde hace unos 40 minutos varias tiendas se quejan de que el panel va muy lento, y algunas operaciones fallan con un error 500. Si repites la misma acción, a veces funciona.',
    'El equipo de desarrollo dice que no han desplegado nada hoy.'],
  inicio: -41, abierto: -12,
  averias: [
    { tipo: 'rabbit-debug', nodo: 'ctl02', soloPractica: true },
    { tipo: 'disco-lleno', nodo: 'ctl02', fichero: '/var/log/rabbitmq/rabbit@ctl02.log', mb: 31000 },
    { tipo: 'servicio-caido', nodo: 'ctl02', servicio: 'rabbitmq-server', motivo: 'sin-espacio', hace: 41, efecto: 'systemctl status rabbitmq-server' },
  ],
  practicas: [
    { t: 'Buscaste qué ocupa el espacio (du) antes de borrar nada', ok: st => antes(st, /\bdu\b/, /\brm\b|truncate|vacuum|logrotate\.yml/) },
    { t: 'Corregiste la causa: RabbitMQ ya no escribe en debug (logrotate.yml)', ok: st => !st.hosts.ctl02.extra.rabbitDebug },
    { t: 'Comprobaste que el clúster de RabbitMQ vuelve a tener sus tres nodos', ok: st => usado(st, /rabbitmqctl cluster_status/) },
  ],
  pistas: [
    'Errores intermitentes detrás de un balanceador suelen ser un nodo malo de tres. Mira las alertas de la flota (amtool alert) y ve al nodo que se queja.',
    'En ctl02: df -h, y luego du -sh /var/log/* para encontrar al culpable. Mira también systemctl status rabbitmq-server.',
    'El log de RabbitMQ pesa 30 GB porque alguien lo dejó en debug. Desde ~/infra, ansible-playbook playbooks/logrotate.yml -l ctl02 lo pone en info, rota el log y reinicia RabbitMQ. A mano: sudo truncate -s 0 del log y sudo systemctl restart rabbitmq-server, pero el debug seguiría ahí.',
  ],
  causa: 'Alguien dejó RabbitMQ en nivel debug en ctl02 durante una prueba. El log creció hasta 30 GB, llenó /var y RabbitMQ se cayó. Los servicios de ctl02 se quedan sin cola de mensajes y una de cada tres peticiones a la API acaba en 500.',
  solucion: 'Localización del log con du, playbook logrotate.yml (nivel info, rotación y reinicio de RabbitMQ) y comprobación del clúster con rabbitmqctl.',
  leccion: 'Un disco lleno es un síntoma: la pregunta es quién lo llena y por qué. Liberar espacio sin corregir el nivel de log compra horas, no una solución. Y fíjate en el patrón: fallos intermitentes = un nodo de tres está mal.',
  guion: ['amtool alert', 'ssh ctl02', 'df -h', 'du -sh /var/log/*', 'du -sh /var/log/rabbitmq/*', 'exit', 'cd infra', 'ansible-playbook playbooks/logrotate.yml -l ctl02', 'ssh ctl02', 'sudo rabbitmqctl cluster_status'],
  trampas: [
    { cmds: ['ssh ctl02', 'sudo systemctl restart rabbitmq-server'], porque: 'sin espacio no arranca' },
    { cmds: ['ssh ctl02', 'sudo journalctl --vacuum-size=100M', 'sudo systemctl restart rabbitmq-server'], porque: 'el journal no es lo que llena /var' },
  ],
},
// ============================================================================ 5
{
  id: 'INC-4836', clave: 'reloj', tipo: 'incidente', nivel: 2, area: 'Ceph · Ansible', funciones: ['ceph', 'auto', 'incid'],
  impacto: 'medio', urgencia: 'media', de: 'Monitorización (Alertmanager)',
  asunto: 'Ceph en HEALTH_WARN: clock skew detected on mon.ceph03',
  cuerpo: ['Ceph ha pasado a HEALTH_WARN por desfase horario en uno de sus monitores. Por ahora el clúster funciona, pero si el desfase crece los monitores pueden perder el quórum.',
    'Esta madrugada hubo pruebas con los servidores NTP internos.'],
  inicio: -47, abierto: -20,
  averias: [
    { tipo: 'reloj-desfasado', nodo: 'ceph03', segundos: 0.912, hace: 300 },
    { tipo: 'reloj-desfasado', nodo: 'cmp01', segundos: 0.341, hace: 290 },
  ],
  practicas: [
    { t: 'Miraste las alertas de toda la flota, no sólo la de Ceph', ok: st => usado(st, /amtool alert|ansible .*(timedatectl|chronyc)/) },
    { t: 'Arreglaste la flota con Ansible (chrony.yml), no nodo a nodo', ok: st => pb(st, 'chrony.yml').length > 0 },
    { t: 'chrony queda habilitado en los dos nodos', ok: st => st.hosts.ceph03.svcs.chrony.enabled && st.hosts.cmp01.svcs.chrony.enabled },
  ],
  pistas: [
    'MON_CLOCK_SKEW: un monitor de Ceph tiene la hora mal. Lee ceph health detail y después las alertas de toda la flota: amtool alert.',
    'En ceph03: timedatectl y chronyc tracking. ¿Está chrony corriendo? ¿Y en los demás? Desde ~/infra, ansible all -m shell -a "timedatectl | grep synchronized" te lo dice de una vez.',
    'chrony está parado y deshabilitado en ceph03 y en cmp01. Desde ~/infra, ansible-playbook playbooks/chrony.yml lo arranca, lo habilita y fuerza la sincronización en toda la flota. A mano harían falta enable --now y chronyc makestep en cada nodo.',
  ],
  causa: 'chrony quedó parado y deshabilitado en ceph03 y en cmp01 tras las pruebas de NTP de esta madrugada. Ceph detecta el desfase en su monitor de ceph03; el de cmp01 sólo lo ve Prometheus.',
  solucion: 'Playbook chrony.yml en toda la flota: chrony arrancado y habilitado donde faltaba y sincronización forzada.',
  leccion: 'El síntoma te enseña un nodo; el problema puede estar en varios. Para eso existen las herramientas de flota: un playbook idempotente arregla los que están mal y no toca los que están bien. Y chrony corrige despacio a propósito: si necesitas la hora ya, makestep.',
  guion: ['ceph health detail', 'amtool alert', 'cd infra', 'ansible all -m shell -a "timedatectl | grep synchronized"', 'ansible-playbook playbooks/chrony.yml', 'ceph -s'],
  trampas: [{ cmds: ['ssh ceph03', 'sudo systemctl start chrony'], porque: 'arranca, pero sin makestep tarda media hora en corregir y cmp01 sigue mal' }],
},
// ============================================================================ 6
{
  id: 'INC-4840', clave: 'nearfull', tipo: 'incidente', nivel: 2, area: 'Ceph', funciones: ['ceph', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: 'Monitorización (Alertmanager)',
  asunto: 'CephOSDNearFull: osd.7 al 87 %',
  cuerpo: ['Alertmanager avisa de que osd.7 ha pasado el umbral de casi lleno. Ceph está en HEALTH_WARN con todos los pools marcados nearfull.',
    'Si ese OSD llega al 95 %, el clúster entero dejará de aceptar escrituras.'],
  inicio: -95, abierto: -30,
  averias: [
    { tipo: 'balancer-apagado', osd: 7, exceso: 29.5 },
    { tipo: 'registro-ceph', lineas: [{ hace: 95, sev: 'WRN', t: 'Health check failed: 1 nearfull osd(s) (OSD_NEARFULL)' }] },
  ],
  practicas: [
    { t: 'Miraste el reparto por OSD (ceph osd df) antes de actuar', ok: st => antes(st, /ceph osd df/, /balancer on|reweight|set-nearfull/) },
    { t: 'Encendiste el balancer: arreglas la causa, no sólo este OSD', ok: st => st.ceph.balancer.activo },
    { t: 'No tocaste los umbrales para callar la alarma', ok: st => !st.hechos.umbralSubido },
  ],
  pistas: [
    'Un clúster al 60 % no debería tener un OSD casi lleno. Mira el reparto: ceph osd df. Fíjate en la columna VAR y en STDDEV.',
    'Un OSD muy por encima de la media es un problema de reparto, no de capacidad. ¿Quién reparte en Ceph? ceph balancer status.',
    'El balancer está apagado desde una migración. ceph balancer on y deja que trabaje (sleep 420, luego ceph osd df). Si hubiera prisa, ceph osd reweight-by-utilization quita peso al OSD cargado mientras tanto.',
  ],
  causa: 'El balancer se apagó durante la migración de la semana pasada y nadie lo volvió a encender. Sin él, CRUSH reparte con varianza y osd.7 fue acumulando datos hasta el 87 %.',
  solucion: 'Balancer encendido (modo upmap) y espera a que redistribuya; comprobación con ceph osd df.',
  leccion: 'Ceph se llena por el OSD más lleno, no por la media: con uno al 95 % el clúster deja de escribir aunque queden 6 TiB libres. Mira siempre ceph osd df, no sólo ceph df. Y subir nearfull_ratio es quitarle las pilas al detector de humo porque pita.',
  guion: ['ceph health detail', 'ceph osd df', 'ceph balancer status', 'ceph balancer on', 'sleep 420', 'ceph osd df', 'ceph -s'],
  trampas: [{ cmds: ['ceph osd set-nearfull-ratio 0.9'], porque: 'calla la alarma sin mover un byte' }],
},
// ============================================================================ 6b
{
  id: 'INC-4861', clave: 'certificado', tipo: 'incidente', nivel: 2, area: 'OpenStack · Ansible', funciones: ['openstack', 'auto', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: 'Desarrollo y atención al cliente',
  asunto: 'La API de OpenStack rechaza las conexiones: "certificate has expired"',
  cuerpo: ['Desde las 08:20 ningún pipeline consigue hablar con OpenStack y Horizon muestra un aviso de seguridad en el navegador. El error es siempre el mismo: CERTIFICATE_VERIFY_FAILED, certificate has expired.',
    'Las VMs que ya estaban funcionando siguen funcionando.'],
  inicio: -52, abierto: -12,
  averias: [{ tipo: 'certificado-caducado', hace: 52 }],
  practicas: [
    { t: 'Confirmaste la caducidad (curl u openssl) antes de tocar nada', ok: st => antes(st, /openssl|curl/, /certs\.yml|(restart|reload) haproxy/) },
    { t: 'Renovaste con Ansible en los tres controladores, no sólo en el de la VIP', ok: st => pb(st, 'certs.yml').some(x => !x.limite || /controllers|all/.test(x.limite)) },
    { t: 'Comprobaste desde fuera que la API vuelve a responder', ok: st => despues(st, /openssl s_client|curl|openstack /, /certs\.yml|(restart|reload) haproxy/) },
  ],
  pistas: [
    'El error lo dice todo, pero confírmalo tú: curl -I https://api.retail.local:5000, u openssl s_client -connect api.retail.local:5000. ¿Qué fecha tiene el certificado?',
    'La VIP de la API la sirve HAProxy en los controladores. En ctl01: openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates. Dónde está el certificado renovado lo dice el RUNBOOK (cat ~/RUNBOOK.md).',
    'Desde ~/infra, ansible-playbook playbooks/certs.yml copia el certificado renovado a los tres controladores y recarga HAProxy. Reiniciar HAProxy sin cambiar el fichero no sirve: volvería a cargar el caducado.',
  ],
  causa: 'El certificado de api.retail.local caducó a las 08:20. Se renovaba con un cron en ctl01 que desapareció al reinstalar el nodo en agosto; el certificado nuevo llevaba un mes en el repositorio de Ansible sin que nadie lo desplegara.',
  solucion: 'Confirmación con curl y openssl, despliegue con certs.yml en los tres controladores (copia y recarga de HAProxy) y comprobación desde fuera.',
  leccion: 'Un certificado caduca a una hora exacta y lo tumba todo a la vez: por eso se vigila con una alerta a 30 días, no el día que falla. Y fíjate en las dos mitades: el fichero en disco y lo que el servicio tiene cargado en memoria. Hasta que HAProxy no recarga, el certificado nuevo no existe para nadie.',
  guion: ['source ~/admin-openrc', 'openstack server list --all-projects', 'curl -I https://api.retail.local:5000', 'ssh ctl01', 'openssl x509 -in /etc/haproxy/certs/api.pem -noout -dates', 'exit', 'cd infra', 'ansible-playbook playbooks/certs.yml', 'openssl s_client -connect api.retail.local:5000', 'openstack server list --all-projects'],
  trampas: [
    { cmds: ['ssh ctl01', 'sudo systemctl restart haproxy'], porque: 'reiniciar vuelve a cargar el mismo certificado caducado' },
    { cmds: ['cd infra', 'ansible-playbook playbooks/certs.yml -l ctl01'], porque: 'sólo arregla el controlador de la VIP: si keepalived la mueve, vuelve el error' },
  ],
},
// ============================================================================ 6c
{
  id: 'INC-4866', clave: 'galera', tipo: 'incidente', nivel: 2, area: 'OpenStack · MariaDB', funciones: ['openstack', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: 'Monitorización (Alertmanager)',
  asunto: 'GaleraClusterSizeLow: la base de datos de OpenStack va con 2 de 3 nodos',
  cuerpo: ['mysqld_exporter avisa de que el clúster Galera que usan todos los servicios de OpenStack ha bajado a 2 nodos. Todo sigue funcionando: con 2 de 3 hay quórum.',
    'Pero si cae otro, la base de datos se detiene y con ella toda la nube.'],
  inicio: -18, abierto: -15,
  averias: [{ tipo: 'servicio-caido', nodo: 'ctl03', servicio: 'mariadb', motivo: 'oom', hace: 18 }],
  practicas: [
    { t: 'Miraste el tamaño del clúster antes de tocar nada', ok: st => antes(st, /wsrep/, /(start|restart) mariadb|galera_new_cluster/) },
    { t: 'Buscaste por qué cayó: el OOM killer (dmesg o journal)', ok: st => antes(st, /dmesg|journalctl.*mariadb|status mariadb/, /(start|restart) mariadb|galera_new_cluster/) },
    { t: 'No usaste galera_new_cluster con el clúster vivo', ok: st => !usado(st, /galera_new_cluster/) },
  ],
  pistas: [
    'Pregunta a la base de datos desde un nodo sano: en ctl01, sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'". ¿Cuántos miembros ve y quién falta?',
    'En ctl03: systemctl status mariadb y sudo dmesg | tail. ¿Qué mató a mariadbd?',
    'Con el clúster vivo, un nodo caído se une solo con un arranque normal: sudo systemctl start mariadb. galera_new_cluster sirve para arrancar un clúster desde cero: con los otros dos en marcha crearías dos bases de datos separadas.',
  ],
  causa: 'El OOM killer de ctl03 mató mariadbd: nova-api tenía una fuga de memoria y el kernel eligió al proceso que más ocupaba. El clúster Galera siguió con dos nodos.',
  solucion: 'Tamaño del clúster comprobado desde ctl01, OOM confirmado en ctl03, arranque normal de mariadb (se une por IST) y comprobación de wsrep_cluster_size = 3. Queda un problema aparte: la fuga de memoria de nova-api.',
  leccion: 'Galera aguanta perder un nodo de tres, no dos: un nodo caído es un aviso con reloj. A un clúster vivo se vuelve con un arranque normal; galera_new_cluster crea un clúster nuevo, y hacerlo con los demás en marcha es la forma más rápida de tener dos bases de datos que divergen. Y el OOM killer mata al que más memoria ocupa, no al culpable.',
  guion: ['amtool alert', 'ssh ctl01', 'sudo mysql -e "SHOW STATUS LIKE \'wsrep_cluster_size\'"', 'exit', 'ssh ctl03', 'sudo dmesg | tail -n 5', 'systemctl status mariadb', 'sudo systemctl start mariadb', 'sudo mysql -e "SHOW STATUS LIKE \'wsrep_%\'"'],
  trampas: [{ cmds: ['ssh ctl03', 'sudo galera_new_cluster'], porque: 'arrancar un clúster nuevo con los otros vivos provoca un split-brain' }],
},
// ============================================================================ 6d
{
  id: 'INC-4875', clave: 'sin-red', tipo: 'incidente', nivel: 2, area: 'OpenStack · Red', funciones: ['openstack', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: 'Equipo tienda online',
  asunto: 'web-tienda-01 y pedidos-api-01 no responden, pero están ACTIVE',
  cuerpo: ['El balanceador ha sacado web-tienda-01 y pedidos-api-01 porque no responden. En OpenStack aparecen ACTIVE y en la consola se ven arrancadas. Las demás web siguen bien.',
    'No hemos tocado nada.'],
  inicio: -26, abierto: -8,
  averias: [
    { tipo: 'servicio-caido', nodo: 'cmp01', servicio: 'openvswitch-switch', motivo: 'ovs-lock', hace: 26, efecto: 'sin él no hay red para las VMs', nota: { hace: 27, t: 'openvswitch-switch.service: unattended-upgrades: openvswitch-switch 2.17.9-0ubuntu0.22.04.1 -> 2.17.9-0ubuntu0.22.04.2, restarting' } },
    { tipo: 'servicio-caido', nodo: 'cmp01', servicio: 'neutron-openvswitch-agent', motivo: 'sin-ovs', hace: 26, efecto: 'openstack network agent list' },
  ],
  practicas: [
    { t: 'Acotaste el radio: sólo fallan las VMs de un hipervisor', ok: st => usado(st, /^ping 10\.|server list.*--host|network agent list/) },
    { t: 'Leíste el error del agente antes de reiniciar nada', ok: st => antes(st, /journalctl.*(neutron|openvswitch)|status (neutron-openvswitch-agent|openvswitch-switch)/, /(start|restart) (neutron-openvswitch-agent|openvswitch-switch)|nova-compute\.yml/) },
    { t: 'Comprobaste la red al final (ovs-vsctl, network agent list o ping)', ok: st => despues(st, /network agent list|ovs-vsctl show|^ping 10\./, /(start|restart) (neutron-openvswitch-agent|openvswitch-switch)|nova-compute\.yml/) },
  ],
  pistas: [
    '¿Fallan todas las VMs o sólo algunas? Mira dónde viven las que no responden (openstack server show web-tienda-01) y haz ping a su IP y a la de una web de otro hipervisor.',
    'openstack network agent list: el agente de Open vSwitch de cmp01 aparece XXX. En cmp01, systemctl status neutron-openvswitch-agent: ¿a qué no consigue conectarse?',
    'El agente necesita Open vSwitch, y Open vSwitch no volvió tras la actualización de esta mañana. Primero sudo systemctl start openvswitch-switch, después sudo systemctl restart neutron-openvswitch-agent. Compruébalo con sudo ovs-vsctl show.',
  ],
  causa: 'La actualización automática de Open vSwitch de esta mañana reinició el servicio en cmp01 mientras otro proceso aún tenía bloqueada su base de datos, y no volvió a arrancar. Sin Open vSwitch cayó también el agente de neutron, y las VMs de cmp01 se quedaron sin red aunque seguían encendidas.',
  solucion: 'Radio del fallo acotado a cmp01 (ping y network agent list), Open vSwitch arrancado primero y el agente después, y comprobación con ovs-vsctl show y ping.',
  leccion: 'Una VM puede estar ACTIVE y sin red a la vez: el estado de nova habla de la máquina, no de su conectividad. Cuando algo falla, primero se acota el radio (¿una VM, un nodo, todo?) y después se sigue la cadena de dependencias de abajo arriba: Open vSwitch antes que el agente que lo usa.',
  guion: st => { const ip = n => st.os.servidores.find(s => s.nombre === n).ip; return ['source ~/admin-openrc', 'openstack server show web-tienda-01', 'ping ' + ip('web-tienda-01'), 'ping ' + ip('web-tienda-02'), 'openstack network agent list', 'ssh cmp01', 'systemctl status neutron-openvswitch-agent', 'sudo systemctl start openvswitch-switch', 'sudo systemctl restart neutron-openvswitch-agent', 'sudo ovs-vsctl show', 'exit', 'ping ' + ip('web-tienda-01')]; },
  trampas: [
    { cmds: ['ssh cmp01', 'sudo systemctl restart neutron-openvswitch-agent'], porque: 'sin Open vSwitch, el agente vuelve a caer' },
    { cmds: ['ssh cmp01', 'sudo reboot', 'sleep 300'], porque: 'reiniciar el hipervisor apaga las VMs de los clientes' },
  ],
},
// ============================================================================ 6e
{
  id: 'REQ-1319', clave: 'restaurar', tipo: 'peticion', nivel: 2, area: 'OpenStack · Copias', funciones: ['openstack'],
  impacto: 'alto', urgencia: 'media', de: 'Equipo tienda online (Marta Ruiz)',
  asunto: 'Restaurar redis-carrito-02, borrada por error',
  cuerpo: ['Esta mañana, limpiando VMs de pruebas, borramos redis-carrito-02 por error: el filtro cogió "redis-carrito-0*". El carrito funciona con la otra, pero sin redundancia.',
    'Necesitamos que vuelva con los datos de la copia de esta noche, con el mismo nombre y en nuestro proyecto. La IP da igual: la aplicación la encuentra por DNS.'],
  inicio: -95, abierto: -20,
  averias: [{ tipo: 'vm-borrada', vm: 'redis-carrito-02' }],
  practicas: [
    { t: 'Buscaste las copias disponibles (image list)', ok: st => usado(st, /image list/) },
    { t: 'Leíste en la copia cómo era la VM original (image show) antes de recrearla', ok: st => antes(st, /image show backup-redis-carrito-02/, /server create/) },
    { t: 'Comprobaste que arrancó (server show o server list)', ok: st => despues(st, /server (show|list)/, /server create/) },
  ],
  pistas: [
    'Las copias nocturnas son imágenes: openstack image list (tras source ~/admin-openrc). Busca la más reciente de esa VM.',
    'openstack image show de la copia te dice cómo era la VM original: flavor, red y proyecto. Con esos datos se recrea igual.',
    'Cuidado con el proyecto: con las credenciales de admin, la VM nacería en admin y tienda-online no la vería. openstack --os-project-name tienda-online server create --flavor m1.medium --image backup-redis-carrito-02-20260923 --network retail-net redis-carrito-02.',
  ],
  causa: 'Una limpieza de VMs de pruebas con un filtro demasiado amplio (redis-carrito-0*) borró una VM de producción. La copia nocturna de las 03:00 estaba disponible como imagen.',
  solucion: 'Copia localizada con image list, datos de la VM original leídos con image show, VM recreada desde la copia en su proyecto con el mismo flavor y la misma red, y comprobación de que arranca.',
  leccion: 'Restaurar no es sólo tener la copia: es dejar las cosas como estaban, en el mismo proyecto, con el mismo tamaño y en la misma red. Y todo lo escrito entre las 03:00 y el borrado se ha perdido: por eso importa cada cuánto se hace la copia (el RPO), no sólo que exista.',
  guion: ['source ~/admin-openrc', 'openstack server list --project tienda-online', 'openstack image list', 'openstack image show backup-redis-carrito-02-20260923', 'openstack --os-project-name tienda-online server create --flavor m1.medium --image backup-redis-carrito-02-20260923 --network retail-net redis-carrito-02', 'sleep 60', 'openstack server show redis-carrito-02'],
  trampas: [
    { cmds: ['source ~/admin-openrc', 'openstack server create --flavor m1.medium --image backup-redis-carrito-02-20260923 --network retail-net redis-carrito-02', 'sleep 60'], porque: 'con las credenciales de admin nace en el proyecto admin' },
    { cmds: ['source ~/admin-openrc', 'openstack --os-project-name tienda-online server create --flavor m1.medium --image ubuntu-22.04 --network retail-net redis-carrito-02', 'sleep 60'], porque: 'una imagen limpia no tiene los datos' },
  ],
},
// ============================================================================ 6f
{
  id: 'INC-4880', clave: 'volumen-atascado', tipo: 'incidente', nivel: 2, area: 'OpenStack · Cinder', funciones: ['openstack', 'incid'],
  impacto: 'medio', urgencia: 'media', de: 'Equipo tienda online (Marta Ruiz)',
  asunto: 'El volumen pedidos-db-old lleva desde ayer en «deleting»',
  cuerpo: ['Ayer por la tarde borramos pedidos-db-old (400 GB) y sigue en «deleting». Nos cuenta en la cuota y no podemos crear el volumen de la nueva base de datos.',
    'Hemos intentado borrarlo otra vez y OpenStack no nos deja.'],
  inicio: -1082, abierto: -30,
  averias: [
    { tipo: 'uso-volumenes', proyecto: 'tienda-online', gb: 1000 },
    { tipo: 'servicio-caido', nodo: 'ctl02', servicio: 'cinder-volume', motivo: 'rados-timeout', hace: 1082, efecto: 'nadie puede terminar las operaciones de sus volúmenes' },
    { tipo: 'volumen-atascado', nombre: 'pedidos-db-old', proyecto: 'tienda-online', gb: 400, nodo: 'ctl02', hace: 1080 },
  ],
  practicas: [
    { t: 'Miraste qué servicio gestiona el volumen y si está vivo (volume show y volume service list)', ok: st => usado(st, /volume show/) && antes(st, /volume service list/, /volume set --state|volume delete/) },
    { t: 'Levantaste cinder-volume antes de reintentar el borrado', ok: st => antes(st, /(start|restart) cinder-volume/, /volume set --state/) },
    { t: 'Comprobaste que desapareció y que la cuota bajó', ok: st => despues(st, /volume list|quota show/, /volume delete/) },
  ],
  pistas: [
    'Mira el volumen por dentro: openstack volume show pedidos-db-old (tras source ~/admin-openrc). ¿Qué servicio de cinder se encarga de él (os-vol-host-attr:host)?',
    'openstack volume service list: el cinder-volume de ctl02 está down desde ayer. Nadie puede terminar ese borrado. En ctl02, systemctl status cinder-volume: ¿por qué murió?',
    'Levanta el servicio (sudo systemctl restart cinder-volume en ctl02) y reintenta. Un volumen en deleting no se puede volver a borrar: primero openstack volume set --state error pedidos-db-old y después openstack volume delete pedidos-db-old.',
  ],
  causa: 'Durante el reinicio de los monitores de Ceph de ayer por la tarde, el cinder-volume de ctl02 perdió la conexión con el clúster en mitad del borrado de pedidos-db-old y murió. El volumen quedó en «deleting» para siempre: la base de datos de Cinder esperaba a un servicio que ya no existía.',
  solucion: 'Volumen y servicio responsable identificados (volume show, volume service list), cinder-volume levantado en ctl02, estado del volumen reiniciado a error y borrado de nuevo, y comprobación del volumen y de la cuota.',
  leccion: 'Un estado transitorio que no avanza («deleting», «creating», «migrating») casi siempre significa que el servicio que tenía que terminar la operación murió a mitad. Primero se levanta quien hace el trabajo; después se corrige el estado. Cambiar el estado sin levantar el servicio sólo mueve el atasco un paso más allá.',
  guion: ['source ~/admin-openrc', 'openstack volume list --all-projects', 'openstack volume show pedidos-db-old', 'openstack volume service list', 'ssh ctl02', 'systemctl status cinder-volume', 'sudo systemctl restart cinder-volume', 'exit', 'openstack volume set --state error pedidos-db-old', 'openstack volume delete pedidos-db-old', 'sleep 60', 'openstack volume list --project tienda-online', 'openstack quota show --usage tienda-online'],
  trampas: [
    { cmds: ['source ~/admin-openrc', 'openstack volume delete pedidos-db-old'], porque: 'un volumen en deleting no se puede volver a borrar' },
    { cmds: ['source ~/admin-openrc', 'openstack volume set --state error pedidos-db-old', 'openstack volume delete pedidos-db-old', 'sleep 120'], porque: 'sin cinder-volume vivo, el borrado se vuelve a quedar colgado' },
  ],
},
// ============================================================================ 6g
{
  id: 'INC-4884', clave: 'fuga-memoria', tipo: 'incidente', nivel: 2, area: 'OpenStack · Linux', funciones: ['openstack', 'auto', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: 'Monitorización (Alertmanager)',
  asunto: 'NodeMemoryHighUtilization: ctl03 al 92 %',
  cuerpo: ['La memoria de ctl03 lleva días subiendo sin parar y ya pasa del 90 %. Hace poco el OOM killer mató MariaDB en ese mismo nodo (INC-4866).',
    'ctl01 y ctl02 también suben, más despacio. Nadie ha desplegado nada.'],
  inicio: -180, abierto: -10,
  averias: [{ tipo: 'fuga-memoria', memoria: { ctl01: 31, ctl02: 22, ctl03: 61 } }],
  practicas: [
    { t: 'Identificaste el proceso que se come la memoria (top, ps o systemctl status)', ok: st => antes(st, /\btop\b|ps aux|systemctl status nova-api/, /nova-patch\.yml|restart nova-api|apt (full-|dist-)?upgrade/) },
    { t: 'Buscaste si había una corrección publicada (apt list --upgradable o apt changelog)', ok: st => usado(st, /apt (list|changelog)/) },
    { t: 'Parcheaste y reiniciaste de uno en uno, sin tirar la API (nova-patch.yml)', ok: st => pb(st, 'nova-patch.yml').length > 0 },
  ],
  pistas: [
    'free -h dice cuánto; lo que importa es quién. En ctl03: ps aux --sort=-rss | head -5, o top.',
    'nova-api ocupa decenas de GB y crece. ¿Es un fallo conocido? apt list --upgradable y apt changelog nova-api en ctl03.',
    'La 29.2.1 corrige la fuga. Instalarla no basta: el proceso que corre sigue con el código viejo hasta que se reinicia. Desde ~/infra, ansible-playbook playbooks/nova-patch.yml actualiza y reinicia los tres controladores de uno en uno.',
  ],
  causa: 'nova 29.2.0 tiene una fuga de memoria en nova-api al listar servidores con muchos puertos (LP#2071234): cada petición deja memoria sin liberar. ctl03 recibe más peticiones y va por delante; ctl01 y ctl02 van detrás. La 29.2.1, ya en el repositorio, lo corrige.',
  solucion: 'Proceso identificado (ps, top), fallo confirmado en el changelog, y nova-patch.yml: actualización a 29.2.1 y reinicio de nova-api controlador a controlador.',
  leccion: 'Ante una fuga hay dos tiempos: mitigar (reiniciar devuelve la memoria, pero la fuga vuelve) y corregir (el parche). Entre instalar y reiniciar hay un hueco: un paquete nuevo no cambia el proceso que ya está corriendo. Y un servicio detrás de un balanceador se reinicia de uno en uno, para que la API no se caiga.',
  guion: ['amtool alert', 'ssh ctl03', 'free -h', 'ps aux --sort=-rss | head -5', 'apt list --upgradable', 'apt changelog nova-api', 'exit', 'cd infra', 'ansible-playbook playbooks/nova-patch.yml', 'ssh ctl03', 'free -h'],
  trampas: [
    { cmds: ['ssh ctl03', 'sudo systemctl restart nova-api'], porque: 'la memoria baja, pero sin parche la fuga vuelve' },
    { cmds: ['ssh ctl03', 'sudo apt full-upgrade -y'], porque: 'instalado no es cargado: nova-api sigue corriendo la versión vieja' },
  ],
},
// ============================================================================ 7
{
  id: 'CHG-0218', clave: 'kernel', tipo: 'cambio', nivel: 2, area: 'Ceph · Ansible', funciones: ['ceph', 'auto'],
  impacto: 'medio', urgencia: 'baja', de: 'Seguridad (aprobado en el CAB)',
  asunto: 'Parche de kernel en ceph02 (USN-7022-1) y reinicio',
  cuerpo: ['Cambio aprobado en el CAB de ayer: instalar el kernel 5.15.0-122 en ceph02 y reiniciar. Ventana: ahora, en horario de baja carga.',
    'Criterio de éxito: ceph02 arranca con el kernel nuevo y Ceph vuelve a HEALTH_OK sin mover datos. El resto de nodos Ceph se hará la semana que viene.'],
  inicio: 0, abierto: 0,
  averias: [{ tipo: 'kernel-disponible', version: '5.15.0-122-generic' }],
  objetivo(st) {
    const h = st.hosts.ceph02, p = [];
    if (!h.up) p.push('ceph02 aún está arrancando (tarda unos 12 minutos): sleep y ceph -s');
    else if (h.kernel !== '5.15.0-122-generic') p.push(h.kernelNuevo ? 'El kernel nuevo está instalado pero ceph02 no se ha reiniciado (uname -r)' : 'ceph02 sigue con el kernel ' + h.kernel + ' (uname -r)');
    if (st.ceph.flags.noout) p.push('noout sigue puesto: quítalo al terminar (ceph osd unset noout)');
    return p;
  },
  practicas: [
    { t: 'Comprobaste que Ceph estaba sano antes de empezar', ok: st => antes(st, /ceph (-s|status|health)|ceph-reboot\.yml/, /\breboot\b|shutdown -r|set noout/) || pb(st, 'ceph-reboot.yml').length > 0 },
    { t: 'Pusiste noout antes de reiniciar', ok: st => { const r = st.hechos.reinicios.filter(x => x.host === 'ceph02'); return r.length > 0 && r.every(x => x.noout); } },
    { t: 'Ceph no movió datos: cero rebalanceos', ok: st => st.ceph.movimientos === 0 },
    { t: 'Usaste la automatización del equipo (os-update.yml o ceph-reboot.yml)', ok: st => pb(st, 'os-update.yml').length > 0 || pb(st, 'ceph-reboot.yml').length > 0 },
  ],
  pistas: [
    'Un cambio empieza comprobando que el punto de partida está sano: ceph -s. Después instala el parche en ceph02 (sudo apt update y sudo apt full-upgrade -y, o desde ~/infra playbooks/os-update.yml -l ceph02).',
    'Ceph marca out un OSD que lleva 10 minutos caído, y un nodo Ceph tarda unos 12 en volver. ¿Qué pasará si reinicias sin más? El RUNBOOK lo cuenta: cat ~/RUNBOOK.md.',
    'ceph osd set noout, sudo reboot en ceph02, espera (sleep 780 y ceph -s hasta que vuelvan los OSD) y ceph osd unset noout. O todo en uno desde ~/infra: ansible-playbook playbooks/ceph-reboot.yml -l ceph02.',
  ],
  causa: 'Cambio planificado: parche de seguridad del kernel.',
  solucion: 'Parche instalado con os-update.yml y reinicio ordenado con ceph-reboot.yml: noout, reinicio, espera a los OSD y a la recuperación, unset noout.',
  leccion: 'En almacenamiento distribuido, reiniciar un nodo no es "reiniciar un servidor": es avisar al clúster de que no se alarme. noout convierte 12 minutos de nodo caído en 12 minutos de redundancia reducida, en vez de más de 3 TiB copiándose de un lado a otro y luego de vuelta.',
  guion: ['ceph -s', 'cd infra', 'ansible-playbook playbooks/os-update.yml -l ceph02', 'ansible-playbook playbooks/ceph-reboot.yml -l ceph02', 'ceph -s', 'ssh ceph02', 'uname -r'],
  trampas: [{ cmds: ['ceph -s', 'ssh ceph02', 'sudo apt full-upgrade -y', 'sudo reboot', 'sleep 900', 'sleep 900'], porque: 'sin noout se resuelve, pero moviendo datos', practicas: [1, 2] }],
},
// ============================================================================ 8
{
  id: 'INC-4847', clave: 'disco-muerto', tipo: 'incidente', nivel: 3, area: 'Ceph', funciones: ['ceph', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: 'Monitorización (Alertmanager)',
  asunto: 'Ceph lleva hora y media degradado',
  cuerpo: ['El turno de noche dejó una nota: "osd.7 caído, Ceph se recuperará solo". Pero Ceph sigue en HEALTH_WARN con datos degradados desde hace 95 minutos.',
    'Un tercio de las réplicas vive en sólo dos copias. Si falla otro disco en otro nodo, habrá datos inaccesibles.'],
  inicio: -95, abierto: 0,
  averias: [
    { tipo: 'flag-ceph', flag: 'noout', hace: 720, efecto: 'es lo que impidió que Ceph marcara out el OSD por su cuenta' },
    { tipo: 'disco-muerto', osd: 7, hace: 95 },
    { tipo: 'registro-ceph', lineas: [{ hace: 700, t: 'CHG-0217: reinicio de mon01 terminado' }] },
  ],
  practicas: [
    { t: 'Comprobaste el disco (smartctl, dmesg o el log del OSD) antes de insistir con arranques', ok: st => !usado(st, /(start|restart) ceph-osd@7/) || antes(st, /smartctl|dmesg|journalctl.*ceph-osd@7|systemctl status ceph-osd@7|ceph-osd\.7\.log/, /(start|restart) ceph-osd@7/) },
    { t: 'Identificaste el disco físico para el cambio (ceph osd metadata o ceph-volume)', ok: st => usado(st, /ceph osd metadata 7|ceph-volume lvm list/) },
    { t: 'Leíste ceph health detail entero: el noout estaba ahí', ok: st => usado(st, /health detail/) },
    { t: 'Archivaste el crash después de leerlo', ok: st => antes(st, /crash (info|ls)/, /crash archive/) },
  ],
  pistas: [
    'Con un OSD caído, Ceph debería haberse curado solo a los 10 minutos. Si lleva 95 degradado, algo se lo impide. Lee ceph health detail entero, línea a línea.',
    'Hay dos problemas. Uno: un OSD que no arranca (ceph osd metadata 7 dice qué disco es; en ceph03, sudo smartctl -a sobre ese disco). Dos: un flag que impide que Ceph reaccione.',
    'El disco de osd.7 está muerto: no lo arranques más. ceph osd unset noout y ceph osd out 7, espera a la reconstrucción (sleep 600, ceph -s) y archiva el crash (ceph crash archive-all).',
  ],
  causa: 'El SSD de osd.7 (/dev/sdc en ceph03) murió hace hora y media. Ceph habría marcado out el OSD a los 10 minutos y reconstruido las réplicas, pero el flag noout seguía puesto desde el cambio de anoche: el clúster no reaccionó.',
  solucion: 'Diagnóstico del disco con smartctl, noout retirado, osd.7 marcado out, espera a la reconstrucción y crash archivado. Pendiente: ticket a hardware para cambiar /dev/sdc de ceph03.',
  leccion: 'Los flags de mantenimiento son deuda: noout protege durante un reinicio y estorba el resto del tiempo. Lee health detail entero, porque la línea que explica por qué no se arregla solo suele estar al lado de la que grita. Y un disco con SMART FAILED no se reinicia: se saca y se cambia.',
  guion: ['ceph health detail', 'ceph osd metadata 7', 'ssh ceph03', 'sudo smartctl -a /dev/sdc', 'exit', 'ceph crash ls', 'ceph osd unset noout', 'ceph osd out 7', 'sleep 600', 'ceph crash archive-all', 'ceph -s'],
  trampas: [
    { cmds: ['ssh ceph03', 'sudo systemctl reset-failed ceph-osd@7', 'sudo systemctl start ceph-osd@7'], porque: 'el disco está muerto: no arranca' },
    { cmds: ['ceph osd out 7', 'ceph crash archive-all', 'sleep 900'], porque: 'sin quitar noout el ticket no se cierra' },
  ],
},
// ============================================================================ 8b
{
  id: 'INC-4871', clave: 'quorum', tipo: 'incidente', nivel: 3, area: 'Ceph', funciones: ['ceph', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: 'Monitorización (Alertmanager)',
  asunto: 'Ceph no responde: ceph -s se queda colgado',
  cuerpo: ['Desde hace unos 20 minutos, cualquier comando de Ceph se queda colgado y acaba en "RADOS timed out". Las VMs siguen funcionando, pero no se pueden crear volúmenes nuevos y la monitorización de Ceph está a ciegas.',
    'Hace tres días hubo un mantenimiento en ceph02 (CHG-0215).'],
  inicio: -22, abierto: -10,
  averias: [
    { tipo: 'servicio-parado', nodo: 'ceph02', servicio: 'ceph-mon@ceph02', hace: 4320, deshabilitado: true, nota: { hace: 4322, src: 'sudo[4411]', t: 'admin : TTY=pts/0 ; PWD=/home/admin ; USER=root ; COMMAND=/usr/bin/systemctl disable --now ceph-mon@ceph02' } },
    { tipo: 'servicio-caido', nodo: 'ceph03', servicio: 'ceph-mon@ceph03', motivo: 'mon-abort', hace: 22, crashes: [23] },
    { tipo: 'registro-ceph', lineas: [{ hace: 4320, sev: 'WRN', t: 'Health check failed: 1/3 mons down, quorum ceph01,ceph03 (MON_DOWN)' }, { hace: 22, sev: 'WRN', t: 'mon.ceph01 calling monitor election' }] },
  ],
  practicas: [
    { t: 'Miraste los monitores desde su nodo (socket de administración) en vez de esperar a ceph -s', ok: st => usado(st, /ceph daemon mon\./) },
    { t: 'Averiguaste por qué mon.ceph02 llevaba días parado', ok: st => usado(st, /journalctl.*ceph-mon@ceph02|status ceph-mon@ceph02/) },
    { t: 'Comprobaste el quórum al terminar', ok: st => despues(st, /ceph (mon stat|-s|status|health)|mon_status|quorum_status/, /(start|enable).*ceph-mon/) },
  ],
  pistas: [
    'Si ceph -s se cuelga, no hay quórum: dos de los tres monitores no responden. Las alertas dicen dónde mirar (amtool alert).',
    'Sin quórum, pregunta a cada monitor en su nodo: en ceph01, sudo ceph daemon mon.ceph01 mon_status. En ceph02 y ceph03, systemctl status y journalctl del monitor: ¿por qué está parado cada uno?',
    'mon.ceph03 se cayó tres veces y systemd lo dejó: sudo systemctl reset-failed ceph-mon@ceph03 y sudo systemctl start ceph-mon@ceph03. mon.ceph02 lleva tres días deshabilitado: sudo systemctl enable --now ceph-mon@ceph02. Después, ceph crash archive-all.',
  ],
  causa: 'mon.ceph02 se quedó parado y deshabilitado tras el mantenimiento de hace tres días (CHG-0215), y el aviso MON_DOWN se ignoró porque con 2 de 3 seguía habiendo quórum. Hoy mon.ceph03 se cayó por un fallo de Paxos: con un solo monitor vivo, el clúster perdió el quórum.',
  solucion: 'Estado de cada monitor mirado en su nodo (socket de administración y systemctl), mon.ceph03 levantado con reset-failed y start, mon.ceph02 habilitado y arrancado, crash archivado y quórum comprobado.',
  leccion: 'Un clúster de tres aguanta un fallo, no dos. El primer fallo no rompe nada y por eso se ignora; es el segundo el que se lo lleva todo. Un aviso de redundancia perdida es una incidencia, no ruido. Y cuando la herramienta del clúster se cuelga, se baja a los nodos: systemctl y el socket de administración funcionan sin quórum.',
  guion: ['amtool alert', 'ssh ceph01', 'sudo ceph daemon mon.ceph01 mon_status', 'exit', 'ssh ceph03', 'systemctl status ceph-mon@ceph03', 'sudo systemctl reset-failed ceph-mon@ceph03', 'sudo systemctl start ceph-mon@ceph03', 'exit', 'ssh ceph02', 'journalctl -u ceph-mon@ceph02 -n 5', 'sudo systemctl enable --now ceph-mon@ceph02', 'exit', 'ceph crash archive-all', 'ceph -s'],
  trampas: [
    { cmds: ['ssh ceph03', 'sudo systemctl reset-failed ceph-mon@ceph03', 'sudo systemctl start ceph-mon@ceph03'], porque: 'vuelve el quórum, pero con 2 de 3: el mismo fallo latente que lo ha tumbado todo' },
    { cmds: ['ssh ceph02', 'sudo systemctl start ceph-mon@ceph02', 'exit', 'ssh ceph03', 'sudo systemctl reset-failed ceph-mon@ceph03', 'sudo systemctl start ceph-mon@ceph03', 'exit', 'ceph crash archive-all'], porque: 'arrancado sin habilitar: el próximo reinicio lo deja otra vez fuera' },
  ],
},
// ============================================================================ 8c
{
  id: 'INC-4889', clave: 'mon-disco', tipo: 'incidente', nivel: 3, area: 'Ceph', funciones: ['ceph', 'auto', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: 'Monitorización (Alertmanager)',
  asunto: 'mon.ceph01 caído y / de ceph01 al 100 %',
  cuerpo: ['El monitor de Ceph de ceph01 se ha apagado y el disco raíz del nodo está lleno. El clúster sigue funcionando con 2 de 3 monitores.',
    'La semana pasada se estuvo depurando un problema de elecciones de monitores.'],
  inicio: -40, abierto: -12,
  averias: [
    { tipo: 'config-ceph', quien: 'mon', opcion: 'debug_mon', valor: '20/20', hace: 10080, efecto: 'los logs de los tres monitores siguen creciendo' },
    { tipo: 'disco-lleno', nodo: 'ceph01', fichero: '/var/log/ceph/ceph-mon.ceph01.log', mb: 35500 },
    { tipo: 'disco-lleno', nodo: 'ceph02', fichero: '/var/log/ceph/ceph-mon.ceph02.log', mb: 22000 },
    { tipo: 'disco-lleno', nodo: 'ceph03', fichero: '/var/log/ceph/ceph-mon.ceph03.log', mb: 18000 },
    { tipo: 'servicio-caido', nodo: 'ceph01', servicio: 'ceph-mon@ceph01', motivo: 'mon-sin-espacio', hace: 40 },
    { tipo: 'registro-ceph', lineas: [{ hace: 40, sev: 'WRN', t: 'Health check failed: 1/3 mons down, quorum ceph02,ceph03 (MON_DOWN)' }] },
  ],
  practicas: [
    { t: 'Buscaste qué llenaba el disco (du) antes de borrar nada', ok: st => antes(st, /\bdu\b/, /truncate|\brm\b/) },
    { t: 'Encontraste la causa en la configuración central de Ceph (ceph config)', ok: st => usado(st, /ceph config (dump|get)/) },
    { t: 'Limpiaste también los monitores que aún aguantaban', ok: st => ['ceph02', 'ceph03'].every(n => st.hosts[n].logs['/var/log/ceph/ceph-mon.' + n + '.log'] < 5000) },
  ],
  pistas: [
    'Empieza por ceph health detail: además del monitor caído, ¿cómo andan de disco los otros dos? En ceph01, df -h y sudo du -sh /var/log/ceph/*.',
    'Un log de 35 GB es un log en debug. En Ceph el nivel de log es configuración central, no un fichero: ceph config dump. ¿Quién tiene debug_mon en 20?',
    'ceph config set mon debug_mon 1/5 corta el grifo en los tres monitores. Después vacía sus logs en los tres (desde ~/infra: ansible ceph -b -m shell -a "truncate -s 0 /var/log/ceph/ceph-mon.*.log") y arranca el de ceph01 (sudo systemctl start ceph-mon@ceph01).',
  ],
  causa: 'La semana pasada alguien subió debug_mon a 20/20 con ceph config set para depurar unas elecciones de monitores y no lo devolvió a su valor. Los tres monitores empezaron a escribir cientos de MB por minuto; el de ceph01 llenó el disco y se apagó solo para protegerse, y los otros dos iban por el mismo camino.',
  solucion: 'Causa localizada con du y ceph config dump, debug_mon devuelto a 1/5, logs de los tres monitores vaciados con Ansible y mon.ceph01 arrancado.',
  leccion: 'Ceph se configura en un sitio central: un ceph config set afecta a todos los demonios del tipo, estén donde estén. Por eso el síntoma aparece en un nodo y la causa vive en el clúster, y por eso hay que mirar a los otros monitores antes de que caigan. Y un nivel de debug es una herramienta de un rato: se sube, se mira y se baja.',
  guion: ['ceph health detail', 'ssh ceph01', 'df -h', 'sudo du -sh /var/log/ceph/*', 'exit', 'ceph config dump', 'ceph config set mon debug_mon 1/5', 'cd infra', 'ansible ceph -b -m shell -a "truncate -s 0 /var/log/ceph/ceph-mon.*.log"', 'ssh ceph01', 'sudo systemctl start ceph-mon@ceph01', 'exit', 'ceph -s'],
  trampas: [
    { cmds: ['ssh ceph01', 'sudo systemctl start ceph-mon@ceph01'], porque: 'sin espacio, el monitor no arranca' },
    { cmds: ['ssh ceph01', 'sudo truncate -s 0 /var/log/ceph/ceph-mon.ceph01.log', 'sudo systemctl start ceph-mon@ceph01'], porque: 'sin corregir debug_mon, el log vuelve a crecer y los otros dos monitores van por el mismo camino' },
  ],
},
// ============================================================================ 9
{
  id: 'INC-4852', clave: 'terraform-sg', tipo: 'incidente', nivel: 3, area: 'Terraform · Seguridad', funciones: ['auto', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: 'Seguridad (escáner externo)',
  asunto: 'Puerto 22 expuesto a internet en 185.47.12.20 (pos-backend-01)',
  cuerpo: ['El escáner externo de esta mañana detecta SSH abierto a internet en 185.47.12.20, la IP pública del backend de los TPV. Ese puerto sólo debería aceptar conexiones desde la red de administración (10.20.0.0/16).',
    'El grupo de seguridad de ese servidor se gestiona con Terraform. Cerradlo cuanto antes y dejad constancia.'],
  inicio: -130, abierto: -15,
  averias: [{ tipo: 'regla-a-mano' }],
  practicas: [
    { t: 'terraform plan antes de terraform apply', ok: st => { const t = st.hechos.tf; const i = t.findIndex(x => x.accion === 'plan'), j = t.findIndex(x => x.accion === 'apply'); return i >= 0 && (j < 0 || i < j); } },
    { t: 'Comprobaste las reglas reales en OpenStack', ok: st => usado(st, /security group rule list/) },
    { t: 'Cerraste con un terraform plan limpio (No changes)', ok: st => { const t = st.hechos.tf, u = t[t.length - 1]; return !!u && u.accion === 'plan' && u.pendientes === 0; } },
  ],
  pistas: [
    'Mira qué reglas tiene de verdad el grupo del servidor: openstack security group rule list sg-pos-backend (con las credenciales cargadas: source ~/admin-openrc).',
    'Ese grupo lo gestiona Terraform. Desde ~/infra/terraform, terraform plan te dice qué ha cambiado fuera de él. Compara su respuesta con lo que ves en OpenStack: ¿menciona la regla abierta?',
    'Terraform ve que falta ssh_admin y la recreará (terraform apply), pero no sabe nada de la regla 0.0.0.0/0 que alguien creó a mano: bórrala tú (openstack security group rule delete <ID>) y termina con un terraform plan que diga No changes.',
  ],
  causa: 'Alguien depuró un problema de acceso a pos-backend-01 desde Horizon: borró la regla de SSH restringida y abrió el 22 a todo internet "de forma temporal". Terraform detecta la regla que falta, pero no la que sobra: nunca estuvo en su estado.',
  solucion: 'terraform plan para ver la deriva, terraform apply para recrear ssh_admin, borrado manual de la regla abierta al mundo y plan final sin cambios.',
  leccion: 'La infraestructura como código sólo te protege de lo que declara. Terraform compara con la realidad los recursos que conoce; lo creado a mano es invisible para él. Por eso un cambio a mano en producción es peligroso dos veces: rompe algo y además se esconde.',
  guion: st => ['source ~/admin-openrc', 'openstack security group rule list sg-pos-backend', 'cd infra/terraform', 'terraform plan', 'terraform apply -auto-approve', 'openstack security group rule delete ' + U.uuid('manual-ssh-world'), 'terraform plan'],
  trampas: [{ cmds: ['source ~/admin-openrc', 'cd infra/terraform', 'terraform apply -auto-approve'], porque: 'Terraform no borra lo que no conoce' }],
},
// ============================================================================ 10
{
  id: 'CHG-0221', clave: 'alta-cmp04', tipo: 'cambio', nivel: 3, area: 'OpenStack · Ansible', funciones: ['openstack', 'auto'],
  impacto: 'bajo', urgencia: 'media', de: 'Plataforma (planificación de capacidad)',
  asunto: 'Alta de cmp04 como hipervisor',
  cuerpo: ['cmp04 ya está en el rack con Ubuntu 22.04 y la red configurada, y aparece en el inventario de Ansible, en el grupo compute_nuevos. Hay que darlo de alta como hipervisor para absorber el crecimiento de analítica.',
    'Criterio de éxito: cmp04 aparece up en openstack hypervisor list y el scheduler puede colocar VMs en él.'],
  inicio: 0, abierto: 0,
  averias: [],
  objetivo(st) {
    const h = st.hosts.cmp04, p = [];
    if (!h.provisionado) p.push('cmp04 aún no tiene OpenStack instalado (playbooks/alta-compute.yml)');
    else if (!U.novaUp(st, 'cmp04')) p.push('nova-compute no está activo en cmp04');
    if (h.provisionado && !st.os.mapeados.cmp04) p.push('cmp04 no está mapeado en la celda: el scheduler no le mandará VMs (nova-manage cell_v2 discover_hosts, en un controlador)');
    return p;
  },
  practicas: [
    { t: 'Probaste el acceso con Ansible antes de nada (ansible ... -m ping)', ok: st => { const i = idx(st, /^ansible .*-m ping/), j = idx(st, /alta-compute\.yml/); return i >= 0 && (j < 0 || i < j); } },
    { t: 'Ensayaste con --check antes de aplicar', ok: st => { const p = st.hechos.playbooks.filter(x => x.pb === 'alta-compute.yml'); const i = p.findIndex(x => x.check), j = p.findIndex(x => !x.check); return i >= 0 && (j < 0 || i < j); } },
    { t: 'Comprobaste que aparece en OpenStack después del mapeo', ok: st => despues(st, /hypervisor list|compute service list/, /discover_hosts/) },
  ],
  pistas: [
    'Un alta empieza comprobando que llegas al nodo: cd ~/infra y ansible cmp04 -m ping. Lee el playbook antes de lanzarlo: cat playbooks/alta-compute.yml.',
    'ansible-playbook playbooks/alta-compute.yml -l cmp04 --check te dice qué cambiaría; sin --check, lo aplica. Lee el mensaje de la última tarea.',
    'Falta un paso que el playbook no hace: en un controlador (ssh ctl01), sudo nova-manage cell_v2 discover_hosts --verbose. Comprueba después con openstack hypervisor list.',
  ],
  causa: 'Cambio planificado: ampliación de capacidad.',
  solucion: 'Ping con Ansible, ensayo con --check, alta-compute.yml sobre cmp04, mapeo en la celda con nova-manage y comprobación en hypervisor list.',
  leccion: 'En OpenStack, que un servicio esté "up" no significa que reciba trabajo. nova-compute se registra solo, pero mapearlo en la celda es un paso explícito. Los playbooks de alta siempre tienen un "después de esto" que conviene leer antes de lanzarlos.',
  guion: ['cd infra', 'ansible cmp04 -m ping', 'cat playbooks/alta-compute.yml', 'ansible-playbook playbooks/alta-compute.yml -l cmp04 --check', 'ansible-playbook playbooks/alta-compute.yml -l cmp04', 'ssh ctl01', 'sudo nova-manage cell_v2 discover_hosts --verbose', 'exit', 'source ~/admin-openrc', 'openstack hypervisor list'],
  trampas: [{ cmds: ['cd infra', 'ansible-playbook playbooks/alta-compute.yml -l cmp04'], porque: 'sin discover_hosts no recibe VMs' }],
},
// ============================================================================ 11
{
  id: 'CHG-0224', clave: 'vaciar-hipervisor', tipo: 'cambio', nivel: 3, area: 'OpenStack', funciones: ['openstack'],
  impacto: 'medio', urgencia: 'media', de: 'Plataforma (hardware)',
  asunto: 'Firmware de cmp03: reiniciar sin cortar ninguna VM',
  cuerpo: ['El proveedor pide aplicar una actualización de firmware de la controladora de cmp03, que se instala en el siguiente reinicio. Ventana: ahora.',
    'Criterio de éxito: cmp03 reiniciado, ninguna VM de cliente apagada por el camino y cmp03 de vuelta en el scheduler. Ojo: el pipeline de analítica sigue creando VMs mientras tanto.'],
  inicio: 0, abierto: 0,
  averias: [{ tipo: 'vm-programada', en: 6, nombre: 'ci-runner-17', proyecto: 'analitica', flavor: 'm1.large' }],
  objetivo(st) {
    const h = st.hosts.cmp03, p = [];
    if (!st.hechos.reinicios.some(r => r.host === 'cmp03')) p.push('cmp03 no se ha reiniciado: el firmware no se aplica hasta el reinicio');
    else if (!h.up) p.push('cmp03 aún está arrancando (unos 4 minutos)');
    if (st.os.deshabilitados.cmp03) p.push('cmp03 sigue deshabilitado: el scheduler no le mandará VMs (openstack compute service set --enable)');
    return p;
  },
  practicas: [
    { t: 'Deshabilitaste cmp03 en el scheduler antes de vaciarlo', ok: st => antes(st, /compute service set.*--disable/, /host-evacuate-live|server migrate/) },
    { t: 'Comprobaste que cmp03 estaba vacío antes de reiniciarlo', ok: st => { const m = ultimo(st, /host-evacuate-live|server migrate/), r = idx(st, /reboot|shutdown -r/), c = idx(st, /server list.*--host cmp03|hypervisor show cmp03|virsh list/, m + 1); return m >= 0 && r >= 0 && c >= 0 && c < r; } },
    { t: 'Lo devolviste al servicio y comprobaste que está enabled y up', ok: st => despues(st, /compute service list/, /compute service set.*--enable/) },
  ],
  pistas: [
    'Primero, qué hay dentro: openstack server list --all-projects --host cmp03. Y que no entre nada nuevo mientras trabajas: el procedimiento está en el RUNBOOK (cat ~/RUNBOOK.md).',
    'openstack compute service set --disable --disable-reason "CHG-0224" cmp03 nova-compute lo saca del scheduler, y nova host-evacuate-live cmp03 migra en vivo todas sus VMs. Comprueba que ha quedado vacío antes de reiniciar.',
    'Con cmp03 vacío: ssh cmp03 y sudo reboot. Cuando vuelva (unos 4 minutos), openstack compute service set --enable cmp03 nova-compute, y compruébalo con openstack compute service list.',
  ],
  causa: 'Cambio planificado: actualización de firmware.',
  solucion: 'Hipervisor deshabilitado en el scheduler, vaciado con migración en vivo, reinicio con cero VMs dentro y vuelta al servicio.',
  leccion: 'Un hipervisor con VMs no se reinicia: se vacía. La migración en vivo mueve la VM sin apagarla, y deshabilitar el nodo antes evita que el scheduler te meta una VM nueva mientras lo vacías: el hueco que dejas es justo el sitio más libre de la nube. Y un nodo deshabilitado y olvidado es capacidad perdida: se devuelve al servicio al terminar.',
  guion: ['source ~/admin-openrc', 'openstack server list --all-projects --host cmp03', 'openstack compute service set --disable --disable-reason "CHG-0224 firmware" cmp03 nova-compute', 'nova host-evacuate-live cmp03', 'openstack server list --all-projects --host cmp03', 'ssh cmp03', 'sudo reboot', 'sleep 300', 'openstack compute service set --enable cmp03 nova-compute', 'openstack compute service list'],
  trampas: [
    { cmds: ['source ~/admin-openrc', 'ssh cmp03', 'sudo reboot', 'sleep 300'], porque: 'reiniciar sin vaciar apaga las VMs de los clientes' },
    { cmds: ['source ~/admin-openrc', 'nova host-evacuate-live cmp03', 'sleep 300', 'ssh cmp03', 'sudo reboot', 'sleep 300'], porque: 'sin deshabilitarlo, el pipeline le mete una VM nueva justo antes del reinicio' },
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
