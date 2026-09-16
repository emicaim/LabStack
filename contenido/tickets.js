// Puesto de trabajo: los equipos a los que estás conectado y la cola de tickets.
// Contenido de LabStack — se puede editar sin tocar la lógica de la app.
//
// Cada ticket trae "evidencias": qué contesta un comando concreto en un equipo
// concreto. Esa es la pieza didáctica — el mismo comando dice cosas distintas
// según dónde lo lances, y hay que elegir bien la máquina. Lo que no esté
// declarado aquí cae en la terminal normal y responde como siempre.
//
//   host : en qué equipo hay que lanzarlo
//   cmd  : formas aceptadas del comando (basta con que empiece por una)
//   lines: [texto, color] — out | ok | err | dim
window.LABSTACK = window.LABSTACK || {};

// --- los cuatro equipos del puesto ---
window.LABSTACK.equipos = function () {
  const F = (es, en) => ({ es, en });
  return [
    { id: 'fw01',    name: 'fw01',    cat: 'seguridad',      role: F('Firewall perimetral', 'Edge firewall') },
    { id: 'sw-core', name: 'sw-core', cat: 'red',            role: F('Switch de núcleo', 'Core switch') },
    { id: 'web01',   name: 'web01',   cat: 'so',             role: F('Servidor web', 'Web server') },
    { id: 'db01',    name: 'db01',    cat: 'datos',          role: F('Base de datos', 'Database') },
  ];
};

window.LABSTACK.tickets = function () {
  const F = (es, en) => ({ es, en });
  return [
    {
      id: 'T-1042', prio: 'alta',
      from: F('Marta · Atención al cliente', 'Marta · Customer support'),
      subject: F('La web no carga, da error 502', 'The website is down with a 502'),
      body: F('Los clientes nos están llamando: la web lleva veinte minutos dando error 502. Desde la oficina tampoco entra. No sé si es cosa nuestra o del proveedor.',
              'Customers are calling: the site has been throwing 502 errors for twenty minutes. It does not load from the office either. I do not know if it is us or the provider.'),
      suggest: ['curl -I http://web01', 'systemctl status nginx', 'journalctl -u nginx', 'ss -lntp'],
      evidence: [
        { host: 'web01', cmd: ['systemctl status nginx', 'service nginx status'], lines: [
          ['● nginx.service - A high performance web server', 'out'],
          ['   Loaded: loaded (/lib/systemd/system/nginx.service; enabled)', 'dim'],
          ['   Active: failed (Result: exit-code) desde hace 21min', 'err'],
          ['  Process: 1841 ExecStart=/usr/sbin/nginx (code=exited, status=1/FAILURE)', 'dim'] ] },
        { host: 'web01', cmd: ['journalctl -u nginx', 'journalctl'], lines: [
          ['nginx[1841]: nginx: [emerg] bind() to 0.0.0.0:80 failed', 'err'],
          ['nginx[1841]: (98: Address already in use)', 'err'],
          ['systemd[1]: nginx.service: Failed with result \'exit-code\'.', 'dim'] ] },
        { host: 'web01', cmd: ['ss -lntp', 'netstat -lntp', 'lsof -i :80'], lines: [
          ['State   Local Address:Port    Process', 'dim'],
          ['LISTEN  0.0.0.0:8080          node (pid=2210)', 'out'],
          ['LISTEN  0.0.0.0:80            python3 (pid=2314)  ← ocupa el 80', 'err'] ] },
        { host: 'web01', cmd: ['curl -I http://web01', 'curl -I localhost', 'curl localhost'], lines: [
          ['HTTP/1.1 502 Bad Gateway', 'err'], ['Server: haproxy', 'dim'] ] },
        { host: 'fw01', cmd: ['iptables -L -n', 'ufw status'], lines: [
          ['Chain INPUT (policy DROP)', 'dim'],
          ['ACCEPT  tcp  --  0.0.0.0/0  0.0.0.0/0  tcp dpt:80', 'ok'],
          ['ACCEPT  tcp  --  0.0.0.0/0  0.0.0.0/0  tcp dpt:443', 'ok'],
          ['(el 80 está abierto: el firewall no es el problema)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('Otro proceso se ha quedado con el puerto 80 y nginx no puede arrancar', 'Another process took port 80 so nginx cannot start'), correct: true },
        { id: 'c2', text: F('El firewall está bloqueando el puerto 80', 'The firewall is blocking port 80') },
        { id: 'c3', text: F('La base de datos está caída', 'The database is down') },
        { id: 'c4', text: F('El DNS no resuelve el dominio', 'DNS is not resolving the domain') },
      ],
      fixes: [
        { id: 'f1', text: F('Parar el proceso que ocupa el 80 y arrancar nginx', 'Stop the process holding port 80 and start nginx'), correct: true },
        { id: 'f2', text: F('Abrir el puerto 80 en el firewall', 'Open port 80 on the firewall') },
        { id: 'f3', text: F('Reiniciar el servidor entero y esperar', 'Reboot the whole server and hope') },
      ],
      solved: F('Un script de pruebas se había quedado escuchando en el 80. Al pararlo, nginx arrancó a la primera y la web volvió.',
                'A test script had been left listening on port 80. Once stopped, nginx started first time and the site came back.'),
      lesson: F('«502» dice que el intermediario no encuentra a quien sirve la web, no que la web esté rota. El log del servicio te lleva a la causa en una línea: puerto ocupado.',
                'A 502 says the middleman cannot reach whoever serves the site, not that the site is broken. The service log takes you to the cause in one line: port already in use.'),
    },
    {
      id: 'T-1043', prio: 'alta',
      from: F('Diego · Desarrollo', 'Diego · Development'),
      subject: F('La aplicación no llega a la base de datos', 'The app cannot reach the database'),
      body: F('Desde ayer por la tarde la app da «connection timed out» al conectar con PostgreSQL. Nosotros no hemos tocado nada, y la base de datos parece que está viva.',
              'Since yesterday afternoon the app throws “connection timed out” when connecting to PostgreSQL. We have not changed anything, and the database seems alive.'),
      suggest: ['ping db01', 'psql -h db01', 'ss -lntp', 'iptables -L -n'],
      evidence: [
        { host: 'web01', cmd: ['ping db01', 'ping -c1 db01'], lines: [
          ['PING db01 (10.0.2.20) 56 data bytes', 'out'],
          ['64 bytes from 10.0.2.20: icmp_seq=1 ttl=63 time=0.412 ms', 'ok'],
          ['(llega: no es un problema de red)', 'dim'] ] },
        { host: 'web01', cmd: ['psql -h db01', 'psql'], lines: [
          ['psql: error: connection to server at "db01" (10.0.2.20), port 5432 failed:', 'err'],
          ['        Connection timed out', 'err'],
          ['(«timed out», no «refused»: alguien se está comiendo los paquetes en silencio)', 'dim'] ] },
        { host: 'db01', cmd: ['ss -lntp', 'netstat -lntp'], lines: [
          ['State   Local Address:Port    Process', 'dim'],
          ['LISTEN  0.0.0.0:5432          postgres (pid=903)', 'ok'],
          ['(postgres escucha y acepta de todas partes)', 'dim'] ] },
        { host: 'db01', cmd: ['systemctl status postgresql', 'service postgresql status'], lines: [
          ['● postgresql.service - PostgreSQL RDBMS', 'out'],
          ['   Active: active (running) desde hace 34 días', 'ok'] ] },
        { host: 'fw01', cmd: ['iptables -L -n', 'ufw status'], lines: [
          ['Chain FORWARD (policy ACCEPT)', 'dim'],
          ['DROP    tcp  --  10.0.1.0/24  10.0.2.20  tcp dpt:5432   /* regla nueva ayer 17:40 */', 'err'],
          ['ACCEPT  tcp  --  0.0.0.0/0    0.0.0.0/0  tcp dpt:443', 'ok'] ] },
      ],
      causes: [
        { id: 'c1', text: F('Una regla nueva del firewall bloquea el 5432 desde la red de aplicación', 'A new firewall rule blocks 5432 from the app network'), correct: true },
        { id: 'c2', text: F('PostgreSQL está caído', 'PostgreSQL is down') },
        { id: 'c3', text: F('El servidor de aplicación ha perdido la red', 'The app server lost network connectivity') },
        { id: 'c4', text: F('A db01 se le ha llenado el disco', 'db01 ran out of disk') },
      ],
      fixes: [
        { id: 'f1', text: F('Permitir el 5432 sólo desde la red de aplicación y documentar la regla', 'Allow 5432 only from the app network and document the rule'), correct: true },
        { id: 'f2', text: F('Quitar todas las reglas del firewall', 'Flush every firewall rule') },
        { id: 'f3', text: F('Reiniciar PostgreSQL', 'Restart PostgreSQL') },
      ],
      solved: F('Un cambio de la noche anterior había metido una regla que tiraba el tráfico al 5432. Se sustituyó por una que permite sólo la red de aplicación.',
                'A change the night before had added a rule dropping traffic to 5432. It was replaced by one that allows only the app network.'),
      lesson: F('«Refused» es que nadie escucha; «timed out» es que alguien se traga los paquetes por el camino. Esa palabra ya te dice si mirar el servicio o el firewall.',
                '“Refused” means nobody is listening; “timed out” means something is swallowing the packets on the way. That word alone tells you whether to look at the service or the firewall.'),
    },
    {
      id: 'T-1044', prio: 'critica',
      from: F('Lucía · Administración', 'Lucía · Admin'),
      subject: F('Media planta 2 se ha quedado sin red', 'Half of floor 2 has no network'),
      body: F('Esta mañana al llegar, media planta no tiene red. Los cables están enchufados. En el armario, las luces de una fila entera del switch están apagadas.',
              'This morning half the floor has no network. The cables are plugged in. In the rack, the lights of a whole row on the switch are off.'),
      suggest: ['ip -br link', 'ethtool gi0/12', 'arp -a', 'dmesg'],
      evidence: [
        { host: 'sw-core', cmd: ['ip -br link', 'ip link', 'ifconfig'], lines: [
          ['gi0/01   UP     10.0.1.1/24', 'ok'],
          ['gi0/10   UP     ---', 'ok'],
          ['gi0/12   DOWN   ---   ← fila de planta 2', 'err'],
          ['gi0/13   DOWN   ---', 'err'],
          ['gi0/14   DOWN   ---', 'err'] ] },
        { host: 'sw-core', cmd: ['ethtool gi0/12', 'ethtool'], lines: [
          ['Settings for gi0/12:', 'out'],
          ['        Speed: Unknown!', 'dim'],
          ['        Link detected: no', 'err'],
          ['        Port state: administratively down  ← lo apagó alguien', 'err'] ] },
        { host: 'sw-core', cmd: ['dmesg', 'journalctl'], lines: [
          ['[ayer 19:02] mgmt: user=backup cmd="interface range gi0/12-14 / shutdown"', 'err'],
          ['[ayer 19:02] link gi0/12 gi0/13 gi0/14 state DOWN', 'dim'] ] },
        { host: 'sw-core', cmd: ['arp -a'], lines: [
          ['10.0.1.10  aa:bb:cc:00:11:22  gi0/01', 'out'],
          ['(ninguna entrada de la planta 2: no llegan ni a pedir IP)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('Alguien desactivó esos puertos del switch por error', 'Someone disabled those switch ports by mistake'), correct: true },
        { id: 'c2', text: F('Se han roto los cables de esa fila', 'The cables in that row are broken') },
        { id: 'c3', text: F('El servidor DHCP se ha quedado sin direcciones', 'The DHCP server ran out of addresses') },
        { id: 'c4', text: F('La base de datos está saturada', 'The database is overloaded') },
      ],
      fixes: [
        { id: 'f1', text: F('Reactivar los puertos y revisar quién tiene permiso de configuración', 'Re-enable the ports and review who has config access'), correct: true },
        { id: 'f2', text: F('Cambiar todos los cables de la planta', 'Replace every cable on the floor') },
        { id: 'f3', text: F('Reiniciar el switch entero en horario de oficina', 'Reboot the whole switch during office hours') },
      ],
      solved: F('Un script de respaldo mal parametrizado había apagado el rango gi0/12-14 la noche anterior. Al reactivarlos, la planta volvió en segundos.',
                'A badly parameterised backup script had shut down the gi0/12-14 range the night before. Re-enabling them brought the floor back in seconds.'),
      lesson: F('Antes de culpar al cable, mira si el puerto está «administratively down»: eso no lo hace una avería, lo hace una persona o un script. El registro te dice quién.',
                'Before blaming the cable, check whether the port is “administratively down”: that is not a fault, that is a person or a script. The log tells you who.'),
    },
    {
      id: 'T-1045', prio: 'media',
      from: F('Aviso automático · Zabbix', 'Automatic alert · Zabbix'),
      subject: F('A db01 le queda poco disco en /var', 'db01 is running low on disk in /var'),
      body: F('AVISO: /var al 96% en db01. Si llega al 100%, PostgreSQL deja de aceptar escrituras y la aplicación se cae entera.',
              'ALERT: /var at 96% on db01. If it hits 100%, PostgreSQL stops accepting writes and the whole app goes down.'),
      suggest: ['df -h', 'du -sh /var/log', 'ls -la /var/log', 'journalctl --disk-usage'],
      evidence: [
        { host: 'db01', cmd: ['df -h', 'df'], lines: [
          ['Filesystem      Size  Used Avail Use% Mounted on', 'dim'],
          ['/dev/sda1        50G   12G   36G  26% /', 'out'],
          ['/dev/sda2       200G  190G  8.0G  96% /var', 'err'] ] },
        { host: 'db01', cmd: ['du -sh /var/log', 'du -sh /var', 'du'], lines: [
          ['68G     /var/log', 'err'],
          ['121G    /var/lib/postgresql', 'out'],
          ['(los logs se han comido un tercio del disco)', 'dim'] ] },
        { host: 'db01', cmd: ['ls -la /var/log', 'ls /var/log'], lines: [
          ['-rw-r-----  41G  postgresql-2026.log      ← sin rotar desde enero', 'err'],
          ['-rw-r-----  27G  postgresql-slow.log', 'err'],
          ['-rw-r--r--  12M  syslog', 'out'] ] },
        { host: 'db01', cmd: ['systemctl status postgresql', 'service postgresql status'], lines: [
          ['● postgresql.service - PostgreSQL RDBMS', 'out'],
          ['   Active: active (running) — todavía acepta escrituras', 'ok'] ] },
      ],
      causes: [
        { id: 'c1', text: F('Los logs no rotan y llevan meses creciendo sin parar', 'Logs are not rotating and have grown for months'), correct: true },
        { id: 'c2', text: F('La base de datos ha crecido más de lo previsto', 'The database grew more than expected') },
        { id: 'c3', text: F('El backup está dejando copias en el disco local', 'Backups are piling up on the local disk') },
        { id: 'c4', text: F('Falta memoria RAM en db01', 'db01 is short on RAM') },
      ],
      fixes: [
        { id: 'f1', text: F('Rotar y comprimir los logs, y dejar logrotate activado', 'Rotate and compress the logs, and leave logrotate enabled'), correct: true },
        { id: 'f2', text: F('Borrar /var/lib/postgresql para hacer sitio', 'Delete /var/lib/postgresql to free space') },
        { id: 'f3', text: F('Añadir disco y no tocar nada más', 'Add disk and change nothing else') },
      ],
      solved: F('Los dos logs enormes se rotaron y comprimieron, y se activó logrotate con retención de 14 días. /var bajó al 31% y dejó de crecer.',
                'Both huge logs were rotated and compressed, and logrotate was enabled with 14-day retention. /var dropped to 31% and stopped growing.'),
      lesson: F('Añadir disco calla el aviso pero no arregla nada: dentro de unos meses vuelve. El arreglo bueno es el que hace que no pueda repetirse.',
                'Adding disk silences the alert but fixes nothing: it comes back in a few months. The good fix is the one that stops it happening again.'),
    },
    {
      id: 'T-1046', prio: 'baja',
      from: F('Javier · Comercial', 'Javier · Sales'),
      subject: F('La VPN va lentísima a primera hora', 'The VPN crawls first thing in the morning'),
      body: F('Cuando me conecto por VPN entre las 8 y las 10 va a tirones y se me cae la videollamada. Por la tarde va perfecta. Llevo así dos semanas.',
              'When I connect over VPN between 8 and 10 it stutters and my calls drop. In the afternoon it is perfect. Two weeks like this.'),
      suggest: ['uptime', 'top', 'nproc', 'vmstat'],
      evidence: [
        { host: 'fw01', cmd: ['uptime', 'w'], lines: [
          ['09:14:02 up 92 days,  load average: 7.82, 6.40, 3.10', 'err'],
          ['(con 4 núcleos, una carga de 7.8 es el doble de lo que aguanta)', 'dim'] ] },
        { host: 'fw01', cmd: ['top', 'htop', 'ps'], lines: [
          ['  PID USER      %CPU  COMMAND', 'dim'],
          ['  812 root     382.4  openvpn --config corp.conf', 'err'],
          ['  903 root       4.1  iptables-restore', 'out'] ] },
        { host: 'fw01', cmd: ['nproc', 'lscpu'], lines: [['4', 'out'], ['(4 vCPU para cifrar todo el tráfico de la empresa)', 'dim']] },
        { host: 'fw01', cmd: ['vmstat', 'free'], lines: [
          ['procs -----------memory----------  -----cpu-----', 'dim'],
          ['  8  0   1240336  512000  2104320   us 94  sy 5  id 1', 'err'],
          ['(la CPU está al 99%, la memoria sobra: no es falta de RAM)', 'dim'] ] },
        { host: 'sw-core', cmd: ['ip -br link', 'ethtool gi0/01'], lines: [
          ['gi0/01   UP   1000Mb/s full duplex   utilización 22%', 'ok'],
          ['(la línea va holgada: el cuello no está en la red)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('El firewall se queda sin CPU cifrando la VPN en hora punta', 'The firewall runs out of CPU encrypting VPN traffic at peak time'), correct: true },
        { id: 'c2', text: F('La línea de internet está saturada por las mañanas', 'The internet line is saturated in the mornings') },
        { id: 'c3', text: F('Falta memoria RAM en el firewall', 'The firewall is short on RAM') },
        { id: 'c4', text: F('El servidor web está sobrecargado', 'The web server is overloaded') },
      ],
      fixes: [
        { id: 'f1', text: F('Activar la aceleración de cifrado por hardware y ampliar vCPU en fw01', 'Enable hardware crypto offload and add vCPU to fw01'), correct: true },
        { id: 'f2', text: F('Pedir a la gente que no se conecte por la mañana', 'Ask people not to connect in the morning') },
        { id: 'f3', text: F('Reiniciar la VPN cada día a las 8', 'Restart the VPN every day at 8') },
      ],
      solved: F('El cifrado iba por software con 4 vCPU. Se activó la aceleración por hardware y se subió a 8 vCPU: la carga de la mañana bajó de 7.8 a 1.9.',
                'Encryption was running in software on 4 vCPU. Hardware offload was enabled and it went to 8 vCPU: the morning load dropped from 7.8 to 1.9.'),
      lesson: F('«Va lento a ciertas horas» casi siempre es un recurso que se agota cuando sube la demanda. Mira la carga en hora punta, no cuando está tranquilo.',
                '“It is slow at certain times” is almost always a resource running out when demand rises. Measure at peak, not when it is quiet.'),
    },
  ];
};
