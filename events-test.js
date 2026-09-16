// Recorre la consola de eventos y el puente hacia el ticket.
// Comprueba lo que hace que la pantalla enseñe algo: que los síntomas cuelguen
// de su causa, que cerrar una causa se lleve sus síntomas, que el ruido no
// pueda abrir incidencia, y que del evento salga el ticket correcto con su
// histórico.
//   node events-test.js
const fs = require('fs'), path = require('path');
const D = __dirname;
const src = fs.readFileSync(path.join(D, 'Laboratorio.dc.html'), 'utf8');
const code = src.match(/<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/)[1];
class DCLogic { constructor() { this.props = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); } }
const win = { location: { hash: '', search: '', pathname: '/' }, addEventListener() {} };
['piezas', 'capas', 'textos', 'retos', 'kids', 'tickets', 'eventos'].forEach(n =>
  new Function('window', fs.readFileSync(path.join(D, 'contenido', n + '.js'), 'utf8'))(win));
const doc = { addEventListener() {}, createElement: () => ({ style: {}, click() {} }), head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} }, querySelector: () => null, querySelectorAll: () => [] };
const C = new Function('DCLogic', 'StreamableLogic', 'React', 'localStorage', 'window', 'document', 'setInterval', 'clearInterval', 'setTimeout',
  code + '\nreturn Component;')(DCLogic, DCLogic, { createElement: () => ({}), Fragment: 'F' }, { getItem: () => null, setItem() {}, removeItem() {} }, win, doc, () => 0, () => {}, () => 0);

let fail = 0;
const mal = m => { console.error('  ✕ ' + m); fail++; };
const bien = m => console.log('  ✓ ' + m);
const c = new C(); c.props = {}; c.setState({ mode: 'events' });
const evs = c.eventos(), ids = new Set(evs.map(e => e.id));
const tickIds = new Set(c.tickets().map(t => t.id));
const hostIds = new Set(c.deskHosts().map(h => h.id));

console.log('Consola de eventos\n');

// --- integridad del contenido ---
let bad = 0;
evs.forEach(e => {
  if (!hostIds.has(e.node)) { mal(e.id + ': equipo inexistente ' + e.node); bad++; }
  if (e.ticket && !tickIds.has(e.ticket)) { mal(e.id + ': apunta a un ticket que no existe (' + e.ticket + ')'); bad++; }
  (e.related || []).forEach(r => { if (!ids.has(r)) { mal(e.id + ': síntoma inexistente ' + r); bad++; } });
  if (e.symptomOf && !ids.has(e.symptomOf)) { mal(e.id + ': cuelga de una causa inexistente'); bad++; }
  if (!e.title || !e.title.es || !e.title.en) { mal(e.id + ': sin título en los dos idiomas'); bad++; }
  if (!e.text || !e.text.es || !e.text.en) { mal(e.id + ': sin descripción en los dos idiomas'); bad++; }
  if (e.cause && e.noise) { mal(e.id + ': no puede ser causa y ruido a la vez'); bad++; }
});
// la correlación tiene que ser recíproca o la pantalla miente
evs.filter(e => e.symptomOf).forEach(e => {
  const padre = evs.find(x => x.id === e.symptomOf);
  if (padre && (padre.related || []).indexOf(e.id) < 0) { mal(e.id + ': dice colgar de ' + padre.id + ' pero el padre no lo lista'); bad++; }
});
evs.filter(e => (e.related || []).length).forEach(e => {
  (e.related || []).forEach(r => { const h = evs.find(x => x.id === r);
    if (h && h.symptomOf !== e.id) { mal(e.id + ': lista a ' + r + ' pero ese no dice colgar de él'); bad++; } });
});
if (!bad) {
  const causas = evs.filter(e => e.cause).length, sint = evs.filter(e => e.symptomOf).length, ruido = evs.filter(e => e.noise).length;
  bien(evs.length + ' eventos: ' + causas + ' causas, ' + sint + ' síntomas correlados y ' + ruido + ' de ruido');
}

// --- la vista ---
let v = c.renderVals().events;
if (v.rows.length !== evs.length) mal('la lista no muestra todos los eventos abiertos');
else bien('la consola abre con los ' + v.rows.length + ' eventos, ordenados por gravedad');
if (v.counts.reduce((s, x) => s + Number(x.count), 0) !== evs.length) mal('los contadores por gravedad no cuadran');
else bien('contadores por gravedad: ' + v.counts.map(x => x.label + ' ' + x.count).join(', '));

// --- reconocer una causa se lleva sus síntomas ---
const causa = evs.find(e => e.cause && (e.related || []).length);
v.rows.find(r => r.id === causa.id).onClick();
v = c.renderVals().events;
if (!v.hasSel || v.det.id !== causa.id) mal('no se puede seleccionar un evento');
if (!v.det.hasKids || v.det.kids.length !== causa.related.length) mal('el detalle no enseña los síntomas correlados');
else bien(causa.id + ' agrupa ' + v.det.kids.length + ' síntomas y el detalle los muestra');
v.det.onAck();
v = c.renderVals().events;
const pend = [causa.id].concat(causa.related).filter(id => {
  const r = v.rows.find(x => x.id === id); return r && r.state !== 'Reconocido';
});
if (pend.length) mal('reconocer la causa no reconoce sus síntomas: ' + pend.join(', '));
else bien('acusar recibo de la causa reconoce también sus ' + causa.related.length + ' síntomas');

// --- del evento sale el ticket, con su rastro en el histórico ---
v.rows.find(r => r.id === causa.id).onClick();
v = c.renderVals().events;
if (!v.det.canRaise) mal('una causa con ticket no ofrece crear incidencia');
v.det.onRaise();
const d = c.renderVals();
if (d.mode !== 'desk') mal('crear incidencia no lleva al puesto');
else if (d.desk.ticket.id !== causa.ticket) mal('abre el ticket equivocado');
else bien('crear incidencia abre ' + causa.ticket + ' en el Puesto');
const log0 = d.desk.itsm.log.map(l => l.t).join(' | ');
if (log0.indexOf(causa.id) < 0) mal('el histórico no deja constancia del evento de origen');
else bien('el histórico arranca citando el evento: "' + d.desk.itsm.log[d.desk.itsm.log.length - 1].t + '"');

// --- el ruido no abre incidencia ---
const c2 = new C(); c2.props = {}; c2.setState({ mode: 'events' });
const ruidoEv = evs.find(e => e.noise);
let v2 = c2.renderVals().events;
v2.rows.find(r => r.id === ruidoEv.id).onClick();
v2 = c2.renderVals().events;
if (v2.det.canRaise) mal('un evento informativo ofrece abrir incidencia');
else if (!v2.det.noise) mal('un evento informativo no se marca como tal');
else bien('el ruido se puede cerrar pero no abrir incidencia');
v2.det.onClose();
v2 = c2.renderVals().events;
if (v2.rows.some(r => r.id === ruidoEv.id)) mal('cerrar un evento no lo saca de la lista');
else bien('cerrar lo saca de la consola (' + v2.rows.length + ' abiertos)');

// --- cerrar una causa se lleva sus síntomas ---
const c3 = new C(); c3.props = {}; c3.setState({ mode: 'events' });
let v3 = c3.renderVals().events;
v3.rows.find(r => r.id === causa.id).onClick();
v3 = c3.renderVals().events;
v3.det.onClose();
v3 = c3.renderVals().events;
const quedan = [causa.id].concat(causa.related).filter(id => v3.rows.some(r => r.id === id));
if (quedan.length) mal('cerrar la causa deja sueltos sus síntomas: ' + quedan.join(', '));
else bien('cerrar la causa cierra sus síntomas: ' + (evs.length - v3.rows.length) + ' eventos fuera de una vez');

// --- filtros ---
const c4 = new C(); c4.props = {}; c4.setState({ mode: 'events' });
let v4 = c4.renderVals().events;
v4.filters.find(f => f.key === 'cause').onClick();
v4 = c4.renderVals().events;
if (v4.rows.some(r => r.tag !== 'CAUSA')) mal('el filtro de causas cuela otros eventos');
else bien('el filtro «solo causas» deja ' + v4.rows.length + ' de ' + evs.length);

// --- prioridad por impacto x urgencia ---
console.log('\n  prioridad ITSM (impacto × urgencia -> P + SLA):');
['critica', 'alta', 'media', 'baja'].forEach(k => {
  const pr = c.itsmPrio(k);
  console.log('    ' + k.padEnd(8) + ' ' + pr.p + '  impacto ' + pr.impacto.padEnd(6) + ' urgencia ' + pr.urgencia.padEnd(6) + ' SLA ' + pr.sla);
});
const p1 = c.itsmPrio('critica'), p4 = c.itsmPrio('baja');
if (p1.p !== 'P1' || p4.p !== 'P4') mal('la matriz de prioridad no da P1 para crítica y P4 para baja');
if (p1.slaMin >= p4.slaMin) mal('el SLA de P1 no es más exigente que el de P4');

console.log(fail ? ('\n' + fail + ' fallo(s)') : '\nConsola de eventos OK');
process.exit(fail ? 1 : 0);
