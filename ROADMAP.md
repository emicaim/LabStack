# LabStack · Taller visual de infraestructura — Estado y Roadmap

> Documento vivo. Resume **lo que ya tiene** el taller y **los pasos a seguir** para mejorarlo.
> Para la documentación técnica de cómo está construido, ver [CLAUDE.md](CLAUDE.md).

---

## 1. Qué es

Un laboratorio educativo **de un solo archivo** (`Laboratorio.dc.html`) que enseña la infraestructura de sistemas de forma visual e interactiva: el alumno arrastra tecnologías, monta su stack, y la app le explica el *porqué*, valida su arquitectura y le deja experimentar. Bilingüe (ES/EN), tema claro/oscuro, sin backend.

**Público:** estudiantes de Ingeniería en Sistemas / DevOps / infraestructura, y docentes.

---

## 2. Lo que YA tenemos ✅

### Modos (9)
| Modo | Qué hace |
|---|---|
| **Libre** | Sandbox: arrastra piezas al árbol por capas, con feedback y corrección. |
| **Misión** | 11 retos con objetivos, niveles de dificultad y evaluación del stack. |
| **Quiz** | Preguntas de recuerdo activo, **adaptativo** (insiste donde fallas). |
| **Mapa** | Datacenter físico navegable (pan/zoom), con flujo animado y modo avería. |
| **Terminal** | Shell simulado con **148 comandos** y filesystem virtual. |
| **Métricas** | Dashboard en vivo (CPU/RAM/req-s/latencia) con sparklines SVG. |
| **Petición** | Waterfall de una petición HTTP salto a salto por tu stack; simula caídas por salto (5xx/timeout). |
| **Despliegue** | Simulador rolling / blue-green / canary con reparto de tráfico animado y rollback. |
| **Incidente** | Runbook de troubleshooting: síntoma → investigar → diagnosticar → arreglar, con 3 escenarios. |

### Contenido
- **16 categorías** en **6 familias de color** (física, plataforma, aplicación, datos, nube, operación).
- **~69 piezas** (router, k8s, postgres, terraform, **Kafka/RabbitMQ/NATS**, Istio, Kong, Vault, Elasticsearch… + marcos **COSO / ISO 27001 / COBIT**).
- Cada pieza con ficha completa: descripción, ideas clave, **en una frase**, **cuándo usarla**, **alternativas**, coste/CPU/RAM, y (algunas) terminal simulada.
- Cada capa con: por qué existe, qué pasa si falta, analogía.

### Rigor y análisis
- **Linter de arquitectura**: nota de robustez 0–100, detecta dependencias rotas y anti-patrones (SPOF, datos sin persistencia, sin TLS/firewall/monitorización).
- **Dimensionado**: coste €/mes, vCPU y RAM del stack; misión con **restricción de presupuesto**.
- **Modo avería / chaos**: tira una pieza y mide la resiliencia (cascada por dependencias).

### Mapa físico
- Zonas (perímetro → sala → almacenamiento/datos/nube → operación), iconos por pieza, leyenda.
- **Dependencias** dibujadas como curvas con **tráfico animado**.
- **Avisos del linter** anclados a las piezas/zonas.
- **Flujo de petición** animado salto a salto.

### Aprendizaje y progreso
- **11 misiones** con niveles (Básico/Intermedio/Avanzado) y objetivo de **redundancia (×2)**.
- **Quiz adaptativo** con repetición espaciada (persistente).
- **11 logros** persistentes + **confeti** al desbloquear (canvas-confetti desde CDN).

### Uso y persistencia
- **Autoguardado** en `localStorage` (stack, idioma, tema, logros, progreso de quiz).
- **Compartir por enlace** (`#s=…`) — el compañero abre y ve tu montaje.
- **Tour guiado** (recorrido por las capas) y **exportar** (hoja de resumen imprimible / PDF).

### Terminal (simulador casi real)
- **148 comandos**: filesystem (`ls/cd/cat/tree/grep…`), red (`ping/curl/nmap/dig/tcpdump…`), Kubernetes (`kubectl …`, `helm`), Docker (`docker …`, `compose`), Git, Terraform, Ansible, nube (`aws/gcloud/az`), bases de datos (`psql/redis-cli/mongosh/mysql`), utilidades (`stat/seq/expr/base64/htop…`) y extras (`neofetch/cowsay…`).
- **Consciente del stack**: cada comando responde según lo montado (o da el error real).
- Historial (↑/↓), autocompletado (Tab), `man`, prompt con ruta.

### Base técnica
- Formato `.dc.html` (runtime React vía `support.js`). Toda la lógica en un `class Component`.
- `renderVals()` precomputa todo (el motor de plantillas no admite ternarios/aritmética).
- **Verificación**: smoke tests en Node (instanciar `Component` con stubs) para validar sin navegador.

---

## 3. Pasos a seguir 🚧 (backlog priorizado)

Marcado con ⭐ lo que más recomiendo.

### ✅ Hecho — rediseño didáctico (fases 1 y 2)
- ✅ **Pantalla de inicio** como modo por defecto: tres puertas (Aprender / Practicar / Explorar) + «seguir donde lo dejaste».
- ✅ **Cabecera de 13 controles → 4**: marca, 3 grupos por verbo, idioma y un menú «Más» con el resto.
- ✅ **Los 6 simuladores dejan de ser modos** y pasan a ser vistas dentro de Explorar (sub-navegación en el lienzo).
- ✅ **Paneles contextuales**: la paleta solo existe donde se colocan piezas y el raíl derecho solo donde aporta. En Quiz se ocultan ambos — la paleta daba la respuesta.
- ✅ **Transversales en cinturón horizontal** (texto legible) en vez de 7 columnas verticales rotadas; libera ~40% del lienzo.
- ✅ **Capas agrupadas en los 5 planos** + densidad **Compacto / Detalle**: el stack entero cabe en una pantalla.
- ✅ **Checklist de 17 casillas → tarjeta de progreso** (porcentaje, capas, pilares y siguiente paso).
- ✅ **Rejilla por clases CSS** con puntos de ruptura propios: deja de romperse a 1280 px.

### ✅ Hecho — mapa ilustrado
- ✅ **39 arquetipos de dibujo esquemático** (`artArchetypes()`): cada pieza se dibuja como el aparato real de frente — rack con sus U, switch con puertos y LEDs, servidor con bahías, firewall como muro con llama, VPN como túnel, TLS como certificado, cinta de backup, RAM, cabina de discos, NAS, RAID con paridad…
- ✅ Nodos de 172×64 con ilustración + nombre a dos líneas + código; respetan tema claro/oscuro y el color de familia sin tocar nada (`var(--panel)` + rol de color).
- ✅ Autoencuadre al entrar (`mapAutoFit()`) con escala mínima para que el dibujo siga legible.
- Pendiente si se quiere: usar la misma ilustración en la **ficha de la pieza** y en la **paleta** (una línea: `paintArt(artKeyFor(id,cat), color)`).

### ✅ Hecho — cableado legible
- ✅ **Trazado ortogonal** con esquinas redondeadas en vez de curvas Bézier cruzadas.
- ✅ **Los cables no pasan por encima de ningún grupo**: bandeja bajo las cajas si están en la misma fila, pasillo entre filas si son contiguas, y bus por el margen si hay filas de por medio.
- ✅ **Tres lenguajes de línea** en vez de uno: camino de la petición (acento, flecha, animado) · necesita debajo (gris discontinuo) · opera sobre (violeta punteado). Con leyenda de los tres.
- ✅ Los cables salen del **borde** de cada grupo con su conector, no del centro.
- ✅ Cada cable explica al pasar por encima qué conecta y por qué (cobertura ~67%: la leyenda sigue siendo la explicación principal).

### ✅ Hecho — la simulación del mapa se entiende
- ✅ El paquete **recorre una ruta real** en ángulo recto (antes volaba en diagonal ignorando el cableado).
- ✅ **Rastro que se dibuja solo** detrás del paquete: al acabar ves el camino completo de la petición.
- ✅ **La cámara sigue** la parada activa, y solo se mueve si se está saliendo de la vista.
- ✅ El paquete es una etiqueta **GET /**, no un punto anónimo.
- ✅ Cartel con **paso n/total + nombre de la capa** + qué ocurre ahí; las paradas ya visitadas se quedan marcadas.
- ✅ Ritmo más lento (~950 ms por paso) y pausa final para leer la ruta entera.
- Pendiente si se quiere: **controles de reproducción** (pausa / paso a paso) para que el alumno marque su propio ritmo.

### ✅ Hecho — modo Kids (cuarta pestaña)
- ✅ **17 pasos partidos en DOS PARTIDAS**, porque 17 de una sentada pasan de los 8 min que aguanta esta edad.
  - **Partida 1 · La torre** (11 pisos): caminos → agenda (DNS) → repartir la cola (balanceador) → máquina → cajón → partir → jefe → cajas → jefe de las cajas (K8s) → libreta → nube.
  - **Partida 2 · Los ayudantes** (6): buzón (mensajería), portero (firewall), vigilante (monitorización), copia de seguridad, instrucciones (IaC/Terraform) y cadena de montaje (CI/CD).
- ✅ En la partida 2 la torre se muestra **entera y atenuada** de fondo: el niño ve sobre qué está trabajando aunque juegue otro día.
- ✅ Los ayudantes se dibujan **aparte y con borde discontinuo**: misma distinción visual que pila vs. transversales en la app de adultos, sin usar la palabra.
- ✅ **Tres opciones como máximo** y una sola decisión por pantalla (memoria de trabajo corta).
- ✅ Cada capa entra por una **analogía concreta**, no por su definición técnica.
- ✅ **El error no castiga**: sin rojo, sin puntuación; la opción tocada dice qué es de verdad y da una pista visual.
- ✅ La **familia se revela al responder**, no antes: así hay algo que recordar.
- ✅ **Torre que crece** y no se borra, con bloques estilo Scratch; al final queda el stack entero a la vista.
- ✅ Guía («Bit») presente toda la partida, estrellas de progreso y puente final al Mapa real.
- Pendiente si se quiere: voz en off o lectura en alto, y más rutas (una de seguridad, otra de datos).

### ✅ Hecho — contenido fuera de la lógica
- ✅ **139 KB de contenido** salen a `contenido/*.js`: piezas y fichas, pedagogía por capa, textos ES/EN, retos e incidentes, y los pasos de Kids. El fichero principal baja de **499 a 377 KB**.
- ✅ Son **ficheros de datos, no de código**: un docente añade una pieza o cambia un texto sin abrir la lógica.
- ✅ Se cargan con `<script src>`, **no con `fetch`**: la app sigue abriéndose con doble clic, sin servidor.
- ✅ Si falta un fichero, avisa en consola con un mensaje claro en vez de quedarse en blanco.
- ✅ Verificado comparando **método a método contra el original**: contenido idéntico byte a byte en ES y EN.

### Corto plazo (alto valor, bajo esfuerzo)

- ⭐ **Glosario / índice buscable** de términos con enlaces cruzados.
- **Tooltips enriquecidos al pasar el ratón** (mini-ficha sin clic) en paleta y mapa.
- **Undo / redo** al montar el stack.
- **Más misiones**: migración a la nube, big data / analítica, IoT-edge, recuperación ante desastres (DR).
- **Rutas de aprendizaje**: encadenar misiones + teoría en un currículum con progreso.

- ⭐ **Fase 3 — sistema visual**: tokens de radio (8/12/16 en vez de 18 valores), escala tipográfica (5 tamaños en vez de 23), mono solo para código/terminal/métricas, quitar `gridDrift`/glows/degradados de fondo y hacer que la cabecera respete el tema.

### Medio plazo (mejoras de producto)
- ⭐ **Modo profesor**: crear/editar misiones propias y **exportar/importar stacks como archivo** `.json`.
- **Minimapa** y **niveles de detalle (LOD)** en el mapa al hacer zoom (agrupar al alejar).
- **Pipes y redirección** en la terminal (`ls | grep`, `echo x > file`) — sube el realismo.
- **Comparador de arquitecturas** lado a lado (on-prem vs cloud) con sus notas del linter.
- **Simulador de costes más fino**: región, reservado vs on-demand, egress.
- **Accesibilidad**: navegación por teclado, roles ARIA, modo alto contraste, foco visible.
- **Responsive / móvil**: la app está pensada para escritorio; pulir tablets/móvil.

### Largo plazo (requiere backend o esfuerzo grande)
- **Backend opcional** para guardar/compartir sin depender del archivo local, y **progreso de alumnos** para el docente.
- **Multiusuario / salas** (un profe reparte un reto, ve resultados en vivo).
- **Modo examen / certificación** con puntuación global y diploma.
- **Modelo de rendimiento realista** (cuellos de botella reales, no aditivo) para el dashboard.
- ✅ HECHO **Escenarios de incidente guiados** (runbooks: "el servicio cae, diagnostica y arregla") — modo **Incidente** con 3 escenarios. Ampliable con más casos.

### Deuda técnica / mantenimiento
- Convertir los **smoke tests en una suite** ejecutable (`npm test`) reproducible.
- **Versionado del formato de guardado** en `localStorage` (migraciones si cambia el esquema).
- **Rendimiento**: revisar el re-render en cada tecleo de inputs (buscador, terminal) — memoizar si hace falta.
- El archivo crece mucho; valorar **partir contenido/lógica** (ligado a "externalizar a JSON").

---

## 4. Ideas que creo que le faltan (mi recomendación)

1. **Contenido en datos, no en código** — es el desbloqueador nº 1: permite crecer sin miedo y abre la puerta al "modo profesor".
2. **Rutas de aprendizaje** — hoy hay piezas sueltas y misiones; falta el hilo pedagógico que lleve al alumno de 0 a experto en orden.
3. **Glosario** — un sitio único donde buscar cualquier término y saltar a su ficha.
4. **Exportar/importar stacks como archivo** — más robusto que la URL para el aula, y sin backend.
5. **Accesibilidad y móvil** — para que sea usable por todos y en cualquier dispositivo.

---

## 5. Restricciones a tener presentes
- **Sin backend** hoy: todo es client-side. Compartir por URL es pleno solo si la app está **hospedada** (GitHub Pages, etc.), no en `file://`.
- **Requiere internet** para cargar React (y el confeti) desde CDN.
- El **runtime no admite ternarios/operadores** dentro de `{{ }}`: todo estilo/valor se precomputa en `renderVals()`.
- Los simuladores (terminal, métricas, chaos) son **modelos educativos**, no ejecución/medición real.
