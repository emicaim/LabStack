// Qué te dice cada comando.
// Contenido de LabStack — se puede editar sin tocar la lógica de la app.
//
// No es un manual: es la frase que convierte «escribe esto» en «busco esto».
// Se usa en el Puesto, debajo de cada comando sugerido, para que el alumno
// sepa qué está preguntando antes de pulsar Enter.
//
// Se busca por prefijo, del más largo al más corto: «systemctl status nginx»
// encuentra su entrada antes de caer en «systemctl status».
window.LABSTACK = window.LABSTACK || {};

window.LABSTACK.comandos = function () {
  const F = (es, en) => ({ es, en });
  return {
    // --- servicios ---
    'systemctl status nginx': F('Si el servidor web está vivo, desde cuándo y con qué error murió.',
                                'Whether the web server is alive, since when, and with what error it died.'),
    'systemctl status': F('Si el servicio está arrancado, desde cuándo y cuántas veces se ha reiniciado.',
                          'Whether the service is up, since when, and how many times it has restarted.'),
    'journalctl -u nginx': F('El registro del propio servidor web: aquí sale el motivo exacto de que no arranque.',
                             'The web server’s own log: the exact reason it will not start shows up here.'),
    'journalctl -u backup': F('El registro del trabajo de copia: si falla, lo dice aquí aunque termine «en verde».',
                              'The backup job’s log: if it fails it says so here, even when the job finishes “green”.'),
    'journalctl --disk-usage': F('Cuánto disco se están comiendo los propios registros.',
                                 'How much disk the logs themselves are eating.'),
    'journalctl': F('El registro del sistema, por servicio o entero.', 'The system log, per service or whole.'),
    'dmesg': F('Lo que dice el núcleo: discos que fallan, procesos que mata por memoria, bucles de red.',
               'What the kernel says: failing disks, processes killed for memory, network loops.'),

    // --- red ---
    'ping db01': F('Si llega hasta la base de datos. Distingue «no hay camino» de «el servicio no responde».',
                   'Whether you reach the database at all. Tells “no path” apart from “service not answering”.'),
    'ping': F('Si hay camino hasta esa máquina, cuánto tarda y si contesta siempre la misma.',
              'Whether there is a path to that machine, how long it takes, and whether the same one always answers.'),
    'nslookup': F('Si el nombre se convierte en dirección. Si por IP va y por nombre no, mira aquí.',
                  'Whether the name resolves to an address. If IP works and the name does not, look here.'),
    'ip -s link': F('Contadores por boca: errores y difusión. Una cifra disparada delata una tormenta.',
                    'Per-port counters: errors and broadcast. A runaway number gives away a storm.'),
    'ip -br link': F('Qué interfaces están arriba y cuáles caídas, de un vistazo.',
                     'Which interfaces are up and which are down, at a glance.'),
    'ethtool': F('El estado físico de una boca: si hay enlace, a qué velocidad y si la han apagado a mano.',
                 'The physical state of a port: link, speed, and whether someone disabled it by hand.'),
    'arp -a': F('Qué direcciones responden en la red local y desde qué boca. Delata las IP duplicadas.',
                'Which addresses answer on the local network and from which port. Gives away duplicate IPs.'),
    'ss -lntp': F('Quién está escuchando y en qué puerto. Si algo no arranca, mira si el puerto ya está cogido.',
                  'Who is listening and on which port. If something will not start, check the port is not taken.'),
    'iptables -L -n': F('Las reglas del firewall. Una regla nueva aquí explica muchos «no llego».',
                        'The firewall rules. A new rule here explains a lot of “I cannot reach it”.'),
    'curl -I https://web01': F('La cabecera de la respuesta por HTTPS, incluido el estado del certificado.',
                               'The HTTPS response header, including the certificate state.'),
    'curl -I': F('Sólo la cabecera de la respuesta: el código de estado sin descargarte la página.',
                 'Just the response header: the status code without downloading the page.'),
    'openssl s_client': F('Contra qué certificado estás hablando y cuándo caduca.',
                          'Which certificate you are talking to and when it expires.'),

    // --- recursos ---
    'df -h': F('Cuánto sitio queda en cada disco. El 100% en el sitio malo tumba servicios.',
               'How much space is left on each disk. 100% in the wrong place takes services down.'),
    'du -sh /var/log': F('Cuánto ocupan los registros. Suelen ser los culpables de un disco lleno.',
                         'How much the logs take up. They are usually the culprit for a full disk.'),
    'du -sh /backup': F('Cuánto ocupan las copias de verdad. Si son cuatro kilobytes, no hay copia.',
                        'How much the backups actually take. Four kilobytes means there is no backup.'),
    'du -sh': F('Cuánto ocupa una carpeta, sumando todo lo que hay dentro.',
                'How much a folder takes up, adding up everything inside.'),
    'free -h': F('Memoria libre y swap. Sin memoria y sin swap, el sistema empieza a matar procesos.',
                 'Free memory and swap. With neither, the system starts killing processes.'),
    'uptime': F('Cuánto lleva encendida y la carga media. Compárala con el número de núcleos.',
                'How long it has been up and the load average. Compare it with the number of cores.'),
    'nproc': F('Cuántos núcleos tiene. Sin este número, la carga media no significa nada.',
               'How many cores it has. Without this number, load average means nothing.'),
    'top': F('Quién se está comiendo la CPU ahora mismo, ordenado de mayor a menor.',
             'Who is eating the CPU right now, sorted from most to least.'),
    'vmstat': F('Reparto de la CPU: cuánto trabaja y cuánto espera al disco. Un «wa» alto es disco, no CPU.',
                'CPU breakdown: how much it works versus waits on disk. A high “wa” means disk, not CPU.'),
    'cat /proc/mdstat': F('Estado del espejo de discos. Aquí se ve si uno ha caído y está reconstruyendo.',
                          'State of the disk mirror. This shows if one dropped and it is rebuilding.'),

    // --- ficheros ---
    'ls -la /var/log': F('Los registros uno a uno con su tamaño: enseña cuál se ha desbocado.',
                         'The logs one by one with their size: shows which one ran away.'),
    'ls -la /backup': F('Los ficheros de copia con su tamaño y su fecha. Un cero delata mucho.',
                        'The backup files with size and date. A zero gives a lot away.'),
    'ls -la /etc/letsencrypt': F('Los certificados y cuándo se emitieron. Y si el renovador sigue vivo.',
                                 'The certificates and when they were issued. And whether the renewer is still alive.'),
    'ls -la': F('El contenido de una carpeta con permisos, tamaño y fecha.',
                'The contents of a folder with permissions, size and date.'),
    'ls': F('Qué hay en esta carpeta.', 'What is in this folder.'),
    'cat': F('El contenido de un fichero, tal cual.', 'The contents of a file, as is.'),
    'date': F('La fecha y hora de la máquina. Un reloj desajustado rompe certificados y registros.',
              'The machine’s date and time. A skewed clock breaks certificates and logs.'),

    // --- bases de datos ---
    'psql -h db01': F('Intenta conectar con la base de datos. El error que dé es la pista: «refused» o «timeout».',
                      'Tries to connect to the database. The error it gives is the clue: “refused” or “timeout”.'),
    'psql': F('Abre la base de datos PostgreSQL desde la línea de comandos.',
              'Opens the PostgreSQL database from the command line.'),
  };
};
