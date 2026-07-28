# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file interactive educational web app: a bilingual (ES/EN) "visual infrastructure workshop." The learner drags infrastructure blocks (router, switch, hypervisor, Docker, Kubernetes, databases, cloud, etc.) from a palette into a layered stack, then runs an animated "flow" that traces a request through the assembled layers. It teaches the layers of a modern infra stack and why each one matters.

Almost all real content and behavior lives in [Laboratorio.dc.html](Laboratorio.dc.html). [support.js](support.js) is a build artifact, not source.

## Running

Open `Laboratorio.dc.html` in a browser. There is no build step and no server for the app itself — `support.js` boots on load and mounts the component. **Requires internet access**: the runtime fetches React 18 (and Babel standalone) from the unpkg CDN at runtime (see `REACT_URL` / `BABEL_URL` in [support.js](support.js)). Offline, the page will fail to boot.

## The `.dc.html` "Design Component" format

This is a custom React-backed component format, not plain HTML. A `.dc.html` file has two parts inside `<x-dc>`:

1. **Template** — HTML with a mini templating dialect (compiled to `React.createElement` by the runtime).
2. **Logic** — `<script type="text/x-dc" data-dc-script>` defining `class Component extends DCLogic`.

### Template dialect (what to use inside `<x-dc>`)

- `{{ expr }}` — interpolation. Binds to whatever `renderVals()` returns, plus props. Also used for `onClick="{{ handler }}"`, `disabled="{{ bool }}"`, `style="...{{ val }}..."`, etc.
- `<sc-for list="{{ arr }}" as="item">…</sc-for>` — list rendering; `hint-placeholder-count` is a streaming hint only.
- `<sc-if value="{{ cond }}">…</sc-if>` — conditional rendering.
- `<helmet>…</helmet>` — content hoisted into `<head>` (fonts, `<style>`, CSS variables). The `:root` / `.theme-dark` CSS-variable palette lives here.
- `style-hover="…"` / `style-<pseudo>="…"` — pseudo-class styles compiled into a real stylesheet (plain inline `style` can't express `:hover`).
- Event attrs use HTML casing (`onClick`, `onDragStart`) and are mapped to React handlers.

### Logic contract (`class Component extends DCLogic`)

- `state = { … }` — component state; mutate only via `this.setState(patch)` or `this.setState(s => patch)`.
- `renderVals()` — **the key method.** Returns the flat object the template binds against (merged over props). This is where `state` + static data are transformed into everything the template reads: palette groups, stacked layers, flow captions, button styles, i18n strings, etc. To change what the UI shows, you almost always edit `renderVals()` and the template together.
- Methods are called directly from the template via `{{ }}` handlers (e.g. `onBlockClick`, `onLayerClick`, `runFlow`, `reset`, `loadPreset`).
- `DCLogic` is the base class exposed by the runtime (aliased `StreamableLogic`).

### Data model (all defined as methods returning arrays/objects in the logic script)

- `cats()` — the 17 infrastructure categories (id, color, bilingual name). 10 are stackable layers; `seguridad`, `cicd`, `iac`, `monitorizacion`, `gobernanza`, `mensajeria`, `backup` are cross-cutting transversals (rendered separately, not in the stack).
- `blocks()` — the draggable items. Each block has `id`, `cat` (category id), `code` (badge), bilingual `name`/`why`/`desc`, `facts[]`, and optionally a fake `term[]` transcript or `steps[]`.
- `layerMeta()` — per-layer pedagogy (bilingual `hint`, `why`, `miss`, `anal`, `flow`), keyed by category id.
- `strings()` — UI chrome strings.
- The canonical stack order (bottom→top) is the `stackIds` array in `renderVals()`.

### i18n

Every user-facing string is `{ es: '…', en: '…' }`. `this.loc(obj)` returns the string for the current `state.lang` (`'es'` default). Never hard-code display text — always add both languages and go through `loc()`.

### Learning modes (`state.mode`)

The app has **nine** modes, switched from the header toggle and driven by `state.mode`. Product-level status and roadmap live in [ROADMAP.md](ROADMAP.md).

- `'sandbox'` — the original free-build lab (default). Shows the tree + example presets.
- `'mission'` — goal-based challenges from `missions()`. Each mission declares required categories (`need`), specific blocks (`needBlock`), optional `redundant` categories (need 2+ pieces), optional `budget`, and a `level` (1–3). `missionProgress()` / `checkMission()` evaluate the built stack live (goals + budget + zero linter errors) and give feedback. Presets are hidden here.
- `'quiz'` — retrieval-practice quiz, **adaptive** (`buildQuiz()` weights categories by past mistakes via `quizWeight`/`weightedPick`). State in `state.quiz`; per-category stats in `state.quizStats` (persisted). Result screen shows mastered vs to-review.
- `'map'` — pan/zoom physical map. `buildMap()` lays categories into physical zones; the world div is transformed via `translate()+scale()` (`state.map`). Node icons come from `pieceIcon()` (per-piece, falling back to category). Has animated request **flow** (`runMapFlow()`), dependency **curves** with animated traffic, linter **alerts** anchored to nodes, and a **chaos** mode (`toggleChaos`/`simulateFailure`/`resilience`/`cascadeFailure`). `effectivePlaced()` centralizes the real-or-demo `placed`.
- `'terminal'` — simulated shell (`execCmd()` + `cmdKubectl/cmdDocker/cmdGit/cmdTerraform` helpers). ~148 commands, stack-aware (each errors realistically if its layer isn't deployed). Virtual filesystem via `vfs()`/`vfsFiles()`/`resolvePath()`; state in `state.term` (`input`, `history`, `cmdHistory`, `histIdx`, `cwd`). History (↑/↓), Tab autocomplete (`termCmds`/`termComplete`), `man` (`manPage`).
- `'metrics'` — live dashboard. A `setInterval` (`tickMetrics`, started/stopped in `setMode`) pushes points into `state.metrics` series; `sparkPath()` builds SVG polylines. Load dial drives CPU/RAM/req-s/latency with alerts. SVG-native, no libraries.
- `'http'` — **request waterfall** (DevTools-Network style). `buildRequest(placed, failKey)` rolls per-hop latencies (jitter × load factor) from the built stack (or `effectivePlaced()` demo), deriving hops from present pieces (DNS/CDN/TLS/FW/LB/gateway/app/cache/DB/storage). `waterfallView()` formats bar geometry + status; tapping a hop toggles `state.reqFail` (simulated failure → realistic status code, downstream hops skipped); missing compute ⇒ implicit 502. `state.request`/`state.reqFail`; `runRequest()`/`toggleReqFail()`.
- `'deploy'` — **deployment simulator** (rolling / blue-green / canary). `deployFrames(strategy)` returns per-step frames (replica boxes by version, traffic split, downtime); `deployView()` formats them. Playback via `setInterval` (`deployPlay`, cleared in `setMode`); `deployNext/Prev/Reset/Rollback`; `state.deploy` (`strategy`,`step`,`playing`,`rolled`).
- `'incident'` — **troubleshooting runbook**. Scenarios in `incidents()` (symptom, `checks[]` diagnostic outputs with red herrings, multiple-choice `causes`/`fixes`, resolution + takeaway). Phase machine (`brief`→`investigate`→`diagnose`→`fix`→`done`) in `state.incident`; `incidentView()` builds the per-phase view; correct fix unlocks the `incident` achievement. Wrong guesses give feedback and let you retry.

**Cross-cutting features:** color families (`cats()` `fam` + `families()`), palette search/filter/collapse (`state.search`/`famFilter`/`collapsed`), sizing/budget (`specs()`/`sizing()`), persistence + shareable URL (`persist`/`loadLocal`/`shareLink`/`readUrlStack`, `componentDidMount`/`Update`), achievements (`achievements()`/`unlock()`/`evalAchievements`, `state.achievements`, confetti via CDN), guided tour (`tourList()`), print export (`.print-sheet` + `@media print`). Governance frameworks (COSO/ISO 27001/COBIT) are a transversal category `gobernanza`.

### Architecture rigor (dependency + linter engine)

Cutting across all modes: `deps()` declares category-level dependencies (`orquestacion`→`contenedores`→`so`→`computo`/etc, each as a `oneOf` list). `analyzeArch(placed)` runs it plus anti-pattern rules (single point of failure = no load balancer, data without persistence, unencrypted edge = no TLS, no firewall, no observability) and returns `{ errors, warns, oks, score, empty }` — `score` is a 0–100 robustness rating (`100 − errors·25 − warns·10`). It feeds two surfaces from one model: the right-panel **"Análisis de arquitectura"** card (shown in the guide slot when pieces exist; `analysis`/`analysisShow`/`analysisEmpty` in `renderVals`), and the map's **dependency links** (`buildMap()` draws lines between piece groups via `deps()` + `catPt`). The linter analyzes `state.placed` normally, or `effectivePlaced()` in map mode so the demo also gets analyzed.

`renderVals()` computes the per-mode view objects (`mission`, `quiz`, `map`, `analysis`, `sizing`, `metricsTiles`, terminal fields…) and exposes mode flags (`showTree`, `showQuiz`, `showMap`, `showTerminal`, `showMetrics`, `showMissionPicker`, `showMissionGoals`, `showPresets`). To add a mission, append to `missions()`; a quiz variant, extend `buildQuiz()`; a terminal command, add a `case` in `execCmd()` and to `termCmds()`; a piece, edit `blocks()` (+ `extras()`/`pieceIcons()`/`specs()`). There is a Node smoke-test pattern (instantiate `Component` with stubbed `DCLogic`/`React`/`localStorage`/`window`, call `renderVals()` across all nine modes; simulate events with stubbed `currentTarget.getBoundingClientRect`/`e.key`) used to validate logic changes without a browser — every feature above was verified this way.

## support.js — do not edit by hand

The first line says it all: `GENERATED from dc-runtime/src/*.ts — do not edit. Rebuild with cd dc-runtime && bun run build`. **The `dc-runtime` source is not part of this repository** — only the bundled output ships here. Treat `support.js` as read-only; to understand runtime behavior, read it (sections are labeled `// src/<file>.ts`: `parse`, `compile`, `expr`, `logic`, `component`, `runtime`, `index`, …), but make behavioral changes in the `.dc.html` file, not the bundle.

## Working conventions

- The whole app is styled with inline `style="…"` attributes driven by CSS variables (`var(--accent)`, `var(--panel)`, …) defined in the `<helmet>` block, with `.theme-dark` overrides. Add new colors as variables there rather than hard-coding hex values inline, so light/dark both work.
- When adding a block: add it to `blocks()` with its `cat`, and ensure that category exists in `cats()` (and, for a stackable layer, in `layerMeta()` and `stackIds`).
