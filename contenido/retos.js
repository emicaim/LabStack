// Retos con objetivos e incidentes de la sala de troubleshooting.
// Contenido de LabStack — se puede editar sin tocar la lógica de la app.
// Se carga con <script src> (no con fetch) para que la app siga abriéndose
// con doble clic, sin servidor. Cada entrada es una función: devuelve un
// objeto nuevo en cada llamada, igual que hacían los métodos originales.
window.LABSTACK = window.LABSTACK || {};

// --- incidentes (antes incidents()) ---
window.LABSTACK.incidentes = function () {
    const F=(es,en)=>({es,en});
    return [
      { id:'crashloop', level:1, title:F('Errores 502 tras un despliegue','502 errors after a deploy'),
        symptom:F('Los usuarios reciben 502/503 al entrar y el sitio no carga. Empezó justo tras el último despliegue.','Users get 502/503 and the site won’t load. It started right after the last deploy.'),
        checks:[
          { id:'pods', label:F('kubectl get pods','kubectl get pods'), output:F('web-7d9f  0/1  CrashLoopBackOff  6 reinicios (hace 2m)','web-7d9f  0/1  CrashLoopBackOff  6 restarts (2m ago)') },
          { id:'logs', label:F('kubectl logs web-7d9f','kubectl logs web-7d9f'), output:F('Error: falta la variable DATABASE_URL … el proceso sale con código 1','Error: env DATABASE_URL is not set … process exits with code 1') },
          { id:'metrics', label:F('Ver métricas (errores / req-s)','Check metrics (errors / req-s)'), output:F('5xx: 100% · req-s cayendo · CPU baja (los pods ni arrancan)','5xx: 100% · req-s dropping · CPU low (pods never start)') },
          { id:'lb', label:F('Estado del balanceador','Load balancer status'), output:F('Backends sanos: 0/3 — sin endpoints listos a los que enviar tráfico','Healthy backends: 0/3 — no ready endpoints to route to') },
        ],
        causes:[
          { id:'c1', text:F('Los pods no arrancan por una variable/config que falta','Pods fail to start due to a missing env/config'), correct:true },
          { id:'c2', text:F('El balanceador está mal configurado','The load balancer is misconfigured') },
          { id:'c3', text:F('La base de datos está caída','The database is down') },
          { id:'c4', text:F('Falta capacidad de CPU en el clúster','The cluster is out of CPU') },
        ],
        fixes:[
          { id:'f1', text:F('Corregir el ConfigMap/variables y volver a desplegar','Fix the ConfigMap/env and redeploy'), correct:true },
          { id:'f2', text:F('Reiniciar el balanceador','Restart the load balancer') },
          { id:'f3', text:F('Escalar a más réplicas','Scale to more replicas') },
        ],
        resolved:F('Corregiste la configuración y redeployaste: los pods pasan a Running 3/3 y el 502 desaparece.','You fixed the config and redeployed: pods go Running 3/3 and the 502 is gone.'),
        learn:F('Un 502/503 casi siempre es el backend caído, no el balanceador. Empieza por «kubectl get pods» y los logs del pod.','A 502/503 is almost always the backend being down, not the LB. Start with “kubectl get pods” and the pod logs.') },
      { id:'dbsat', level:2, title:F('La app va lentísima en horas punta','The app crawls at peak hours'),
        symptom:F('La aplicación responde lentísima y algunas peticiones dan timeout. Empeora cuando hay más usuarios.','The app is very slow and some requests time out. It gets worse with more users.'),
        checks:[
          { id:'metrics', label:F('Ver métricas (latencia / CPU)','Check metrics (latency / CPU)'), output:F('Latencia p95: 4200 ms (normal 120) · CPU de la BD: 98%','p95 latency: 4200 ms (normal 120) · DB CPU: 98%') },
          { id:'dblogs', label:F('kubectl logs db-0','kubectl logs db-0'), output:F('FATAL: no quedan slots de conexión — «too many clients already»','FATAL: remaining connection slots are reserved — “too many clients already”') },
          { id:'cache', label:F('¿Hay caché desplegada?','Is a cache deployed?'), output:F('No hay Redis: cada petición golpea directamente la base de datos','No Redis: every request hits the database directly') },
          { id:'pods', label:F('kubectl get pods','kubectl get pods'), output:F('Todo Running, sin reinicios — la app está sana','All Running, no restarts — the app itself is healthy') },
        ],
        causes:[
          { id:'c1', text:F('La BD se satura: agota conexiones y no hay caché que la descargue','The DB saturates: it exhausts connections and no cache offloads it'), correct:true },
          { id:'c2', text:F('Los pods de la app están caídos','The app pods are down') },
          { id:'c3', text:F('El DNS resuelve lento','DNS resolves slowly') },
        ],
        fixes:[
          { id:'f1', text:F('Añadir una caché (Redis) y acotar el pool de conexiones','Add a cache (Redis) and cap the connection pool'), correct:true },
          { id:'f2', text:F('Reiniciar la base de datos','Restart the database') },
          { id:'f3', text:F('Subir el timeout del cliente','Increase the client timeout') },
        ],
        resolved:F('Con Redis delante y un pool acotado, la latencia baja a ~130 ms y desaparecen los timeouts.','With Redis in front and a capped pool, latency drops to ~130 ms and the timeouts vanish.'),
        learn:F('Ante latencia alta, mide antes de tocar. Una caché absorbe lecturas repetidas y protege la base de datos.','With high latency, measure before you touch. A cache absorbs repeated reads and protects the database.') },
      { id:'tls', level:1, title:F('«La conexión no es privada»','“Your connection is not private”'),
        symptom:F('El navegador avisa de que el sitio no es seguro y algunos clientes de API fallan el handshake TLS.','The browser warns the site is not secure and some API clients fail the TLS handshake.'),
        checks:[
          { id:'curl', label:F('curl https://app','curl https://app'), output:F('SSL certificate problem: certificate has expired','SSL certificate problem: certificate has expired') },
          { id:'cert', label:F('openssl … -dates','openssl … -dates'), output:F('notAfter=2026-07-10 — hoy es 2026-07-24: CADUCADO hace 14 días','notAfter=2026-07-10 — today is 2026-07-24: EXPIRED 14 days ago') },
          { id:'fw', label:F('Reglas de firewall (443)','Firewall rules (443)'), output:F('Puerto 443 abierto, sin cambios recientes','Port 443 open, no recent changes') },
          { id:'dns', label:F('dig app','dig app'), output:F('Resuelve correctamente a la IP del balanceador','Resolves correctly to the load balancer IP') },
        ],
        causes:[
          { id:'c1', text:F('El certificado TLS ha caducado','The TLS certificate has expired'), correct:true },
          { id:'c2', text:F('El firewall bloquea el puerto 443','The firewall blocks port 443') },
          { id:'c3', text:F('El DNS apunta a la IP equivocada','DNS points to the wrong IP') },
        ],
        fixes:[
          { id:'f1', text:F('Renovar el certificado (cert-manager / Let’s Encrypt) y recargar','Renew the certificate (cert-manager / Let’s Encrypt) and reload'), correct:true },
          { id:'f2', text:F('Abrir el puerto 443 en el firewall','Open port 443 on the firewall') },
          { id:'f3', text:F('Desactivar HTTPS temporalmente','Disable HTTPS temporarily') },
        ],
        resolved:F('Renovado el certificado y recargado el proxy, vuelve el candado y el handshake funciona.','With the certificate renewed and the proxy reloaded, the padlock returns and the handshake works.'),
        learn:F('Automatiza la renovación (cert-manager). Un certificado caducado tumba el HTTPS aunque todo lo demás esté bien.','Automate renewal (cert-manager). An expired certificate takes down HTTPS even when everything else is fine.') },
    ];
};

// --- retos (antes missionsBase()) ---
window.LABSTACK.retos = function () {
    const F=(es,en)=>({es,en});
    return [
      { id:'first', level:1, name:F('Tu primer servidor','Your first server'),
        brief:F('Lo esencial de abajo hacia arriba: red, hardware, dónde guardar datos y un sistema operativo.','The essentials bottom-up: network, hardware, where to store data and an operating system.'),
        need:['red','computo','almacenamiento','so'], needBlock:[],
        hints:{ red:F('Para comunicar el equipo','To connect the machine'), computo:F('El hardware real','The real hardware'), almacenamiento:F('Persistir los datos','Persist the data'), so:F('Donde corren las apps','Where apps run') } },
      { id:'web-shop', level:2, name:F('Tienda online resiliente','Resilient web shop'),
        brief:F('Debe aguantar picos de tráfico y no perder pedidos: reparto de carga, contenedores orquestados, datos persistentes y observabilidad.','Must handle traffic spikes and never lose orders: load balancing, orchestrated containers, persistent data and observability.'),
        need:['red','computo','so','contenedores','orquestacion','datos','seguridad','monitorizacion'], needBlock:['lb'],
        hints:{ red:F('Incluye un balanceador','Include a load balancer'), orquestacion:F('Escala y auto-repara','Scale and self-heal'), datos:F('Guarda los pedidos','Store the orders'), monitorizacion:F('Para ver qué pasa','To see what happens') } },
      { id:'serverless', level:2, name:F('Producto serverless','Serverless product'),
        brief:F('Sin servidores que administrar: DNS, servicios gestionados en la nube, datos y seguridad de identidad.','No servers to manage: DNS, managed cloud services, data and identity security.'),
        need:['red','nube','datos','seguridad'], needBlock:['dns','serverless'],
        hints:{ nube:F('Funciones bajo demanda','On-demand functions'), seguridad:F('Gestiona identidades (IAM)','Manage identities (IAM)') } },
      { id:'observability', level:2, name:F('Observabilidad total','Full observability'),
        brief:F('No vueles a ciegas: métricas, paneles, alertas y logs sobre un servicio en contenedores.','Do not fly blind: metrics, dashboards, alerts and logs over a containerized service.'),
        need:['red','computo','so','contenedores','monitorizacion'], needBlock:['prometheus','grafana','alerts','logs'],
        hints:{ monitorizacion:F('Prometheus, Grafana, alertas y logs','Prometheus, Grafana, alerts and logs') } },
      { id:'cicd', level:2, name:F('Fábrica de software (CI/CD)','Software factory (CI/CD)'),
        brief:F('Automatiza del código al despliegue: pipeline, registro de imágenes y GitOps sobre contenedores orquestados.','Automate code to deploy: pipeline, image registry and GitOps over orchestrated containers.'),
        need:['red','computo','so','contenedores','orquestacion','cicd'], needBlock:['git','pipeline','registry'],
        hints:{ cicd:F('Git, pipeline, registro, GitOps','Git, pipeline, registry, GitOps'), orquestacion:F('Donde despliega el pipeline','Where the pipeline deploys') } },
      { id:'hci', level:2, name:F('Datacenter hiperconvergente','Hyperconverged datacenter'),
        brief:F('On-premise con Nutanix HCI: red física, almacenamiento y virtualización convergida en un clúster.','On-prem with Nutanix HCI: physical network, storage and converged virtualization in a cluster.'),
        need:['red','computo','almacenamiento','hci','virtualizacion','so','seguridad'], needBlock:['hcinode'],
        hints:{ hci:F('El clúster Nutanix (nodo, AHV, Prism)','The Nutanix cluster (node, AHV, Prism)'), virtualizacion:F('Hipervisor sobre el hardware','Hypervisor on the hardware') } },
      { id:'cloud-native', level:2, name:F('Nativo de la nube','Cloud native'),
        brief:F('Todo gestionado por el proveedor: Kubernetes gestionado, CDN, datos y seguridad de identidad.','Fully provider-managed: managed Kubernetes, CDN, data and identity security.'),
        need:['red','nube','datos','seguridad','monitorizacion'], needBlock:['dns','managedk8s','cdn','iam'],
        hints:{ nube:F('Kubernetes gestionado + CDN','Managed Kubernetes + CDN'), seguridad:F('IAM en la nube','Cloud IAM') } },
      { id:'budget', level:3, name:F('Producción con presupuesto','Production on a budget'),
        brief:F('Monta una arquitectura de producción robusta (sin errores) sin pasar de 450 €/mes. Cada pieza cuesta: elige con cabeza.','Build a robust production architecture (no errors) without exceeding €450/month. Every piece costs: choose wisely.'),
        need:['red','computo','so','contenedores','orquestacion','datos','almacenamiento','monitorizacion'], needBlock:['lb','tls','firewall'],
        budget:450,
        hints:{ computo:F('Lo caro: el hardware','The costly bit: hardware'), contenedores:F('Capacidad barata','Cheap capacity'), datos:F('Persiste los pedidos','Persist the orders') } },
      { id:'k8s-micro', level:3, name:F('Microservicios en Kubernetes','Microservices on Kubernetes'),
        brief:F('Plataforma de microservicios completa: contenedores orquestados con Service e Ingress, datos y observabilidad.','A full microservices platform: orchestrated containers with Service and Ingress, data and observability.'),
        need:['red','computo','so','contenedores','orquestacion','datos','almacenamiento','monitorizacion'], needBlock:['lb','k8s','service','ingress'],
        hints:{ orquestacion:F('Service + Ingress para exponer','Service + Ingress to expose'), monitorizacion:F('Observa los microservicios','Observe the microservices') } },
      { id:'ha', level:3, name:F('Alta disponibilidad','High availability'),
        brief:F('Sin puntos únicos de fallo: duplica las capas críticas (2+ piezas) para que, si una cae, el sistema aguante.','No single points of failure: duplicate the critical layers (2+ pieces) so the system survives a failure.'),
        need:['so','contenedores','orquestacion','monitorizacion'], redundant:['red','computo','datos'], needBlock:['lb'],
        hints:{ red:F('Duplica: router, switch, LB…','Duplicate: router, switch, LB…'), computo:F('Varios nodos físicos','Several physical nodes'), datos:F('Réplica de datos','Data replica') } },
      { id:'security', level:3, name:F('Bastión seguro y auditable','Secure, auditable bastion'),
        brief:F('Protege y certifica: perímetro con firewall y TLS, identidades (IAM), observabilidad y un marco de cumplimiento.','Protect and certify: firewalled TLS edge, identities (IAM), observability and a compliance framework.'),
        need:['red','computo','so','seguridad','monitorizacion','gobernanza'], needBlock:['firewall','tls','iam'],
        hints:{ seguridad:F('Firewall, TLS e IAM','Firewall, TLS and IAM'), gobernanza:F('ISO 27001 / COBIT / COSO','ISO 27001 / COBIT / COSO') } },
    ];
};
