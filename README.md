# LabStack · Taller visual de infraestructura

Laboratorio educativo **de un solo archivo** para aprender la infraestructura de sistemas de forma visual e interactiva: arrastra tecnologías, monta tu stack por capas y la app te explica el *porqué*, valida tu arquitectura y te deja experimentar. Bilingüe (ES/EN), tema claro/oscuro, sin backend.

## Cómo ejecutarlo

Abre **`Laboratorio.dc.html`** en un navegador moderno con conexión a internet (carga React desde CDN). No requiere instalación ni servidor.

> Para el flujo completo de "compartir por enlace" conviene servirlo (p. ej. GitHub Pages) en lugar de abrirlo como `file://`.

## Qué incluye

- **9 modos**: Libre · Misión · Quiz · Mapa físico · Terminal · Métricas · **Petición (waterfall)** · **Despliegue** · **Incidente**.
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
| `support.js` | Runtime del formato `.dc.html` (React vía CDN). **Generado — no editar.** |
| `fokosoft.png` | Logo. |
| `ROADMAP.md` | Estado del proyecto y plan de mejoras. |
| `CLAUDE.md` | Guía técnica de la arquitectura del código. |

## Créditos

Powered by **FOKO SOFT** · © 2026 FOKO Games · Uso libre y gratuito ·
