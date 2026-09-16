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
          ['  Process: 1841 ExecStart=/usr/sbin/nginx (code=exited, status=1/FAILURE)', 'dim'] ],
          fixed: [
            ["● nginx.service - A high performance web server", 'out'],
            ["   Loaded: loaded (/lib/systemd/system/nginx.service; enabled)", 'dim'],
            ["   Active: active (running) desde hace 2min", 'ok'],
            ["  Process: 6021 ExecStart=/usr/sbin/nginx (code=exited, status=0/SUCCESS)", 'dim'] ] },
        { host: 'web01', cmd: ['journalctl -u nginx', 'journalctl'], lines: [
          ['nginx[1841]: nginx: [emerg] bind() to 0.0.0.0:80 failed', 'err'],
          ['nginx[1841]: (98: Address already in use)', 'err'],
          ['systemd[1]: nginx.service: Failed with result \'exit-code\'.', 'dim'] ],
          fixed: [
            ["systemd[1]: Starting A high performance web server...", 'dim'],
            ["systemd[1]: Started A high performance web server.", 'ok'],
            ["(sin errores desde el arranque)", 'dim'] ] },
        { host: 'web01', cmd: ['ss -lntp', 'netstat -lntp', 'lsof -i :80'], lines: [
          ['State   Local Address:Port    Process', 'dim'],
          ['LISTEN  0.0.0.0:8080          node (pid=2210)', 'out'],
          ['LISTEN  0.0.0.0:80            python3 (pid=2314)  ← ocupa el 80', 'err'] ],
          fixed: [
            ["State   Local Address:Port    Process", 'dim'],
            ["LISTEN  0.0.0.0:80            nginx (pid=6021)", 'ok'],
            ["LISTEN  0.0.0.0:8080          node (pid=2210)", 'out'] ] },
        { host: 'web01', cmd: ['curl -I http://web01', 'curl -I localhost', 'curl localhost'], lines: [
          ['HTTP/1.1 502 Bad Gateway', 'err'], ['Server: haproxy', 'dim'] ],
          fixed: [
            ["HTTP/1.1 200 OK", 'ok'],
            ["Server: nginx", 'dim'] ] },
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
          ['(«timed out», no «refused»: alguien se está comiendo los paquetes en silencio)', 'dim'] ],
          fixed: [
            ["psql (16.2)  Type \"help\" for help.", 'ok'],
            ["labdb=# ", 'out'],
            ["(conecta a la primera)", 'dim'] ] },
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
          ['ACCEPT  tcp  --  0.0.0.0/0    0.0.0.0/0  tcp dpt:443', 'ok'] ],
          fixed: [
            ["Chain FORWARD (policy ACCEPT)", 'dim'],
            ["ACCEPT  tcp  --  10.0.1.0/24  10.0.2.20  tcp dpt:5432   /* app -> bd, documentada */", 'ok'],
            ["ACCEPT  tcp  --  0.0.0.0/0    0.0.0.0/0  tcp dpt:443", 'ok'] ] },
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
          ['gi0/14   DOWN   ---', 'err'] ],
          fixed: [
            ["gi0/01   UP     10.0.1.1/24", 'ok'],
            ["gi0/12   UP     ---   ← planta 2 de vuelta", 'ok'],
            ["gi0/13   UP     ---", 'ok'],
            ["gi0/14   UP     ---", 'ok'] ] },
        { host: 'sw-core', cmd: ['ethtool gi0/12', 'ethtool'], lines: [
          ['Settings for gi0/12:', 'out'],
          ['        Speed: Unknown!', 'dim'],
          ['        Link detected: no', 'err'],
          ['        Port state: administratively down  ← lo apagó alguien', 'err'] ],
          fixed: [
            ["Settings for gi0/12:", 'out'],
            ["        Speed: 1000Mb/s", 'ok'],
            ["        Link detected: yes", 'ok'],
            ["        Port state: up", 'ok'] ] },
        { host: 'sw-core', cmd: ['dmesg', 'journalctl'], lines: [
          ['[ayer 19:02] mgmt: user=backup cmd="interface range gi0/12-14 / shutdown"', 'err'],
          ['[ayer 19:02] link gi0/12 gi0/13 gi0/14 state DOWN', 'dim'] ],
          fixed: [
            ["[hoy 10:05] mgmt: user=tu cmd=\"interface range gi0/12-14 / no shutdown\"", 'ok'],
            ["[hoy 10:05] link gi0/12 gi0/13 gi0/14 state UP", 'ok'] ] },
        { host: 'sw-core', cmd: ['arp -a'], lines: [
          ['10.0.1.10  aa:bb:cc:00:11:22  gi0/01', 'out'],
          ['(ninguna entrada de la planta 2: no llegan ni a pedir IP)', 'dim'] ] },
        { host: 'web01', cmd: ['ping 10.0.1.60', 'ping -c1 10.0.1.60', 'ip -br link'], lines: [
          ['PING 10.0.1.60 (10.0.1.60) 56 data bytes', 'out'],
          ['Request timeout for icmp_seq=1', 'err'],
          ['eth0   UP   10.0.1.10/24   ← este servidor tiene su enlace bien', 'ok'],
          ['(el servidor está sano; lo que no llega es el camino hasta la planta 2)', 'dim'] ],
          fixed: [
            ["PING 10.0.1.60 (10.0.1.60) 56 data bytes", 'out'],
            ["64 bytes from 10.0.1.60: icmp_seq=1 ttl=63 time=0.51 ms", 'ok'],
            ["eth0   UP   10.0.1.10/24", 'ok'] ] },
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
          ['/dev/sda2       200G  190G  8.0G  96% /var', 'err'] ],
          fixed: [
            ["Filesystem      Size  Used Avail Use% Mounted on", 'dim'],
            ["/dev/sda1        50G   12G   36G  26% /", 'out'],
            ["/dev/sda2       200G   62G  138G  31% /var", 'ok'] ] },
        { host: 'db01', cmd: ['du -sh /var/log', 'du -sh /var', 'du'], lines: [
          ['68G     /var/log', 'err'],
          ['121G    /var/lib/postgresql', 'out'],
          ['(los logs se han comido un tercio del disco)', 'dim'] ],
          fixed: [
            ["2,1G    /var/log", 'ok'],
            ["121G    /var/lib/postgresql", 'out'],
            ["(los registros vuelven a un tamaño normal)", 'dim'] ] },
        { host: 'db01', cmd: ['ls -la /var/log', 'ls /var/log'], lines: [
          ['-rw-r-----  41G  postgresql-2026.log      ← sin rotar desde enero', 'err'],
          ['-rw-r-----  27G  postgresql-slow.log', 'err'],
          ['-rw-r--r--  12M  syslog', 'out'] ],
          fixed: [
            ["-rw-r-----  1,2G  postgresql.log", 'ok'],
            ["-rw-r-----  340M  postgresql.log.1.gz", 'ok'],
            ["-rw-r-----  312M  postgresql.log.2.gz", 'ok'],
            ["(logrotate activo, 14 días de retención)", 'dim'] ] },
        { host: 'db01', cmd: ['systemctl status postgresql', 'service postgresql status'], lines: [
          ['● postgresql.service - PostgreSQL RDBMS', 'out'],
          ['   Active: active (running) — todavía acepta escrituras', 'ok'] ] },
        { host: 'web01', cmd: ['curl -I http://web01', 'curl localhost', 'uptime'], lines: [
          ['HTTP/1.1 200 OK', 'ok'],
          ['load average: 0.40, 0.38, 0.35', 'out'],
          ['(la aplicación va perfectamente: este aviso llega ANTES de que se rompa nada,', 'dim'],
          [' que es justo para lo que sirve vigilar)', 'dim'] ] },
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
          ['(con 4 núcleos, una carga de 7.8 es el doble de lo que aguanta)', 'dim'] ],
          fixed: [
            ["09:14:02 up 92 días,  load average: 1.92, 2.10, 2.40", 'ok'],
            ["(con 8 núcleos, esa carga va holgada)", 'dim'] ] },
        { host: 'fw01', cmd: ['top', 'htop', 'ps'], lines: [
          ['  PID USER      %CPU  COMMAND', 'dim'],
          ['  812 root     382.4  openvpn --config corp.conf', 'err'],
          ['  903 root       4.1  iptables-restore', 'out'] ],
          fixed: [
            ["  PID USER      %CPU  COMMAND", 'dim'],
            ["  812 root      96.2  openvpn --config corp.conf", 'ok'],
            ["  903 root       3.8  iptables-restore", 'out'] ] },
        { host: 'fw01', cmd: ['nproc', 'lscpu'], lines: [['4', 'out'], ['(4 vCPU para cifrar todo el tráfico de la empresa)', 'dim']] },
        { host: 'fw01', cmd: ['vmstat', 'free'], lines: [
          ['procs -----------memory----------  -----cpu-----', 'dim'],
          ['  8  0   1240336  512000  2104320   us 94  sy 5  id 1', 'err'],
          ['(la CPU está al 99%, la memoria sobra: no es falta de RAM)', 'dim'] ],
          fixed: [
            ["procs -----------memory----------  -----cpu-----", 'dim'],
            ["  1  0   1240336  512000  2104320   us 41  sy 6  id 53", 'ok'],
            ["(la CPU respira: el cifrado ya no la monopoliza)", 'dim'] ] },
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
    {
      id: 'T-1047', prio: 'critica',
      from: F('Marta · Atención al cliente', 'Marta · Customer support'),
      subject: F('Chrome dice que la web no es segura', 'Chrome says the site is not secure'),
      body: F('Los clientes ven un aviso rojo enorme al entrar y muchos ni pasan. Uno me ha mandado una captura: pone algo de un certificado.',
              'Customers see a huge red warning and many do not go through. One sent me a screenshot: something about a certificate.'),
      suggest: ['curl -I https://web01', 'openssl s_client', 'date', 'ls -la /etc/letsencrypt'],
      evidence: [
        { host: 'web01', cmd: ['openssl s_client', 'curl -I https://web01', 'curl https://web01'], lines: [
          ['subject=CN = tienda.empresa.com', 'out'],
          ['notAfter=Aug 14 09:12:00 2026 GMT', 'err'],
          ['Verify return code: 10 (certificate has expired)  ← caducó hace 33 días', 'err'] ],
          fixed: [
            ["subject=CN = tienda.empresa.com", 'out'],
            ["notAfter=Dec 15 09:12:00 2026 GMT", 'ok'],
            ["Verify return code: 0 (ok)", 'ok'] ] },
        { host: 'web01', cmd: ['date'], lines: [
          ['lun 16 sep 2026 09:41:02 CEST', 'out'],
          ['(la fecha del servidor es correcta: no es el reloj)', 'dim'] ] },
        { host: 'web01', cmd: ['ls -la /etc/letsencrypt', 'ls /etc/letsencrypt', 'systemctl status certbot'], lines: [
          ['● certbot.timer - Run certbot twice daily', 'out'],
          ['   Active: failed — el temporizador lleva 3 meses sin ejecutarse', 'err'],
          ['-rw-r--r--  fullchain.pem   emitido el 16 may 2026', 'dim'] ],
          fixed: [
            ["● certbot.timer - Run certbot twice daily", 'out'],
            ["   Active: active (waiting) — próxima ejecución en 8h", 'ok'],
            ["-rw-r--r--  fullchain.pem   emitido hoy", 'ok'] ] },
        { host: 'fw01', cmd: ['iptables -L -n', 'ufw status'], lines: [
          ['ACCEPT  tcp  --  0.0.0.0/0  0.0.0.0/0  tcp dpt:443', 'ok'],
          ['(el 443 está abierto y llega tráfico: el firewall no pinta nada aquí)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('El certificado caducó porque la renovación automática lleva meses fallando', 'The certificate expired because auto-renewal has been failing for months'), correct: true },
        { id: 'c2', text: F('El reloj del servidor está desajustado', 'The server clock is out of sync') },
        { id: 'c3', text: F('El firewall bloquea el puerto 443', 'The firewall is blocking port 443') },
        { id: 'c4', text: F('El DNS apunta a la máquina equivocada', 'DNS points at the wrong machine') },
      ],
      fixes: [
        { id: 'f1', text: F('Renovar el certificado y dejar el temporizador funcionando y vigilado', 'Renew the certificate and get the timer working and monitored'), correct: true },
        { id: 'f2', text: F('Avisar a los clientes de que acepten el aviso del navegador', 'Tell customers to click through the browser warning') },
        { id: 'f3', text: F('Servir la web por HTTP mientras tanto', 'Serve the site over plain HTTP for now') },
      ],
      solved: F('El temporizador de renovación estaba en «failed» desde mayo y nadie lo miraba. Se renovó el certificado, se reactivó el temporizador y se añadió un aviso a 20 días de la caducidad.',
                'The renewal timer had been failing since May and nobody was watching it. The certificate was renewed, the timer re-enabled and an alert added 20 days before expiry.'),
      lesson: F('Un certificado caduca en una fecha conocida: que te pille por sorpresa no es mala suerte, es que nadie vigilaba la renovación. Lo que se renueva solo también hay que mirarlo.',
                'A certificate expires on a date you know in advance: being caught out is not bad luck, it means nobody was watching the renewal. Things that renew themselves still need watching.'),
    },
    {
      id: 'T-1048', prio: 'critica',
      from: F('Lucía · Administración', 'Lucía · Admin'),
      subject: F('Todo el edificio va a trompicones', 'The whole building is stuttering'),
      body: F('La red se corta y vuelve cada pocos segundos, en todas las plantas. Empezó justo después de que un compañero estuviera enchufando cables en la sala de reuniones.',
              'The network drops and comes back every few seconds, on every floor. It started right after a colleague was plugging cables in the meeting room.'),
      suggest: ['ip -s link', 'dmesg', 'arp -a', 'uptime'],
      evidence: [
        { host: 'sw-core', cmd: ['ip -s link', 'ip -s', 'netstat -i'], lines: [
          ['gi0/22   RX broadcast 48.912.334   (hace 20 min: 1.204)', 'err'],
          ['gi0/23   RX broadcast 48.910.877   (hace 20 min: 1.198)', 'err'],
          ['gi0/01   RX broadcast 2.410', 'out'],
          ['(dos bocas con millones de broadcast: algo se está repitiendo solo)', 'dim'] ],
          fixed: [
            ["gi0/22   RX broadcast 1.284", 'ok'],
            ["gi0/23   RX broadcast 1.271", 'ok'],
            ["gi0/01   RX broadcast 2.455", 'ok'],
            ["(los contadores vuelven a cifras normales)", 'dim'] ] },
        { host: 'sw-core', cmd: ['dmesg', 'journalctl'], lines: [
          ['[09:22:14] LOOP DETECT: trama propia recibida de vuelta por gi0/23', 'err'],
          ['[09:22:14] gi0/22 <-> gi0/23 forman un bucle de capa 2', 'err'] ],
          fixed: [
            ["[hoy 09:31] gi0/23 link down (cable retirado)", 'out'],
            ["[hoy 09:32] loop-guard habilitado en las bocas de usuario", 'ok'],
            ["(sin detecciones de bucle desde entonces)", 'dim'] ] },
        { host: 'web01', cmd: ['uptime', 'top', 'w'], lines: [
          ['09:41:02 up 61 días,  load average: 0.31, 0.28, 0.25', 'ok'],
          ['(el servidor está tranquilo: no es carga, es la red)', 'dim'] ] },
        { host: 'fw01', cmd: ['top', 'uptime', 'vmstat'], lines: [
          ['load average: 0.44, 0.40, 0.39 — CPU al 6%', 'ok'],
          ['(el firewall tampoco está sufriendo)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('Hay un bucle: dos bocas del switch están unidas por un cable', 'There is a loop: two switch ports are joined by a cable'), correct: true },
        { id: 'c2', text: F('El servidor web está saturado y no responde', 'The web server is overloaded') },
        { id: 'c3', text: F('La línea de internet se ha quedado corta', 'The internet line is too small now') },
        { id: 'c4', text: F('Hay un virus mandando tráfico desde un portátil', 'A laptop is infected and flooding traffic') },
      ],
      fixes: [
        { id: 'f1', text: F('Quitar el cable del bucle y activar la protección contra bucles en los puertos de usuario', 'Remove the looping cable and enable loop protection on user ports'), correct: true },
        { id: 'f2', text: F('Reiniciar el switch y ver si se arregla', 'Reboot the switch and see if it clears') },
        { id: 'f3', text: F('Contratar más ancho de banda', 'Buy more bandwidth') },
      ],
      solved: F('En la sala de reuniones habían enchufado los dos extremos de un latiguillo a la misma roseta doble. Al quitarlo, la red se estabilizó en el acto; después se activó la protección contra bucles para que no vuelva a pasar.',
                'In the meeting room both ends of a patch lead had been plugged into the same double socket. Removing it settled the network instantly; loop protection was then enabled so it cannot happen again.'),
      lesson: F('Un bucle de capa 2 no rompe nada: repite las tramas hasta ahogar la red. Por eso «va lento en todas partes a la vez» apunta a la red, no a los servidores — y los contadores de broadcast lo cantan.',
                'A layer-2 loop breaks nothing: it repeats frames until the network drowns. That is why “everything is slow everywhere at once” points at the network, not the servers — and the broadcast counters say it out loud.'),
    },
    {
      id: 'T-1049', prio: 'alta',
      from: F('Diego · Desarrollo', 'Diego · Development'),
      subject: F('La aplicación se cierra sola cada pocas horas', 'The app dies on its own every few hours'),
      body: F('Se cae sin dejar ningún error en nuestros logs, vuelve sola y al rato otra vez. No coincide con ningún despliegue.',
              'It dies leaving no error in our logs, comes back on its own and then does it again. It does not line up with any deploy.'),
      suggest: ['dmesg', 'free -h', 'systemctl status', 'vmstat'],
      evidence: [
        { host: 'web01', cmd: ['dmesg', 'journalctl -k'], lines: [
          ['[08:14:02] Out of memory: Killed process 4412 (java) total-vm:6291456kB', 'err'],
          ['[11:47:51] Out of memory: Killed process 5108 (java) total-vm:6288900kB', 'err'],
          ['(no se cae: el propio sistema lo está matando por falta de memoria)', 'dim'] ],
          fixed: [
            ["[hoy 10:12] cgroup: límite de memoria fijado para app.service (3G)", 'ok'],
            ["(ninguna muerte por falta de memoria desde el cambio)", 'dim'] ] },
        { host: 'web01', cmd: ['free -h', 'free'], lines: [
          ['               total        used        free', 'dim'],
          ['Mem:            3,8Gi       3,6Gi       112Mi', 'err'],
          ['Swap:              0B          0B          0B  ← sin swap', 'err'] ],
          fixed: [
            ["               total        used        free", 'dim'],
            ["Mem:            7,8Gi       4,1Gi       3,1Gi", 'ok'],
            ["Swap:           2,0Gi          0B       2,0Gi", 'ok'] ] },
        { host: 'web01', cmd: ['systemctl status', 'service status', 'ps'], lines: [
          ['● app.service - Tienda', 'out'],
          ['   Active: active (running) desde hace 41 min', 'out'],
          ['   (se ha reiniciado 6 veces hoy)', 'err'] ],
          fixed: [
            ["● app.service - Tienda", 'out'],
            ["   Active: active (running) desde hace 6h", 'ok'],
            ["   (0 reinicios desde el arreglo)", 'ok'] ] },
        { host: 'db01', cmd: ['free -h', 'free', 'uptime'], lines: [
          ['Mem:           15Gi        6,1Gi       8,4Gi', 'ok'],
          ['(a la base de datos le sobra memoria: el problema no está aquí)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('El sistema mata el proceso porque se queda sin memoria', 'The kernel kills the process because it runs out of memory'), correct: true },
        { id: 'c2', text: F('Se ha llenado el disco del servidor', 'The server disk filled up') },
        { id: 'c3', text: F('La base de datos cierra las conexiones', 'The database closes the connections') },
        { id: 'c4', text: F('El firewall corta las sesiones largas', 'The firewall kills long sessions') },
      ],
      fixes: [
        { id: 'f1', text: F('Ampliar memoria, poner un límite al proceso y buscar la fuga con un aviso por consumo', 'Add memory, cap the process and hunt the leak with a memory alert'), correct: true },
        { id: 'f2', text: F('Programar un reinicio de la aplicación cada hora', 'Schedule an app restart every hour') },
        { id: 'f3', text: F('Desactivar el mecanismo del sistema que mata procesos', 'Disable the kernel mechanism that kills processes') },
      ],
      solved: F('El registro del sistema tenía el motivo desde el primer día: la aplicación pedía más memoria de la que había. Se le subió la memoria, se le puso un límite propio y se añadió un aviso al 85% mientras Desarrollo busca la fuga.',
                'The kernel log had the reason from day one: the app asked for more memory than the box had. Memory was raised, a per-process limit set, and an alert at 85% added while Development hunts the leak.'),
      lesson: F('Si un proceso desaparece sin dejar error suyo, mira el registro del sistema: lo más probable es que no se haya caído, sino que lo hayan matado. Reiniciarlo cada hora esconde el problema y deja la fuga intacta.',
                'When a process vanishes without an error of its own, check the kernel log: it probably did not crash, it was killed. Restarting it hourly hides the problem and leaves the leak untouched.'),
    },
    {
      id: 'T-1050', prio: 'alta',
      from: F('Javier · Comercial', 'Javier · Sales'),
      subject: F('No se abre la intranet por su nombre', 'The intranet will not open by name'),
      body: F('Escribo intranet.empresa.local y no carga desde ningún portátil. Si pongo la dirección con números sí entra, así que la intranet funciona.',
              'I type intranet.empresa.local and it does not load on any laptop. If I type the numeric address it works, so the intranet itself is fine.'),
      suggest: ['nslookup intranet.empresa.local', 'ping 10.0.2.30', 'ss -lntp', 'ip -br link'],
      evidence: [
        { host: 'web01', cmd: ['nslookup intranet.empresa.local', 'nslookup', 'dig'], lines: [
          ['Server:  10.0.1.2', 'dim'],
          ['** server can\'t find intranet.empresa.local: SERVFAIL', 'err'],
          ['(el nombre no se resuelve; la máquina que debería contestar es 10.0.1.2)', 'dim'] ],
          fixed: [
            ["Server:  10.0.1.2", 'dim'],
            ["Name:    intranet.empresa.local", 'ok'],
            ["Address: 10.0.2.30", 'ok'] ] },
        { host: 'web01', cmd: ['ping 10.0.2.30', 'ping -c1 10.0.2.30', 'curl 10.0.2.30'], lines: [
          ['64 bytes from 10.0.2.30: icmp_seq=1 ttl=63 time=0.388 ms', 'ok'],
          ['(por número llega perfectamente: la intranet está viva y la red también)', 'dim'] ] },
        { host: 'fw01', cmd: ['ss -lntp', 'netstat -lntp', 'systemctl status dnsmasq'], lines: [
          ['● dnsmasq.service - DNS interno', 'out'],
          ['   Active: inactive (dead) desde el reinicio de anoche', 'err'],
          ['   Loaded: loaded (disabled)  ← no arranca solo al encender', 'err'] ],
          fixed: [
            ["● dnsmasq.service - DNS interno", 'out'],
            ["   Active: active (running) desde hace 12min", 'ok'],
            ["   Loaded: loaded (enabled)  ← ya arranca solo", 'ok'] ] },
        { host: 'sw-core', cmd: ['ip -br link', 'ip link', 'arp -a'], lines: [
          ['gi0/01   UP     1000Mb/s', 'ok'],
          ['gi0/12   UP     1000Mb/s', 'ok'],
          ['(todos los puertos arriba: no es la electrónica de red)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('El servicio de DNS interno está parado y no arranca al encender', 'The internal DNS service is stopped and does not start at boot'), correct: true },
        { id: 'c2', text: F('Los portátiles tienen mal configurada la red', 'The laptops have the wrong network settings') },
        { id: 'c3', text: F('La intranet está caída', 'The intranet is down') },
        { id: 'c4', text: F('Hay un problema de cableado en la planta', 'There is a cabling problem on the floor') },
      ],
      fixes: [
        { id: 'f1', text: F('Arrancar el DNS, dejarlo habilitado al inicio y añadir un segundo servidor', 'Start DNS, enable it at boot and add a second server'), correct: true },
        { id: 'f2', text: F('Poner la dirección a mano en el fichero de cada portátil', 'Hard-code the address on every laptop') },
        { id: 'f3', text: F('Reiniciar todos los portátiles', 'Reboot every laptop') },
      ],
      solved: F('El servicio de DNS no estaba habilitado al arranque y se quedó parado tras el reinicio de la noche. Se arrancó, se habilitó y se levantó un segundo servidor para que no dependa de una sola máquina.',
                'The DNS service was not enabled at boot and stayed down after the night reboot. It was started, enabled, and a second server brought up so it does not hang on one box.'),
      lesson: F('«Por IP sí, por nombre no» es la firma del DNS: ya has descartado la red y el servicio de destino sin tocarlos. Y un servicio que funciona pero no está habilitado al arranque es una avería con fecha de caducidad.',
                '“Works by IP, not by name” is the signature of DNS: you have already ruled out the network and the target service without touching them. And a service that runs but is not enabled at boot is an outage waiting for a reboot.'),
    },
    {
      id: 'T-1051', prio: 'media',
      from: F('Aviso automático · Veeam', 'Automatic alert · Veeam'),
      subject: F('La prueba de restauración ha fallado', 'The restore test failed'),
      body: F('El trabajo de copia termina en verde todas las noches desde hace meses, pero la prueba de restauración de ayer no pudo recuperar nada.',
              'The backup job has finished green every night for months, but yesterday\'s restore test could not recover anything.'),
      suggest: ['ls -la /backup', 'du -sh /backup', 'journalctl -u backup', 'df -h'],
      evidence: [
        { host: 'db01', cmd: ['ls -la /backup', 'ls /backup'], lines: [
          ['-rw-r-----  0  dump-2026-09-15.sql', 'err'],
          ['-rw-r-----  0  dump-2026-09-14.sql', 'err'],
          ['-rw-r-----  0  dump-2026-09-13.sql', 'err'],
          ['(todos los volcados pesan cero bytes)', 'err'] ],
          fixed: [
            ["-rw-r-----  4,2G  dump-2026-09-16.sql.gz", 'ok'],
            ["-rw-r-----  4,1G  dump-2026-09-15.sql.gz", 'ok'],
            ["-rw-r-----  4,1G  dump-2026-09-14.sql.gz", 'ok'] ] },
        { host: 'db01', cmd: ['du -sh /backup', 'du'], lines: [
          ['4,0K    /backup', 'err'],
          ['(tres semanas de copias ocupan cuatro kilobytes)', 'dim'] ],
          fixed: [
            ["96G     /backup", 'ok'],
            ["(las copias vuelven a pesar lo que tienen que pesar)", 'dim'] ] },
        { host: 'db01', cmd: ['journalctl -u backup', 'journalctl', 'cat /var/log/backup.log'], lines: [
          ['pg_dump: error: connection to server failed: role "backup" does not exist', 'err'],
          ['backup.sh: línea 12: pg_dump ... || true', 'err'],
          ['backup.service: Succeeded.  ← termina en verde igualmente', 'err'] ],
          fixed: [
            ["pg_dump: 4,2 GB volcados en 6m18s", 'ok'],
            ["backup.sh: verificación de restauración: OK", 'ok'],
            ["backup.service: Succeeded.", 'ok'] ] },
        { host: 'db01', cmd: ['df -h', 'df'], lines: [
          ['/dev/sdc1       500G   18G  482G   4% /backup', 'ok'],
          ['(sitio de sobra: no es falta de disco)', 'dim'] ] },
        { host: 'fw01', cmd: ['iptables -L -n', 'ufw status', 'tcpdump'], lines: [
          ['ACCEPT  tcp  --  10.0.2.20  10.0.3.9  tcp dpt:22  /* copia nocturna */', 'ok'],
          ['22:00:04 IP 10.0.2.20.51882 > 10.0.3.9.22: Flags [S]  — sesión establecida', 'out'],
          ['(la copia sí sale de la red cada noche: no la está cortando el firewall)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('El volcado falla desde hace semanas pero el script devuelve éxito igualmente', 'The dump has failed for weeks but the script reports success anyway'), correct: true },
        { id: 'c2', text: F('El disco de copias está lleno', 'The backup disk is full') },
        { id: 'c3', text: F('La base de datos es demasiado grande para copiarla', 'The database is too big to back up') },
        { id: 'c4', text: F('La red entre los servidores va lenta de noche', 'The network between servers is slow at night') },
      ],
      fixes: [
        { id: 'f1', text: F('Que el trabajo falle cuando falla, avisar, y probar la restauración cada mes', 'Let the job fail when it fails, alert on it, and test a restore monthly'), correct: true },
        { id: 'f2', text: F('Hacer la copia dos veces al día', 'Run the backup twice a day') },
        { id: 'f3', text: F('Comprimir más para que ocupe menos', 'Compress harder so it takes less space') },
      ],
      solved: F('El usuario de la base de datos se había borrado en una limpieza y el script llevaba tres semanas fallando en silencio por un «|| true». Se recreó el usuario, se quitó esa línea, se añadió aviso por fallo y una restauración de prueba mensual.',
                'The database user had been removed during a clean-up and the script had been failing silently for three weeks behind a “|| true”. The user was recreated, that line removed, failure alerting added and a monthly test restore scheduled.'),
      lesson: F('Una copia que no has restaurado nunca no es una copia: es una carpeta. Y un trabajo que siempre termina en verde no prueba que funcione, sólo que nadie ha mirado si podía fallar.',
                'A backup you have never restored is not a backup, it is a folder. And a job that always finishes green does not prove it works, only that nobody made it able to fail.'),
    },
    {
      id: 'T-1052', prio: 'alta',
      from: F('Lucía · Administración', 'Lucía · Admin'),
      subject: F('La impresora va y viene', 'The printer keeps coming and going'),
      body: F('Unas veces imprime y otras dice que no está en red. No sigue ningún horario: puede fallar dos veces seguidas y luego ir bien media hora.',
              'Sometimes it prints, sometimes it says it is offline. There is no pattern: it can fail twice in a row and then work fine for half an hour.'),
      suggest: ['arp -a', 'dmesg', 'ping 10.0.1.55', 'ip -br link'],
      evidence: [
        { host: 'sw-core', cmd: ['arp -a', 'arp'], lines: [
          ['10.0.1.55  00:1b:44:11:3a:b7  gi0/07', 'out'],
          ['10.0.1.55  3c:52:82:04:9e:11  gi0/19   ← la misma IP en dos bocas', 'err'] ],
          fixed: [
            ["10.0.1.55  00:1b:44:11:3a:b7  gi0/07   (impresora, reserva DHCP)", 'ok'],
            ["10.0.1.62  3c:52:82:04:9e:11  gi0/19   (portátil, dirección nueva)", 'ok'] ] },
        { host: 'sw-core', cmd: ['dmesg', 'journalctl'], lines: [
          ['[10:02:11] duplicate IP 10.0.1.55 detected, sent from 3c:52:82:04:9e:11', 'err'],
          ['[10:04:48] duplicate IP 10.0.1.55 detected, sent from 00:1b:44:11:3a:b7', 'err'] ],
          fixed: [
            ["[hoy 10:20] reserva DHCP creada para 00:1b:44:11:3a:b7 -> 10.0.1.55", 'ok'],
            ["(sin avisos de dirección duplicada desde entonces)", 'dim'] ] },
        { host: 'web01', cmd: ['ping 10.0.1.55', 'ping -c1 10.0.1.55'], lines: [
          ['64 bytes from 10.0.1.55: icmp_seq=1 ttl=64 time=0.9 ms', 'ok'],
          ['Request timeout for icmp_seq=2', 'err'],
          ['64 bytes from 10.0.1.55: icmp_seq=3 ttl=255 time=1.1 ms  ← otro ttl, otra máquina', 'err'] ],
          fixed: [
            ["64 bytes from 10.0.1.55: icmp_seq=1 ttl=64 time=0.9 ms", 'ok'],
            ["64 bytes from 10.0.1.55: icmp_seq=2 ttl=64 time=0.8 ms", 'ok'],
            ["64 bytes from 10.0.1.55: icmp_seq=3 ttl=64 time=0.9 ms", 'ok'],
            ["(siempre el mismo ttl: contesta una sola máquina)", 'dim'] ] },
        { host: 'fw01', cmd: ['iptables -L -n', 'ufw status', 'top'], lines: [
          ['Chain FORWARD (policy ACCEPT) — sin reglas para 10.0.1.55', 'ok'],
          ['(el firewall ni la mira: el problema está dentro de la red local)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('Dos equipos tienen configurada la misma dirección IP', 'Two devices are configured with the same IP address'), correct: true },
        { id: 'c2', text: F('La impresora está estropeada', 'The printer is faulty') },
        { id: 'c3', text: F('El cable de la impresora está suelto', 'The printer cable is loose') },
        { id: 'c4', text: F('El servidor DHCP ha dejado de funcionar', 'The DHCP server has stopped working') },
      ],
      fixes: [
        { id: 'f1', text: F('Sacar la IP fija del rango que reparte el DHCP y reservarla para la impresora', 'Move the fixed IP out of the DHCP range and reserve it for the printer'), correct: true },
        { id: 'f2', text: F('Apagar y encender la impresora', 'Turn the printer off and on') },
        { id: 'f3', text: F('Cambiar el cable de red', 'Replace the network cable') },
      ],
      solved: F('A un portátil nuevo le tocó por DHCP la misma dirección que tenía fija la impresora. Se sacó esa dirección del rango del DHCP y se dejó reservada para la impresora por su MAC.',
                'A new laptop was handed the same address the printer had statically. That address was moved out of the DHCP range and reserved for the printer by MAC.'),
      lesson: F('Cuando algo «va y viene» sin horario, sospecha de dos cosas peleándose por lo mismo. Dos respuestas con TTL distinto al mismo ping son dos máquinas distintas contestando.',
                'When something works intermittently with no pattern, suspect two things fighting over the same resource. Two replies with different TTLs to the same ping are two different machines answering.'),
    },
    {
      id: 'T-1053', prio: 'alta',
      from: F('Diego · Desarrollo', 'Diego · Development'),
      subject: F('Las consultas tardan 50 veces más que ayer', 'Queries are 50 times slower than yesterday'),
      body: F('Lo que tardaba 40 ms ahora tarda dos segundos largos. No hemos tocado ni el código ni las consultas, y los datos son los mismos.',
              'What took 40 ms now takes over two seconds. We have not touched the code or the queries, and the data is the same.'),
      suggest: ['cat /proc/mdstat', 'dmesg', 'top', 'df -h'],
      evidence: [
        { host: 'db01', cmd: ['cat /proc/mdstat', 'cat /proc/mdstat ', 'mdadm'], lines: [
          ['md0 : active raid1 sdb1[1](F) sda1[0]', 'err'],
          ['      1953512448 blocks [2/1] [U_]   ← un disco fuera del espejo', 'err'],
          ['      [===>.................]  recovery = 18.4% finish=284.1min', 'err'] ],
          fixed: [
            ["md0 : active raid1 sdb1[1] sda1[0]", 'ok'],
            ["      1953512448 blocks [2/2] [UU]   ← espejo completo", 'ok'] ] },
        { host: 'db01', cmd: ['dmesg', 'journalctl -k'], lines: [
          ['[03:11:42] blk_update_request: I/O error, dev sdb, sector 1180492', 'err'],
          ['[03:11:44] md/raid1:md0: Disk failure on sdb1, disabling device', 'err'] ],
          fixed: [
            ["[hoy 11:40] md/raid1:md0: disco sdb1 añadido, reconstrucción iniciada", 'out'],
            ["[hoy 14:02] md/raid1:md0: reconstrucción completada", 'ok'] ] },
        { host: 'db01', cmd: ['top', 'vmstat', 'iostat'], lines: [
          ['%Cpu(s):  4,1 us,  2,0 sy, 88,3 wa  ← casi todo esperando al disco', 'err'],
          ['(la CPU no hace nada: está esperando a que el disco conteste)', 'dim'] ],
          fixed: [
            ["%Cpu(s): 18,4 us,  3,1 sy,  1,2 wa", 'ok'],
            ["(la espera de disco vuelve a ser residual)", 'dim'] ] },
        { host: 'db01', cmd: ['df -h', 'df', 'free -h'], lines: [
          ['/dev/md0        1,8T  640G  1,1T  37% /var/lib/postgresql', 'ok'],
          ['(espacio de sobra y memoria normal: no es capacidad)', 'dim'] ] },
        { host: 'web01', cmd: ['uptime', 'top', 'ping db01'], lines: [
          ['load average: 0.52, 0.48, 0.44 — la app está esperando, no trabajando', 'ok'],
          ['64 bytes from db01: time=0.4 ms  (la red entre ambos va fina)', 'dim'] ] },
      ],
      causes: [
        { id: 'c1', text: F('Un disco del espejo ha fallado y el sistema está reconstruyendo', 'One disk of the mirror failed and the array is rebuilding'), correct: true },
        { id: 'c2', text: F('Falta un índice en la base de datos', 'The database is missing an index') },
        { id: 'c3', text: F('La red entre la aplicación y la base de datos va mal', 'The network between app and database is bad') },
        { id: 'c4', text: F('El servidor se ha quedado sin CPU', 'The server has run out of CPU') },
      ],
      fixes: [
        { id: 'f1', text: F('Sustituir el disco averiado y comprobar que la reconstrucción termina bien', 'Replace the failed disk and check the rebuild completes'), correct: true },
        { id: 'f2', text: F('Reiniciar la base de datos a ver si va más rápida', 'Restart the database to see if it speeds up') },
        { id: 'f3', text: F('Añadir memoria al servidor', 'Add more memory to the server') },
      ],
      solved: F('Un disco del espejo murió de madrugada. El sistema siguió sirviendo con el que quedaba, pero reconstruyendo, y eso dejó el disco al límite. Se sustituyó el disco averiado y, al terminar la reconstrucción, los tiempos volvieron a 40 ms.',
                'One disk of the mirror died overnight. The system kept serving on the surviving one, but rebuilding, which pinned the disk. The failed disk was replaced and, once the rebuild finished, times were back to 40 ms.'),
      lesson: F('El espejo hizo su trabajo: nadie perdió datos y nadie se enteró. Por eso hay que vigilarlo — un RAID degradado no avisa a los usuarios, sólo va lento, y si cae el segundo disco ahí sí se pierde todo.',
                'The mirror did its job: nobody lost data and nobody noticed. That is exactly why it needs monitoring — a degraded array does not tell users anything, it just goes slow, and if the second disk goes, everything is gone.'),
    },
  ];
};
