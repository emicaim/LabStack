// Valida el contenido de contenido/*.js.
//
// Ahora que el contenido vive repartido en varios ficheros, pueden aparecer
// referencias cruzadas rotas que antes eran imposibles: un paso de Kids que
// nombra una pieza que ya no existe, un reto que pide una categoría
// inventada, un texto que está en español pero no en inglés. Esto lo caza.
//
//   node content-test.js
const fs = require('fs'), path = require('path');
const DIR = __dirname;

function cargar() {
  const win = { location: { hash: '', search: '', pathname: '/' }, addEventListener() {} };
  ['piezas', 'capas', 'textos', 'retos', 'kids', 'tickets', 'eventos', 'comandos'].forEach(n => {
    const f = path.join(DIR, 'contenido', n + '.js');
    if (!fs.existsSync(f)) throw new Error('falta contenido/' + n + '.js');
    new Function('window', fs.readFileSync(f, 'utf8'))(win);
  });
  return win.LABSTACK;
}

const L = cargar();
let fail = 0;
const mal = m => { console.error('  ✕ ' + m); fail++; };
const bien = m => console.log('  ✓ ' + m);

const cats = L.categorias(), piezas = L.piezas(), fichas = L.fichas();
const iconos = L.iconos(), dim = L.dimensionado(), capas = L.capas();
const retos = L.retos(), incidentes = L.incidentes(), kids = L.kids();
const textos = L.textos();
const catIds = new Set(cats.map(c => c.id));
const pieceIds = new Set(piezas.map(b => b.id));
const catDe = {}; piezas.forEach(b => { catDe[b.id] = b.cat; });

console.log('Contenido de LabStack\n');

// --- piezas ---
const sinCat = piezas.filter(b => !catIds.has(b.cat));
sinCat.length ? mal(sinCat.length + ' piezas con categoría inexistente: ' + sinCat.map(b => b.id + '→' + b.cat).join(', '))
              : bien(piezas.length + ' piezas, todas en una categoría que existe');

const dupes = piezas.map(b => b.id).filter((id, i, a) => a.indexOf(id) !== i);
dupes.length ? mal('ids de pieza repetidos: ' + [...new Set(dupes)].join(', ')) : bien('sin ids de pieza repetidos');

const sinNombre = piezas.filter(b => !b.name || !b.name.es || !b.name.en);
sinNombre.length ? mal(sinNombre.length + ' piezas sin nombre en los dos idiomas: ' + sinNombre.map(b => b.id).join(', '))
                 : bien('todas las piezas tienen nombre en ES y EN');

// --- referencias sueltas en fichas e iconos ---
[['fichas', fichas], ['iconos', iconos]].forEach(([n, obj]) => {
  const huerfanas = Object.keys(obj).filter(id => !pieceIds.has(id));
  huerfanas.length ? mal(n + ' apunta a piezas que ya no existen: ' + huerfanas.join(', '))
                   : bien(n + ': ' + Object.keys(obj).length + ' entradas, todas de piezas reales');
});

// --- categorías: cada una necesita coste y, si es apilable, pedagogía ---
const sinDim = cats.filter(c => !dim[c.id]);
sinDim.length ? mal('categorías sin dimensionado: ' + sinDim.map(c => c.id).join(', '))
              : bien('las ' + cats.length + ' categorías tienen coste/CPU/RAM');
const sinCapa = cats.filter(c => !capas[c.id]);
sinCapa.length ? mal('categorías sin pedagogía en capas.js: ' + sinCapa.map(c => c.id).join(', '))
               : bien('las ' + cats.length + ' categorías tienen su explicación de capa');

// --- retos ---
let retoMal = 0;
retos.forEach(r => {
  (r.need || []).forEach(c => { if (!catIds.has(c)) { mal('reto "' + r.id + '" pide una categoría inexistente: ' + c); retoMal++; } });
  (r.redundant || []).forEach(c => { if (!catIds.has(c)) { mal('reto "' + r.id + '" redundante sobre categoría inexistente: ' + c); retoMal++; } });
  (r.needBlock || []).forEach(b => { if (!pieceIds.has(b)) { mal('reto "' + r.id + '" pide una pieza inexistente: ' + b); retoMal++; } });
});
if (!retoMal) bien(retos.length + ' retos, todos apuntando a piezas y categorías reales');
bien(incidentes.length + ' incidentes');

// --- kids ---
let kidsMal = 0;
kids.forEach((s, i) => {
  const n = 'paso ' + (i + 1) + ' (' + (s.title ? s.title.es : '?') + ')';
  if (!catIds.has(s.cat)) { mal('kids ' + n + ': categoría inexistente ' + s.cat); kidsMal++; }
  if (!pieceIds.has(s.block)) { mal('kids ' + n + ': pieza inexistente ' + s.block); kidsMal++; }
  else if (catDe[s.block] !== s.cat) { mal('kids ' + n + ': ' + s.block + ' no es de ' + s.cat); kidsMal++; }
  (s.wrong || []).forEach(w => {
    if (!pieceIds.has(w)) { mal('kids ' + n + ': distractor inexistente ' + w); kidsMal++; }
    // un distractor de la misma capa que la respuesta haría la pregunta injusta
    else if (catDe[w] === s.cat) { mal('kids ' + n + ': el distractor ' + w + ' es de la misma capa que la respuesta'); kidsMal++; }
  });
  if ((s.wrong || []).length !== 2) { mal('kids ' + n + ': debe tener exactamente 2 distractores'); kidsMal++; }
  ['title', 'say', 'ask', 'hint', 'why'].forEach(k => {
    if (!s[k] || !s[k].es || !s[k].en) { mal('kids ' + n + ': falta "' + k + '" en algún idioma'); kidsMal++; }
  });
});
if (!kidsMal) {
  const p1 = kids.filter(s => s.chapter === 1).length, p2 = kids.filter(s => s.chapter === 2).length;
  bien('kids: ' + kids.length + ' pasos (' + p1 + ' la torre + ' + p2 + ' ayudantes), sin trampas ni huecos');
}

// --- tickets del puesto ---
const equipos = L.equipos(), tks = L.tickets();
const eqIds = new Set(equipos.map(e => e.id));
const eqMal = equipos.filter(e => !catIds.has(e.cat));
eqMal.length ? mal('equipos con categoría inexistente: ' + eqMal.map(e => e.id).join(', '))
             : bien(equipos.length + ' equipos del puesto, todos con una categoría real');

let tkMal = 0;
const vistos = new Set();
tks.forEach(tk => {
  const n = 'ticket ' + tk.id;
  if (vistos.has(tk.id)) { mal(n + ': id repetido'); tkMal++; }
  vistos.add(tk.id);
  ['from', 'subject', 'body', 'solved', 'lesson'].forEach(k => {
    if (!tk[k] || !tk[k].es || !tk[k].en) { mal(n + ': falta "' + k + '" en algún idioma'); tkMal++; }
  });
  const hosts = new Set();
  (tk.evidence || []).forEach(ev => {
    if (!eqIds.has(ev.host)) { mal(n + ': evidencia en un equipo que no existe: ' + ev.host); tkMal++; }
    hosts.add(ev.host);
    if (!(ev.cmd || []).length) { mal(n + ': una evidencia sin comando'); tkMal++; }
    if (!(ev.lines || []).length) { mal(n + ': una evidencia sin salida'); tkMal++; }
  });
  // un ticket con toda la pista en un solo equipo no enseña a elegir dónde
  // mirar, que es justo el punto del modo
  if (hosts.size < 2) { mal(n + ': toda la evidencia está en el mismo equipo'); tkMal++; }
  const cOk = (tk.causes || []).filter(x => x.correct).length;
  const fOk = (tk.fixes || []).filter(x => x.correct).length;
  if (cOk !== 1) { mal(n + ': tiene ' + cOk + ' causas correctas, debe haber 1'); tkMal++; }
  if (fOk !== 1) { mal(n + ': tiene ' + fOk + ' arreglos correctos, debe haber 1'); tkMal++; }
  if ((tk.causes || []).length < 3) { mal(n + ': muy pocas causas entre las que elegir'); tkMal++; }
  (tk.causes || []).concat(tk.fixes || []).forEach(x => {
    if (!x.text || !x.text.es || !x.text.en) { mal(n + ': una opción sin traducir'); tkMal++; }
  });
});
if (!tkMal) {
  const usados = new Set();
  tks.forEach(tk => (tk.evidence || []).forEach(e => usados.add(e.host)));
  const media = (tks.reduce((s, tk) => s + (tk.evidence || []).length, 0) / tks.length).toFixed(1);
  bien(tks.length + ' tickets: evidencia en ' + usados.size + ' equipos, ' + media + ' pistas de media, una sola respuesta buena cada uno');
}

// --- textos ---
const es = Object.keys(textos.es || {}), en = Object.keys(textos.en || {});
const faltanEn = es.filter(k => !(k in textos.en)), faltanEs = en.filter(k => !(k in textos.es));
if (faltanEn.length) mal('textos sin traducir al inglés: ' + faltanEn.join(', '));
if (faltanEs.length) mal('textos que solo están en inglés: ' + faltanEs.join(', '));
if (!faltanEn.length && !faltanEs.length) bien(es.length + ' textos de interfaz, completos en ES y EN');

console.log(fail ? ('\n' + fail + ' problema(s) en el contenido') : '\nContenido correcto');
process.exit(fail ? 1 : 0);
