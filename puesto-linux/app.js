// Puesto · interfaz. Pinta la cola y el puesto de trabajo a partir del motor.
//
// La interfaz no guarda estado de la plataforma: todo lo que enseña (nodos,
// OSD, alertas, reloj, SLA) se vuelve a leer del motor tras cada comando. Así
// el panel nunca puede contradecir a la terminal.
(function () {
'use strict';
const P = window.PUESTO, U = P.u;
const $ = s => document.querySelector(s);
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CLAVE = 'puesto-linux-v1';
const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}') || {}; } catch (e) { return {}; } };
const guardar = d => { try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch (e) { /* sin almacenamiento: se juega igual */ } };

const TIPOS = { incidente: 'Incidente', peticion: 'Petición', cambio: 'Cambio' };
const MAX_LINEAS = 1500, MAX_TABS = 6;
// Incidencias importadas: se guarda el fichero tal cual y se vuelve a validar
// (y a ensayar) en cada arranque. Si una deja de ser válida, se ve y se puede borrar.
const CLAVE_IMP = 'puesto-linux-importadas';
const leerImp = () => { try { const v = JSON.parse(localStorage.getItem(CLAVE_IMP) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const guardarImp = l => { try { localStorage.setItem(CLAVE_IMP, JSON.stringify(l)); } catch (e) { /* sin almacenamiento: vive hasta recargar */ } };
let importadas = [];   // [{ fuente, r }]
function recargarImportadas(fuentes) {
  importadas = fuentes.map(fuente => ({ fuente, r: P.cargarIncidencia(fuente) }));
  P.importadas.length = 0;
  importadas.forEach(x => { if (x.r.ok) P.importadas.push(x.r.escenario); });
}
const app = { vista: 'cola', modo: null, esc: null, st: null, tabs: [], activa: 0, pistas: 0, intentos: 0, pendientes: null, cierre: null, filtro: null, progreso: leer().resueltos || {}, guardias: leer().guardias || {}, guardiaPanel: false, caos: [], caosMsg: null };

// ------------------------------------------------------------------ cola
function vistaCola() {
  const res = app.progreso;
  const funcs = P.funciones.map(f => { const es = P.escenarios.filter(e => e.funciones.indexOf(f.id) >= 0); return { f, total: es.length, n: es.filter(e => res[e.id]).length }; });
  const lista = P.escenarios.filter(e => !app.filtro || e.funciones.indexOf(app.filtro) >= 0);
  const hechos = P.escenarios.filter(e => res[e.id]).length;
  $('#vista').innerHTML = `
  <div class="cola-wrap">
    <section class="hero">
      <div class="card oferta">
        <span class="oferta-tag">📌 Puesto</span>
        <h1>Administrador/a de Sistemas Linux</h1>
        <p class="oferta-sub">Proyecto retail · remoto · contrato indefinido</p>
        <p class="oferta-txt">Despliegue y mantenimiento de la plataforma OpenStack, administración y monitorización del almacenamiento Ceph, automatización con Ansible y Terraform, y monitorización y resolución de incidencias. Cada función del puesto tiene sus tickets:</p>
        <div class="funcs">
          ${funcs.map(x => `<button class="func ${app.filtro === x.f.id ? 'on' : ''}" data-act="filtro" data-id="${x.f.id}" aria-pressed="${app.filtro === x.f.id}">
            <span class="func-t">${h(x.f.titulo)}</span><span class="func-bar"><i style="width:${x.total ? x.n / x.total * 100 : 0}%"></i></span><span class="func-n">${x.n}/${x.total}</span></button>`).join('')}
        </div>
      </div>
      <div class="lado">
        <button class="modo" data-act="guardia" aria-expanded="${app.guardiaPanel}"><span class="modo-ic" style="background:var(--bad-tint)">🔔</span><span class="modo-tx"><b>Guardia</b><small>Averías al azar, sin ticket: sólo las alertas. Como a las tres de la mañana.</small></span></button>
        ${app.guardiaPanel ? panelGuardia() : ''}
        <button class="modo" data-act="libre"><span class="modo-ic" style="background:var(--accent-tint)">🧪</span><span class="modo-tx"><b>Laboratorio libre</b><small>La plataforma sana, sin ticket. Rompe cosas a propósito y mira qué pasa.</small></span></button>
        <div class="card como">
          <h3>Cómo funciona</h3>
          <ol>
            <li><b>Doce nodos simulados</b>: bastión, 3 controladores OpenStack, 4 hipervisores, 3 nodos Ceph y monitorización.</li>
            <li><b>Arreglas con comandos reales</b>: ssh, systemctl, ceph, openstack, ansible-playbook, terraform… Nada de elegir respuestas.</li>
            <li><b>Se comprueba el estado</b>, no el camino. Luego se valora cómo llegaste: las buenas prácticas del oficio.</li>
          </ol>
        </div>
      </div>
    </section>
    <section>
      <div class="cola-cab"><h2>Cola de trabajo</h2><span>${hechos} de ${P.escenarios.length} resueltos</span>${app.filtro ? '<button data-act="filtro" data-id="">Ver todos</button>' : ''}</div>
      <div class="lista">${lista.map(filaTicket).join('')}</div>
    </section>
    ${seccionImportadas()}
  </div>`;
}
function seccionImportadas() {
  const res = app.impResultado || [];
  const aviso = res.map(x => x.r.ok
    ? `<div class="imp-res ok"><b>✓ ${h(x.nombre)}: ${h(x.r.escenario.id)} aceptada</b><span>${x.r.ensayo.averias} averías${x.r.ensayo.condiciones ? ' y ' + x.r.ensayo.condiciones + ' condiciones' : ''} · ${x.r.ensayo.alertas} alertas · su solución de referencia la resuelve en ${x.r.ensayo.comandos} comandos</span>${x.r.avisos.map(a => '<span class="imp-aviso">! ' + h(a) + '</span>').join('')}</div>`
    : `<div class="imp-res mal"><b>✕ ${h(x.nombre)} no se acepta</b><ul>${x.r.errores.map(e => '<li>' + h(e) + '</li>').join('')}</ul></div>`).join('');
  const cat = P.catalogoLegible();
  return `<section class="importar">
    <div class="cola-cab"><h2>Incidencias importadas</h2><span>${P.importadas.length ? P.importadas.length + ' en la cola' : 'ninguna todavía'}</span></div>
    <div class="card imp" id="zonaImp">
      <div class="imp-txt"><b>Trae tus propias incidencias</b><p>Compónlas en el formulario, o trae un fichero <code>.json</code> que combina averías del catálogo. Antes de aceptarlo, el puesto lo aplica sobre una plataforma nueva y ensaya su solución: si nadie podría cerrarlo, no entra. Puedes arrastrarlo aquí.</p></div>
      <div class="imp-acc">
        <a class="btn primario-in" href="./compositor.html">Componer una incidencia</a>
        <button class="btn" data-act="importar">Importar .json</button>
        <span class="imp-sep">o parte de un ticket del puesto:</span>
        <select id="plantilla" aria-label="Ticket que usar como plantilla">${P.exportables().map(e => `<option value="${e.id}">${e.id} · ${h(e.asunto)}</option>`).join('')}</select>
        <button class="btn" data-act="exportar">Descargar como plantilla</button>
      </div>
      <input type="file" id="fichero" accept=".json,application/json" multiple hidden>
      ${aviso}
      <details class="catalogo"><summary>Catálogo de averías · ${cat.length} tipos para combinar</summary>
        ${cat.map(c => `<div class="cat-item"><div class="cat-cab"><code>${c.tipo}</code><b>${h(c.titulo)}</b>${c.condicion ? '<span class="chip t-cambio">condición</span>' : ''}</div>${c.descripcion ? '<p>' + h(c.descripcion) + '</p>' : ''}<dl>${Object.keys(c.params).map(k => '<dt>' + h(k) + '</dt><dd>' + h(c.params[k]) + '</dd>').join('')}</dl><pre>${h(JSON.stringify(c.ejemplo))}</pre></div>`).join('')}
      </details>
    </div>
    <div class="lista">${importadas.map(x => x.r.ok
      ? `<div class="tk-imp">${filaTicket(x.r.escenario)}<button class="tk-borrar" data-act="borrarImp" data-id="${h(x.r.escenario.id)}" title="Quitar de la cola" aria-label="Quitar ${h(x.r.escenario.id)} de la cola">×</button></div>`
      : `<div class="tk-imp"><div class="tk tk-rota"><span class="tk-id">${h(x.fuente.id || '¿?')}</span><span class="chip t-incidente">no válida</span><span></span><span class="tk-main"><span class="tk-asunto">${h(x.fuente.asunto || 'sin asunto')}</span><span class="tk-de">${h(x.r.errores[0] || '')}</span></span></div><button class="tk-borrar" data-act="borrarImp" data-id="${h(x.fuente.id || '')}" title="Quitar" aria-label="Quitar">×</button></div>`).join('')}</div>
  </section>`;
}
function importarFicheros(files) {
  const lista = Array.from(files || []).slice(0, 20);
  if (!lista.length) return;
  const res = []; let pendientes = lista.length;
  lista.forEach(f => {
    const rd = new FileReader();
    rd.onload = () => {
      const r = P.cargarIncidencia(String(rd.result));
      res.push({ nombre: f.name, r });
      if (r.ok) {
        const fuentes = importadas.map(x => x.fuente).filter(x => x.id !== r.escenario.id && (x.id || r.escenario.id !== 'EXT-?'));
        fuentes.push(Object.assign({}, r.escenario.fuente, { id: r.escenario.id }));
        guardarImp(fuentes); recargarImportadas(fuentes);
      }
      if (--pendientes === 0) { app.impResultado = res; vistaCola(); const z = $('#zonaImp'); if (z) z.scrollIntoView({ block: 'center' }); }
    };
    rd.onerror = () => { res.push({ nombre: f.name, r: { ok: false, errores: ['No se ha podido leer el fichero'], avisos: [] } }); if (--pendientes === 0) { app.impResultado = res; vistaCola(); } };
    rd.readAsText(f);
  });
}
function descargar(nombre, texto, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function panelGuardia() {
  const g = app.guardias, n = k => g[k] || 0;
  return `<div class="card gd">
    <p class="gd-t">¿Cómo de mala viene la noche?</p>
    <div class="gd-niveles">${[1, 2, 3].map(k => `<button data-act="guardiaNivel" data-n="${k}"><b>${P.nivelesGuardia[k]}</b><span>${k === 1 ? 'una avería' : k === 2 ? 'dos a la vez' : 'tres a la vez, alguna de las gordas'}</span><em>${n(k)} resueltas</em></button>`).join('')}</div>
    <div class="gd-pie">
      <label>Semilla <input id="semilla" inputmode="numeric" placeholder="al azar" aria-label="Semilla para repetir una guardia"></label>
      <button class="gd-ticket" data-act="guardiaTicket">o un ticket del puesto al azar, sin su texto${P.importadas.length ? ' (incluidas las importadas)' : ''}</button>
    </div>
    <p class="gd-nota">Cada guardia sale de una semilla: con el mismo número, la misma noche. Pásasela a un compañero y comparad.</p>
  </div>`;
}
function filaTicket(e) {
  const p = P.prioridad(e), r = app.progreso[e.id];
  return `<button class="tk" data-act="abrir" data-id="${e.id}">
    <span class="tk-id">${e.id}</span>
    <span class="chip t-${e.tipo}">${TIPOS[e.tipo]}</span>
    <span class="chip p-${p.p}" title="Impacto ${e.impacto} × urgencia ${e.urgencia}">${p.p}</span>
    <span class="tk-main"><span class="tk-asunto">${h(e.asunto)}</span><span class="tk-de">${h(e.de)} · ${h(e.area)}${e.importada ? ' · importada' + (e.autor ? ' · ' + h(e.autor) : '') : ''}</span></span>
    <span class="tk-nivel" title="Nivel ${e.nivel} de 3">${'●'.repeat(e.nivel)}${'○'.repeat(3 - e.nivel)}</span>
    <span class="tk-estado ${r ? 'ok' : ''}">${r ? '✓ ' + r.min + ' min' : 'Nuevo'}</span>
  </button>`;
}

// ------------------------------------------------------------------ puesto
function nuevaTab(host) {
  const t = { ses: P.nuevaSesion(), lineas: [], hIdx: -1 };
  app.tabs.push(t); app.activa = app.tabs.length - 1;
  if (host) correrEn(t, 'ssh ' + host);
  return t;
}
function abrir(modo, esc) {
  app.vista = 'puesto'; app.modo = modo; app.esc = esc || null;
  app.st = P.preparar(app.esc);
  app.tabs = []; app.pistas = 0; app.intentos = 0; app.pendientes = null; app.cierre = null; app.caos = []; app.caosMsg = null;
  const t = nuevaTab();
  const bienvenida = modo === 'guardia'
    ? ['Te ha saltado la guardia. No hay ticket: sólo lo que ven las alertas.', 'Estás en el bastión. Para orientarte: amtool alert · ceph -s · help']
    : modo === 'libre'
      ? ['Laboratorio libre: la plataforma está sana y no hay ticket.', 'Estás en el bastión. Empieza por help o por cat RUNBOOK.md']
      : ['Estás en el bastión, el punto de entrada a la plataforma.', 'Para orientarte: help · cat RUNBOOK.md · amtool alert'];
  bienvenida.forEach(x => t.lineas.push({ t: x, c: 'dim' }));
  t.lineas.push({ t: '', c: 'out' });
  pintarPuesto();
}
function pintarPuesto() {
  const e = app.esc;
  const titulo = app.modo === 'libre' ? 'Laboratorio libre' : app.modo === 'guardia' && !app.cierre ? (e.guardia ? e.asunto : 'Guardia') : e.asunto;
  $('#vista').innerHTML = `
  <div class="puesto">
    <div class="barra">
      <button class="volver" data-act="cola">← Cola</button>
      <div class="barra-t">${e && (app.modo !== 'guardia' || app.cierre) ? '<span class="mono">' + e.id + '</span>' : ''}<b>${h(titulo)}</b></div>
      <div class="reloj"><b id="hora"></b><span id="tmas"></span></div>
      <div class="sla" id="sla"></div>
    </div>
    <aside class="col izq" id="izq"></aside>
    <main class="centro">
      <div class="term">
        <div class="tabs" id="tabs" role="tablist"></div>
        <div class="term-body" id="termBody">
          <div id="termOut" aria-live="polite"></div>
          <div class="term-in"><span id="termPrompt"></span><input id="termIn" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Línea de comandos"></div>
        </div>
      </div>
    </main>
    <aside class="col der" id="der"></aside>
  </div>`;
  const inp = $('#termIn');
  inp.addEventListener('keydown', teclaTerminal);
  $('#termBody').addEventListener('mouseup', () => { if (!String(window.getSelection() || '')) inp.focus(); });
  pintarTerminal(); pintarPaneles();
  inp.focus();
}
const tab = () => app.tabs[app.activa];

// ------------------------------------------------------------------ terminal
function correrEn(t, txt) {
  const pr = P.prompt(t.ses), oculto = !!(t.ses.pendiente && t.ses.pendiente.oculto);
  const r = P.ejecutar(app.st, t.ses, txt);
  if (r.limpiar) t.lineas = [];
  else t.lineas.push({ t: oculto ? '' : txt, c: 'in', pr });   // una contraseña no se ve al escribirla
  r.lineas.forEach(l => t.lineas.push(l));
  app.tabs.forEach(x => P.expulsar(app.st, x.ses).forEach(l => x.lineas.push(l)));
  app.tabs.forEach(x => { if (x.lineas.length > MAX_LINEAS) x.lineas = x.lineas.slice(-MAX_LINEAS); });
}
function ejecutar(txt) {
  const t = tab(); t.hIdx = -1;
  correrEn(t, txt);
  app.pendientes = null;
  pintarTerminal(); pintarPaneles();
}
function pintarTerminal() {
  const t = tab();
  $('#tabs').innerHTML = app.tabs.map((x, i) => `<button class="tab ${i === app.activa ? 'on' : ''}" role="tab" aria-selected="${i === app.activa}" data-act="tab" data-i="${i}">${i + 1} · ${h(x.ses.host)}${app.tabs.length > 1 ? `<span class="x" data-act="cerrarTab" data-i="${i}" title="Cerrar pestaña" aria-label="Cerrar pestaña">×</span>` : ''}</button>`).join('')
    + (app.tabs.length < MAX_TABS ? '<button class="tab-mas" data-act="nuevaTab" title="Nueva sesión en el bastión" aria-label="Nueva pestaña">+</button>' : '');
  $('#termOut').innerHTML = t.lineas.map(l => l.c === 'in'
    ? `<div class="ln in"><span class="pr">${h(l.pr)}</span>${h(l.t)}</div>`
    : `<div class="ln ${l.c}">${h(l.t) || '&nbsp;'}</div>`).join('');
  $('#termPrompt').textContent = P.prompt(t.ses);
  $('#termIn').type = t.ses.pendiente && t.ses.pendiente.oculto ? 'password' : 'text';
  const b = $('#termBody'); b.scrollTop = b.scrollHeight;
}
function teclaTerminal(ev) {
  const inp = ev.target, t = tab();
  if (ev.key === 'Enter') { ev.preventDefault(); const v = inp.value; inp.value = ''; ejecutar(v); return; }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    if (t.ses.pendiente) return;
    const r = P.completar(app.st, t.ses, inp.value);
    inp.value = r.texto;
    if (r.opciones.length) { t.lineas.push({ t: inp.value, c: 'in', pr: P.prompt(t.ses) }); t.lineas.push({ t: r.opciones.join('   '), c: 'dim' }); pintarTerminal(); }
    return;
  }
  if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    ev.preventDefault();
    const hi = t.ses.hist; if (!hi.length) return;
    let i = t.hIdx === -1 ? hi.length : t.hIdx;
    i += ev.key === 'ArrowUp' ? -1 : 1;
    if (i < 0) i = 0;
    if (i >= hi.length) { t.hIdx = -1; inp.value = ''; return; }
    t.hIdx = i; inp.value = hi[i];
    setTimeout(() => inp.setSelectionRange(inp.value.length, inp.value.length), 0);
    return;
  }
  if (ev.ctrlKey && (ev.key === 'l' || ev.key === 'L')) { ev.preventDefault(); t.lineas = []; pintarTerminal(); return; }
  if (ev.ctrlKey && (ev.key === 'c' || ev.key === 'C') && !String(window.getSelection() || '')) {
    ev.preventDefault();
    t.lineas.push({ t: inp.value + '^C', c: 'in', pr: P.prompt(t.ses) });
    if (t.ses.pendiente) { t.ses.pendiente = null; t.lineas.push({ t: 'Cancelado.', c: 'ambar' }); }
    inp.value = ''; pintarTerminal();
  }
}

// ------------------------------------------------------------------ paneles
const GRUPOS = [['Bastión', ['bastion']], ['Controladores', ['ctl01', 'ctl02', 'ctl03']], ['Cómputo', ['cmp01', 'cmp02', 'cmp03', 'cmp04']], ['Ceph', ['ceph01', 'ceph02', 'ceph03']], ['Monitorización', ['mon01']]];
const ROL_CORTO = { bastion: 'Ansible · Terraform · CLI', ctl: 'API · RabbitMQ · Galera', cmp: 'KVM · nova-compute', ceph: 'mon · mgr · 3 OSD', mon: 'Prometheus · Grafana' };
function pintarPaneles() {
  const st = app.st;
  $('#hora').textContent = U.hora(st.reloj);
  $('#tmas').textContent = 'T+' + st.reloj + ' min';
  const e = app.esc;
  if (e && app.modo === 'ticket') {
    const p = P.prioridad(e), pasado = st.reloj - (e.abierto || 0), f = Math.min(1, pasado / p.sla);
    const col = f < 0.5 ? 'var(--ok)' : f < 0.85 ? 'var(--warn)' : 'var(--bad)';
    $('#sla').innerHTML = `<span><b>SLA ${p.p}</b><em style="font-style:normal">${Math.max(0, p.sla - pasado)} min</em></span><span class="sla-bar"><i style="width:${f * 100}%;background:${col}"></i></span>`;
  } else $('#sla').innerHTML = '';
  $('#izq').innerHTML = panelAlertas() + panelNodos() + panelCeph();
  $('#der').innerHTML = app.modo === 'libre' ? panelLibre() : app.cierre ? panelCierre() : panelTicket() + panelResolver() + panelPistas() + panelRegistro();
}
function panelNodos() {
  const st = app.st, al = P.alertasActivas(st);
  const nota = hn => {
    const x = st.hosts[hn];
    if (!x.up) return 'reiniciando… vuelve ' + U.hora(x.vuelveEn);
    const a = al.find(y => y.host === hn && y.sev !== 'info');
    if (a) return a.res;
    if (!x.provisionado) return 'sin OpenStack: pendiente de alta';
    if (x.kernelNuevo) return 'reinicio pendiente (kernel)';
    return ROL_CORTO[x.rol];
  };
  return `<section class="panel"><h3>Plataforma</h3>${GRUPOS.map(([t, hs]) => `<div class="grupo"><p class="grupo-t">${t}</p>${hs.map(n => {
    const e = P.estadoHost(st, st.hosts[n]);
    return `<button class="host e-${e}" data-act="ssh" data-host="${n}" title="Abrir una sesión en ${n}"><i class="punto"></i><b>${n}</b><span>${h(nota(n))}</span></button>`;
  }).join('')}</div>`).join('')}</section>`;
}
function panelCeph() {
  const st = app.st, c = st.ceph, s = P.saludCeph(st), usos = U.usos(st);
  const hosts = ['ceph01', 'ceph02', 'ceph03'].map(n => `<div class="osd-host"><p class="grupo-t">${n}</p>${c.osds.filter(o => o.host === n).map(o => {
    const up = U.osdUp(st, o), u = usos[o.id], clase = !up && o.in ? 'caido' : !o.in ? 'fuera' : u >= c.nearfull * 100 ? 'lleno' : '';
    const txt = !up && o.in ? 'down' : !o.in ? 'out' : u.toFixed(0) + ' %';
    return `<div class="osd ${clase}"><b>osd.${o.id}</b><span class="osd-bar"><i style="width:${o.in ? u : 0}%"></i></span><em>${txt}</em></div>`;
  }).join('')}</div>`).join('');
  const flags = Object.keys(c.flags).filter(k => c.flags[k]);
  const rec = c.rec ? `<div class="rec">${c.rec.tipo === 'reparto' ? 'Rebalanceando' : c.rec.tipo === 'log' ? 'Poniéndose al día' : 'Reconstruyendo réplicas'} · quedan ${c.rec.restante} min<span class="sla-bar"><i style="width:${(1 - c.rec.restante / c.rec.total) * 100}%"></i></span></div>` : '';
  return `<section class="panel"><h3>Ceph <span class="salud s-${s.estado} der-n">${s.estado}</span></h3>${hosts}${flags.length ? '<div class="flags">' + flags.map(f => '<span class="flag">' + f + '</span>').join('') + '</div>' : ''}${rec}</section>`;
}
function panelAlertas() {
  const al = P.alertasActivas(app.st);
  return `<section class="panel"><h3>Alertas <span class="der-n">${al.length}</span></h3>${al.length ? al.map(a => `<div class="alerta al-${a.sev}"><i></i><div><b>${h(a.nombre)}</b><span>${h((a.host ? a.host + ' · ' : '') + a.res)}</span></div><small>${Math.max(0, app.st.reloj - a.desde)} min</small></div>`).join('') : '<p class="vacio">Sin alertas activas.</p>'}</section>`;
}
function panelTicket() {
  const e = app.esc, st = app.st, p = P.prioridad(e);
  const fase = app.cierre ? 3 : st.registro.length ? 1 : 0;
  const estados = ['Nuevo', 'En curso', 'Resuelto', 'Cerrado'].map((x, i) => `<span class="${i === fase ? 'on' : i < fase ? 'hecho' : ''}">${x}</span>`).join('');
  if (app.modo === 'guardia') return `<section class="panel ticket"><div class="tk-cab"><span class="chip t-incidente">Guardia</span></div><h2>Te ha saltado el busca</h2><p>No hay ticket: nadie te dice qué pasa. Mira las alertas, averigua qué está roto y arréglalo.</p><p class="de">Cuando creas que está resuelto, compruébalo abajo. Sabrás qué incidente era al cerrarlo.</p><div class="estado-itsm">${estados}</div></section>`;
  return `<section class="panel ticket">
    <div class="tk-cab"><span class="mono">${e.id}</span><span class="chip t-${e.tipo}">${TIPOS[e.tipo]}</span><span class="chip p-${p.p}">${p.p}</span></div>
    <h2>${h(e.asunto)}</h2>
    <p class="de">De: ${h(e.de)} · abierto a las ${U.hora(e.abierto || 0)}</p>
    ${e.cuerpo.map(x => '<p>' + h(x) + '</p>').join('')}
    <dl class="itsm"><dt>Impacto</dt><dd>${e.impacto}</dd><dt>Urgencia</dt><dd>${e.urgencia}</dd><dt>Prioridad</dt><dd>${p.p} · resolver en ${p.sla >= 60 ? p.sla / 60 + ' h' : p.sla + ' min'}</dd><dt>Área</dt><dd>${h(e.area)}</dd></dl>
    <div class="estado-itsm">${estados}</div>
  </section>`;
}
function panelPistas() {
  const e = app.esc, quedan = e.pistas.length - app.pistas;
  return `<section class="panel"><h3>Pistas <span class="der-n">${app.pistas} de ${e.pistas.length}</span></h3>
    ${e.pistas.slice(0, app.pistas).map((x, i) => `<p class="pista"><b>${i + 1}</b>${h(x)}</p>`).join('')}
    ${quedan ? `<button class="btn suave" data-act="pista">${app.pistas ? 'Otra pista' : 'Pedir una pista'} <span style="color:var(--faint);font-weight:500">(quedan ${quedan})</span></button>` : '<p class="vacio">No quedan más pistas.</p>'}
  </section>`;
}
function panelRegistro() {
  const r = app.st.registro.slice(-40);
  return `<section class="panel"><h3>Registro de trabajo <span class="der-n">${app.st.registro.length}</span></h3>${r.length ? '<div class="registro" id="registro">' + r.map(x => `<div><span>${U.hora(x.min)}</span><span>${x.host}</span><span title="${h(x.cmd)}">${h(x.cmd)}</span></div>`).join('') + '</div>' : '<p class="vacio">Cada comando que lances queda anotado aquí, con el equipo y la hora. Es la cronología del informe.</p>'}</section>`;
}
function panelResolver() {
  const aun = app.pendientes ? `<div class="aun"><b>Todavía no está resuelto</b><ul>${app.pendientes.map(x => '<li>' + h(x) + '</li>').join('')}</ul></div>` : '';
  return `<section class="panel"><button class="btn primario" data-act="comprobar">Comprobar y resolver</button>${aun}</section>`;
}
function panelCierre() {
  const e = app.esc, c = app.cierre, p = P.prioridad(e);
  const ok = c.practicas.filter(x => x.ok).length;
  return `<section class="panel cierre">
    <div class="cierre-top"><span class="cierre-ok">✓</span><div><b>${e.id} resuelto</b><span>${h(e.asunto)}</span></div></div>
    <div class="cifras">
      <div><b>${c.trabajo} min</b><span>de trabajo</span></div>
      <div><b style="color:${c.total <= p.sla ? 'var(--ok)' : 'var(--bad)'}">${c.total <= p.sla ? 'Dentro' : 'Fuera'}</b><span>SLA ${p.p} (${c.total} min)</span></div>
      <div><b>${c.pistas}/3</b><span>pistas</span></div>
    </div>
    <h3 style="margin:0 0 8px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)">Buenas prácticas · ${ok} de ${c.practicas.length}</h3>
    ${c.practicas.map(x => `<p class="practica ${x.ok ? 'si' : 'no'}"><i>${x.ok ? '✓' : '○'}</i><span>${h(x.t)}</span></p>`).join('')}
    <div class="bloque"><h4>Qué pasaba</h4><p>${h(e.causa)}</p></div>
    <div class="bloque"><h4>Lo que te llevas</h4><p>${h(e.leccion)}</p></div>
    <div class="acciones">
      <button class="btn primario" data-act="informe">Descargar el informe (.md)</button>
      ${e.guardia ? `<button class="btn" data-act="guardiaNivel" data-n="${e.guardia.nivel}">Otra guardia ${P.nivelesGuardia[e.guardia.nivel].toLowerCase()}</button><button class="btn" data-act="guardiaJson">Descargar como incidencia (.json)</button>` : ''}
      <button class="btn" data-act="repetir">${e.guardia ? 'Repetir esta misma guardia (semilla ' + e.guardia.semilla + ')' : 'Repetir desde cero'}</button>
      <button class="btn" data-act="cola">Volver a la cola</button>
    </div>
  </section>`;
}
const EXPERIMENTOS = [
  ['ceph osd out 3', 'Saca un OSD sano del clúster y mira cómo se reparten los datos (ceph -s, ceph osd df).'],
  ['ssh ceph01', 'Entra en un nodo Ceph y reinícialo sin noout (sudo reboot). Mira qué hace Ceph a los 10 minutos.'],
  ['cd infra', 'Ve a la carpeta de automatización y ensaya un playbook sin tocar nada: ansible-playbook playbooks/chrony.yml --check'],
  ['source ~/admin-openrc', 'Carga las credenciales y mira cuánta RAM le queda a cada hipervisor: openstack hypervisor list --long'],
  ['cat ~/RUNBOOK.md', 'Lee las normas de la casa: qué se hace a mano y qué no.'],
];
function panelLibre() {
  return `<section class="panel"><h3>Laboratorio libre</h3><p style="margin:0 0 10px;font-size:12px;color:var(--muted)">No hay ticket ni reloj de SLA. Pulsa un experimento para escribirlo en la terminal.</p>
    ${EXPERIMENTOS.map(([c, t]) => `<button class="experimento" data-act="escribir" data-cmd="${h(c)}"><code>${h(c)}</code><span>${h(t)}</span></button>`).join('')}
    <button class="btn" style="width:100%;margin-top:6px" data-act="repetir">Dejar la plataforma como nueva</button></section>` + panelCaos() + panelRegistro();
}
function panelCaos() {
  const c = app.caos, msg = app.caosMsg;
  return `<section class="panel caos"><h3>Caos <span class="der-n">${c.length ? c.length + ' provocada' + (c.length > 1 ? 's' : '') : ''}</span></h3>
    <p class="caos-t">Rompe algo al azar sin decirte qué. Pasará en los próximos minutos, como en la vida real: te enterarás por las alertas, si las miras.</p>
    <button class="btn caos-btn" data-act="caos">Provocar una avería</button>
    ${c.length ? `<div class="caos-acc"><button class="btn" data-act="caosComprobar">¿Está todo arreglado?</button><button class="btn" data-act="caosRevelar">Revelar qué era</button></div>` : ''}
    ${msg ? `<div class="caos-msg ${msg.tipo}">${msg.html}</div>` : ''}
  </section>`;
}

// ------------------------------------------------------------------ cierre
function comprobar() {
  const e = app.esc, ev = P.evaluar(app.st, e);
  app.intentos++;
  if (ev.pendientes.length) { app.pendientes = ev.pendientes; pintarPaneles(); return; }
  app.cierre = { trabajo: app.st.reloj, total: app.st.reloj - (e.abierto || 0), pistas: app.pistas, practicas: ev.practicas, intentos: app.intentos };
  const ant = app.progreso[e.id], nuevo = { min: app.st.reloj, pistas: app.pistas, practicas: ev.practicas.filter(x => x.ok).length + '/' + ev.practicas.length };
  if (e.guardia) app.guardias[e.guardia.nivel] = (app.guardias[e.guardia.nivel] || 0) + 1;
  else if (!ant || nuevo.pistas < ant.pistas || (nuevo.pistas === ant.pistas && nuevo.min < ant.min)) app.progreso[e.id] = nuevo;
  guardar({ resueltos: app.progreso, guardias: app.guardias });
  pintarPuesto();
}
function informe() {
  const e = app.esc, st = app.st, p = P.prioridad(e), c = app.cierre;
  const L = [];
  L.push('# ' + e.id + ' · ' + e.asunto, '');
  L.push('| | |', '|---|---|');
  L.push('| Tipo | ' + TIPOS[e.tipo] + (app.modo === 'guardia' ? ' (detectado en guardia)' : '') + ' |');
  L.push('| Origen | ' + e.de + ' |');
  L.push('| Prioridad | ' + p.p + ' (impacto ' + e.impacto + ' × urgencia ' + e.urgencia + '), resolver en ' + (p.sla >= 60 ? p.sla / 60 + ' h' : p.sla + ' min') + ' |');
  L.push('| Inicio de la avería | ' + U.hora(e.inicio || 0) + ' |');
  L.push('| Ticket abierto | ' + U.hora(e.abierto || 0) + ' |');
  L.push('| Resuelto | ' + U.hora(st.reloj) + ' (' + c.total + ' min desde la apertura, ' + (c.total <= p.sla ? 'dentro' : 'fuera') + ' de SLA) |');
  L.push('| Pistas usadas | ' + c.pistas + ' de 3 |', '');
  L.push('## Descripción', '', e.cuerpo.join('\n\n'), '');
  L.push('## Cronología', '');
  st.registro.forEach(x => L.push('- `' + U.hora(x.min) + '` **' + x.host + '** `' + x.cmd.replace(/`/g, "'") + '`'));
  L.push('', '## Causa raíz', '', e.causa, '', '## Solución aplicada', '', e.solucion, '');
  L.push('## Buenas prácticas', '');
  c.practicas.forEach(x => L.push('- [' + (x.ok ? 'x' : ' ') + '] ' + x.t));
  L.push('', '## Lección aprendida', '', e.leccion, '');
  descargar(e.id + '-informe.md', L.join('\n'), 'text/markdown;charset=utf-8');
}

// ------------------------------------------------------------------ eventos
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'cola') { app.vista = 'cola'; vistaCola(); window.scrollTo(0, 0); return; }
  if (act === 'tema') { const o = document.body.classList.toggle('oscuro'); try { localStorage.setItem('puesto-tema', o ? 'oscuro' : 'claro'); } catch (e) { /* nada */ } return; }
  if (act === 'filtro') { app.filtro = b.dataset.id || null; vistaCola(); return; }
  if (act === 'abrir') { abrir('ticket', P.escenario(b.dataset.id)); return; }
  if (act === 'guardia') { app.guardiaPanel = !app.guardiaPanel; vistaCola(); return; }
  if (act === 'guardiaNivel') {
    const campo = $('#semilla'), v = campo && parseInt(campo.value, 10);
    const semilla = v > 0 ? v : 100000 + Math.floor(Math.random() * 900000);
    const g = P.generarGuardia(+b.dataset.n, semilla);
    if (g.ok) abrir('guardia', g.escenario); else alert('No ha salido una guardia jugable con esa semilla. Prueba otra.');
    return;
  }
  if (act === 'guardiaTicket') {
    const pool = P.escenarios.concat(P.importadas).filter(e => e.tipo === 'incidente' && P.alertasActivas(P.preparar(e)).length);
    abrir('guardia', pool[Math.floor(Math.random() * pool.length)]); return;
  }
  if (act === 'guardiaJson') { const d = app.esc.fuente; descargar(d.id.toLowerCase() + '.json', JSON.stringify(d, null, 2), 'application/json'); return; }
  if (act === 'caos') {
    const c = P.provocarCaos(app.st, 1 + Math.floor(Math.random() * 1e9), [].concat(...app.caos.map(x => x.averias)));
    if (c) { app.caos.push(c); app.caosMsg = { tipo: 'aviso', html: 'Hecho. Algo se romperá en los próximos minutos. Los comandos hacen pasar el tiempo; <code>sleep 60</code> también.' }; }
    else app.caosMsg = { tipo: 'aviso', html: 'Ya hay demasiadas cosas rotas a la vez: arregla algo antes de pedir más.' };
    pintarPaneles(); return;
  }
  if (act === 'caosComprobar') {
    const futuras = app.caos.filter(c => c.cuando > app.st.reloj).length, p = P.pendientesCaos(app.st, app.caos);
    app.caosMsg = futuras ? { tipo: 'aviso', html: 'Todavía no ha pasado todo lo que provocaste. Deja correr el tiempo (<code>sleep 60</code>) y mira las alertas.' }
      : p.length ? { tipo: 'mal', html: 'Aún queda algo roto: <b>' + p.length + '</b> cosa' + (p.length > 1 ? 's' : '') + ' sin arreglar. Las alertas y <code>systemctl --failed</code> te dicen dónde.' }
      : { tipo: 'ok', html: '✓ Todo arreglado: lo que rompiste, y lo que arrastró, está sano.' };
    pintarPaneles(); return;
  }
  if (act === 'caosRevelar') {
    app.caosMsg = { tipo: 'aviso', html: 'Lo que provocaste:<ul>' + app.caos.map(c => '<li><b>' + h(c.familia.titulo) + '</b> a las ' + U.hora(c.cuando) + ' · ' + c.averias.map(a => h(a.tipo) + (a.nodo ? ' en ' + h(a.nodo) : a.osd != null ? ' (osd.' + a.osd + ')' : '')).join(', ') + '<br><span>' + h(c.familia.leccion.charAt(0).toUpperCase() + c.familia.leccion.slice(1)) + '.</span></li>').join('') + '</ul>' };
    pintarPaneles(); return;
  }
  if (act === 'libre') { abrir('libre', null); return; }
  if (act === 'repetir') { abrir(app.modo, app.esc); return; }
  if (act === 'cerrarTab') { ev.stopPropagation(); app.tabs.splice(+b.dataset.i, 1); app.activa = Math.min(app.activa, app.tabs.length - 1); pintarTerminal(); $('#termIn').focus(); return; }
  if (act === 'tab') { app.activa = +b.dataset.i; pintarTerminal(); $('#termIn').focus(); return; }
  if (act === 'nuevaTab') { nuevaTab(); tab().lineas.push({ t: 'Nueva sesión en el bastión.', c: 'dim' }); pintarTerminal(); pintarPaneles(); $('#termIn').focus(); return; }
  if (act === 'ssh') {
    const n = b.dataset.host;
    if (app.tabs.length < MAX_TABS) nuevaTab(n); else { app.activa = app.tabs.length - 1; correrEn(tab(), 'ssh ' + n); }
    pintarTerminal(); pintarPaneles(); $('#termIn').focus(); return;
  }
  if (act === 'pista') { app.pistas = Math.min(app.esc.pistas.length, app.pistas + 1); pintarPaneles(); return; }
  if (act === 'comprobar') { comprobar(); return; }
  if (act === 'informe') { informe(); return; }
  if (act === 'importar') { const f = $('#fichero'); if (f) { f.value = ''; f.click(); } return; }
  if (act === 'exportar') { const s = $('#plantilla'), e = s && P.escenario(s.value); if (e) descargar(P.exportarIncidencia(e).id.toLowerCase() + '.json', JSON.stringify(P.exportarIncidencia(e), null, 2), 'application/json'); return; }
  if (act === 'borrarImp') { const fuentes = importadas.map(x => x.fuente).filter(x => (x.id || '') !== b.dataset.id); guardarImp(fuentes); recargarImportadas(fuentes); app.impResultado = null; vistaCola(); return; }
  if (act === 'escribir') { const i = $('#termIn'); i.value = b.dataset.cmd; i.focus(); return; }
});
// Escribir en cualquier parte del puesto va a la terminal.
document.addEventListener('keydown', ev => {
  if (app.vista !== 'puesto' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.key.length !== 1) return;
  const a = document.activeElement;
  if (a && (a.id === 'termIn' || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  const i = $('#termIn'); if (i) i.focus();
});

// Importar: el selector de ficheros y arrastrar sobre la tarjeta.
document.addEventListener('change', ev => { if (ev.target && ev.target.id === 'fichero') importarFicheros(ev.target.files); });
document.addEventListener('dragover', ev => { const z = ev.target.closest && ev.target.closest('#zonaImp'); if (z) { ev.preventDefault(); z.classList.add('encima'); } });
document.addEventListener('dragleave', ev => { const z = ev.target.closest && ev.target.closest('#zonaImp'); if (z) z.classList.remove('encima'); });
document.addEventListener('drop', ev => { const z = ev.target.closest && ev.target.closest('#zonaImp'); if (!z) return; ev.preventDefault(); z.classList.remove('encima'); importarFicheros(ev.dataTransfer && ev.dataTransfer.files); });

recargarImportadas(leerImp());
try { const t = localStorage.getItem('puesto-tema'); if (t === 'oscuro' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.body.classList.add('oscuro'); } catch (e) { /* nada */ }
// index.html#INC-4821 abre ese ticket directamente (lo usa el solucionario).
const deHash = P.escenario(decodeURIComponent((location.hash || '').slice(1)));
if (deHash) { history.replaceState(null, '', location.pathname); abrir('ticket', deHash); } else vistaCola();
})();
