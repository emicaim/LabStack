# LabStack · Taller visual de infraestructura

Laboratorio educativo **de un solo archivo** para aprender la infraestructura de sistemas de forma visual e interactiva: arrastra tecnologías, monta tu stack por capas y la app te explica el *porqué*, valida tu arquitectura y te deja experimentar. Bilingüe (ES/EN), tema claro/oscuro, sin backend.

## Cómo ejecutarlo

Abre **`Laboratorio.dc.html`** en un navegador moderno. No requiere instalación, ni servidor, **ni conexión a internet**: React, las fuentes y el resto van en `vendor/`.

> Para el flujo completo de "compartir por enlace" conviene servirlo (p. ej. GitHub Pages) en lugar de abrirlo como `file://`.

## Qué incluye

- **Una sola puerta de entrada** y **4 grupos** en vez de un menú de nueve modos:
  - **Aprender** — monta tu stack por capas, agrupadas en los 5 planos (física → plataforma → aplicación → datos → nube), con densidad **Compacto / Detalle**.
  - **Practicar** — retos con objetivos y presupuesto + quiz adaptativo.
  - **Explorar** — 8 vistas del stack que has montado: Mapa · Petición · Despliegue · Métricas · Terminal · Incidente · **Eventos** (consola tipo OBM con correlación) · **Puesto** (ITSM con 12 tickets y cuatro terminales a la vez).
  - **Kids** — para peques: dos partidas cortas (la torre, 11 pisos; los ayudantes, 6), una capa cada vez, con dibujos y sin forma de equivocarse del todo.
- **~69 tecnologías** en 16 categorías (6 familias de color) con fichas educativas + mensajería (Kafka/RabbitMQ/NATS) + marcos de gobierno (COSO / ISO 27001 / COBIT).
- **Linter de arquitectura** (robustez, anti-patrones), **dimensionado** (coste/CPU/RAM) y **modo avería** (resiliencia).
- **11 misiones** con niveles, **quiz adaptativo**, **ruta de aprendizaje** guiada, **logros** y **glosario** buscable.
- **Simuladores**: petición HTTP salto a salto, despliegue rolling/blue-green/canary, e incidentes de troubleshooting guiados.
- **Terminal simulada** (~148 comandos, filesystem virtual) y **dashboard de métricas** en vivo.
- **Modo profesor** (contenido en JSON importable/exportable) y **exportar/importar stacks**.
- Accesibilidad (foco visible, Escape, `prefers-reduced-motion`) y responsive.

## Estructura

| Archivo | Descripción |
|---|---|
| `Laboratorio.dc.html` | La aplicación (plantilla `<x-dc>` + lógica `class Component`). |
| `events-test.js` | Recorre la consola de eventos: correlación, triaje del ruido y el puente evento → incidencia. |
| `desk-test.js` | Recorre el modo Puesto: resuelve los 12 tickets y comprueba que la evidencia sólo aparece en el equipo correcto. |
| `test.js` + `package.json` | `npm test` lanza las cinco comprobaciones de una vez. No hay nada que instalar. |
| `content-test.js` | Valida el contenido: `node content-test.js` comprueba referencias entre ficheros, ids repetidos y que ES y EN estén completos. |
| `vendor/` | React, fuentes (subconjunto latino) y confeti, en local. Es lo que permite abrirla sin internet. |
| `contenido/` | **El contenido, editable sin tocar la lógica**: `piezas.js` (tecnologías y fichas), `capas.js` (pedagogía por capa), `textos.js` (interfaz ES/EN), `retos.js` (misiones e incidentes), `kids.js` (modo Kids), `tickets.js` y `eventos.js` (Puesto y consola), `comandos.js` (qué te dice cada comando). |
| `support.js` | Runtime del formato `.dc.html` (React vía CDN). **Generado — no editar.** |
| `fokosoft.png` | Logo. |
| `ROADMAP.md` | Estado del proyecto y plan de mejoras. |
| `CLAUDE.md` | Guía técnica de la arquitectura del código. |

## Créditos

Powered by **FOKO SOFT** · © 2026 FOKO Games · Uso libre y gratuito ·
