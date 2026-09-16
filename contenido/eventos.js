// Consola de eventos (estilo OBM / Operations Bridge).
// Contenido de LabStack — se puede editar sin tocar la lógica de la app.
//
// Un evento NO es una incidencia. Llegan miles, la mayoría son ruido o son
// síntomas de una sola causa. El trabajo del operador es triar: reconocer,
// correlar y decidir cuáles merecen abrir un ticket. Eso es lo que enseña
// esta pantalla.
//
//   sev      critical | major | minor | warning
//   node     equipo del puesto donde se originó
//   source   quién lo mandó (agente, trap SNMP, syslog…)
//   cause    true  -> es la causa raíz de su grupo
//   related  ids de los síntomas que cuelgan de esa causa
//   ticket   si merece incidencia, a cuál corresponde
//   noise    true  -> informativo: se reconoce y se cierra, no abre ticket
window.LABSTACK = window.LABSTACK || {};

window.LABSTACK.eventos = function () {
  const F = (es, en) => ({ es, en });
  return [
    // ---- bucle de capa 2: una causa, muchos síntomas ----
    { id: 'EV-2051', sev: 'critical', min: 3, node: 'sw-core', source: 'SNMP trap', cause: true, ticket: 'T-1048',
      related: ['EV-2052', 'EV-2053', 'EV-2054'],
      title: F('Bucle de capa 2 detectado entre gi0/22 y gi0/23', 'Layer-2 loop detected between gi0/22 and gi0/23'),
      text: F('El switch recibe de vuelta sus propias tramas. Las bocas gi0/22 y gi0/23 están unidas. Todo lo que cuelga de este switch se va a ver afectado.',
              'The switch is receiving its own frames back. Ports gi0/22 and gi0/23 are joined. Everything behind this switch will be affected.') },
    { id: 'EV-2052', sev: 'major', min: 3, node: 'sw-core', source: 'Agente', symptomOf: 'EV-2051',
      title: F('Broadcast por encima del umbral en gi0/22 (98%)', 'Broadcast above threshold on gi0/22 (98%)'),
      text: F('Tormenta de difusión. Es consecuencia del bucle, no una avería aparte.', 'Broadcast storm. A consequence of the loop, not a separate fault.') },
    { id: 'EV-2053', sev: 'major', min: 2, node: 'web01', source: 'Agente', symptomOf: 'EV-2051',
      title: F('Pérdida de paquetes del 41% hacia la puerta de enlace', '41% packet loss towards the gateway'),
      text: F('El servidor pierde paquetes, pero el servidor está sano: el ruido viene de la red.', 'The server is dropping packets, but the server is healthy: the noise comes from the network.') },
    { id: 'EV-2054', sev: 'minor', min: 2, node: 'db01', source: 'Agente', symptomOf: 'EV-2051',
      title: F('Latencia de red elevada hacia web01 (312 ms)', 'High network latency towards web01 (312 ms)'),
      text: F('Mismo origen. Cerrar los síntomas por separado no arregla nada.', 'Same origin. Closing symptoms one by one fixes nothing.') },

    // ---- certificado caducado ----
    { id: 'EV-2048', sev: 'critical', min: 21, node: 'web01', source: 'Sonda HTTPS', cause: true, ticket: 'T-1047',
      related: ['EV-2049'],
      title: F('Certificado TLS caducado en tienda.empresa.com', 'TLS certificate expired on tienda.empresa.com'),
      text: F('El certificado venció hace 33 días. Los navegadores bloquean el acceso. La sonda lleva avisando desde antes de que caducara.',
              'The certificate expired 33 days ago. Browsers are blocking access. The probe has been warning since before it expired.') },
    { id: 'EV-2049', sev: 'warning', min: 40, node: 'web01', source: 'systemd', symptomOf: 'EV-2048',
      title: F('certbot.timer en estado failed', 'certbot.timer in failed state'),
      text: F('Este aviso lleva tres meses repitiéndose. Si alguien lo hubiera mirado, no habría caducado nada.',
              'This alert has been repeating for three months. Had anyone looked at it, nothing would have expired.') },

    // ---- memoria ----
    { id: 'EV-2044', sev: 'major', min: 12, node: 'web01', source: 'Agente', cause: true, ticket: 'T-1049',
      related: ['EV-2045'],
      title: F('Proceso terminado por falta de memoria (java, pid 5108)', 'Process killed out of memory (java, pid 5108)'),
      text: F('El núcleo ha matado la aplicación por falta de memoria. Es la sexta vez hoy.',
              'The kernel killed the application out of memory. Sixth time today.') },
    { id: 'EV-2045', sev: 'minor', min: 12, node: 'web01', source: 'Sonda HTTP', symptomOf: 'EV-2044',
      title: F('Servicio Tienda no responde durante 40 s', 'Tienda service unresponsive for 40 s'),
      text: F('Corte breve mientras el servicio se levanta solo. Vuelve sin intervención, por eso pasa desapercibido.',
              'Brief outage while the service restarts itself. It comes back unattended, which is why it goes unnoticed.') },

    // ---- RAID degradado ----
    { id: 'EV-2039', sev: 'critical', min: 34, node: 'db01', source: 'Agente', cause: true, ticket: 'T-1053',
      related: ['EV-2040'],
      title: F('Espejo degradado en md0: disco sdb fuera', 'Mirror degraded on md0: disk sdb dropped'),
      text: F('Queda un solo disco sirviendo los datos. Si cae el segundo se pierde todo. Nadie lo ha notado porque el servicio sigue en pie.',
              'A single disk is serving the data. If the second one goes, everything is lost. Nobody noticed because the service is still up.') },
    { id: 'EV-2040', sev: 'major', min: 30, node: 'db01', source: 'Agente', symptomOf: 'EV-2039',
      title: F('Espera de disco por encima del 80% sostenida', 'Disk wait above 80% sustained'),
      text: F('El disco va al límite por la reconstrucción del espejo.', 'The disk is pinned by the mirror rebuild.') },

    // ---- disco / logs ----
    { id: 'EV-2036', sev: 'major', min: 55, node: 'db01', source: 'Zabbix', cause: true, ticket: 'T-1045',
      related: [],
      title: F('/var al 96% de ocupación en db01', '/var at 96% on db01'),
      text: F('A este ritmo se llena en cuatro días. Todavía no ha roto nada: llega a tiempo.',
              'At this rate it fills up in four days. Nothing is broken yet: this one arrives in time.') },

    // ---- IP duplicada ----
    { id: 'EV-2033', sev: 'minor', min: 71, node: 'sw-core', source: 'SNMP trap', cause: true, ticket: 'T-1052',
      related: [],
      title: F('Dirección IP duplicada 10.0.1.55 en gi0/07 y gi0/19', 'Duplicate IP 10.0.1.55 on gi0/07 and gi0/19'),
      text: F('Dos equipos responden por la misma dirección. Provoca cortes intermitentes difíciles de reproducir.',
              'Two devices answer for the same address. It causes intermittent drops that are hard to reproduce.') },

    // ---- ruido: se reconoce y se cierra, no abre ticket ----
    { id: 'EV-2056', sev: 'warning', min: 1, node: 'fw01', source: 'syslog', noise: true,
      title: F('Inicio de sesión correcto de admin desde 10.0.1.14', 'Successful admin login from 10.0.1.14'),
      text: F('Acceso legítimo del compañero de guardia. Informativo: no hay nada que arreglar.',
              'Legitimate access by the colleague on shift. Informational: nothing to fix.') },
    { id: 'EV-2055', sev: 'minor', min: 5, node: 'web01', source: 'Agente', noise: true,
      title: F('Copia de seguridad diaria completada (12,4 GB)', 'Daily backup completed (12.4 GB)'),
      text: F('Evento de fin de trabajo. No requiere acción.', 'Job completion event. No action needed.') },
    { id: 'EV-2050', sev: 'warning', min: 26, node: 'sw-core', source: 'Agente', noise: true,
      title: F('Temperatura del armario a 27 °C (umbral 30 °C)', 'Rack temperature at 27 °C (threshold 30 °C)'),
      text: F('Por debajo del umbral. Conviene vigilarlo en verano, pero no es una incidencia.',
              'Below threshold. Worth watching in summer, but not an incident.') },
    { id: 'EV-2047', sev: 'minor', min: 33, node: 'db01', source: 'Zabbix', noise: true,
      title: F('Reinicio programado del agente de monitorización', 'Scheduled monitoring agent restart'),
      text: F('Ventana de mantenimiento prevista. Ruido puro.', 'Planned maintenance window. Pure noise.') },
    { id: 'EV-2042', sev: 'warning', min: 48, node: 'fw01', source: 'syslog', noise: true,
      title: F('14 intentos de conexión bloqueados desde 203.0.113.44', '14 blocked connection attempts from 203.0.113.44'),
      text: F('El firewall hizo exactamente su trabajo. Esto es normal en cualquier equipo expuesto a internet.',
              'The firewall did exactly its job. This is normal on anything facing the internet.') },
  ];
};
