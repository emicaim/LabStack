# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file interactive educational web app: a bilingual (ES/EN) "visual infrastructure workshop." The learner drags infrastructure blocks (router, switch, hypervisor, Docker, Kubernetes, databases, cloud, etc.) from a palette into a layered stack, then runs an animated "flow" that traces a request through the assembled layers. It teaches the layers of a modern infra stack and why each one matters.

Almost all real content and behavior lives in [Laboratorio.dc.html](Laboratorio.dc.html). [support.js](support.js) is a build artifact, not source.

## Running

Open `Laboratorio.dc.html` in a browser. No build step, no server, **and no internet**.

Everything it needs is in the repo:

- `vendor/react*.js` — React 18.3.1 UMD. `support.js` still *names* the unpkg URL, but `cdnScriptFor()` looks the URL up in `window.__resources` first, and the `<script>` block in `<head>` maps both to `./vendor/`. Delete that block and it goes back to the CDN.
- `vendor/fuentes.css` + `vendor/fonts/` — Inter and JetBrains Mono, **latin subset only** (8 files, 328 KB). Latin-1 covers Spanish and English completely; the few symbols outside it (`←`, `→`, `★`, `✓`) already fell back to the system font before.
- `vendor/confetti.browser.js` — self-hosted, and this also **fixed a live bug**: the CDN URL in the code was `confetti.browser.min.js`, which does not exist in canvas-confetti 1.9.3. The confetti had never once fired.
- `contenido/*.js` — loaded with `<script src>`, never `fetch`, for the same reason.

Verified by rendering with every DNS lookup blackholed (`--host-resolver-rules="MAP * 0.0.0.0"`): the app boots, the fonts are right and there is not a single `ERR_` in the console. If you add a dependency, vendor it — do not reintroduce a CDN.

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

## Where the content lives

**The content is not in `Laboratorio.dc.html` any more.** ~139 KB of it sits in `contenido/*.js`, loaded by plain `<script src>` tags in `<head>` before `support.js`:

| File | Holds |
|---|---|
| `contenido/piezas.js` | `categorias`, `piezas` (the 75 technologies), `fichas` (one-liner / when to use / alternatives), `iconos`, `dimensionado` |
| `contenido/capas.js` | `capas` — per-layer pedagogy (hint, why, miss, anal, flow) |
| `contenido/textos.js` | `textos` — every UI string, `{ es, en }` |
| `contenido/retos.js` | `retos` (missions) and `incidentes` |
| `contenido/kids.js` | `kids` — the Kids steps |

**They are `.js`, not `.json`, and that is deliberate.** `fetch` of a sibling file is blocked by CORS under `file://`, and the app must keep opening with a double-click and no server. A classic `<script src>` has no such limit. Each file is still pure data — no logic — so a teacher edits content without opening the app code.

**Every entry is a function, not a value:** `window.LABSTACK.piezas = function () { … return [ … ]; }`. That is not decoration — `extras()`, `specs()` and `pieceIcons()` **mutate** what their `*Base()` returns to merge in the teacher content pack. Returning a shared singleton would let those mutations pile up across calls. A fresh object per call reproduces the original semantics exactly.

Splitting the content across files made a new class of bug possible — a Kids step naming a piece that no longer exists, a mission asking for an invented category, a string that is in Spanish but not English. None of it is caught by the smoke test, because the app still boots. **`node content-test.js`** checks exactly that: cross-file references, duplicate ids, every category with cost and pedagogy, Kids distractors never drawn from the answer's own layer, and ES/EN key parity. Run it after editing anything under `contenido/`.

Reading goes through `content(key, fallback)`, which calls `contentMissing(key)` and logs a clear one-time error if a file did not load, instead of rendering a blank app. **To add a piece or change a text, edit `contenido/` — not the logic.** The `contentPack` teacher mode (localStorage JSON) still layers on top of all this, unchanged.

### Data model (all defined as methods returning arrays/objects in the logic script)

- `cats()` / `blocks()` / `layerMeta()` / `strings()` / `missions()` / `incidents()` / `kidsSteps()` now read from `contenido/` (see above); the methods that remain in the file are thin readers.
- `cats()` — the 17 infrastructure categories (id, color, bilingual name). 10 are stackable layers; `seguridad`, `cicd`, `iac`, `monitorizacion`, `gobernanza`, `mensajeria`, `backup` are cross-cutting transversals (rendered separately, not in the stack).
- `blocks()` — the draggable items. Each block has `id`, `cat` (category id), `code` (badge), bilingual `name`/`why`/`desc`, `facts[]`, and optionally a fake `term[]` transcript or `steps[]`.
- `layerMeta()` — per-layer pedagogy (bilingual `hint`, `why`, `miss`, `anal`, `flow`), keyed by category id.
- `strings()` — UI chrome strings.
- The canonical stack order (bottom→top) is the `stackIds` array in `renderVals()`.

### i18n

Every user-facing string is `{ es: '…', en: '…' }`. `this.loc(obj)` returns the string for the current `state.lang` (`'es'` default). Never hard-code display text — always add both languages and go through `loc()`.

### Learning modes (`state.mode`)

The app has **ten** values of `state.mode`. Product-level status and roadmap live in [ROADMAP.md](ROADMAP.md).

The header does **not** expose ten peers. It exposes **three verb-based groups** (`navGroups` in `renderVals()`), and the modes inside a group are switched from a secondary chip row rendered at the top of the canvas (`subnav`):

| Group (header) | Modes | Where you switch |
|---|---|---|
| **Aprender / Learn** | `sandbox` | — |
| **Practicar / Practice** | `mission`, `quiz` | canvas `subnav` |
| **Explorar / Explore** | `map`, `http`, `deploy`, `metrics`, `terminal`, `incident` | canvas `subnav` |

`groupOf` maps mode → group. Clicking a group only switches mode when you are not already inside it, so the sub-view you picked is preserved.

- `'home'` — **the default and the single entrance.** Three cards (Aprender / Practicar / Explorar) built in `home.cards`, a "continue where you left off" strip when `placed` is non-empty, and content stats. Reached from the brand button (`goHome()`); `mode` is deliberately **not** persisted, so every session starts here. A stack shared by URL is the exception — it lands straight on `sandbox`.
- `'sandbox'` — the free-build lab. Shows the tree + example presets.
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

`renderVals()` computes the per-mode view objects (`mission`, `quiz`, `map`, `analysis`, `sizing`, `metricsTiles`, `home`, terminal fields…) and exposes mode flags (`showTree`, `showQuiz`, `showMap`, `showTerminal`, `showMetrics`, `showMissionPicker`, `showMissionGoals`, `showPresets`, `showHome`). To add a mission, append to `missions()`; a quiz variant, extend `buildQuiz()`; a terminal command, add a `case` in `execCmd()` and to `termCmds()`; a piece, edit `blocks()` (+ `extras()`/`pieceIcons()`/`specs()`). There is a Node smoke-test pattern (instantiate `Component` with stubbed `DCLogic`/`React`/`localStorage`/`window`, call `renderVals()` across all ten modes; simulate events with stubbed `currentTarget.getBoundingClientRect`/`e.key`) used to validate logic changes without a browser — every feature above was verified this way. A companion check walks every `{{ key }}` in the template and asserts it has a binding in some mode; run it after touching the template.

### Kids mode (`mode === 'kids'`)

A fourth header group, built on **the opposite rules to the rest of the app**. Everything it shows is reused (`blocks()`, `catById` colours, the map's `artArchetypes()` drawings) but the presentation is driven by how children actually learn — treat these as constraints, not style preferences:

- **One decision per screen.** A child's working memory holds far less than an adult's, so: one layer, one question, **exactly three options**, never a palette. Don't add a fourth option.
- **Concrete before abstract.** Every layer enters through a real-world analogy written for the age (*"el switch es un cartero rapidísimo"*), never through its technical definition. `kidsSteps()` holds that copy — `title`, `say`, `ask`, `hint`, `why` — bilingual like everything else.
- **An error is information, never a failure.** A wrong tap has no penalty, no red, no score: the card turns warm, reveals what it actually is (*"eso es PostgreSQL, de Bases de datos"*) and gives a concrete visual hint. Nothing advances. Keep it that way.
- **The family label is a reward, not a prompt.** `layerShow` reveals a piece's category **only after** it is tapped — correct (labels it) or wrong (corrects it). Showing it up front removes the retrieval, which is where the learning is.
- **What you build never disappears.** The tower on the right grows bottom-up with a Scratch-style nub on each block and is still whole on the final screen.
- **The guide stays on screen** the whole game (`guideShow`), even after a correct answer. It is the child's anchor.

**Two separate games, not one long one.** `state.kids.part` (null = chooser, 1 = the tower, 2 = the helpers); `kidsPartSteps(part)` filters `kidsSteps()` by `chapter`. 17 steps in one sitting is past what this age sustains (~8 min), so each part stands alone and part 2 can be played another day. In part 2 the tower renders **complete and dimmed** as context, so the child sees what they are helping even with no memory of part 1 — progress is still not persisted on purpose.

**Two chapters, and the difference between them is the lesson.** Chapter 1 builds the tower (10 stack pieces, `side` falsy); chapter 2 adds the three that look after it (`side:true` — firewall, monitoring, backup). They render apart: tower blocks solid with a Scratch nub, guardians dashed under a separate heading — the same solid-vs-dashed language the adult app uses for stack vs. transversals. A child learns the shape of the idea without the word. `kidsView()` splits `built` into `tower` (reversed, bottom-up) and `guards`; the chapter banner shows only on the first step of each chapter.

Flow: `state.kids = { step, phase: 'ask' | 'ok' | 'end', wrong }`; `kidsPick()` → `kidsNext()` → `kidsRestart()`; `kidsView()` builds everything. Progress is **not** persisted — the run is short and a half-finished state would confuse more than it helps. The final screen offers a bridge into `map`, so a child who finishes can go look at the real thing.

Colour is deliberate: each option carries **its own family colour**. At step 1 that means nothing to the child; by step 5 the colour itself has become a cue. That is the intended effect — don't neutralise it.

### Events mode (`mode === 'events'`) — the OBM-style console

A live console of raw events plus the ITSM layer on the incident. The pair teaches the thing a monitoring tool cannot: **an event is not an incident.**

- `contenido/eventos.js` holds the events. Three kinds, and the distinction is the whole lesson:
  - `cause: true` + `related: [ids]` — the root cause, which rolls up its symptoms.
  - `symptomOf: id` — a consequence. Closing these one by one fixes nothing.
  - `noise: true` — informational. It can be acknowledged and closed but **never** raises an incident; `events-test.js` asserts that.
- Correlation must be **reciprocal**: a symptom naming its cause, and the cause listing that symptom. The test fails the build otherwise, because the indentation in the list would be lying.
- The list is **grouped, not just sorted**: each cause is followed by its own symptoms. Sorting by severity alone puts a symptom visually under the wrong cause.
- Acknowledging or closing a cause takes its symptoms with it (`evAckGroup`, `evCloseGroup`) — that is what makes triage feel like triage.
- `evRaise(id)` is the bridge: acknowledge the group, switch to `desk`, open the ticket the event points at, and write the origin event into the work log.

### ITSM layer on the incident

`itsmView(tk, d)` wraps the Puesto ticket in what a real service desk shows:

- **Priority is derived, never chosen.** `itsmMatrix()` maps the content's `prio` to impact × urgency; the product gives P1–P4 and the SLA target (1 h / 4 h / 8 h / 24 h). The panel shows the two inputs next to the result so the learner sees where "Crítica" actually comes from.
- **State machine** Nuevo → En curso → Resuelto → Cerrado, driven by `desk.phase`.
- **Work notes.** `deskLog()` records every real action: opening, the originating event, each command and the host it ran on, the hypothesis, the root cause and the fix. `deskState()` **must** return `log` — it did not at first, and every entry silently overwrote the last one.

### Desk mode (`mode === 'desk'`) — four sessions at once

A ticket queue plus **four simultaneous terminals**, one per host (`fw01`, `sw-core`, `web01`, `db01`, from `contenido/tickets.js`). The teaching point is not typing commands — the Terminal mode already does that — it is that **the same command answers differently depending on where you run it**, so you have to pick the right box.

- `state.desk.terms` is an array of independent sessions (`host`, `input`, `history`, `cwd`, `cmdHistory`). They never share history; `desk-test.js` asserts that.
- `execCmd(raw, sess)` gained an optional session (`{cwd, host}`). Same interpreter as Terminal mode, different working directory and hostname. Do not fork it.
- **Ticket evidence overrides the generic terminal.** `deskEvidence(host, raw)` looks up the open ticket's `evidence[]` for a `(host, command)` match and returns those lines instead. Anything not declared falls through to `execCmd` and answers as usual. That is what lets one command tell *this* ticket's story on the box that matters.
- Resolution reuses the incident pattern: investigate → cause → fix, wrong answers give feedback and never advance.

**Hosts come from the stack you built.** `deskHosts()` reads `effectivePlaced()` and, for each of the four roles (`red`, `seguridad`, `so`, `datos`), picks the first piece placed in that category: the host is renamed via `deskHostName()` (`winserver` → `win01`, `kong` → `gw01`, `redis` → `cache01`…) and labelled **from the category**, never from the sample host — put Vault where the sample had a firewall and it must not keep saying "firewall". A role you have not built keeps its sample host, visibly marked, so the desk is never a dead end.

This is why **ticket evidence binds to the role id, not the hostname**: `evidence[].host` is matched against `h.id` (the stable role key), while the prompt, the header and `hostname` show `h.name` (what you actually built). Renaming a host must never break a ticket — `desk-test.js` loads a preset and re-checks the evidence still lands.

Tab completion is `deskComplete(i)`, per session, sharing `termCmds()` with Terminal mode. `man` needs nothing special: it is a `case` in `execCmd`, so it already works.

`content-test.js` enforces the rules below — most importantly that **a ticket's evidence spans at least two hosts**. One host means the learner never has to choose where to look, which is the whole point of the mode; it caught three of the first five tickets failing exactly that.

**Command hints.** `contenido/comandos.js` maps a command prefix to one line of *what it tells you* — not what it does, what you learn from it. `cmdHint()` matches **longest prefix first**, so `systemctl status nginx` gets its own line instead of falling back to `systemctl status`. The suggestion list renders it under each command, so "type this" becomes "I am looking for this". Add a command to a ticket's `suggest` and give it an entry here — `desk-test.js` fails if any suggested command has no hint.

**The right command on the wrong host is a signpost, not a dead end.** `deskOtherHost()` checks whether the typed command has evidence on a *different* host of the open ticket and, if so, appends one dim line saying so. It deliberately **does not name the host** — choosing the box stays the exercise; the test asserts the line never leaks a hostname. A command that is evidence for nobody (`uptime`, `df -h`) must not trigger it.

**Every piece of evidence that shows a fault also carries `fixed`** — how that same command answers once the incident is resolved. `deskEvidence()` returns `fixed` when `phase === 'done'`. Without it the simulation contradicts itself: you apply the fix, re-run the check and it still reports the failure. Evidence that only ruled something out has **no** `fixed` — it was healthy before and stays healthy, and changing it would be a lie in the other direction. `content-test.js` fails any evidence with an `err` line and no `fixed`, and any `fixed` that still contains an `err` line; `desk-test.js` resolves all twelve tickets and re-runs every check.

**Writing a ticket** (`contenido/tickets.js`): give it evidence on **more than one host**, including at least one that rules something out — a firewall that turns out to be fine is as instructive as the broken thing. Keep the distinctive line long enough to be unique: `desk-test.js` matches on the longest line precisely because a short one like `4` collides with generic output.

### Map artwork (schematic illustrations)

Map nodes are **not** the small line icons used elsewhere. Each node draws a schematic front view of the real device, so a rack, a switch and a database are told apart without reading the label.

- `artArchetypes()` returns ~39 archetypes keyed by name (`rack`, `server`, `switch`, `router`, `patch`, `lb`, `globe`, `gateway`, `appliance`, `diskshelf`, `nasbox`, `raidset`, `bucket`, `tape`, `mirror`, `db`, `memory`, `search`, `container`, `cluster`, `vm`, `hostvms`, `os`, `winos`, `cloud`, `tunnel`, `cert`, `lock`, `idcard`, `screen`, `gauge`, `spans`, `doclines`, `bell`, `pipeline`, `branch`, `blueprint`, `queue`, `doc`). Each is a list of `[d, role]` pairs on a **56×46** canvas.
- **Everything is a `<path>`** — no `<rect>`/`<circle>` — so the template renders one `sc-for` over `n.art`. Use the `artBoxes()` / `artCircle()` helpers to generate repeated ports, bays and circles into a single `d`.
- Roles map to concrete paint in `paintArt(key, color)`: `body` (chassis: `var(--panel)` fill + accent outline), `panel` / `soft` (accent tints), `solid` (full accent: LEDs, flames, hubs), `line` (thin stroke). Because `body` fills with `var(--panel)`, **light and dark themes work for free** — never hard-code a hex in an archetype.
- `artKeyFor(pieceId, catId)` maps a piece to its archetype, falling back to a per-category default, so a new piece always draws something sensible.
- Adding a piece: if it looks like something already drawn, just let the mapping fall through. Add an archetype only when the new piece would otherwise be **visually identical to a different kind of thing** — that duplication is exactly what this system exists to avoid (four security pieces once shared one drawing).
- To review every archetype at once, render a contact sheet: instantiate `Component` with the Node stubs, call `artArchetypes()` and `paintArt()` for each key, and write them to a scratch HTML grid. Far faster than panning the map.

Node geometry lives in `buildMap()` (`GW=172`, `CELL_H=64`). `mapAutoFit()` runs once per session on first entry to `map` and clamps the scale to a floor (0.78) so the drawings stay legible even if the whole world does not fit; the ⤢ button still does a true fit.

### Map wiring (the cables between groups)

Cables are drawn with **orthogonal routing** (right angles, rounded corners) — the formal language of a network schematic — not free-form Bézier curves. `orthoPath(pts, r)` turns a list of axis-aligned waypoints into a path with quadratic corners; `linkRoute(A, B, lane, ctx)` decides the waypoints; `arrowHead()` and `portMark()` add the end decorations.

**A cable must never run over another group.** `linkRoute` picks one of three trays:

| Case | Route |
|---|---|
| Boxes overlap vertically (same row) | dips **below both boxes** and crosses underneath |
| Adjacent rows | straight corridor through the **gap between rows** |
| Rows further apart (`ctx.bandGap > 0`) | **vertical bus along the map margin**, clear of everything in between |

`buildMap()` records a `bands[]` entry per row and `catBox[cat]` (the bounding box of each category's column of nodes) to make that possible — anchors sit on **box edges**, never on centroids, so a cable never starts inside a card. `lane` staggers parallel cables so they don't stack.

**Three link kinds, three visual languages** — set in `wire(aCat, bCat, kind, why)`:

| kind | Meaning | Look |
|---|---|---|
| `flow` | the request path | accent, solid, 2px, **arrowhead**, animated dashes |
| `dep` | structural dependency from `deps()` | `--text-faint`, dashed `5 5`, no direction |
| `ops` | cross-cutting operation (monitoring, CI/CD, IaC, security) | `#9333ea`, dotted `2 6` |

Keep these distinct: `ops` is **not** `dep` — monitoring does not sit *under* the service, it operates *on* it. The legend renders one sample of each line, so any new kind needs a legend entry too.

Each cable carries a `tip` (`<title>` inside a `<g>`, plus a transparent 14px-wide hit path) explaining what it connects and why. Hover coverage is partial — roughly 67% of cable length on the demo stack, since cables pass under node cards, which must stay clickable — so **the tooltip is a bonus, never the only place a meaning lives**; the legend carries the primary explanation. Zone boxes are `pointer-events:none` so they don't steal hover from cables underneath.

The links `<svg>` sits **after the zones and before the labels/nodes** in the DOM: above zone fills (or the cables get washed out) and below node cards (or cables cross the illustrations). Don't reorder it.

### Map flow simulation

`runMapFlow()` walks `mapFlowCats()` (categories present, bottom-up through the stack) one step at a time via `state.flowStep`. Four things move together, and all four come from **one** source of truth — `mapFlowRoute(M)`:

- **The route**: an orthogonal polyline through the centre of each stop's `catBox`. It uses **sharp corners on purpose** — every segment is axis-aligned, so `|dx|+|dy|` is the exact length. That exactness is what lets the packet land precisely on each stop. Do not round these corners without switching to `getTotalLength()`.
- **The packet**: an HTML pill labelled `GET /` driven by `offset-path: path(...)` + an animated `offset-distance` percentage (`stopDist[i] / total`). It renders after the nodes, so it passes *over* the cards — it reads as the request entering the equipment.
- **The trail**: the same `d`, drawn inside the links `<svg>` (so *behind* the cards) with `stroke-dasharray:total` and a transitioned `stroke-dashoffset` of `total − distanceSoFar`. The route draws itself behind the packet and the whole path is still on screen when the run ends.
- **The camera**: `mapFocusCat()` re-centres on the active stop, but **only when it is outside the middle ~56% of the viewport**, so a map that already fits does not jiggle. The world div gets a `transform` transition only while `flowing`.

Nodes accumulate state: the active category gets a strong ring, already-visited ones keep a faint ring, so the path stays legible as it grows. The caption shows `n / total`, the layer name and `layerMeta[cat].flow`.

**Gotcha:** `animation:fadeUp` ends on `transform:none`, which silently kills a `transform:translateX(-50%)` used for centring. The flow caption and the chaos message are centred with a flex wrapper instead — don't "simplify" them back to a transform.

### Contextual rails (which panels a mode gets)

The three-rail grid is **not** fixed — each mode shows only the panels it needs, which is what keeps the app from feeling like a cockpit:

- `needPalette` = you are placing pieces (`sandbox`, or `mission` with an active mission).
- `needRail` = `needPalette` or `map` (the right rail carries the linter + sizing, which the map needs).
- `gridClass` picks the CSS class — `g-lcr` / `g-lc` / `g-cr` / `g-c` — defined in `<helmet>` with their own breakpoints. **Never** put `grid-template-columns` back inline on `.lab-grid`.

This matters pedagogically as well as visually: in `quiz` the palette is hidden **on purpose**, because the palette groups pieces by category and would hand the learner the answer to "which layer does this piece belong to?".

Modes that render into an absolutely-positioned container (`map`, `terminal`, `metrics`, `http`, `deploy`, `incident`) use `top:56px` rather than `inset:0`, to leave room for the `subnav` chip row. If you add another such mode, match that offset.

### The stack canvas: planes and density

The ten stackable layers are rendered grouped into the **five conceptual planes** (`planes` in `renderVals()`, derived from `families()` + a fixed plane→layer map): nube → datos → aplicación → plataforma → física. Each plane draws a coloured left edge, its name, an `n/m` counter and a one-line role from `t.planeRoles`. Grouping turns ten items into five, which is what makes the stack legible at a glance.

`state.density` (`'compact'` default, persisted) drives a per-layer set of precomputed style values (`pad`, `iconBox`, `iconSz`, `showHint`, `compactChips`, `detailChips`) plus `layerGap`/`planeGap`. Compact fits the whole stack on one screen with placed pieces as chips on the right; detail restores the per-layer explanation. Because the template dialect has no ternaries, **both densities share one markup** and differ only by those bound values — add new density-sensitive styling the same way.

The seven transversals render as a horizontal **belt** below the stack (`grid-template-columns:repeat(auto-fit,minmax(108px,1fr))`), not as vertical rails. Their labels are horizontal; do not reintroduce `writing-mode:vertical-rl`.

## Visual system (phase 3 — done, keep it)

Two scales, and **nothing outside them**:

- **Type**: `10 · 11 · 12 · 13 · 15 · 17 · 20 · 26 · 32 · 44 · 58` (was 30 arbitrary values across 456 usages).
- **Radius**: `6 · 10 · 14 · 20 · 99` (was 22 values). `99` is the pill.

Every `font-size` and `border-radius` lives inline in the template — there are none in the logic — so slipping in an off-scale value is easy and invisible. Resist it: if a new size feels necessary, the answer is almost always an existing step.

Also gone, deliberately: the `gridDrift` background animation, the two radial gradients on `.lab-root`, and the hard-coded dark header. The header now reads `var(--header-solid)` (white in light, `#0f172a` in dark) so it belongs to the theme instead of fighting it. To bring the always-dark header back, that one token is the only edit.

## Progress spans every mode

Kids, Desk and Events are **not** side attractions: `evalAchievements()` unlocks `oncall` / `veteran` (desk tickets), `triage` (all noise events closed) and `tower` (a Kids game finished), and `learningPathExtra()` appends two steps that end the path on the service desk. Those two steps mark themselves done **from real work** — a solved ticket, closed noise — never by hand. Add a mode and it must earn a place here, or nobody will find it.

`persist()` now also stores `deskSolved`, `evAck` and `evClosed`: twelve tickets are hours of work and losing them to a page reload is not acceptable. Kids progress stays unsaved on purpose — short games, and half a game confuses more than it helps.

## Tests

`npm test` (or `node test.js`) runs all five suites and prints one line each:

| Suite | Covers |
|---|---|
| `smoke.js` | `renderVals()` in all 12 modes, template bindings, achievements across the new modes, persistence round-trip |
| `content-test.js` | cross-file references, ES/EN parity, ticket and Kids content rules |
| `kids-test.js` | both Kids games end to end |
| `desk-test.js` | 12 tickets, command hints, wrong-host nudge, coherence after resolving |
| `events-test.js` | correlation, triage, the event to incident bridge |

Nothing to install; `package.json` exists only to hold the scripts.

## Console noise at load (expected, not a bug)

Opening the app logs **16 `<path> attribute d: Expected moveto…` errors**. They are inherent to the `.dc.html` format and **do not affect rendering**:

The browser parses the inline `<x-dc>` template into real DOM *before* the runtime compiles it. SVG validates geometry attributes, so a literal `d="{{ x }}"` is rejected and logged. The string itself survives in the attribute, the runtime reads it with `getAttribute` and compiles it correctly. Measured identical over `file://` and `http://` — it has nothing to do with the protocol. Fixing it would need runtime support (the template would have to live somewhere inert), and `support.js` is generated outside this repo.

Two families of error **were** removed and must not come back:

- `<svg> attribute width/height: Expected length` — bind the size through `style="width:{{ x }}px"` instead of the `width`/`height` attributes. An invalid CSS declaration is dropped silently; an invalid SVG attribute is not. Same rendered result.
- `CORS policy` + `ERR_FAILED` on `file://` — `boot()` in support.js re-fetches the page source to recompile the template from raw text, which CORS always blocks on `file://`. The runtime catches it, but the browser still logs it. A one-line guard before `support.js` sets `window.__resources = {}` **only when `location.protocol === file:`**, which makes the runtime skip that fetch. Over HTTP the fetch is useful and is left alone.

Anything **other** than those 16 `d` lines is a real problem worth chasing.

## support.js — do not edit by hand

The first line says it all: `GENERATED from dc-runtime/src/*.ts — do not edit. Rebuild with cd dc-runtime && bun run build`. **The `dc-runtime` source is not part of this repository** — only the bundled output ships here. Treat `support.js` as read-only; to understand runtime behavior, read it (sections are labeled `// src/<file>.ts`: `parse`, `compile`, `expr`, `logic`, `component`, `runtime`, `index`, …), but make behavioral changes in the `.dc.html` file, not the bundle.

## Working conventions

- The whole app is styled with inline `style="…"` attributes driven by CSS variables (`var(--accent)`, `var(--panel)`, …) defined in the `<helmet>` block, with `.theme-dark` overrides. Add new colors as variables there rather than hard-coding hex values inline, so light/dark both work.
- When adding a block: add it to `blocks()` with its `cat`, and ensure that category exists in `cats()` (and, for a stackable layer, in `layerMeta()` and `stackIds`).
