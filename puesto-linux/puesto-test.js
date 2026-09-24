// Comprueba el Puesto de Administración Linux sin navegador.
//
//   node puesto-linux/puesto-test.js
//
// Lo importante no es que la app arranque: es que cada ticket se pueda
// resolver con comandos de verdad, que los arreglos a medias NO lo cierren y
// que el simulador no se contradiga (el mismo guion da siempre lo mismo).
const fs = require('fs'), path = require('path');
const D = __dirname;
const win = {};
['motor.js', 'cmd-ceph.js', 'cmd-openstack.js', 'cmd-auto.js', 'averias.js', 'escenarios.js', 'incidencias.js', 'guardia.js', 'soluciones.js'].forEach(f => new Function('window', fs.readFileSync(path.join(D, f), 'utf8'))(win));
const P = win.PUESTO, U = P.u;

let fallos = 0;
const mal = m => { console.error('  ✕ ' + m); fallos++; };
const bien = m => console.log('  ✓ ' + m);

// Ejecuta una lista de comandos en una sesión, como haría la app.
function correr(st, cmds, ses) {
  ses = ses || P.nuevaSesion();
  const salida = [];
  cmds.forEach(c => {
    const r = P.ejecutar(st, ses, c);
    salida.push({ cmd: c, host: ses.host, lineas: r.lineas });
    P.expulsar(st, ses);
  });
  return { ses, salida };
}
const texto = s => s.salida.map(x => '$ ' + x.cmd + '\n' + x.lineas.map(l => l.t).join('\n')).join('\n');

console.log('Puesto · Administración de sistemas Linux\n');

// ------------------------------------------------------------ plataforma sana
{
  const st = P.crear();
  const al = P.alertasActivas(st), salud = P.saludCeph(st);
  if (al.length) mal('la plataforma sana ya tiene alertas: ' + al.map(a => a.nombre + '@' + a.host).join(', '));
  else if (salud.estado !== 'HEALTH_OK') mal('Ceph sano no está en HEALTH_OK: ' + salud.checks.map(c => c.res).join('; '));
  else bien('la plataforma de partida está sana: HEALTH_OK y cero alertas en ' + Object.keys(st.hosts).length + ' nodos');
  const libre = ['cmp01', 'cmp02', 'cmp03'].map(n => Math.round(P.ramLibreHost(st, n) / 1024) + ' GB');
  bien('RAM libre en los hipervisores: ' + libre.join(' · '));
}

// ------------------------------------------------------------ escenarios
console.log('\n  escenarios (guion de referencia, prácticas y trampas):');
const ids = new Set();
P.escenarios.forEach(e => {
  if (ids.has(e.id)) mal(e.id + ' repetido'); ids.add(e.id);
  ['asunto', 'de', 'causa', 'solucion', 'leccion'].forEach(k => { if (!e[k]) mal(e.id + ': falta ' + k); });
  if (!e.pistas || e.pistas.length !== 3) mal(e.id + ': tiene que tener exactamente 3 pistas');
  if (!P.prioridad(e).p) mal(e.id + ': impacto/urgencia no dan una prioridad (' + e.impacto + ' × ' + e.urgencia + ')');
  // El SLA cuenta desde que se abre el ticket, no desde que empezó la avería.
  // Un ticket que nace con el SLA vencido no enseña nada sobre el SLA.
  if (e.abierto == null || e.abierto < e.inicio) mal(e.id + ': falta la hora de apertura del ticket, o es anterior a la avería');
  else if (-e.abierto >= P.prioridad(e).sla / 2) mal(e.id + ': nace con más de medio SLA consumido');
  (e.funciones || []).forEach(f => { if (!P.funciones.some(x => x.id === f)) mal(e.id + ': función inexistente ' + f); });

  const st = P.preparar(e);
  const antes = e.resuelto(st, P);
  if (!antes.length) { mal(e.id + ' nace resuelto'); return; }
  if (e.tipo === 'incidente' && !P.alertasActivas(st).length) mal(e.id + ': un incidente sin ninguna alerta no se puede descubrir');

  const guion = P.guionDe(e, st);
  const run = correr(st, guion);
  const noExiste = run.salida.filter(x => x.lineas.some(l => /: command not found/.test(l.t)));
  if (noExiste.length) mal(e.id + ': el guion usa comandos que no existen: ' + noExiste.map(x => x.cmd + ' (en ' + x.host + ')').join(', '));
  const ev = P.evaluar(st, e);
  if (ev.pendientes.length) { mal(e.id + ': el guion no lo resuelve: ' + ev.pendientes.join(' | ')); return; }
  const flojas = ev.practicas.filter(p => !p.ok);
  if (flojas.length) mal(e.id + ': el guion no cumple sus propias prácticas: ' + flojas.map(p => p.t).join(' | '));

  // determinismo: el mismo guion, desde cero, da exactamente la misma salida
  const st2 = P.preparar(e), run2 = correr(st2, P.guionDe(e, st2));
  if (texto(run) !== texto(run2)) mal(e.id + ': el mismo guion da salidas distintas');

  // trampas: arreglos a medias que no deben cerrar el ticket
  let trampasOk = 0;
  (e.trampas || []).forEach(t => {
    const s3 = P.preparar(e); correr(s3, t.cmds);
    const ev3 = P.evaluar(s3, e);
    if (t.practicas) {
      const pasan = t.practicas.filter(i => ev3.practicas[i].ok);
      if (pasan.length) mal(e.id + ': la trampa "' + t.porque + '" no hace fallar las prácticas ' + pasan.join(', '));
      else trampasOk++;
    } else if (!ev3.pendientes.length) mal(e.id + ': la trampa "' + t.porque + '" cierra el ticket');
    else trampasOk++;
  });
  const p = P.prioridad(e);
  bien(e.id.padEnd(9) + e.clave.padEnd(18) + p.p + '  ' + guion.length + ' comandos, ' + st.reloj + ' min simulados, ' + ev.practicas.length + ' prácticas, ' + trampasOk + ' trampa' + (trampasOk === 1 ? '' : 's') + ' que no cierran');
});
const cubre = P.funciones.map(f => f.corto + ' ' + P.escenarios.filter(e => e.funciones.indexOf(f.id) >= 0).length);
bien('funciones del puesto cubiertas: ' + cubre.join(' · '));
P.funciones.forEach(f => { if (P.escenarios.filter(e => e.funciones.indexOf(f.id) >= 0).length < 3) mal('la función «' + f.titulo + '» tiene menos de 3 escenarios'); });

// ------------------------------------------------------------ mecánica
console.log('\n  mecánica del simulador:');
{
  // noout: reiniciar un nodo Ceph con y sin él
  const a = P.crear(); correr(a, ['ssh ceph02', 'sudo reboot', 'sleep 1800']);
  const b = P.crear(); correr(b, ['ceph osd set noout', 'ssh ceph02', 'sudo reboot', 'sleep 1800', 'ceph osd unset noout', 'sleep 120']);
  if (!(a.ceph.movimientos > 0)) mal('reiniciar un nodo Ceph sin noout debería mover datos');
  else if (b.ceph.movimientos !== 0) mal('con noout no debería moverse nada (' + b.ceph.movimientos + ' movimientos)');
  else if (P.saludCeph(a).estado !== 'HEALTH_OK' || P.saludCeph(b).estado !== 'HEALTH_OK') mal('tras el reinicio Ceph no vuelve a HEALTH_OK');
  else bien('reinicio de ceph02: sin noout ' + a.ceph.movimientos + ' rebalanceos, con noout 0; los dos terminan en HEALTH_OK');
}
{
  const st = P.crear(), r = correr(st, ['ssh cmp01', 'systemctl restart nova-compute']).salida[1].lineas;
  if (!r.some(l => /Access denied/.test(l.t)) || !r.some(l => l.c === 'dim' && /sudo/.test(l.t))) mal('systemctl restart sin sudo debería denegarse y sugerir sudo');
  else bien('sin sudo, systemctl restart se deniega y la pista dice por qué');
}
{
  const st = P.crear(), r = correr(st, ['openstack server list', 'source ~/admin-openrc', 'openstack server list --all-projects']).salida;
  if (!r[0].lineas.some(l => /auth-url/.test(l.t))) mal('openstack sin credenciales debería fallar como el cliente real');
  else if (!r[2].lineas.some(l => /pos-backend-01/.test(l.t))) mal('con credenciales, server list --all-projects debería listar las VMs');
  else bien('openstack pide source ~/admin-openrc, y con él lista ' + st.os.servidores.length + ' VMs');
}
{
  const st = P.crear(), r = correr(st, ['source ~/admin-openrc', 'terraform plan', 'cd infra/terraform', 'terraform plan']).salida;
  if (!r[1].lineas.some(l => /No configuration files/.test(l.t))) mal('terraform fuera de su carpeta debería quejarse');
  else if (!r[3].lineas.some(l => /No changes/.test(l.t))) mal('terraform plan en la plataforma sana debería decir No changes');
  else bien('terraform exige su carpeta y, en la plataforma sana, no ve cambios');
}
{
  const st = P.crear(), r = correr(st, ['ansible all -m ping', 'cd infra', 'ansible all -m ping']).salida;
  if (!r[0].lineas.some(l => /No inventory/.test(l.t))) mal('ansible fuera de ~/infra no debería encontrar inventario');
  else if (r[2].lineas.filter(l => /SUCCESS/.test(l.t)).length !== 12) mal('ansible all -m ping debería responder en los 12 nodos');
  else bien('ansible necesita ~/infra (ansible.cfg); desde ahí, ping responde en los 12 nodos');
}
{
  // idempotencia: el segundo pase del mismo playbook no cambia nada
  const e = P.escenario('reloj'), st = P.preparar(e);
  const r = correr(st, ['cd infra', 'ansible-playbook playbooks/chrony.yml', 'ansible-playbook playbooks/chrony.yml']).salida;
  const cambios = x => x.lineas.filter(l => /changed=([1-9])/.test(l.t)).length;
  if (!cambios(r[1])) mal('el primer pase de chrony.yml debería cambiar algo');
  else if (cambios(r[2])) mal('el segundo pase de chrony.yml no es idempotente');
  else bien('chrony.yml es idempotente: el primer pase arregla ' + cambios(r[1]) + ' nodos y el segundo da changed=0');
}
{
  // --check no toca nada
  const st = P.crear(); correr(st, ['cd infra', 'ansible-playbook playbooks/alta-compute.yml -l cmp04 --check']);
  if (st.hosts.cmp04.provisionado) mal('--check ha instalado cosas');
  else bien('ansible-playbook --check cuenta lo que haría sin hacerlo');
}
{
  // Terraform no ve lo creado a mano
  const e = P.escenario('terraform-sg'), st = P.preparar(e);
  const r = correr(st, ['source ~/admin-openrc', 'cd infra/terraform', 'terraform plan']).salida[2].lineas.map(l => l.t).join('\n');
  if (!/ssh_admin has been deleted/.test(r)) mal('terraform plan debería detectar que ssh_admin ha desaparecido');
  else if (/0\.0\.0\.0\/0"\s*$/m.test(r.split('will be created')[0].split('has been deleted')[1] || '') || /manual/.test(r)) mal('terraform plan no debería ver la regla creada a mano');
  else bien('terraform plan ve la regla borrada pero no la abierta a mano: la lección del INC-4852');
}
{
  // el reloj de Ceph: sin actuar, el OSD caído acaba marcado out
  const e = P.escenario('osd-caido'), st = P.preparar(e);
  correr(st, ['sleep 600']);
  if (st.ceph.osds[4].in) mal('a los 10 minutos Ceph debería marcar out el OSD caído');
  else bien('si nadie actúa, a los 10 minutos Ceph marca out osd.4 y empieza a mover datos');
}
{
  // RabbitMQ caído: la API falla una de cada tres veces
  const e = P.escenario('disco-lleno'), st = P.preparar(e);
  const r = correr(st, ['source ~/admin-openrc'].concat(Array(6).fill('openstack server list --all-projects'))).salida.slice(1);
  const n500 = r.filter(x => x.lineas.some(l => /HTTP 500/.test(l.t))).length;
  if (n500 !== 2) mal('con RabbitMQ caído en ctl02, 2 de 6 llamadas deberían dar 500 (dan ' + n500 + ')');
  else bien('con RabbitMQ caído, 2 de cada 6 llamadas a la API dan HTTP 500: el síntoma del ticket');
}
{
  // Tab
  const st = P.crear(), ses = P.nuevaSesion();
  const t1 = P.completar(st, ses, 'ceph os'), t2 = P.completar(st, ses, 'ssh cep'), t3 = P.completar(st, ses, 'cat RUN');
  if (t1.texto !== 'ceph osd ') mal('Tab: "ceph os" → "' + t1.texto + '"');
  else if (t2.texto !== 'ssh ceph0') mal('Tab: "ssh cep" → "' + t2.texto + '"');
  else if (t3.texto !== 'cat RUNBOOK.md ') mal('Tab: "cat RUN" → "' + t3.texto + '"');
  else bien('Tab completa comandos, nodos y ficheros');
}
{
  // cada pista habla de comandos que existen
  const nombres = Object.keys(P.comandos);
  const raros = [];
  P.escenarios.forEach(e => e.pistas.forEach(p => { (p.match(/\b(sudo )?([a-z][a-z0-9-]+) (-[a-z]|[a-z@.~\/-]+)/g) || []).forEach(m => { const w = m.replace(/^sudo /, '').split(' ')[0]; if (/^(ceph|openstack|ansible|ansible-playbook|terraform|systemctl|journalctl|smartctl|amtool|nova-manage|rabbitmqctl|chronyc|timedatectl|du|df|uname)$/.test(w) && nombres.indexOf(w) < 0) raros.push(e.id + ': ' + w); }); }));
  if (raros.length) mal('pistas con comandos que no existen: ' + raros.join(', '));
  else bien('las pistas sólo nombran comandos que el simulador conoce');
}

// ------------------------------------------------------------ catálogo de averías
// Las averías son las piezas con las que se generarán incidencias nuevas. Cada
// una, sola, tiene que romper algo y su arreglo tiene que dejarlo todo sano.
console.log('\n  catálogo de averías:');
{
  const tipos = Object.keys(P.averias), rompen = tipos.filter(t => !P.averias[t].condicion);
  let malos = 0;
  tipos.forEach(t => {
    const av = P.averias[t], a = Object.assign({ tipo: t }, av.ejemplo);
    ['titulo', 'ejemplo'].forEach(k => { if (!av[k]) { mal(t + ': falta ' + k); malos++; } });
    const err = P.validarAverias([a]);
    if (err.length) { mal(t + ': su propio ejemplo no pasa la validación: ' + err.join(' | ')); malos++; return; }
    if (av.condicion) return;
    const st = P.crear(); st.inicioFallo = -(a.hace || 0); P.aplicarAverias(st, [a]); P.refrescarAlertas(st);
    if (!P.pendientesAverias(st, [a]).length) { mal(t + ': aplicada no deja nada pendiente'); malos++; return; }
    const r = correr(st, P.arregloAverias(st, [a]));
    const raros = r.salida.filter(x => x.lineas.some(l => /: command not found/.test(l.t)));
    if (raros.length) { mal(t + ': su arreglo usa comandos que no existen: ' + raros.map(x => x.cmd).join(', ')); malos++; }
    const quedan = P.pendientesAverias(st, [a]).concat(P.pendientesSalud(st));
    if (quedan.length) { mal(t + ': su arreglo no la arregla: ' + quedan.join(' | ')); malos++; }
  });
  if (!malos) bien(tipos.length + ' tipos de avería (' + rompen.length + ' que rompen, ' + (tipos.length - rompen.length) + ' condiciones): cada una, sola, se aplica, se detecta y su arreglo deja la plataforma sana');

  // El compositor edita con campos: cada parámetro tiene el suyo, y cada campo es un parámetro.
  const sinCampo = [];
  tipos.forEach(t => {
    const c = P.camposAveria[t], ks = (c || []).map(x => x.k), ps = Object.keys(P.averias[t].params);
    if (!c) { sinCampo.push(t + ' (sin campos)'); return; }
    ps.filter(k => k !== 'nota' && ks.indexOf(k) < 0).forEach(k => sinCampo.push(t + '.' + k));
    ks.filter(k => ps.indexOf(k) < 0).forEach(k => sinCampo.push(t + '.' + k + ' (campo sin parámetro)'));
  });
  if (sinCampo.length) mal('parámetros que el compositor no puede editar: ' + sinCampo.join(', '));
  else bien('el compositor tiene un campo para cada parámetro de los ' + tipos.length + ' tipos (salvo la nota de contexto, que se conserva)');

  // Componer: la solución de una incidencia es la suma de las de sus averías.
  const compuestos = P.escenarios.filter(e => !e.objetivo && e.averias.some(a => !P.averias[a.tipo].condicion));
  const fallan = compuestos.filter(e => {
    const st = P.preparar(e); correr(st, P.arregloAverias(st, e.averias));
    const q = e.resuelto(st, P);
    if (q.length) mal(e.id + ': encadenar los arreglos de sus averías no lo resuelve: ' + q.join(' | '));
    return q.length;
  });
  if (!fallan.length) bien('en los ' + compuestos.length + ' tickets hechos de averías, encadenar sus arreglos los resuelve sin guion escrito a mano');
  const usados = new Set([].concat(...P.escenarios.map(e => e.averias.map(a => a.tipo))));
  const sinUso = tipos.filter(t => !usados.has(t));
  if (sinUso.length) mal('tipos del catálogo que ningún ticket usa: ' + sinUso.join(', '));
  else bien('los 20 tickets usan los ' + tipos.length + ' tipos del catálogo; ninguno tiene código propio para romper');

  // Una combinación que nadie ha escrito: tiene que validar, avisar, propagarse
  // sola y resolverse encadenando arreglos.
  {
    const combo = [
      { tipo: 'servicio-parado', nodo: 'cmp03', servicio: 'libvirtd', hace: 120, deshabilitado: true },
      { tipo: 'reloj-desfasado', nodo: 'ceph01', segundos: 0.4, hace: 200 },
      { tipo: 'disco-lleno', nodo: 'ctl01', fichero: '/var/log/nova/nova-api.log', mb: 31000 },
      { tipo: 'flag-ceph', flag: 'norebalance', hace: 300 },
      { tipo: 'servicio-caido', nodo: 'cmp01', servicio: 'openvswitch-switch', motivo: 'ovs-lock', hace: 30 },
    ];
    const err = P.validarAverias(combo);
    const st = P.crear(); P.aplicarAverias(st, combo); P.refrescarAlertas(st);
    const alertas = P.alertasActivas(st).length;
    const cadena = st.hosts.cmp03.svcs['nova-compute'].estado === 'failed' && st.hosts.cmp01.svcs['neutron-openvswitch-agent'].estado === 'failed';
    const solo = P.pendientesAverias(st, combo);
    correr(st, P.arregloAverias(st, combo));
    const q = P.pendientesAverias(st, combo).concat(P.pendientesSalud(st), P.pendientesUnidades(st));
    if (err.length) mal('una combinación inventada no valida: ' + err.join(' | '));
    else if (!cadena) mal('parar libvirtd o tumbar Open vSwitch no arrastra a nova-compute ni al agente');
    else if (q.length) mal('una combinación inventada no se resuelve encadenando arreglos: ' + q.join(' | '));
    else bien('una combinación que nadie ha escrito (5 averías, ' + alertas + ' alertas, ' + solo.length + ' pendientes) arrastra sola a nova-compute y al agente de red, y encadenando arreglos queda sana');
  }

  // El validador rechaza lo que no tiene sentido.
  const casos = [
    [[], 'una incidencia vacía'],
    [[{ tipo: 'meteorito' }], 'un tipo que no existe'],
    [[{ tipo: 'servicio-caido', nodo: 'cmp09', servicio: 'libvirtd' }], 'un nodo que no existe'],
    [[{ tipo: 'servicio-caido', nodo: 'ceph01', servicio: 'libvirtd' }], 'un servicio que ese nodo no tiene'],
    [[{ tipo: 'servicio-parado', nodo: 'cmp02', servicio: 'libvirtd' }, { tipo: 'servicio-caido', nodo: 'cmp02', servicio: 'libvirtd', motivo: 'oom' }], 'dos averías sobre la misma unidad'],
    [[{ tipo: 'vm-borrada', vm: 'web-tienda-01' }], 'restaurar una VM que no tiene copia'],
    [[{ tipo: 'servicio-caido', nodo: 'cmp02' }], 'un servicio sin elegir'],
  ];
  const cuelan = casos.filter(c => !P.validarAverias(c[0]).length).map(c => c[1]);
  const sinServicio = P.validarAverias([{ tipo: 'servicio-caido', nodo: 'cmp02' }]).join(' ');
  if (!/falta servicio/.test(sinServicio)) mal('un parámetro obligatorio que falta tiene que decirse así, no «' + sinServicio + '»');
  if (cuelan.length) mal('el validador deja pasar: ' + cuelan.join(', '));
  else bien('el validador rechaza ' + casos.map(c => c[1]).join(', '));
}

// ------------------------------------------------------------ incidencias en fichero
// Lo que entra de fuera no se acepta a ciegas: estructura, catálogo y ensayo.
console.log('\n  incidencias en fichero:');
{
  const dir = path.join(D, 'incidencias');
  const ejemplos = fs.readdirSync(dir).filter(f => /\.json$/.test(f));
  const malosEj = ejemplos.filter(f => { const r = P.cargarIncidencia(fs.readFileSync(path.join(dir, f), 'utf8')); if (!r.ok) mal('incidencias/' + f + ' no se acepta: ' + r.errores.join(' | ')); return !r.ok; });
  if (!malosEj.length) bien('los ' + ejemplos.length + ' ejemplos de incidencias/ se aceptan y su solución de referencia los resuelve');

  // Un ticket del puesto exportado como fichero y vuelto a cargar sigue siendo resoluble.
  const exp = P.exportables();
  const idaVuelta = exp.filter(e => { const r = P.cargarIncidencia(JSON.stringify(P.exportarIncidencia(e))); if (!r.ok) mal(e.id + ' exportado no se vuelve a aceptar: ' + r.errores.join(' | ')); return r.ok; });
  if (idaVuelta.length === exp.length) bien('los ' + exp.length + ' tickets hechos de averías se exportan como fichero y se vuelven a aceptar');

  // Un fichero importado se juega como un ticket más: sus prácticas y su pista 3 salen de sus averías.
  {
    const r = P.cargarIncidencia(fs.readFileSync(path.join(dir, 'guardia-de-noche.json'), 'utf8')), e = r.escenario;
    const st = P.preparar(e); correr(st, P.guionDe(e, st));
    const ev = P.evaluar(st, e);
    if (ev.pendientes.length || ev.practicas.some(x => !x.ok)) mal('una incidencia importada no se resuelve con su guion o no cumple sus prácticas: ' + ev.pendientes.concat(ev.practicas.filter(x => !x.ok).map(x => x.t)).join(' | '));
    else if (e.pistas.length !== 3 || !/Una solución/.test(e.pistas[2])) mal('una incidencia sin pistas debería generarlas');
    else bien('una incidencia importada se juega como un ticket: pistas y prácticas generadas, y su guion la cierra');
  }

  // Lo que se rechaza, y por qué.
  const base = () => JSON.parse(fs.readFileSync(path.join(dir, 'guardia-de-noche.json'), 'utf8'));
  const con = f => { const d = base(); f(d); return JSON.stringify(d); };
  const casos = [
    ['{ esto no es json', /JSON válido/, 'un JSON roto'],
    [con(d => { d.formato = 'otro/2'; }), /formato/, 'otro formato'],
    [con(d => { delete d.asunto; }), /asunto: falta/, 'sin asunto'],
    [con(d => { d.impacto = 'enorme'; }), /impacto/, 'un impacto que no existe'],
    [con(d => { d.id = 'INC-4821'; }), /ya es un ticket/, 'un id que ya usa el puesto'],
    [con(d => { d.asunto = 'x'.repeat(5000); }), /demasiado largo/, 'un texto enorme'],
    [con(d => { d.averias.push({ tipo: 'meteorito' }); }), /tipo desconocido/, 'una avería que no está en el catálogo'],
    [con(d => { d.averias = [{ tipo: 'uso-volumenes', proyecto: 'tienda-online', gb: 900 }]; }), /No rompe nada/, 'una incidencia que no rompe nada'],
    [con(d => { d.averias = [{ tipo: 'vm-borrada', vm: 'catalogo-db-01' }, { tipo: 'hipervisores-llenos', nodos: ['cmp01', 'cmp02', 'cmp03'], proyecto: 'analitica' }]; }), /no la resuelve/, 'una VM de 32 GB a restaurar en una nube sin sitio'],
    [con(d => { d.abiertoHace = 50; d.hace = 60; }), /SLA/, 'un P1 que nace con el SLA casi gastado'],
  ];
  const cuelan = casos.filter(([t, re]) => { const r = P.cargarIncidencia(t); return r.ok || !r.errores.some(x => re.test(x)); });
  cuelan.forEach(c => mal('se acepta (o se rechaza por otro motivo) ' + c[2] + ': ' + (P.cargarIncidencia(c[0]).errores || []).join(' | ')));
  if (!cuelan.length) bien('se rechazan, cada una con su motivo: ' + casos.map(c => c[2]).join(', '));
  const sinAlerta = P.cargarIncidencia(con(d => { d.averias = [{ tipo: 'vm-borrada', vm: 'redis-carrito-02' }]; }));
  if (!sinAlerta.ok || !sinAlerta.avisos.some(x => /ninguna alerta/.test(x))) mal('una incidencia sin alertas debería aceptarse con un aviso');
  else bien('una incidencia sin alertas se acepta, pero avisa de que en guardia nadie la encontraría');
}

// ------------------------------------------------------------ guardias generadas y caos
console.log('\n  guardias generadas y caos:');
{
  const familias = new Set(P.familias.map(f => f.id));
  if (familias.size !== P.familias.length) mal('hay familias con el mismo id');
  P.familias.forEach(f => { const a = f.crear(P.azar(7)); const e = P.validarAverias(a); if (e.length) mal('la familia ' + f.id + ' no valida: ' + e.join(' | ')); });
  const SEMILLAS = 30;
  [1, 2, 3].forEach(nivel => {
    const combos = new Set(); let malas = 0, intentos = 0;
    for (let s = 1; s <= SEMILLAS; s++) {
      const g = P.generarGuardia(nivel, s * 7 + 1);
      if (!g.ok) { mal('nivel ' + nivel + ', semilla ' + (s * 7 + 1) + ': no sale ninguna guardia jugable'); malas++; continue; }
      intentos += g.intentos;
      const e = g.escenario;
      combos.add(e.guardia.familias.slice().sort().join('+'));
      if (e.guardia.familias.length !== nivel) { mal('nivel ' + nivel + ' con ' + e.guardia.familias.length + ' familias'); malas++; }
      if (!P.familias.some(f => f.nivel === nivel && e.guardia.familias.indexOf(f.id) >= 0)) { mal('una guardia de nivel ' + nivel + ' sin ninguna familia de su nivel'); malas++; }
      if (JSON.stringify(P.generarGuardia(nivel, s * 7 + 1).def) !== JSON.stringify(g.def)) { mal('la misma semilla da guardias distintas'); malas++; }
      // se juega como cualquier ticket: su guion la cierra y cumple sus prácticas
      const st = P.preparar(e);
      if (!P.alertasActivas(st).length) { mal('una guardia sin alertas (semilla ' + (s * 7 + 1) + ')'); malas++; }
      correr(st, P.guionDe(e, st));
      const ev = P.evaluar(st, e);
      if (ev.pendientes.length || ev.practicas.some(x => !x.ok)) { mal('guardia ' + nivel + '/' + (s * 7 + 1) + ' no se cierra con su guion: ' + ev.pendientes.concat(ev.practicas.filter(x => !x.ok).map(x => x.t)).join(' | ')); malas++; }
    }
    if (!malas) bien('nivel ' + nivel + ' (' + P.nivelesGuardia[nivel].toLowerCase() + '): ' + SEMILLAS + ' semillas, todas jugables y resueltas por su guion; ' + combos.size + ' combinaciones distintas, ' + (intentos / SEMILLAS).toFixed(2) + ' intentos de media');
  });

  // Caos: rompe cuando dice, no antes, y se arregla encadenando arreglos.
  const st = P.crear(), prov = [];
  for (let i = 1; i <= 3; i++) { const c = P.provocarCaos(st, 500 + i, [].concat(...prov.map(x => x.averias))); if (c) prov.push(c); }
  const antes = P.alertasActivas(st).length;
  P.avanzar(st, 5);
  const despues = P.alertasActivas(st).length, pend = P.pendientesCaos(st, prov).length;
  correr(st, P.arregloAverias(st, [].concat(...prov.map(c => c.averias))));
  const quedan = P.pendientesCaos(st, prov);
  if (prov.length !== 3) mal('el caos no consigue provocar tres averías compatibles');
  else if (antes !== 0) mal('el caos rompe antes de tiempo');
  else if (!despues || !pend) mal('el caos no rompe nada cuando toca');
  else if (quedan.length) mal('lo que provoca el caos no se arregla encadenando arreglos: ' + quedan.join(' | '));
  else bien('el caos programa 3 averías (' + prov.map(c => c.familia.id).join(', ') + '): nada antes de su minuto, ' + despues + ' alertas después, y encadenando arreglos queda sano');
}

// ------------------------------------------------------------ solucionario
// Los pasos del solucionario van en el mismo orden que el guion: si alguien
// cambia un guion y no el solucionario, esto falla.
console.log('\n  solucionario:');
{
  let malos = 0;
  const ids = new Set(P.glosario.map(g => g.id));
  if (ids.size !== P.glosario.length) { mal('el glosario tiene ids repetidos'); malos++; }
  P.escenarios.forEach(e => {
    const s = P.soluciones[e.id];
    if (!s) { mal(e.id + ': no está en el solucionario'); malos++; return; }
    const guion = P.guionDe(e, P.preparar(e));
    if (s.pasos.length !== guion.length) { mal(e.id + ': el solucionario tiene ' + s.pasos.length + ' pasos y el guion ' + guion.length); malos++; return; }
    s.pasos.forEach((p, i) => {
      const marca = p[0].search(/<[A-Z]+>/);   // <ID>, <IP>: se copia de una salida anterior
      const igual = marca >= 0 ? guion[i].indexOf(p[0].slice(0, marca)) === 0 : p[0] === guion[i];
      if (!igual) { mal(e.id + ' paso ' + (i + 1) + ': el solucionario dice «' + p[0] + '» y el guion «' + guion[i] + '»'); malos++; }
      if (['diag', 'arreglo', 'comprobar', ''].indexOf(p[1]) < 0 || !p[2]) { mal(e.id + ' paso ' + (i + 1) + ': sin fase válida o sin explicación'); malos++; }
    });
    if (!s.pasos.some(p => p[1] === 'comprobar')) { mal(e.id + ': el solucionario no termina comprobando nada'); malos++; }
    (s.terminos || []).forEach(t => { if (!ids.has(t)) { mal(e.id + ': término de glosario inexistente «' + t + '»'); malos++; } });
  });
  if (!malos) bien(P.escenarios.length + ' tickets con sus pasos alineados con el guion, cada uno con fase y explicación; ' + P.glosario.length + ' términos de glosario');
}

// ------------------------------------------------------------ compositor
// La página del profesor, con un DOM de mentira: pinta cada tipo de avería con
// un control por campo, y lo que carga de un ticket o de una guardia sale igual
// de jugable al guardarlo.
console.log('\n  compositor:');
{
  const els = {}, almacen = {};
  const el = () => ({ innerHTML: '', textContent: '', classList: { add() {}, toggle() {} }, querySelector: () => null });
  const documento = { querySelector: s => els[s] || (els[s] = el()), querySelectorAll: () => [], addEventListener() {}, body: el() };
  const ls = { getItem: k => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: k => { delete almacen[k]; } };
  new Function('window', 'document', 'localStorage', 'location', fs.readFileSync(path.join(D, 'compositor.js'), 'utf8'))(win, documento, ls, {});
  const C = P.compositor, html = () => els['#vista'].innerHTML;
  let malos = 0;
  // Cada tipo, solo: un control por cada campo del esquema.
  Object.keys(P.averias).forEach(t => {
    C.cargar({ asunto: 'x', cuerpo: ['y'], averias: [Object.assign({ tipo: t }, JSON.parse(JSON.stringify(P.averias[t].ejemplo)))] }, t);
    const falta = (P.camposAveria[t] || []).filter(c => html().indexOf('data-k="' + c.k + '"') < 0).map(c => c.k);
    if (falta.length) { mal('el compositor no pinta ' + t + '.' + falta.join(', ')); malos++; }
    if (!P.averias[t].condicion && !C.est.res.ok) { mal('el ejemplo de ' + t + ' no sale jugable en el compositor: ' + C.est.res.errores.join(' | ')); malos++; }
  });
  // Partir de un ticket del puesto, guardarlo en la cola y que siga siendo jugable.
  P.exportables().forEach(e => {
    C.cargar(P.exportarIncidencia(e), e.id);
    const id = C.guardarEnCola();
    const g = JSON.parse(almacen['puesto-linux-importadas'] || '[]').find(x => x.id === id);
    if (!C.est.res.ok || !C.est.vista || !g || !P.cargarIncidencia(g).ok) { mal('partir de ' + e.id + ' y guardarlo no da una incidencia jugable: ' + (C.est.res.errores || []).join(' | ')); malos++; }
  });
  const gd = JSON.parse(JSON.stringify(P.generarGuardia(3, 4242).def)); delete gd.id;
  C.cargar(gd, 'guardia');
  if (!C.est.res.ok) { mal('una guardia de nivel 3 no sale jugable en el compositor'); malos++; }
  // Un error de avería llega al resumen aunque el ticket aún no tenga cuerpo.
  C.cargar({ asunto: 'x', cuerpo: [''], averias: [{ tipo: 'servicio-caido', nodo: 'cmp02' }] }, 'a medias');
  if (!C.est.res.errores.some(x => /falta servicio/.test(x))) { mal('con el ticket a medias, el ensayo no avisa del servicio sin elegir'); malos++; }
  if (!malos) bien('pinta los ' + Object.keys(P.averias).length + ' tipos con un control por campo; ' + P.exportables().length + ' tickets y una guardia de nivel 3 cargan, se guardan en la cola y siguen siendo jugables');
}

console.log('\n' + (fallos ? fallos + ' fallo' + (fallos === 1 ? '' : 's') : 'Todo en orden'));
process.exit(fallos ? 1 : 0);
