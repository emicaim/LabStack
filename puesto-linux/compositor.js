// Puesto · compositor de incidencias.
//
// Un formulario sobre el catálogo de averías. Cada campo sale de
// P.camposAveria, así que un tipo de avería nuevo aparece aquí sin tocar
// esta página. Mientras se edita, la incidencia se valida y se ENSAYA con el
// mismo cargador que usa «Importar» (incidencias.js): lo que aquí sale jugable
// es exactamente lo que el puesto aceptará.
(function () {
'use strict';
const P = window.PUESTO, U = P.u;
const $ = s => document.querySelector(s);
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CLAVE_IMP = 'puesto-linux-importadas', CLAVE_BORRADOR = 'puesto-linux-borrador';
const leer = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } };
const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
const copia = o => JSON.parse(JSON.stringify(o));

// La plataforma de partida, para ofrecer nodos, servicios, ficheros y VMs reales.
const BASE = P.crear();
const NODOS = P.topologia.filter(d => d.n !== 'bastion');
const ROL = { ctl: 'controlador', cmp: 'hipervisor', ceph: 'Ceph', mon: 'monitorización' };
const VMS_COPIA = BASE.os.imagenesExtra.filter(i => /-20260923$/.test(i.nombre)).map(i => i.nombre.replace(/^backup-/, '').replace(/-20260923$/, ''));

const nueva = () => ({ formato: P.FORMATO_INCIDENCIA, asunto: '', de: '', cuerpo: [''], impacto: 'medio', urgencia: 'alta', tipo: 'incidente', nivel: 2, hace: 30, abiertoHace: 10, autor: '', averias: [] });
const est = { def: leer(CLAVE_BORRADOR, null) || nueva(), res: null, vista: null, msg: null, errAv: [] };
if (!Array.isArray(est.def.averias)) est.def.averias = [];
if (!Array.isArray(est.def.cuerpo)) est.def.cuerpo = [''];

// Lo que se valida y se guarda: sin campos vacíos opcionales.
function limpio(def) {
  const d = copia(def);
  ['id', 'de', 'autor', 'area', 'causa', 'solucion', 'leccion'].forEach(k => { if (d[k] == null || !String(d[k]).trim()) delete d[k]; });
  d.cuerpo = (d.cuerpo || []).map(x => String(x).trim()).filter(Boolean);
  if (Array.isArray(d.pistas) && d.pistas.every(x => !String(x || '').trim())) delete d.pistas;
  d.averias = (d.averias || []).map(a => { const x = Object.assign({}, a); Object.keys(x).forEach(k => { if (x[k] === '' || x[k] == null) delete x[k]; }); return x; });
  return d;
}

// ------------------------------------------------------------------ campos
function opciones(lista, valor, vacio) {
  return (vacio != null ? `<option value="">${h(vacio)}</option>` : '') + lista.map(o => { const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return `<option value="${h(v)}"${String(valor) === String(v) ? ' selected' : ''}>${h(t)}</option>`; }).join('');
}
function campo(a, i, c) {
  const v = a[c.k], id = 'f' + i + '-' + c.k, base = `data-i="${i}" data-k="${c.k}" data-t="${c.t}" id="${id}"`;
  const etiqueta = `<span>${h(c.etiqueta || c.k)}${c.opcional ? ' <em>opcional</em>' : ''}</span>`;
  let ctl;
  switch (c.t) {
    case 'nodo': ctl = `<select ${base}>${opciones(NODOS.filter(d => !c.roles || c.roles.indexOf(d.rol) >= 0).map(d => [d.n, d.n + ' · ' + ROL[d.rol]]), v, v ? null : 'elige un nodo')}</select>`; break;
    case 'servicio': { const hs = BASE.hosts[a.nodo]; ctl = `<select ${base}${hs ? '' : ' disabled'}>${opciones(hs ? Object.keys(hs.svcs) : [], v, hs ? (v ? null : 'elige un servicio') : 'primero el nodo')}</select>`; break; }
    case 'motivo': ctl = `<select ${base}>${opciones(Object.keys(P.motivos).sort(), v, '(genérico)')}</select>`; break;
    case 'opciones': ctl = `<select ${base}>${opciones(c.opciones, v)}</select>`; break;
    case 'osd': ctl = `<select ${base}>${opciones([0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, 'osd.' + n + ' · ceph0' + (Math.floor(n / 3) + 1)]), v)}</select>`; break;
    case 'proyecto': ctl = `<select ${base}>${opciones(Object.keys(BASE.os.proyectos), v)}</select>`; break;
    case 'flavor': ctl = `<select ${base}>${opciones(Object.keys(P.FLAVORS), v)}</select>`; break;
    case 'vm': ctl = `<select ${base}>${opciones(VMS_COPIA, v, v ? null : 'elige una VM con copia')}</select>`; break;
    case 'bool': return `<label class="cf cf-bool"><input type="checkbox" ${base}${v ? ' checked' : ''}> ${etiqueta}</label>`;
    case 'num': ctl = `<input type="number" ${base} value="${v == null ? '' : h(v)}"${c.min != null ? ' min="' + c.min + '"' : ''}${c.max != null ? ' max="' + c.max + '"' : ''} step="${c.paso || 1}">`; break;
    case 'fichero': { const hs = BASE.hosts[a.nodo], dl = 'dl' + i; ctl = `<input type="text" ${base} list="${dl}" value="${h(v || '')}" placeholder="/var/log/…"><datalist id="${dl}">${hs ? Object.keys(hs.logs).filter(p => !/journal|\.gz$|\.\d$/.test(p)).map(p => '<option value="' + h(p) + '">').join('') : ''}</datalist>`; break; }
    case 'minutos': ctl = `<input type="text" ${base} value="${h((v || []).join(', '))}" placeholder="6, 5, 3">`; break;
    case 'lista': ctl = `<input type="text" ${base} value="${h((v || []).join(', '))}">`; break;
    case 'nodos': return `<div class="cf cf-ancho">${etiqueta}<div class="cf-checks">${NODOS.filter(d => !d.nuevo && (!c.roles || c.roles.indexOf(d.rol) >= 0)).map(d => `<label><input type="checkbox" data-i="${i}" data-k="${c.k}" data-t="nodos" data-sub="${d.n}"${(v || []).indexOf(d.n) >= 0 ? ' checked' : ''}> ${d.n}</label>`).join('')}</div></div>`;
    case 'memoria': return `<div class="cf cf-ancho">${etiqueta}<div class="cf-checks">${['ctl01', 'ctl02', 'ctl03'].map(n => `<label>${n} <input type="number" min="0" max="64" data-i="${i}" data-k="${c.k}" data-t="memoria" data-sub="${n}" value="${v && v[n] != null ? v[n] : ''}"></label>`).join('')}</div></div>`;
    case 'lineas': return `<label class="cf cf-ancho">${etiqueta}<textarea ${base} rows="3" placeholder="7 | 2.7f deep-scrub starts">${h((v || []).map(l => l.hace + ' | ' + l.t).join('\n'))}</textarea></label>`;
    default: ctl = `<input type="text" ${base} value="${h(v || '')}">`;
  }
  return `<label class="cf" for="${id}">${etiqueta}${ctl}</label>`;
}
function leerCampo(el) {
  const t = el.dataset.t, v = el.value;
  if (t === 'bool') return el.checked ? true : undefined;
  if (t === 'num' || t === 'osd') return v === '' ? undefined : Number(v);
  if (t === 'minutos') return v.split(/[,\s]+/).filter(Boolean).map(Number).filter(n => !isNaN(n));
  if (t === 'lista') return v.split(',').map(x => x.trim()).filter(Boolean);
  if (t === 'lineas') return v.split('\n').map(l => { const m = /^\s*(\d+)\s*\|\s*(.+)$/.exec(l); return m ? { hace: +m[1], t: m[2].trim() } : null; }).filter(Boolean);
  return v === '' ? undefined : v;
}

// ------------------------------------------------------------------ vista
const TIPOS = Object.keys(P.averias);
const tipoOpciones = sel => `<optgroup label="Rompen algo">${opciones(TIPOS.filter(t => !P.averias[t].condicion).map(t => [t, P.averias[t].titulo]), sel)}</optgroup><optgroup label="Condiciones (preparan, no rompen)">${opciones(TIPOS.filter(t => P.averias[t].condicion).map(t => [t, P.averias[t].titulo]), sel)}</optgroup>`;
function tarjetaAveria(a, i) {
  const t = P.averias[a.tipo], n = est.def.averias.length;
  if (!t) return `<div class="av-card av-mala"><b>Avería ${i + 1}: tipo desconocido «${h(a.tipo)}»</b><button class="btn" data-act="quitar" data-i="${i}">Quitar</button></div>`;
  return `<div class="av-card${t.condicion ? ' av-cond' : ''}">
    <div class="av-cab">
      <span class="av-n">${i + 1}</span>
      <select class="av-tipo" data-i="${i}" data-act-cambio="tipo" aria-label="Tipo de la avería ${i + 1}">${tipoOpciones(a.tipo)}</select>
      <span class="av-acc">
        <button data-act="subir" data-i="${i}" title="Subir"${i === 0 ? ' disabled' : ''} aria-label="Subir">↑</button>
        <button data-act="bajar" data-i="${i}" title="Bajar"${i === n - 1 ? ' disabled' : ''} aria-label="Bajar">↓</button>
        <button data-act="quitar" data-i="${i}" title="Quitar" aria-label="Quitar">×</button>
      </span>
    </div>
    ${t.descripcion ? '<p class="av-desc">' + h(t.descripcion) + '</p>' : ''}
    <p class="av-err" role="status"></p>
    <div class="av-campos">${(P.camposAveria[a.tipo] || []).map(c => campo(a, i, c)).join('') || '<p class="av-desc">No tiene parámetros.</p>'}</div>
    ${a.soloPractica ? '<p class="av-desc">Marcada como «sólo práctica»: se aplica y cuenta como buena práctica arreglarla, pero no impide cerrar.</p>' : ''}
  </div>`;
}
function origenes() {
  const imp = leer(CLAVE_IMP, []).filter(x => x && x.id);
  return `<option value="">Empezar desde…</option><option value="blanco">Una incidencia en blanco</option>
    <optgroup label="Un ticket del puesto">${P.exportables().map(e => `<option value="t:${e.id}">${e.id} · ${h(e.asunto)}</option>`).join('')}</optgroup>
    ${imp.length ? `<optgroup label="Una incidencia importada">${imp.map(x => `<option value="i:${h(x.id)}">${h(x.id)} · ${h(x.asunto || '')}</option>`).join('')}</optgroup>` : ''}
    <optgroup label="Una guardia generada al azar">${[1, 2, 3].map(n => `<option value="g:${n}">Guardia ${P.nivelesGuardia[n].toLowerCase()}</option>`).join('')}</optgroup>`;
}
function pintar() {
  const d = est.def;
  $('#vista').innerHTML = `<div class="comp">
    <div class="comp-form">
      <section class="comp-cab">
        <h1>Compositor de incidencias</h1>
        <p>Combina averías del catálogo y escribe el ticket. A la derecha, el puesto la ensaya mientras escribes: lo que verá quien la juegue, lo que tendrá que arreglar y si tiene arreglo.</p>
        <div class="comp-origen">
          <select id="origen" aria-label="Punto de partida">${origenes()}</select>
          <button class="btn" data-act="cargar">Cargar</button>
          <button class="btn" data-act="fichero">Abrir .json</button>
          <input type="file" id="fichero" accept=".json,application/json" hidden>
        </div>
      </section>

      <section class="card comp-sec">
        <h2>El ticket</h2>
        <div class="comp-grid">
          <label class="cf cf-ancho"><span>asunto</span><input type="text" data-top="asunto" maxlength="160" value="${h(d.asunto)}" placeholder="Lo que pone el ticket, en una línea"></label>
          <label class="cf cf-ancho"><span>cuerpo <em>párrafos separados por una línea en blanco</em></span><textarea data-top="cuerpo" rows="4" placeholder="Lo que cuenta quien abre el ticket. Sin dar la causa.">${h((d.cuerpo || []).join('\n\n'))}</textarea></label>
          <label class="cf"><span>de <em>opcional</em></span><input type="text" data-top="de" value="${h(d.de || '')}" placeholder="Monitorización, un equipo…"></label>
          <label class="cf"><span>tipo</span><select data-top="tipo">${opciones([['incidente', 'Incidente'], ['peticion', 'Petición'], ['cambio', 'Cambio']], d.tipo)}</select></label>
          <label class="cf"><span>impacto</span><select data-top="impacto">${opciones(['alto', 'medio', 'bajo'], d.impacto)}</select></label>
          <label class="cf"><span>urgencia</span><select data-top="urgencia">${opciones(['alta', 'media', 'baja'], d.urgencia)}</select></label>
          <label class="cf"><span>nivel</span><select data-top="nivel" data-num="1">${opciones([[1, '1 · fácil'], [2, '2 · medio'], [3, '3 · difícil']], d.nivel)}</select></label>
          <label class="cf"><span>la avería empezó hace (min)</span><input type="number" min="0" max="10080" data-top="hace" data-num="1" value="${d.hace == null ? '' : d.hace}"></label>
          <label class="cf"><span>el ticket se abrió hace (min)</span><input type="number" min="0" max="10080" data-top="abiertoHace" data-num="1" value="${d.abiertoHace == null ? '' : d.abiertoHace}"></label>
          <label class="cf"><span>id <em>opcional</em></span><input type="text" data-top="id" value="${h(d.id || '')}" placeholder="EXT-001"></label>
          <label class="cf"><span>autor <em>opcional</em></span><input type="text" data-top="autor" value="${h(d.autor || '')}"></label>
        </div>
      </section>

      <section class="card comp-sec">
        <h2>Las averías <span class="der-n">${d.averias.length} de 12</span></h2>
        <div class="av-lista">${d.averias.map(tarjetaAveria).join('') || '<p class="vacio">Todavía ninguna. Añade una avería suelta o una familia entera (averías que tienen sentido juntas).</p>'}</div>
        <div class="av-nueva">
          <select id="nuevoTipo" aria-label="Tipo de avería que añadir">${tipoOpciones('servicio-caido')}</select>
          <button class="btn" data-act="anadir"${d.averias.length >= 12 ? ' disabled' : ''}>+ Añadir avería</button>
          <select id="nuevaFamilia" aria-label="Familia que añadir">${P.familias.map(f => `<option value="${f.id}">${h(f.titulo)} · nivel ${f.nivel}</option>`).join('')}</select>
          <button class="btn" data-act="familia"${d.averias.length >= 12 ? ' disabled' : ''}>+ Añadir familia</button>
        </div>
      </section>

      <details class="card comp-sec"${d.pistas || d.causa || d.leccion || d.solucion ? ' open' : ''}>
        <summary><h2>Textos didácticos <em>opcionales: si se dejan vacíos, se generan</em></h2></summary>
        <div class="comp-grid">
          ${[0, 1, 2].map(n => `<label class="cf cf-ancho"><span>pista ${n + 1}</span><textarea rows="2" data-top="pista" data-n="${n}" maxlength="400">${h((d.pistas || [])[n] || '')}</textarea></label>`).join('')}
          <label class="cf cf-ancho"><span>causa</span><textarea rows="2" data-top="causa" maxlength="1500">${h(d.causa || '')}</textarea></label>
          <label class="cf cf-ancho"><span>solución</span><textarea rows="2" data-top="solucion" maxlength="1500">${h(d.solucion || '')}</textarea></label>
          <label class="cf cf-ancho"><span>lo que se lleva quien la resuelva</span><textarea rows="2" data-top="leccion" maxlength="1500">${h(d.leccion || '')}</textarea></label>
        </div>
      </details>
    </div>
    <aside class="comp-ensayo" id="ensayo" aria-live="polite"></aside>
  </div>`;
  pintarEnsayo();
}
function pintarEnsayo() {
  const r = est.res, v = est.vista;
  const estado = !r ? '' : r.ok
    ? `<div class="imp-res ok"><b>✓ Jugable</b><span>Se ha aplicado sobre una plataforma nueva y su solución de referencia la resuelve.</span>${r.avisos.map(a => '<span class="imp-aviso">! ' + h(a) + '</span>').join('')}</div>`
    : `<div class="imp-res mal"><b>Todavía no se puede jugar</b><ul>${r.errores.map(e => '<li>' + h(e) + '</li>').join('')}</ul>${(r.avisos || []).map(a => '<span class="imp-aviso">! ' + h(a) + '</span>').join('')}</div>`;
  const e = v && v.e, p = e && P.prioridad(e);
  const cifras = v ? `<div class="cifras"><div><b>${p && p.p ? p.p : '—'}</b><span>${p && p.sla ? 'SLA ' + (p.sla >= 60 ? p.sla / 60 + ' h' : p.sla + ' min') : 'prioridad'}</span></div><div><b>${v.alertas.length}</b><span>alertas</span></div><div><b>${r && r.ensayo ? r.ensayo.comandos : v.guion.length}</b><span>comandos de solución</span></div></div>` : '';
  const bloque = (t, cont) => `<div class="bloque"><h4>${t}</h4>${cont}</div>`;
  $('#ensayo').innerHTML = `<section class="panel">
    <h3>Ensayo</h3>
    ${estado}${cifras}
    ${v ? bloque('Lo que verá quien juegue (alertas)', v.alertas.length ? v.alertas.map(a => `<div class="alerta al-${a.sev}"><i></i><div><b>${h(a.nombre)}</b><span>${h((a.host ? a.host + ' · ' : '') + a.res)}</span></div><small></small></div>`).join('') : '<p class="vacio">Ninguna: en guardia nadie la encontraría.</p>')
      + bloque('Lo que tendrá que dejar arreglado', v.pendientes.length ? '<ul class="lista-p">' + v.pendientes.map(x => '<li>' + h(x) + '</li>').join('') + '</ul>' : '<p class="vacio">Nada: así la plataforma nace sana.</p>')
      + bloque('Pistas', '<ol class="lista-p">' + e.pistas.map(x => '<li>' + h(x) + '</li>').join('') + '</ol>')
      + bloque('Solución de referencia', '<div class="sol-ref">' + v.guion.map(c => '<code>' + h(c) + '</code>').join('') + '</div>')
      : '<p class="vacio">Añade al menos una avería válida para ver el ensayo.</p>'}
    <div class="acciones">
      <button class="btn primario" data-act="probar"${r && r.ok ? '' : ' disabled'}>Probarla en el puesto</button>
      <button class="btn" data-act="guardar"${r && r.ok ? '' : ' disabled'}>Guardar en la cola</button>
      <button class="btn" data-act="descargar"${r && r.ok ? '' : ' disabled'}>Descargar .json</button>
    </div>
    ${est.msg ? '<p class="comp-msg">' + est.msg + '</p>' : ''}
  </section>`;
}

// ------------------------------------------------------------------ ensayo
let espera = null;
function ensayar() {
  const d = limpio(est.def);
  escribir(CLAVE_BORRADOR, est.def);
  est.res = P.cargarIncidencia(d);
  est.vista = null;
  // El cargador se para en los errores de estructura; las averías se validan
  // siempre, para señalar cada una en su tarjeta mientras se rellena el ticket.
  est.errAv = d.averias.length && d.averias.every(a => P.averias[a.tipo]) ? P.validarAverias(d.averias) : [];
  if (!est.res.ok) est.errAv.forEach(x => { if (est.res.errores.indexOf(x) < 0) est.res.errores.push(x); });
  document.querySelectorAll('.av-card').forEach((c, i) => {
    const m = est.errAv.filter(x => x.indexOf('avería ' + (i + 1) + ' ') === 0 || new RegExp('^las averías (\\d+ y )?' + (i + 1) + '\\b').test(x));
    c.classList.toggle('av-error', m.length > 0);
    const p = c.querySelector('.av-err'); if (p) p.textContent = m.map(x => x.replace(/^avería \d+ \([^)]*\): /, '')).join(' · ');
  });
  if (d.averias.length && !est.errAv.length) {
    try {
      const e = P.construirIncidencia(Object.assign({}, d, { asunto: d.asunto || '(sin asunto)', cuerpo: d.cuerpo.length ? d.cuerpo : ['(sin cuerpo)'] }));
      const st = P.preparar(e);
      est.vista = { e, alertas: P.alertasActivas(st), pendientes: e.resuelto(st, P), guion: P.guionDe(e, st) };
    } catch (x) { est.vista = null; }
  }
  pintarEnsayo();
}
const pronto = () => { clearTimeout(espera); espera = setTimeout(ensayar, 220); };

function guardarEnCola() {
  const r = est.res; if (!r || !r.ok) return null;
  const id = r.escenario.id, d = Object.assign(limpio(est.def), { id });
  const lista = leer(CLAVE_IMP, []).filter(x => x && x.id !== id);
  lista.push(d); escribir(CLAVE_IMP, lista);
  est.def.id = id;
  return id;
}
function descargar(nombre, texto) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function cargar(def, origen) {
  est.def = Object.assign(nueva(), copia(def));
  if (!Array.isArray(est.def.cuerpo)) est.def.cuerpo = [''];
  est.msg = 'Cargado: ' + h(origen) + '.';
  pintar(); ensayar();
}

// ------------------------------------------------------------------ eventos
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.top) {
    const k = el.dataset.top, d = est.def;
    if (k === 'cuerpo') d.cuerpo = el.value.split(/\n\s*\n/);
    else if (k === 'pista') { d.pistas = d.pistas || ['', '', '']; d.pistas[+el.dataset.n] = el.value; }
    else if (el.dataset.num) d[k] = el.value === '' ? undefined : Number(el.value);
    else d[k] = el.value;
    pronto(); return;
  }
  if (el.dataset.k != null && el.dataset.i != null && el.dataset.t) {
    const a = est.def.averias[+el.dataset.i], k = el.dataset.k, t = el.dataset.t;
    if (t === 'nodos') { const s = new Set(a[k] || []); if (el.checked) s.add(el.dataset.sub); else s.delete(el.dataset.sub); a[k] = NODOS.map(n => n.n).filter(n => s.has(n)); }
    else if (t === 'memoria') { a[k] = Object.assign({}, a[k]); if (el.value === '') delete a[k][el.dataset.sub]; else a[k][el.dataset.sub] = Number(el.value); }
    else { const v = leerCampo(el); if (v === undefined) delete a[k]; else a[k] = v; }
    // cambiar de nodo cambia los servicios y ficheros que tiene sentido ofrecer
    if (t === 'nodo') {
      const hs = BASE.hosts[a.nodo];
      if (a.servicio && !(hs && hs.svcs[a.servicio])) delete a.servicio;
      pintar();
    }
    pronto();
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset.actCambio === 'tipo') {
    const i = +el.dataset.i, t = el.value;
    est.def.averias[i] = Object.assign({ tipo: t }, copia(P.averias[t].ejemplo));
    pintar(); ensayar(); return;
  }
  if (el.id === 'fichero' && el.files && el.files[0]) {
    const f = el.files[0], rd = new FileReader();
    rd.onload = () => { let d; try { d = JSON.parse(String(rd.result)); } catch (e) { est.msg = 'No es un JSON válido: ' + h(e.message); pintarEnsayo(); return; } if (!d || typeof d !== 'object' || Array.isArray(d)) { est.msg = 'El fichero no contiene una incidencia.'; pintarEnsayo(); return; } cargar(d, f.name); };
    rd.readAsText(f);
  }
});
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, av = est.def.averias, i = +b.dataset.i;
  if (act === 'tema') { const o = document.body.classList.toggle('oscuro'); try { localStorage.setItem('puesto-tema', o ? 'oscuro' : 'claro'); } catch (e) { /* nada */ } return; }
  if (act === 'anadir') { const t = $('#nuevoTipo').value; av.push(Object.assign({ tipo: t }, copia(P.averias[t].ejemplo))); est.msg = null; pintar(); ensayar(); return; }
  if (act === 'familia') {
    const f = P.familias.find(x => x.id === $('#nuevaFamilia').value);
    f.crear(P.azar(1 + Math.floor(Math.random() * 1e9))).forEach(a => { if (av.length < 12) av.push(a); });
    est.msg = null; pintar(); ensayar(); return;
  }
  if (act === 'quitar') { av.splice(i, 1); pintar(); ensayar(); return; }
  if (act === 'subir' && i > 0) { [av[i - 1], av[i]] = [av[i], av[i - 1]]; pintar(); ensayar(); return; }
  if (act === 'bajar' && i < av.length - 1) { [av[i + 1], av[i]] = [av[i], av[i + 1]]; pintar(); ensayar(); return; }
  if (act === 'fichero') { const f = $('#fichero'); f.value = ''; f.click(); return; }
  if (act === 'cargar') {
    const v = $('#origen').value;
    if (v === 'blanco') { est.def = nueva(); est.msg = 'Incidencia en blanco.'; pintar(); ensayar(); return; }
    if (v.indexOf('t:') === 0) { cargar(P.exportarIncidencia(P.escenario(v.slice(2))), 'el ticket ' + v.slice(2)); return; }
    if (v.indexOf('i:') === 0) { const d = leer(CLAVE_IMP, []).find(x => x.id === v.slice(2)); if (d) cargar(d, 'la incidencia ' + v.slice(2)); return; }
    if (v.indexOf('g:') === 0) { const g = P.generarGuardia(+v.slice(2), 1 + Math.floor(Math.random() * 999999)); if (g.ok) { const d = copia(g.def); delete d.id; d.asunto = d.asunto.replace(/^Guardia/, 'Noche'); cargar(d, 'una guardia ' + P.nivelesGuardia[+v.slice(2)].toLowerCase()); } return; }
    return;
  }
  if (act === 'guardar') { const id = guardarEnCola(); if (id) { est.msg = '✓ Guardada en la cola como <b>' + h(id) + '</b>. La verás en «Incidencias importadas».'; pintar(); ensayar(); } return; }
  if (act === 'probar') { const id = guardarEnCola(); if (id) location.href = './index.html#' + encodeURIComponent(id); return; }
  if (act === 'descargar') { const r = est.res; if (r && r.ok) descargar(r.escenario.id.toLowerCase() + '.json', JSON.stringify(Object.assign(limpio(est.def), { id: r.escenario.id }), null, 2)); return; }
});

try { const t = localStorage.getItem('puesto-tema'); if (t === 'oscuro' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.body.classList.add('oscuro'); } catch (e) { /* nada */ }
pintar(); ensayar();
P.compositor = { est, pintar, ensayar, cargar, limpio, guardarEnCola };   // para puesto-test.js
})();
