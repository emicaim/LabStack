// Puesto · automatización: Ansible, Terraform, Alertmanager y el bastión.
//
// Los playbooks son idempotentes de verdad: cada tarea mira el estado antes de
// tocarlo y dice ok / changed según lo que encuentra. Pasarlo dos veces seguidas
// da changed=0 la segunda, y --check cuenta lo que haría sin hacerlo.
//
// Terraform sólo ve lo que tiene en su estado. Una regla creada a mano no
// existe para él: esa es la lección del escenario de seguridad.
(function (P) {
'use strict';
const U = P.u, L = U.L, T = P.T, H = U.HOME, INFRA = H + '/infra', TFDIR = INFRA + '/terraform';

// ------------------------------------------------------------------ inventario
const GRUPOS = { bastion: ['bastion'], controllers: ['ctl01', 'ctl02', 'ctl03'], compute: ['cmp01', 'cmp02', 'cmp03'], compute_nuevos: ['cmp04'], ceph: ['ceph01', 'ceph02', 'ceph03'], monitoring: ['mon01'] };
GRUPOS.openstack = GRUPOS.controllers.concat(GRUPOS.compute);
const TODOS = ['bastion', 'ctl01', 'ctl02', 'ctl03', 'cmp01', 'cmp02', 'cmp03', 'cmp04', 'ceph01', 'ceph02', 'ceph03', 'mon01'];
GRUPOS.all = TODOS;
function resolver(patron, avisos) {
  let sel = [];
  String(patron || '').split(/[,:]/).filter(Boolean).forEach(p => {
    const neg = p[0] === '!', q = neg ? p.slice(1) : p;
    let hs = GRUPOS[q] || (TODOS.indexOf(q) >= 0 ? [q] : null);
    if (!hs && q.indexOf('*') >= 0) { const re = new RegExp('^' + q.replace(/\*/g, '.*') + '$'); hs = TODOS.filter(n => re.test(n)); }
    if (!hs || !hs.length) { if (avisos) avisos.push(L('[WARNING]: Could not match supplied host pattern, ignoring: ' + q, 'ambar')); return; }
    sel = neg ? sel.filter(n => hs.indexOf(n) < 0) : sel.concat(hs.filter(n => sel.indexOf(n) < 0));
  });
  return TODOS.filter(n => sel.indexOf(n) >= 0);
}
const INVENTARIO = [T('# Inventario de la plataforma retail. Los grupos mandan: los playbooks', '# Retail platform inventory. Groups rule: playbooks target'), T('# apuntan a grupos, nunca a máquinas sueltas.', '# groups, never individual machines.'),'', '[bastion]', 'bastion', '', '[controllers]', 'ctl01', 'ctl02', 'ctl03', '', '[compute]', 'cmp01', 'cmp02', 'cmp03', '', T('# Hipervisores recién montados, pendientes de alta (alta-compute.yml)', '# Freshly racked hypervisors, waiting to be onboarded (alta-compute.yml)'), '[compute_nuevos]', 'cmp04', '', '[ceph]', 'ceph01', 'ceph02', 'ceph03', '', '[monitoring]', 'mon01', '', '[openstack:children]', 'controllers', 'compute'];

// ------------------------------------------------------------------ tareas
const asegurar = u => (st, h, c) => {
  const s = h.svcs[u];
  if (!s) return c.check ? 'changed' : { fallo: 'Could not find the requested service ' + u + ': host' };
  if (s.estado === 'active' && s.enabled) return 'ok';
  if (c.check) return 'changed';
  s.enabled = true; s.limite = false;
  if (s.estado !== 'active' && P.arrancar(st, h, u)) return { fallo: 'Unable to start service ' + u + ': Job for ' + u + '.service failed because the control process exited with error code.\nSee "systemctl status ' + u + '.service" and "journalctl -xeu ' + u + '.service" for details.' };
  return 'changed';
};
const nada = () => 'ok';
const PB = {};
// Los handlers se buscan por nombre: el mismo texto en notify, en la tabla y en el YAML.
const REINICIAR_CHRONY = T('reiniciar chrony', 'restart chrony'), REINICIAR_RABBIT = T('reiniciar rabbitmq', 'restart rabbitmq'), RECARGAR_HAPROXY = T('recargar haproxy', 'reload haproxy');
PB['chrony.yml'] = { plays: [{ nombre: T('Sincronización horaria (chrony)', 'Time synchronization (chrony)'), hosts: 'all', tareas: [
  { n: T('chrony instalado', 'chrony installed'), f: nada },
  { n: T('configuración de chrony (servidores NTP internos)', 'chrony configuration (internal NTP servers)'), f: nada },
  { n: T('chrony arrancado y habilitado', 'chrony started and enabled'), f: asegurar('chrony') },
  { n: T('forzar sincronización si el desfase supera 50 ms', 'force a sync if the offset exceeds 50 ms'), f: (st, h, c) => { if (Math.abs(h.ntp.offset) < 0.05) return 'skipped'; if (c.check) return 'skipped'; h.ntp.offset = 0.000011; return 'changed'; } },
] }], yaml: T(['---', '# Hora sincronizada en toda la flota. Ceph protesta en cuanto un monitor se', '# desvía más de 50 ms, y los tokens de Keystone caducan mal con relojes locos.', '- name: Sincronización horaria (chrony)', '  hosts: all', '  become: true', '  tasks:', '    - name: chrony instalado', '      ansible.builtin.apt:', '        name: chrony', '        state: present', '', '    - name: configuración de chrony (servidores NTP internos)', '      ansible.builtin.template:', '        src: templates/chrony.conf.j2', '        dest: /etc/chrony/chrony.conf', '      notify: reiniciar chrony', '', '    - name: chrony arrancado y habilitado', '      ansible.builtin.service:', '        name: chrony', '        state: started', '        enabled: true', '', '    - name: forzar sincronización si el desfase supera 50 ms', '      ansible.builtin.command: chronyc makestep', '      when: clock_offset | float | abs > 0.05', '', '  handlers:', '    - name: reiniciar chrony', '      ansible.builtin.service:', '        name: chrony', '        state: restarted'],
  ['---', '# Synchronized time across the whole fleet. Ceph complains as soon as a monitor', '# drifts more than 50 ms, and Keystone tokens expire wrongly with bad clocks.', '- name: Time synchronization (chrony)', '  hosts: all', '  become: true', '  tasks:', '    - name: chrony installed', '      ansible.builtin.apt:', '        name: chrony', '        state: present', '', '    - name: chrony configuration (internal NTP servers)', '      ansible.builtin.template:', '        src: templates/chrony.conf.j2', '        dest: /etc/chrony/chrony.conf', '      notify: ' + REINICIAR_CHRONY, '', '    - name: chrony started and enabled', '      ansible.builtin.service:', '        name: chrony', '        state: started', '        enabled: true', '', '    - name: force a sync if the offset exceeds 50 ms', '      ansible.builtin.command: chronyc makestep', '      when: clock_offset | float | abs > 0.05', '', '  handlers:', '    - name: ' + REINICIAR_CHRONY, '      ansible.builtin.service:', '        name: chrony', '        state: restarted']) };

PB['logrotate.yml'] = { plays: [{ nombre: T('Logs de OpenStack y RabbitMQ bajo control', 'OpenStack and RabbitMQ logs under control'), hosts: 'controllers', tareas: [
  { n: T('nivel de log de RabbitMQ en info', 'RabbitMQ log level set to info'), notify: REINICIAR_RABBIT, f: (st, h, c) => { if (!h.extra.rabbitDebug) return 'ok'; if (!c.check) h.extra.rabbitDebug = false; return 'changed'; } },
  { n: T('política de rotación de OpenStack y RabbitMQ', 'rotation policy for OpenStack and RabbitMQ'), f: nada },
  { n: T('rotar y comprimir los logs que pasan de 1 GB', 'rotate and compress logs larger than 1 GB'), f: (st, h, c) => {
    const grandes = Object.keys(h.logs).filter(p => /\.log$/.test(p) && h.logs[p] > 1024);
    if (!grandes.length) return 'skipped';
    if (c.check) return 'skipped';
    grandes.forEach(p => { const mb = h.logs[p]; h.logs[p] = 0; h.logs[p + '-20260923.gz'] = Math.round(mb / 12); });
    st.hechos['limpieza:' + h.nombre] = true;
    return 'changed';
  } },
], handlers: { [REINICIAR_RABBIT]: (st, h, c) => { if (c.check) return 'changed'; const r = P.reiniciarUnidad(st, h, 'rabbitmq-server'); return r ? { fallo: 'Unable to restart service rabbitmq-server: Job for rabbitmq-server.service failed because the control process exited with error code.' } : 'changed'; } } }],
yaml: T(['---', '# Logs de los controladores: nivel razonable y rotación diaria.', '# Un log en debug olvidado llena /var en horas.', '- name: Logs de OpenStack y RabbitMQ bajo control', '  hosts: controllers', '  become: true', '  tasks:', '    - name: nivel de log de RabbitMQ en info', '      ansible.builtin.lineinfile:', '        path: /etc/rabbitmq/rabbitmq.conf', "        regexp: '^log.file.level'", "        line: 'log.file.level = info'", '      notify: reiniciar rabbitmq', '', '    - name: política de rotación de OpenStack y RabbitMQ', '      ansible.builtin.template:', '        src: templates/logrotate-openstack.j2', '        dest: /etc/logrotate.d/openstack', '', '    - name: rotar y comprimir los logs que pasan de 1 GB', '      ansible.builtin.command: logrotate -f /etc/logrotate.d/openstack', '      when: logs_grandes | length > 0', '', '  handlers:', '    - name: reiniciar rabbitmq', '      ansible.builtin.service:', '        name: rabbitmq-server', '        state: restarted'],
  ['---', '# Controller logs: sane log level and daily rotation.', '# A debug log someone forgot about fills /var in hours.', '- name: OpenStack and RabbitMQ logs under control', '  hosts: controllers', '  become: true', '  tasks:', '    - name: RabbitMQ log level set to info', '      ansible.builtin.lineinfile:', '        path: /etc/rabbitmq/rabbitmq.conf', "        regexp: '^log.file.level'", "        line: 'log.file.level = info'", '      notify: ' + REINICIAR_RABBIT, '', '    - name: rotation policy for OpenStack and RabbitMQ', '      ansible.builtin.template:', '        src: templates/logrotate-openstack.j2', '        dest: /etc/logrotate.d/openstack', '', '    - name: rotate and compress logs larger than 1 GB', '      ansible.builtin.command: logrotate -f /etc/logrotate.d/openstack', '      when: logs_grandes | length > 0', '', '  handlers:', '    - name: ' + REINICIAR_RABBIT, '      ansible.builtin.service:', '        name: rabbitmq-server', '        state: restarted']) };

PB['nova-compute.yml'] = { plays: [{ nombre: T('Hipervisores (nova-compute + libvirt)', 'Hypervisors (nova-compute + libvirt)'), hosts: 'compute', tareas: [
  { n: T('paquetes de nova-compute, libvirt y Open vSwitch', 'nova-compute, libvirt and Open vSwitch packages'), f: nada },
  { n: T('nova.conf desde plantilla', 'nova.conf from template'), f: nada },
  { n: T('libvirtd arrancado y habilitado', 'libvirtd started and enabled'), f: asegurar('libvirtd') },
  { n: T('nova-compute arrancado y habilitado', 'nova-compute started and enabled'), f: asegurar('nova-compute') },
  { n: T('Open vSwitch arrancado y habilitado', 'Open vSwitch started and enabled'), f: asegurar('openvswitch-switch') },
  { n: T('agente de Open vSwitch arrancado y habilitado', 'Open vSwitch agent started and enabled'), f: asegurar('neutron-openvswitch-agent') },
] }], yaml: T(['---', '# Estado deseado de los hipervisores. Idempotente: si todo está bien, no cambia nada.', '- name: Hipervisores (nova-compute + libvirt)', '  hosts: compute', '  become: true', '  tasks:', '    - name: paquetes de nova-compute, libvirt y Open vSwitch', '      ansible.builtin.apt:', '        name: [nova-compute, libvirt-daemon-system, neutron-openvswitch-agent]', '        state: present', '', '    - name: nova.conf desde plantilla', '      ansible.builtin.template:', '        src: templates/nova-compute.conf.j2', '        dest: /etc/nova/nova.conf', '', '    - name: libvirtd arrancado y habilitado', '      ansible.builtin.service: {name: libvirtd, state: started, enabled: true}', '', '    - name: nova-compute arrancado y habilitado', '      ansible.builtin.service: {name: nova-compute, state: started, enabled: true}', '', '    - name: Open vSwitch arrancado y habilitado', '      ansible.builtin.service: {name: openvswitch-switch, state: started, enabled: true}', '', '    - name: agente de Open vSwitch arrancado y habilitado', '      ansible.builtin.service: {name: neutron-openvswitch-agent, state: started, enabled: true}'],
  ['---', '# Desired state of the hypervisors. Idempotent: if everything is fine, nothing changes.', '- name: Hypervisors (nova-compute + libvirt)', '  hosts: compute', '  become: true', '  tasks:', '    - name: nova-compute, libvirt and Open vSwitch packages', '      ansible.builtin.apt:', '        name: [nova-compute, libvirt-daemon-system, neutron-openvswitch-agent]', '        state: present', '', '    - name: nova.conf from template', '      ansible.builtin.template:', '        src: templates/nova-compute.conf.j2', '        dest: /etc/nova/nova.conf', '', '    - name: libvirtd started and enabled', '      ansible.builtin.service: {name: libvirtd, state: started, enabled: true}', '', '    - name: nova-compute started and enabled', '      ansible.builtin.service: {name: nova-compute, state: started, enabled: true}', '', '    - name: Open vSwitch started and enabled', '      ansible.builtin.service: {name: openvswitch-switch, state: started, enabled: true}', '', '    - name: Open vSwitch agent started and enabled', '      ansible.builtin.service: {name: neutron-openvswitch-agent, state: started, enabled: true}']) };

PB['alta-compute.yml'] = { plays: [{ nombre: T('Alta de hipervisores nuevos', 'Onboard new hypervisors'), hosts: 'compute_nuevos', tareas: [
  { n: T('repositorio Ubuntu Cloud Archive (OpenStack 2024.1 Caracal)', 'Ubuntu Cloud Archive repository (OpenStack 2024.1 Caracal)'), f: (st, h) => h.provisionado ? 'ok' : 'changed' },
  { n: T('paquetes de nova-compute, libvirt y Open vSwitch', 'nova-compute, libvirt and Open vSwitch packages'), f: (st, h, c) => { if (h.provisionado) return 'ok'; if (!c.check) P.provisionar(st, h); return 'changed'; } },
  { n: T('nova.conf y neutron desde plantilla', 'nova.conf and neutron from template'), f: (st, h, c) => { if (h.extra.configurado) return 'ok'; if (!c.check) h.extra.configurado = true; return 'changed'; } },
  { n: T('servicios arrancados y habilitados', 'services started and enabled'), f: (st, h, c) => {
    if (c.check) return h.provisionado && ['libvirtd', 'nova-compute', 'openvswitch-switch', 'neutron-openvswitch-agent'].every(u => h.svcs[u] && h.svcs[u].estado === 'active') ? 'ok' : 'changed';
    let cambio = false;
    for (const u of ['libvirtd', 'nova-compute', 'openvswitch-switch', 'neutron-openvswitch-agent']) { const r = asegurar(u)(st, h, c); if (r && r.fallo) return r; if (r === 'changed') cambio = true; }
    return cambio ? 'changed' : 'ok';
  } },
  { n: T('siguiente paso', 'next step'), f: (st, h) => ({ debug: h.nombre + T(' listo. No recibirá VMs hasta mapearlo en la celda: nova-manage cell_v2 discover_hosts (en un controlador)', ' is ready. It will not get any VMs until it is mapped into the cell: nova-manage cell_v2 discover_hosts (on a controller)') }) },
] }], yaml: T(['---', '# Alta de un hipervisor nuevo.', '#', '# Lo que este playbook NO hace: mapear el nodo en la celda de nova.', '# Hasta que alguien ejecute en un controlador', '#     nova-manage cell_v2 discover_hosts', '# el scheduler no le mandará ni una VM, aunque nova-compute esté "up".', '- name: Alta de hipervisores nuevos', '  hosts: compute_nuevos', '  become: true', '  tasks:', '    - name: repositorio Ubuntu Cloud Archive (OpenStack 2024.1 Caracal)', '      ansible.builtin.apt_repository:', '        repo: "cloud-archive:caracal"', '', '    - name: paquetes de nova-compute, libvirt y Open vSwitch', '      ansible.builtin.apt:', '        name: [nova-compute, libvirt-daemon-system, neutron-openvswitch-agent]', '        state: present', '', '    - name: nova.conf y neutron desde plantilla', '      ansible.builtin.template:', '        src: templates/nova-compute.conf.j2', '        dest: /etc/nova/nova.conf', '', '    - name: servicios arrancados y habilitados', '      ansible.builtin.service:', '        name: "{{ item }}"', '        state: started', '        enabled: true', '      loop: [libvirtd, nova-compute, openvswitch-switch, neutron-openvswitch-agent]', '', '    - name: siguiente paso', '      ansible.builtin.debug:', '        msg: "{{ inventory_hostname }} listo. No recibirá VMs hasta mapearlo en la celda: nova-manage cell_v2 discover_hosts (en un controlador)"'],
  ['---', '# Onboarding of a new hypervisor.', '#', '# What this playbook does NOT do: map the node into the nova cell.', '# Until someone runs, on a controller,', '#     nova-manage cell_v2 discover_hosts', '# the scheduler will not send it a single VM, even with nova-compute "up".', '- name: Onboard new hypervisors', '  hosts: compute_nuevos', '  become: true', '  tasks:', '    - name: Ubuntu Cloud Archive repository (OpenStack 2024.1 Caracal)', '      ansible.builtin.apt_repository:', '        repo: "cloud-archive:caracal"', '', '    - name: nova-compute, libvirt and Open vSwitch packages', '      ansible.builtin.apt:', '        name: [nova-compute, libvirt-daemon-system, neutron-openvswitch-agent]', '        state: present', '', '    - name: nova.conf and neutron from template', '      ansible.builtin.template:', '        src: templates/nova-compute.conf.j2', '        dest: /etc/nova/nova.conf', '', '    - name: services started and enabled', '      ansible.builtin.service:', '        name: "{{ item }}"', '        state: started', '        enabled: true', '      loop: [libvirtd, nova-compute, openvswitch-switch, neutron-openvswitch-agent]', '', '    - name: next step', '      ansible.builtin.debug:', '        msg: "{{ inventory_hostname }} is ready. It will not get any VMs until it is mapped into the cell: nova-manage cell_v2 discover_hosts (on a controller)"']) };

PB['os-update.yml'] = { plays: [{ nombre: T('Parches de seguridad', 'Security patches'), hosts: 'all', tareas: [
  { n: T('caché de apt al día', 'apt cache up to date'), f: nada },
  { n: T('paquetes actualizados (dist-upgrade)', 'packages upgraded (dist-upgrade)'), f: (st, h, c) => { if (!h.kernelDisponible) return 'ok'; if (!c.check) { h.kernelNuevo = h.kernelDisponible; h.kernelDisponible = null; } return 'changed'; } },
  { n: T('comprobar si hace falta reiniciar', 'check whether a reboot is required'), f: nada },
  { n: T('aviso de reinicio pendiente', 'pending reboot notice'), f: (st, h) => ({ debug: T('Reinicio pendiente: ' + (h.kernelNuevo ? 'sí (kernel ' + h.kernelNuevo + '). Este playbook no reinicia; un nodo Ceph se reinicia con ceph-reboot.yml' : 'no'), 'Reboot pending: ' + (h.kernelNuevo ? 'yes (kernel ' + h.kernelNuevo + '). This playbook does not reboot; a Ceph node is rebooted with ceph-reboot.yml' : 'no')) }) },
] }], yaml: T(['---', '# Parches del sistema. Este playbook NUNCA reinicia: el reinicio de un nodo', '# Ceph va por ceph-reboot.yml (noout antes, unset después).', '- name: Parches de seguridad', '  hosts: all', '  become: true', '  tasks:', '    - name: caché de apt al día', '      ansible.builtin.apt:', '        update_cache: true', '        cache_valid_time: 3600', '', '    - name: paquetes actualizados (dist-upgrade)', '      ansible.builtin.apt:', '        upgrade: dist', '', '    - name: comprobar si hace falta reiniciar', '      ansible.builtin.stat:', '        path: /var/run/reboot-required', '      register: reboot_required', '', '    - name: aviso de reinicio pendiente', '      ansible.builtin.debug:', '        msg: "Reinicio pendiente: {{ reboot_required.stat.exists }}"'],
  ['---', '# System patches. This playbook NEVER reboots: rebooting a Ceph node', '# goes through ceph-reboot.yml (noout before, unset after).', '- name: Security patches', '  hosts: all', '  become: true', '  tasks:', '    - name: apt cache up to date', '      ansible.builtin.apt:', '        update_cache: true', '        cache_valid_time: 3600', '', '    - name: packages upgraded (dist-upgrade)', '      ansible.builtin.apt:', '        upgrade: dist', '', '    - name: check whether a reboot is required', '      ansible.builtin.stat:', '        path: /var/run/reboot-required', '      register: reboot_required', '', '    - name: pending reboot notice', '      ansible.builtin.debug:', '        msg: "Reboot pending: {{ reboot_required.stat.exists }}"']) };

PB['nova-patch.yml'] = { plays: [{ nombre: T('Actualizar nova en los controladores (de uno en uno)', 'Upgrade nova on the controllers (one at a time)'), hosts: 'controllers', serial: 1, tareas: [
  { n: T('nova 29.2.1 (corrige la fuga de memoria de nova-api, LP#2071234)', 'nova 29.2.1 (fixes the nova-api memory leak, LP#2071234)'), f: (st, h, c) => { if (h.extra.novaInstalada !== '29.2.0') return 'ok'; if (!c.check) h.extra.novaInstalada = '29.2.1'; return 'changed'; } },
  { n: T('reiniciar nova-api si corre una versión vieja', 'restart nova-api if it runs an old version'), f: (st, h, c) => { if (h.extra.novaCargada === h.extra.novaInstalada) return 'ok'; if (c.check) return 'changed'; return P.reiniciarUnidad(st, h, 'nova-api') ? { fallo: 'Unable to restart service nova-api' } : 'changed'; } },
  { n: T('esperar a que la API responda en este nodo', 'wait for the API to respond on this node'), espera: true, f: (st) => { P.avanzar(st, 1); return 'ok'; } },
] }], yaml: T(['---', '# Actualiza nova en los controladores DE UNO EN UNO (serial: 1): mientras uno', '# reinicia, HAProxy manda las peticiones a los otros dos y la API no se cae.', '#', '# Instalar el paquete no basta: el proceso que ya corre sigue con el código', '# viejo hasta que se reinicia. Por eso el reinicio va en el mismo playbook.', '- name: Actualizar nova en los controladores (de uno en uno)', '  hosts: controllers', '  become: true', '  serial: 1', '  tasks:', '    - name: nova 29.2.1 (corrige la fuga de memoria de nova-api, LP#2071234)', '      ansible.builtin.apt:', '        name: [nova-api, nova-common, python3-nova]', '        state: latest', '      register: paquetes', '', '    - name: reiniciar nova-api si corre una versión vieja', '      ansible.builtin.service:', '        name: nova-api', '        state: restarted', '      when: paquetes.changed or nova_api_desfasado', '', '    - name: esperar a que la API responda en este nodo', '      ansible.builtin.uri:', '        url: "http://{{ ansible_host }}:8774/"', '        status_code: 200', '      retries: 10'],
  ['---', '# Upgrades nova on the controllers ONE AT A TIME (serial: 1): while one', '# restarts, HAProxy sends requests to the other two and the API stays up.', '#', '# Installing the package is not enough: the process already running keeps the', '# old code until it restarts. That is why the restart is in the same playbook.', '- name: Upgrade nova on the controllers (one at a time)', '  hosts: controllers', '  become: true', '  serial: 1', '  tasks:', '    - name: nova 29.2.1 (fixes the nova-api memory leak, LP#2071234)', '      ansible.builtin.apt:', '        name: [nova-api, nova-common, python3-nova]', '        state: latest', '      register: paquetes', '', '    - name: restart nova-api if it runs an old version', '      ansible.builtin.service:', '        name: nova-api', '        state: restarted', '      when: paquetes.changed or nova_api_desfasado', '', '    - name: wait for the API to respond on this node', '      ansible.builtin.uri:', '        url: "http://{{ ansible_host }}:8774/"', '        status_code: 200', '      retries: 10']) };

PB['certs.yml'] = { plays: [{ nombre: T('Certificado TLS de la API', 'API TLS certificate'), hosts: 'controllers', tareas: [
  { n: T('certificado de la API desde el repositorio', 'API certificate from the repository'), notify: RECARGAR_HAPROXY, f: (st, h, c) => { const k = h.extra.cert; if (!k || k.fichero === st.os.certRepo) return 'ok'; if (!c.check) k.fichero = st.os.certRepo; return 'changed'; } },
  { n: T('días que le quedan al certificado', 'days left on the certificate'), f: (st, h) => ({ debug: h.nombre + ': ' + Math.floor((h.extra.cert.fichero - st.reloj) / 1440) + T(' días', ' days') }) },
], handlers: { [RECARGAR_HAPROXY]: (st, h, c) => { if (c.check) return 'changed'; const r = P.reiniciarUnidad(st, h, 'haproxy'); return r ? { fallo: 'Unable to reload service haproxy' } : 'changed'; } } }],
yaml: T(['---', '# Certificado TLS de la VIP de la API (api.retail.local), firmado por la CA', '# interna. El renovado se guarda en files/certs/ de este repo.', '#', '# Ojo: copiar el fichero no basta. HAProxy lee el certificado al arrancar;', '# hasta que no se recarga, sigue sirviendo el viejo.', '- name: Certificado TLS de la API', '  hosts: controllers', '  become: true', '  tasks:', '    - name: certificado de la API desde el repositorio', '      ansible.builtin.copy:', '        src: files/certs/api.pem', '        dest: /etc/haproxy/certs/api.pem', '        mode: "0600"', '      notify: recargar haproxy', '', '    - name: días que le quedan al certificado', '      ansible.builtin.debug:', '        msg: "{{ inventory_hostname }}: {{ cert_dias }} días"', '', '  handlers:', '    - name: recargar haproxy', '      ansible.builtin.service:', '        name: haproxy', '        state: reloaded'],
  ['---', '# TLS certificate for the API VIP (api.retail.local), signed by the internal', '# CA. The renewed one is kept in files/certs/ in this repo.', '#', '# Careful: copying the file is not enough. HAProxy reads the certificate at', '# startup; until it is reloaded, it keeps serving the old one.', '- name: API TLS certificate', '  hosts: controllers', '  become: true', '  tasks:', '    - name: API certificate from the repository', '      ansible.builtin.copy:', '        src: files/certs/api.pem', '        dest: /etc/haproxy/certs/api.pem', '        mode: "0600"', '      notify: ' + RECARGAR_HAPROXY, '', '    - name: days left on the certificate', '      ansible.builtin.debug:', '        msg: "{{ inventory_hostname }}: {{ cert_dias }} days"', '', '  handlers:', '    - name: ' + RECARGAR_HAPROXY, '      ansible.builtin.service:', '        name: haproxy', '        state: reloaded']) };

// El reinicio ordenado: tres plays, porque run_once con serial se repite por
// lote y el noout tiene que ponerse una vez antes y quitarse una vez después.
// `espera` marca las tareas que sólo esperan: --check no las salta.
PB['ceph-reboot.yml'] = { plays: [
  { nombre: T('Preparar el clúster Ceph', 'Prepare the Ceph cluster'), hosts: 'ceph', unaVez: true, tareas: [
    { n: T('el clúster está en HEALTH_OK', 'the cluster is HEALTH_OK'), salud: true, cmd: true, f: (st) => { const s = P.saludCeph(st), solo = s.checks.every(c => c.code === 'OSDMAP_FLAGS' && /^noout flag/.test(c.res)); return (s.estado === 'HEALTH_OK' || solo) ? 'ok' : { fallo: '{"changed": true, "cmd": ["ceph", "health"], "failed_when_result": true, "stdout": "' + s.estado + ' ' + s.checks.map(c => c.res).join('; ') + '"}', crudo: true }; } },
    { n: 'ceph osd set noout', cmd: true, f: (st, h, c) => { if (st.ceph.flags.noout) return 'ok'; if (!c.check) { st.ceph.flags.noout = true; P.cephLog(st, 'WRN', 'Health check failed: noout flag(s) set (OSDMAP_FLAGS)'); } return 'changed'; } },
  ] },
  { nombre: T('Reinicio ordenado de nodos Ceph', 'Orderly reboot of Ceph nodes'), hosts: 'ceph', serial: 1, tareas: [
    { n: T('reiniciar el nodo', 'reboot the node'), f: (st, h, c) => { if (c.check) return 'changed'; P.reiniciar(st, h); U.hasta(st, () => h.up, 30); return 'changed'; } },
    { n: T('esperar a que sus OSD estén up', 'wait for its OSDs to be up'), espera: true, cmd: true, f: (st, h) => { U.hasta(st, () => h.osds.every(i => U.osdUp(st, st.ceph.osds[i])), 5); return 'ok'; } },
    { n: T('esperar a que el clúster se recupere', 'wait for the cluster to recover'), espera: true, cmd: true, f: (st) => { U.hasta(st, () => !st.ceph.rec, 15); return 'ok'; } },
  ] },
  { nombre: T('Devolver el clúster a la normalidad', 'Return the cluster to normal'), hosts: 'ceph', unaVez: true, tareas: [
    { n: 'ceph osd unset noout', cmd: true, f: (st, h, c) => { if (!st.ceph.flags.noout) return 'ok'; if (!c.check) { delete st.ceph.flags.noout; P.cephLog(st, 'INF', 'Health check cleared: OSDMAP_FLAGS (was: noout flag(s) set)'); } return 'changed'; } },
  ] },
], yaml: T(['---', '# Reinicio ordenado de nodos Ceph, de uno en uno.', '#   1. sólo si el clúster está en HEALTH_OK', '#   2. noout: que Ceph no se ponga a mover datos mientras el nodo arranca', '#   3. reinicia, espera a sus OSD y a que el clúster se recupere', '#   4. quita noout', '# Úsalo con -l para un solo nodo:  ansible-playbook playbooks/ceph-reboot.yml -l ceph02', '', '- name: Preparar el clúster Ceph', '  hosts: ceph', '  become: true', '  run_once: true', '  tasks:', '    - name: el clúster está en HEALTH_OK', '      ansible.builtin.command: ceph health', '      register: salud', "      failed_when: \"'HEALTH_OK' not in salud.stdout\"", '    - name: ceph osd set noout', '      ansible.builtin.command: ceph osd set noout', '', '- name: Reinicio ordenado de nodos Ceph', '  hosts: ceph', '  become: true', '  serial: 1', '  tasks:', '    - name: reiniciar el nodo', '      ansible.builtin.reboot:', '        reboot_timeout: 1200', '    - name: esperar a que sus OSD estén up', '      ansible.builtin.command: ceph osd tree', '      retries: 30', '    - name: esperar a que el clúster se recupere', '      ansible.builtin.command: ceph pg stat', '      retries: 60', '', '- name: Devolver el clúster a la normalidad', '  hosts: ceph', '  become: true', '  run_once: true', '  tasks:', '    - name: ceph osd unset noout', '      ansible.builtin.command: ceph osd unset noout'],
  ['---', '# Orderly reboot of Ceph nodes, one at a time.', '#   1. only if the cluster is HEALTH_OK', '#   2. noout: so Ceph does not start moving data while the node boots', '#   3. reboot, wait for its OSDs and for the cluster to recover', '#   4. unset noout', '# Use it with -l for a single node:  ansible-playbook playbooks/ceph-reboot.yml -l ceph02', '', '- name: Prepare the Ceph cluster', '  hosts: ceph', '  become: true', '  run_once: true', '  tasks:', '    - name: the cluster is HEALTH_OK', '      ansible.builtin.command: ceph health', '      register: salud', "      failed_when: \"'HEALTH_OK' not in salud.stdout\"", '    - name: ceph osd set noout', '      ansible.builtin.command: ceph osd set noout', '', '- name: Orderly reboot of Ceph nodes', '  hosts: ceph', '  become: true', '  serial: 1', '  tasks:', '    - name: reboot the node', '      ansible.builtin.reboot:', '        reboot_timeout: 1200', '    - name: wait for its OSDs to be up', '      ansible.builtin.command: ceph osd tree', '      retries: 30', '    - name: wait for the cluster to recover', '      ansible.builtin.command: ceph pg stat', '      retries: 60', '', '- name: Return the cluster to normal', '  hosts: ceph', '  become: true', '  run_once: true', '  tasks:', '    - name: ceph osd unset noout', '      ansible.builtin.command: ceph osd unset noout']) };
P.playbooks = PB;

// ------------------------------------------------------------------ runner
const cab = t => { const s = t + ' '; return s + '*'.repeat(Math.max(3, 80 - s.length)); };
const inalcanzable = n => 'fatal: [' + n + ']: UNREACHABLE! => {"changed": false, "msg": "Failed to connect to the host via ssh: ssh: connect to host ' + n + ' port 22: No route to host", "unreachable": true}';
function recap(cuentas) {
  const out = [L(''), L(cab('PLAY RECAP'))];
  Object.keys(cuentas).forEach(n => {
    const c = cuentas[n];
    out.push(L(n.padEnd(27) + ': ok=' + String(c.ok).padEnd(4) + ' changed=' + String(c.changed).padEnd(4) + ' unreachable=' + String(c.unreachable).padEnd(4) + ' failed=' + String(c.failed).padEnd(4) + ' skipped=' + String(c.skipped).padEnd(4) + ' rescued=0    ignored=0   ', c.failed || c.unreachable ? 'rojo' : c.changed ? 'ambar' : 'verde'));
  });
  return out.concat([L('')]);
}
function correrPlaybook(st, pb, limite, check) {
  const out = [], cuentas = {}, cuenta = n => (cuentas[n] = cuentas[n] || { ok: 0, changed: 0, unreachable: 0, failed: 0, skipped: 0 });
  const avisos = [];
  const lim = limite ? resolver(limite, avisos) : null;
  avisos.forEach(a => out.push(a));
  for (const play of pb.plays) {
    let hosts = resolver(play.hosts);
    if (lim) hosts = hosts.filter(n => lim.indexOf(n) >= 0);
    out.push(L('')); out.push(L(cab('PLAY [' + play.nombre + ']')));
    if (!hosts.length) { out.push(L('skipping: no hosts matched', 'dim')); continue; }
    const vivos = [];
    out.push(L('')); out.push(L(cab('TASK [Gathering Facts]')));
    hosts.forEach(n => { cuenta(n); if (st.hosts[n].up) { out.push(L('ok: [' + n + ']', 'verde')); cuenta(n).ok++; vivos.push(n); } else { out.push(L(inalcanzable(n), 'rojo')); cuenta(n).unreachable++; } });
    if (!vivos.length) { out.push(L('')); out.push(L('NO MORE HOSTS LEFT ' + '*'.repeat(61), 'rojo')); return { lineas: out.concat(recap(cuentas)), fallo: true }; }
    const lotes = play.unaVez ? [[vivos[0]]] : play.serial ? vivos.map(n => [n]) : [vivos];
    for (const lote of lotes) {
      const notif = {};
      let activos = lote.slice();
      for (const t of play.tareas) {
        out.push(L('')); out.push(L(cab('TASK [' + t.n + ']')));
        const siguen = [];
        activos.forEach(n => {
          const h = st.hosts[n];
          let r = (check && t.cmd && !t.espera && !t.salud) ? 'skipped' : t.f(st, h, { check });
          if (r && r.debug) { out.push(L('ok: [' + n + '] => {', 'verde')); out.push(L('    "msg": "' + r.debug + '"', 'verde')); out.push(L('}', 'verde')); cuenta(n).ok++; siguen.push(n); return; }
          if (r && r.fallo) { out.push(L('fatal: [' + n + ']: FAILED! => ' + (r.crudo ? r.fallo : '{"changed": false, "msg": "' + r.fallo.replace(/\n/g, '\\n') + '"}'), 'rojo')); cuenta(n).failed++; return; }
          if (r === 'changed') { out.push(L('changed: [' + n + ']', 'ambar')); cuenta(n).changed++; if (t.notify) notif[t.notify] = (notif[t.notify] || []).concat([n]); }
          else if (r === 'skipped') { out.push(L('skipping: [' + n + ']', 'dim')); cuenta(n).skipped++; }
          else { out.push(L('ok: [' + n + ']', 'verde')); cuenta(n).ok++; }
          siguen.push(n);
        });
        activos = siguen;
        if (!activos.length) { out.push(L('')); out.push(L('NO MORE HOSTS LEFT ' + '*'.repeat(61), 'rojo')); return { lineas: out.concat(recap(cuentas)), fallo: true }; }
      }
      Object.keys(notif).forEach(hn => {
        out.push(L('')); out.push(L(cab('RUNNING HANDLER [' + hn + ']')));
        notif[hn].filter(n => activos.indexOf(n) >= 0).forEach(n => {
          const r = play.handlers[hn](st, st.hosts[n], { check });
          if (r && r.fallo) { out.push(L('fatal: [' + n + ']: FAILED! => {"changed": false, "msg": "' + r.fallo + '"}', 'rojo')); cuenta(n).failed++; }
          else { out.push(L('changed: [' + n + ']', 'ambar')); cuenta(n).changed++; }
        });
      });
    }
  }
  const fallo = Object.values(cuentas).some(c => c.failed || c.unreachable);
  return { lineas: out.concat(recap(cuentas)), fallo };
}
P.correrPlaybook = correrPlaybook;

const enInfra = ses => ses.cwd === INFRA;   // ansible.cfg sólo se busca en la carpeta actual
const sinInventario = [L('[WARNING]: No inventory was parsed, only implicit localhost is available', 'ambar'), L('[WARNING]: provided hosts list is empty, only localhost is available. Note that the implicit localhost does not match \'all\'', 'ambar'), L(T('(ansible.cfg y el inventario viven en ~/infra: haz cd ~/infra y repite)', '(ansible.cfg and the inventory live in ~/infra: cd ~/infra and try again)'), 'dim')];

U.cmd('ansible-playbook', { ayuda: T('lanza un playbook (-l para limitar, --check para ensayar)', 'run a playbook (-l to limit, --check for a dry run)'), grupo: T('Automatización', 'Automation'), donde: ['bastion'], fuera: T('(Ansible se lanza desde el bastión, en ~/infra)', '(Ansible runs from the bastion, in ~/infra)'), fn: ctx => {
  const st = ctx.st, a = ctx.args;
  let lim = null, check = false, lista = false; const pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '-l' || a[i] === '--limit') { lim = a[++i]; continue; }
    if (/^--limit=/.test(a[i])) { lim = a[i].slice(8); continue; }
    if (a[i] === '--check' || a[i] === '-C') { check = true; continue; }
    if (a[i] === '--list-hosts') { lista = true; continue; }
    if (a[i] === '-i') { i++; continue; }
    if (a[i][0] === '-') continue;
    pos.push(a[i]);
  }
  if (!pos.length) return [L('usage: ansible-playbook [-h] [--version] [-v] [--private-key PRIVATE_KEY_FILE] [-u REMOTE_USER] [-c CONNECTION] [-T TIMEOUT] [-l SUBSET] [-C] [--list-hosts] playbook [playbook ...]', 'err'), L('ansible-playbook: error: the following arguments are required: playbook', 'err')];
  const ruta = U.ruta(ctx.ses.cwd, pos[0], ctx.ses), nombre = ruta.slice(ruta.lastIndexOf('/') + 1);
  if (ruta.indexOf(INFRA + '/playbooks/') !== 0 || !PB[nombre]) return [L('ERROR! the playbook: ' + pos[0] + ' could not be found', 'err'), L(T('(los playbooks están en ~/infra/playbooks: ls ~/infra/playbooks)', '(the playbooks are in ~/infra/playbooks: ls ~/infra/playbooks)'), 'dim')];
  if (!enInfra(ctx.ses)) return { lineas: sinInventario.concat([L(''), L(cab('PLAY [' + PB[nombre].plays[0].nombre + ']')), L('skipping: no hosts matched', 'dim')]) };
  if (lista) {
    const out = [L(''), L('playbook: playbooks/' + nombre)];
    PB[nombre].plays.forEach(p => { let hs = resolver(p.hosts); if (lim) { const l = resolver(lim); hs = hs.filter(n => l.indexOf(n) >= 0); } out.push(L('')); out.push(L('  play #1 (' + p.hosts + '): ' + p.nombre + '\tTAGS: []')); out.push(L('    pattern: [\'' + p.hosts + '\']')); out.push(L('    hosts (' + hs.length + '):')); hs.forEach(n => out.push(L('      ' + n))); });
    return out;
  }
  const r = correrPlaybook(st, PB[nombre], lim, check);
  st.hechos.playbooks.push({ pb: nombre, limite: lim, check, min: st.reloj, fallo: r.fallo });
  if (check) r.lineas.unshift(L(T('(modo --check: Ansible cuenta lo que cambiaría, sin tocar nada)', '(--check mode: Ansible reports what it would change, without touching anything)'), 'dim'));
  return { lineas: r.lineas, minutos: 2, fallo: r.fallo };
}, completar: (st, ses, pal, ult, rutas) => {
  const ant = pal[pal.length - 1];
  if (ant === '-l' || ant === '--limit') return Object.keys(GRUPOS).concat(TODOS);
  if (ult[0] === '-') return ['--check', '--limit', '-l', '--list-hosts'];
  return rutas();
} });

U.cmd('ansible', { ayuda: T('órdenes sueltas a la flota (ansible all -m ping)', 'ad-hoc commands across the fleet (ansible all -m ping)'), grupo: T('Automatización', 'Automation'), donde: ['bastion'], fuera: T('(Ansible se lanza desde el bastión, en ~/infra)', '(Ansible runs from the bastion, in ~/infra)'), fn: ctx => {
  const st = ctx.st, a = ctx.args;
  let mod = 'command', arg = null, become = false, lista = false; const pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '-m') { mod = a[++i]; continue; }
    if (a[i] === '-a') { arg = a[++i]; continue; }
    if (a[i] === '-b' || a[i] === '--become') { become = true; continue; }
    if (a[i] === '--list-hosts') { lista = true; continue; }
    if (a[i] === '-i') { i++; continue; }
    if (a[i][0] === '-') continue;
    pos.push(a[i]);
  }
  if (!pos.length) return [L('usage: ansible [-h] [--version] [-v] [-b] [-m MODULE_NAME] [-a MODULE_ARGS] pattern', 'err')];
  if (!enInfra(ctx.ses)) return { lineas: sinInventario.concat([L('[WARNING]: No hosts matched, nothing to do', 'ambar')]) };
  const avisos = [], hosts = resolver(pos[0], avisos);
  if (!hosts.length) return avisos.concat([L('[WARNING]: No hosts matched, nothing to do', 'ambar')]);
  if (lista) return [L('  hosts (' + hosts.length + '):')].concat(hosts.map(n => L('    ' + n)));
  mod = String(mod).replace(/^ansible\.builtin\./, '');
  const out = avisos.slice();
  hosts.forEach(n => {
    const h = st.hosts[n];
    if (!h.up) { out.push(L(n + ' | UNREACHABLE! => {', 'rojo')); out.push(L('    "changed": false,', 'rojo')); out.push(L('    "msg": "Failed to connect to the host via ssh: ssh: connect to host ' + n + ' port 22: No route to host",', 'rojo')); out.push(L('    "unreachable": true', 'rojo')); out.push(L('}', 'rojo')); return; }
    if (mod === 'ping') { out.push(L(n + ' | SUCCESS => {', 'verde')); out.push(L('    "changed": false,', 'verde')); out.push(L('    "ping": "pong"', 'verde')); out.push(L('}', 'verde')); return; }
    if (mod === 'service' || mod === 'systemd') {
      const kv = {}; String(arg || '').split(/\s+/).forEach(x => { const i = x.indexOf('='); if (i > 0) kv[x.slice(0, i)] = x.slice(i + 1); });
      const u = kv.name && U.unidad(h, kv.name);
      if (!become) { out.push(L(n + ' | FAILED! => {"changed": false, "msg": "Unable to start service ' + (kv.name || '') + ': Failed to start ' + (kv.name || '') + '.service: Access denied"}', 'rojo')); return; }
      if (!u) { out.push(L(n + ' | FAILED! => {"changed": false, "msg": "Could not find the requested service ' + (kv.name || '') + ': host"}', 'rojo')); return; }
      const s = h.svcs[u]; let cambio = false, fallo = null;
      if (kv.enabled === 'yes' || kv.enabled === 'true') { if (!s.enabled) { s.enabled = true; cambio = true; } }
      if (kv.enabled === 'no' || kv.enabled === 'false') { if (s.enabled) { s.enabled = false; cambio = true; } }
      if (kv.state === 'started' && s.estado !== 'active') { s.limite = false; fallo = P.arrancar(st, h, u); cambio = true; }
      if (kv.state === 'restarted') { s.limite = false; if (s.estado === 'active') P.parar(st, h, u); fallo = P.arrancar(st, h, u); cambio = true; }
      if (kv.state === 'stopped' && s.estado === 'active') { P.parar(st, h, u); cambio = true; }
      if (fallo) out.push(L(n + ' | FAILED! => {"changed": false, "msg": "Unable to start service ' + u + ': Job for ' + u + '.service failed because the control process exited with error code."}', 'rojo'));
      else out.push(L(n + ' | ' + (cambio ? 'CHANGED' : 'SUCCESS') + ' => {"changed": ' + cambio + ', "name": "' + u + '", "state": "' + (s.estado === 'active' ? 'started' : 'stopped') + '", "enabled": ' + s.enabled + '}', cambio ? 'ambar' : 'verde'));
      return;
    }
    if (mod === 'shell' || mod === 'command' || mod === 'raw') {
      if (!arg) { out.push(L(n + ' | FAILED! => {"changed": false, "msg": "no command given", "rc": 256}', 'rojo')); return; }
      const r = P.correrEn(st, n, arg, { sudo: become });
      const mal = r.fallo || r.lineas.some(l => l.c === 'err');
      out.push(L(n + ' | ' + (mal ? 'FAILED | rc=1' : 'CHANGED | rc=0') + ' >>', mal ? 'rojo' : 'ambar'));
      r.lineas.forEach(l => out.push(l));
      if (mal) out.push(L('non-zero return code', 'rojo'));
      return;
    }
    out.push(L(n + ' | FAILED! => {"msg": "The module ' + mod + ' was not found in configured module paths"}', 'rojo'));
  });
  st.hechos.adhoc = (st.hechos.adhoc || []).concat([{ patron: pos[0], mod, arg, min: st.reloj }]);
  return { lineas: out, minutos: 1 };
}, completar: (st, ses, pal) => {
  const ant = pal[pal.length - 1];
  if (!pal.length) return Object.keys(GRUPOS).concat(TODOS);
  if (ant === '-m') return ['ping', 'shell', 'command', 'service'];
  return ['-m', '-a', '-b', '--list-hosts'];
} });
U.cmd('ansible-inventory', { ayuda: T('grupos y máquinas del inventario (--graph)', 'inventory groups and hosts (--graph)'), grupo: T('Automatización', 'Automation'), donde: ['bastion'], fn: ctx => {
  if (!enInfra(ctx.ses)) return sinInventario.concat([L('@all:'), L('  |--@ungrouped:')]);
  const out = [L('@all:'), L('  |--@ungrouped:')];
  ['bastion', 'openstack', 'compute_nuevos', 'ceph', 'monitoring'].forEach(g => {
    out.push(L('  |--@' + g + ':'));
    if (g === 'openstack') ['controllers', 'compute'].forEach(s => { out.push(L('  |  |--@' + s + ':')); GRUPOS[s].forEach(n => out.push(L('  |  |  |--' + n))); });
    else GRUPOS[g].forEach(n => out.push(L('  |  |--' + n)));
  });
  return out;
} });

// ------------------------------------------------------------------ Terraform
const TF_REGLAS = [
  { r: 'https_public', puerto: 443, remoto: '0.0.0.0/0', linea: 12 },
  { r: 'ssh_admin', puerto: 22, remoto: '10.20.0.0/16', linea: 23 },
  { r: 'api_internal', puerto: 8443, remoto: '10.30.0.0/16', linea: 34 },
];
P.alCrear.push(st => {
  const sg = st.os.sgs['sg-pos-backend'], rec = { 'openstack_networking_secgroup_v2.pos_backend': sg.id };
  sg.reglas.filter(r => r.tf).forEach(r => { rec['openstack_networking_secgroup_rule_v2.' + r.tf] = r.id; });
  st.tf = { recursos: rec };
});
function planTf(st) {
  const sg = st.os.sgs['sg-pos-backend'], faltan = [];
  TF_REGLAS.forEach(def => {
    const addr = 'openstack_networking_secgroup_rule_v2.' + def.r, id = st.tf.recursos[addr];
    if (!id || !sg.reglas.some(x => x.id === id)) faltan.push({ addr, def, id });
  });
  return faltan;
}
P.planTf = planTf;
const tfError = (lineas) => [L('╷', 'rojo')].concat(lineas.map(t => L('│ ' + t, 'rojo'))).concat([L('╵', 'rojo')]);
const bloqueRegla = (def, signo, sgId, id) => [
  L('  ' + signo + ' resource "openstack_networking_secgroup_rule_v2" "' + def.r + '" {', signo === '+' ? 'verde' : 'rojo'),
  L('      ' + signo + ' direction         = "ingress"'), L('      ' + signo + ' ethertype         = "IPv4"'),
  L('      ' + (id ? '  id                = "' + id + '"' : '+ id                = (known after apply)')),
  L('      ' + signo + ' port_range_max    = ' + def.puerto), L('      ' + signo + ' port_range_min    = ' + def.puerto), L('      ' + signo + ' protocol          = "tcp"'),
  L('      ' + signo + ' remote_ip_prefix  = "' + def.remoto + '"'), L('      ' + signo + ' security_group_id = "' + sgId + '"'), L('    }')];
function refresco(st) { return Object.keys(st.tf.recursos).map(k => L(k + ': Refreshing state... [id=' + st.tf.recursos[k] + ']')); }
function textoPlan(st, faltan) {
  const sg = st.os.sgs['sg-pos-backend'], out = refresco(st);
  if (!faltan.length) return out.concat([L(''), L('No changes. Your infrastructure matches the configuration.', 'verde'), L(''), L('Terraform has compared your real infrastructure against your configuration and found no differences, so no changes are needed.')]);
  const borradas = faltan.filter(f => f.id);
  if (borradas.length) {
    out.push(L('')); out.push(L('Note: Objects have changed outside of Terraform', 'ambar')); out.push(L(''));
    out.push(L('Terraform detected the following changes made outside of Terraform since the')); out.push(L('last "terraform apply" which may have affected this plan:')); out.push(L(''));
    borradas.forEach(f => { out.push(L('  # ' + f.addr + ' has been deleted', 'ambar')); bloqueRegla(f.def, '-', sg.id, f.id).forEach(l => out.push(l)); });
    out.push(L('')); out.push(L('Unless you have made equivalent changes to your configuration, or ignored the')); out.push(L('relevant attributes using ignore_changes, the following plan may include')); out.push(L('actions to undo or respond to these changes.'));
    out.push(L('')); out.push(L('─'.repeat(77)));
  }
  out.push(L('')); out.push(L('Terraform used the selected providers to generate the following execution plan. Resource actions are indicated with the following symbols:')); out.push(L('  + create', 'verde')); out.push(L('')); out.push(L('Terraform will perform the following actions:')); out.push(L(''));
  faltan.forEach(f => { out.push(L('  # ' + f.addr + ' will be created')); bloqueRegla(f.def, '+', sg.id, null).forEach(l => out.push(l)); out.push(L('')); });
  out.push(L('Plan: ' + faltan.length + ' to add, 0 to change, 0 to destroy.'));
  return out;
}
function aplicarTf(st, faltan) {
  const sg = st.os.sgs['sg-pos-backend'], out = [];
  let ok = 0;
  for (const f of faltan) {
    out.push(L(f.addr + ': Creating...'));
    const dup = sg.reglas.find(r => r.dir === 'ingress' && r.proto === 'tcp' && r.puerto === f.def.puerto && r.remoto === f.def.remoto);
    if (dup) {
      tfError(['Error: Error creating openstack_networking_secgroup_rule_v2: Expected HTTP response code [201 202] when accessing [POST https://api.retail.local:9696/v2.0/security-group-rules], but got 409 instead', '{"NeutronError": {"type": "SecurityGroupRuleExists", "message": "Security group rule already exists. Rule id is ' + dup.id + '.", "detail": ""}}', '', '  with ' + f.addr + ',', '  on secgroups.tf line ' + f.def.linea + ', in resource "openstack_networking_secgroup_rule_v2" "' + f.def.r + '":', '  ' + f.def.linea + ': resource "openstack_networking_secgroup_rule_v2" "' + f.def.r + '" {', '']).forEach(l => out.push(l));
      st.hechos.tf.push({ accion: 'apply', min: st.reloj, fallo: true });
      return { lineas: out, fallo: true };
    }
    const id = U.uuid('tf' + f.addr + st.reloj);
    sg.reglas.push({ id, dir: 'ingress', eth: 'IPv4', proto: 'tcp', puerto: f.def.puerto, remoto: f.def.remoto, tf: f.def.r });
    st.tf.recursos[f.addr] = id; ok++;
    out.push(L(f.addr + ': Creation complete after 1s [id=' + id + ']', 'verde'));
  }
  out.push(L('')); out.push(L('Apply complete! Resources: ' + ok + ' added, 0 changed, 0 destroyed.', 'verde'));
  st.hechos.tf.push({ accion: 'apply', min: st.reloj, cambios: ok });
  return { lineas: out };
}
U.cmd('terraform', { ayuda: T('infraestructura como código: plan / apply (en ~/infra/terraform)', 'infrastructure as code: plan / apply (in ~/infra/terraform)'), grupo: T('Automatización', 'Automation'), donde: ['bastion'], fuera: T('(Terraform se lanza desde el bastión, en ~/infra/terraform)', '(Terraform runs from the bastion, in ~/infra/terraform)'), fn: ctx => {
  const st = ctx.st, ses = ctx.ses, a = ctx.args, sub = a[0];
  if (!sub || sub === '-help' || sub === '--help') return U.ls(['Usage: terraform [global options] <subcommand> [args]', '', 'Main commands:', '  init          Prepare your working directory for other commands', '  validate      Check whether the configuration is valid', '  plan          Show changes required by the current configuration', '  apply         Create or update infrastructure', '  state list    List resources in the state']);
  if (ses.cwd !== TFDIR) {
    if (sub === 'plan' || sub === 'apply') return [L('╷', 'rojo'), L('│ Error: No configuration files', 'rojo'), L('│ ', 'rojo'), L('│ ' + (sub === 'plan' ? 'Plan' : 'Apply') + ' requires configuration to be present. Planning without a configuration would mark everything for destruction, which is normally not what is desired.', 'rojo'), L('╵', 'rojo'), L(T('(la configuración está en ~/infra/terraform: haz cd ~/infra/terraform)', '(the configuration is in ~/infra/terraform: cd ~/infra/terraform)'), 'dim')];
    if (sub === 'init') return [L('Terraform initialized in an empty directory!', 'ambar'), L(T('(te has equivocado de carpeta: la buena es ~/infra/terraform)', '(wrong directory: the right one is ~/infra/terraform)'), 'dim')];
    return [L('Error: No configuration files', 'err')];
  }
  if (sub === 'init') return U.ls(['', 'Initializing the backend...', '', 'Initializing provider plugins...', '- Reusing previous version of terraform-provider-openstack/openstack from the dependency lock file', '- Using previously-installed terraform-provider-openstack/openstack v2.1.0', '', 'Terraform has been successfully initialized!']);
  if (sub === 'validate') return [L('Success! The configuration is valid.', 'verde')];
  if (sub === 'fmt') return [];
  if (sub === 'state' && a[1] === 'list') return U.ls(Object.keys(st.tf.recursos));
  if (sub === 'destroy') return [L(T('(terraform destroy borraría los grupos de seguridad de producción: en el simulador está desactivado)', '(terraform destroy would delete the production security groups: it is disabled in the simulator)'), 'dim')];
  if (sub !== 'plan' && sub !== 'apply') return [L('Terraform has no command named "' + sub + '".', 'err')];
  if (!ses.env.OS_AUTH_URL) return tfError(['Error: One of \'auth_url\' or \'cloud\' must be specified', '', '  with provider["registry.terraform.io/terraform-provider-openstack/openstack"],', '  on main.tf line 10, in provider "openstack":', '  10: provider "openstack" {', '']).concat([L(T('(el provider lee las credenciales del entorno: source ~/admin-openrc)', '(the provider reads credentials from the environment: source ~/admin-openrc)'), 'dim')]);
  const faltan = planTf(st);
  if (sub === 'plan') { st.hechos.tf.push({ accion: 'plan', min: st.reloj, pendientes: faltan.length }); return { lineas: textoPlan(st, faltan), minutos: 1 }; }
  const plan = textoPlan(st, faltan);
  if (!faltan.length) { st.hechos.tf.push({ accion: 'apply', min: st.reloj, cambios: 0 }); return plan.concat([L(''), L('Apply complete! Resources: 0 added, 0 changed, 0 destroyed.', 'verde')]); }
  if (a.indexOf('-auto-approve') >= 0 || a.indexOf('--auto-approve') >= 0) { const r = aplicarTf(st, faltan); return { lineas: plan.concat([L('')]).concat(r.lineas), minutos: 1, fallo: r.fallo }; }
  ses.pendiente = { prompt: '  Enter a value: ', responder: (st2, ses2, resp) => {
    if (resp !== 'yes') return { lineas: [L(''), L('Apply cancelled.', 'ambar')] };
    const r = aplicarTf(st2, planTf(st2)); return { lineas: [L('')].concat(r.lineas), minutos: 1 };
  } };
  return { lineas: plan.concat([L(''), L('Do you want to perform these actions?'), L('  Terraform will perform the actions described above.'), L("  Only 'yes' will be accepted to approve."), L('')]), minutos: 1 };
}, completar: (st, ses, pal) => !pal.length ? ['plan', 'apply', 'init', 'validate', 'state'] : pal[0] === 'state' ? ['list'] : pal[0] === 'apply' ? ['-auto-approve'] : [] });

// ------------------------------------------------------------------ Alertmanager
U.cmd('amtool', { ayuda: T('alertas activas en Alertmanager (amtool alert)', 'active alerts in Alertmanager (amtool alert)'), grupo: T('Monitorización', 'Monitoring'), donde: ['bastion', 'mon'], fn: ctx => {
  const st = ctx.st, a = ctx.args;
  if (a[0] !== 'alert') return [L('usage: amtool [<flags>] <command> [<args> ...]', 'err'), L(T('(en el simulador: amtool alert)', '(in the simulator: amtool alert)'), 'dim')];
  const filtro = a.slice(a[1] === 'query' ? 2 : 1).find(x => x[0] !== '-');
  const al = P.alertasActivas(st).filter(x => !filtro || x.nombre.indexOf(filtro.replace(/^alertname=/, '')) >= 0);
  if (!al.length) return [L('Alertname  Starts At  Summary  State')];
  return [L('Alertname'.padEnd(28) + 'Starts At'.padEnd(26) + 'Summary'.padEnd(64) + 'State')].concat(al.map(x => L(x.nombre.padEnd(28) + (U.iso(x.desde).replace('T', ' ') + ' UTC').padEnd(26) + ((x.host ? x.host + ': ' : '') + x.res).slice(0, 62).padEnd(64) + 'active', x.sev === 'critical' ? 'rojo' : x.sev === 'warning' ? 'ambar' : 'out')));
}, completar: (st, ses, pal) => !pal.length ? ['alert'] : ['query'] });

// ------------------------------------------------------------------ bastión
const RUNBOOK = T(['# Plataforma retail — runbook de guardia', '', '## Topología', '  bastion      punto de entrada. Aquí están Ansible, Terraform y el cliente de OpenStack.', '  ctl01..03    controladores OpenStack: API, scheduler, RabbitMQ y Galera. VIP 10.10.1.10', '  cmp01..03    hipervisores KVM (nova-compute + libvirt).', '  cmp04        hipervisor nuevo, montado en rack, pendiente de alta.', '  ceph01..03   Ceph Reef: 1 mon + 1 mgr + 3 OSD SSD de 1.75 TiB por nodo. Réplica 3, min_size 2.', '  mon01        Prometheus, Alertmanager y Grafana.', '', '## Normas', '  1. Todo cambio de configuración pasa por Ansible (~/infra/playbooks) o', '     Terraform (~/infra/terraform). Lo que se toca a mano deriva y vuelve a romperse.', '  2. Antes de reiniciar un nodo Ceph: ceph osd set noout. Después: ceph osd unset noout.', '     O mejor: ansible-playbook playbooks/ceph-reboot.yml -l <nodo>', '     Ceph marca out un OSD que lleva 10 min caído; un nodo Ceph tarda ~12 min en volver.', '  3. No subas umbrales para callar una alarma: arregla lo que la dispara.', '  4. Antes de arreglar, mira por qué se rompió. Después, comprueba que está arreglado.', '  5. Deja rastro en el ticket: qué viste, qué hiciste y cómo lo comprobaste.', '', '## Procedimientos', '  Vaciar un hipervisor   openstack compute service set --disable --disable-reason "<motivo>" <nodo> nova-compute', '                         nova host-evacuate-live <nodo>      (migra en vivo todas sus VMs)', '                         al terminar: openstack compute service set --enable <nodo> nova-compute', '  Certificado de la API  el renovado está en ~/infra (files/certs); se despliega con playbooks/certs.yml', '  Galera (MariaDB)       un nodo caído se arranca con systemctl start mariadb y se une solo.', '                         galera_new_cluster SÓLO si el clúster entero está parado.', '  Monitores de Ceph      si ceph -s se cuelga, no hay quórum: mira cada monitor en su nodo', '                         con sudo ceph daemon mon.<nodo> mon_status (funciona sin quórum).', '  Restaurar una VM       copias nocturnas en openstack image list (backup-<vm>-<fecha>).', '                         Se restaura en su proyecto: openstack --os-project-name <proyecto> server create ...', '  Usuarios nuevos        rol member en su proyecto; admin sólo para el equipo de plataforma.', '                         Contraseñas con --password-prompt, nunca en la línea de comandos.', '', '## Accesos rápidos', '  source ~/admin-openrc    credenciales de OpenStack (admin)', '  ssh <nodo>               todos los nodos aceptan tu clave; sudo sin contraseña', '  amtool alert             alertas activas', '  ceph -s                  estado de Ceph (desde el bastión o cualquier ceph0X)', '  help                     comandos disponibles en el equipo donde estás'], ['# Retail platform — on-call runbook', '', '## Topology', '  bastion      entry point. Ansible, Terraform and the OpenStack client live here.', '  ctl01..03    OpenStack controllers: API, scheduler, RabbitMQ and Galera. VIP 10.10.1.10', '  cmp01..03    KVM hypervisors (nova-compute + libvirt).', '  cmp04        new hypervisor, racked, waiting to be onboarded.', '  ceph01..03   Ceph Reef: 1 mon + 1 mgr + 3 1.75 TiB SSD OSDs per node. Replica 3, min_size 2.', '  mon01        Prometheus, Alertmanager and Grafana.', '', '## Rules', '  1. Every configuration change goes through Ansible (~/infra/playbooks) or', '     Terraform (~/infra/terraform). Whatever is changed by hand drifts and breaks again.', '  2. Before rebooting a Ceph node: ceph osd set noout. Afterwards: ceph osd unset noout.', '     Better yet: ansible-playbook playbooks/ceph-reboot.yml -l <node>', '     Ceph marks an OSD out after 10 min down; a Ceph node takes ~12 min to come back.', '  3. Do not raise thresholds to silence an alert: fix whatever triggers it.', '  4. Before fixing, find out why it broke. Afterwards, check that it is fixed.', '  5. Leave a trail in the ticket: what you saw, what you did and how you verified it.', '', '## Procedures', '  Drain a hypervisor     openstack compute service set --disable --disable-reason "<reason>" <node> nova-compute', '                         nova host-evacuate-live <node>      (live-migrates all its VMs)', '                         when done: openstack compute service set --enable <node> nova-compute', '  API certificate        the renewed one is in ~/infra (files/certs); deploy it with playbooks/certs.yml', '  Galera (MariaDB)       a node that is down is started with systemctl start mariadb and rejoins on its own.', '                         galera_new_cluster ONLY if the whole cluster is stopped.', '  Ceph monitors          if ceph -s hangs, there is no quorum: check each monitor on its node', '                         with sudo ceph daemon mon.<node> mon_status (works without quorum).', '  Restore a VM           nightly backups in openstack image list (backup-<vm>-<date>).', '                         Restore into its project: openstack --os-project-name <project> server create ...', '  New users              member role in their project; admin only for the platform team.', '                         Passwords with --password-prompt, never on the command line.', '', '## Quick access', '  source ~/admin-openrc    OpenStack credentials (admin)', '  ssh <node>               every node accepts your key; passwordless sudo', '  amtool alert             active alerts', '  ceph -s                  Ceph status (from the bastion or any ceph0X)', '  help                     commands available on the host you are on']);
const OPENRC = ['export OS_AUTH_URL=https://api.retail.local:5000/v3', 'export OS_PROJECT_NAME=admin', 'export OS_USERNAME=admin', 'export OS_PASSWORD=Xq7-retail-2026', 'export OS_USER_DOMAIN_NAME=Default', 'export OS_PROJECT_DOMAIN_NAME=Default', 'export OS_IDENTITY_API_VERSION=3', 'export OS_REGION_NAME=RegionOne', 'export OS_INTERFACE=public'];
const MAIN_TF = ['terraform {', '  required_version = ">= 1.6"', '  required_providers {', '    openstack = {', '      source  = "terraform-provider-openstack/openstack"', '      version = "~> 2.1"', '    }', '  }', '}', '', 'provider "openstack" {', T('  # Credenciales desde el entorno (source ~/admin-openrc)', '  # Credentials from the environment (source ~/admin-openrc)'), '}'];
const SG_TF = [T('# Grupo de seguridad del backend de los TPV de tienda.', '# Security group for the store POS backend.'), T('# Todo lo que no esté aquí no debería existir en OpenStack.', '# Anything not declared here should not exist in OpenStack.'), '', 'resource "openstack_networking_secgroup_v2" "pos_backend" {', '  name        = "sg-pos-backend"', T('  description = "Backend TPV (gestionado por Terraform)"', '  description = "POS backend (managed by Terraform)"'), '  tenant_id   = var.proyecto_tpv', '}', '', T('# HTTPS público: las tiendas llegan por internet.', '# Public HTTPS: the stores come in over the internet.'), '', 'resource "openstack_networking_secgroup_rule_v2" "https_public" {', '  direction         = "ingress"', '  ethertype         = "IPv4"', '  protocol          = "tcp"', '  port_range_min    = 443', '  port_range_max    = 443', '  remote_ip_prefix  = "0.0.0.0/0"', '  security_group_id = openstack_networking_secgroup_v2.pos_backend.id', '}', '', T('# SSH sólo desde la red de administración.', '# SSH only from the management network.'), 'resource "openstack_networking_secgroup_rule_v2" "ssh_admin" {', '  direction         = "ingress"', '  ethertype         = "IPv4"', '  protocol          = "tcp"', '  port_range_min    = 22', '  port_range_max    = 22', '  remote_ip_prefix  = "10.20.0.0/16"', '  security_group_id = openstack_networking_secgroup_v2.pos_backend.id', '}', '', T('# API interna de sincronización, sólo desde la red de TPV.', '# Internal sync API, only from the POS network.'), 'resource "openstack_networking_secgroup_rule_v2" "api_internal" {', '  direction         = "ingress"', '  ethertype         = "IPv4"', '  protocol          = "tcp"', '  port_range_min    = 8443', '  port_range_max    = 8443', '  remote_ip_prefix  = "10.30.0.0/16"', '  security_group_id = openstack_networking_secgroup_v2.pos_backend.id', '}'];
P.ficheros.push((st, h) => {
  if (h.nombre !== 'bastion') return {};
  const f = {}, fijo = arr => ({ lineas: () => arr, mb: arr.join('\n').length / 1048576 });
  f[H + '/RUNBOOK.md'] = fijo(RUNBOOK);
  f[H + '/admin-openrc'] = fijo(OPENRC);
  f[INFRA + '/README.md'] = fijo(['# infra', '', T('playbooks/   Ansible: estado deseado de la flota', 'playbooks/   Ansible: desired state of the fleet'), T('inventory/   quién es quién', 'inventory/   who is who'), T('terraform/   recursos de OpenStack declarados (grupos de seguridad)', 'terraform/   declared OpenStack resources (security groups)'), '', T('Lanza Ansible desde esta carpeta (aquí está ansible.cfg).', 'Run Ansible from this directory (ansible.cfg lives here).')]);
  f[INFRA + '/ansible.cfg'] = fijo(['[defaults]', 'inventory = inventory/hosts.ini', 'remote_user = admin', 'host_key_checking = False', 'forks = 20', '', '[privilege_escalation]', 'become_method = sudo']);
  f[INFRA + '/inventory/hosts.ini'] = fijo(INVENTARIO);
  Object.keys(PB).forEach(k => { f[INFRA + '/playbooks/' + k] = fijo(PB[k].yaml); });
  f[TFDIR + '/main.tf'] = fijo(MAIN_TF);
  f[TFDIR + '/secgroups.tf'] = fijo(SG_TF);
  f[TFDIR + '/variables.tf'] = fijo(['variable "proyecto_tpv" {', T('  description = "ID del proyecto tpv-tiendas"', '  description = "ID of the tpv-tiendas project"'), '  type        = string', '  default     = "' + U.hex('projtpv-tiendas', 32) + '"', '}']);
  return f;
});

})(window.PUESTO = window.PUESTO || {});
