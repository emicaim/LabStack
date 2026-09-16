// Recorre el modo Puesto: abre tickets, lanza comandos en varias sesiones a la
// vez y comprueba que la evidencia sólo aparece en el equipo que toca.
//   node desk-test.js
const fs=require('fs'), path=require('path');
const D=__dirname;
const src=fs.readFileSync(path.join(D,'Laboratorio.dc.html'),'utf8');
const code=src.match(/<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/)[1];
class DCLogic{ constructor(){this.props={}} setState(p){Object.assign(this.state, typeof p==='function'?p(this.state):p)} }
const win={location:{hash:'',search:'',pathname:'/'},addEventListener(){}};
['piezas','capas','textos','retos','kids','tickets','eventos','comandos'].forEach(n=>
  new Function('window', fs.readFileSync(path.join(D,'contenido',n+'.js'),'utf8'))(win));
const doc={addEventListener(){},createElement:()=>({style:{},click(){}}),head:{appendChild(){}},body:{appendChild(){},removeChild(){}},querySelector:()=>null,querySelectorAll:()=>[]};
const C=new Function('DCLogic','StreamableLogic','React','localStorage','window','document','setInterval','clearInterval','setTimeout',
  code+'\nreturn Component;')(DCLogic,DCLogic,{createElement:()=>({}),Fragment:'F'},{getItem:()=>null,setItem(){},removeItem(){}},win,doc,()=>0,()=>{},()=>0);

let fail=0; const mal=m=>{ console.error('  ✕ '+m); fail++; }; const bien=m=>console.log('  ✓ '+m);
const c=new C(); c.props={}; c.setState({mode:'desk'});
const tickets=c.tickets(), hosts=c.deskHosts().map(h=>h.id);
const escribir=(i,cmd)=>{ const v=c.renderVals().desk; v.terms[i].onInput({target:{value:cmd}}); v.terms[i].onKey({key:'Enter',preventDefault(){}}); };
const texto=i=>c.renderVals().desk.terms[i].lines.map(l=>l.t).join('\n');

console.log('Puesto de trabajo\n');
console.log('  equipos: '+hosts.join(', '));
console.log('  cola: '+tickets.length+' tickets\n');

for(const tk of tickets){
  c.deskOpen(tk.id);
  let v=c.renderVals().desk;
  if(!v.open || v.terms.length!==hosts.length){ mal(tk.id+': no abre con '+hosts.length+' sesiones'); continue; }

  // la evidencia debe salir en su equipo y NO en los demás: esa es la lección
  let bien=0;
  for(const ev of tk.evidence){
    const cmd=ev.cmd[0], suyo=hosts.indexOf(ev.host);
    escribir(suyo, cmd);
    // comparo por la línea más larga: la corta («4») puede coincidir por azar
    // con la salida genérica y daría un falso positivo
    const esperado=ev.lines.map(l=>l[0]).sort((a,b)=>b.length-a.length)[0];
    const faltan=ev.lines.filter(l=>texto(suyo).indexOf(l[0])<0);
    if(faltan.length){ mal(tk.id+': "'+cmd+'" en '+ev.host+' no da '+faltan.length+' de sus líneas'); continue; }
    bien++;
    const otro=hosts.findIndex((h,i)=>i!==suyo && !tk.evidence.some(e=>e.host===h && e.cmd.some(x=>x===cmd)));
    if(otro>=0){ escribir(otro, cmd);
      if(texto(otro).indexOf(esperado)>=0) mal(tk.id+': "'+cmd+'" en '+hosts[otro]+' filtra la evidencia de '+ev.host);
    }
  }

  // diagnóstico: primero la causa equivocada, luego la buena
  v=c.renderVals().desk; v.onDiagnose(); v=c.renderVals().desk;
  if(!v.showCauses){ mal(tk.id+': no llega a elegir causa'); continue; }
  const iMala=tk.causes.findIndex(x=>!x.correct), iBuena=tk.causes.findIndex(x=>x.correct);
  v.causes[iMala].onClick(); v=c.renderVals().desk;
  if(!v.wrongShow) mal(tk.id+': una causa equivocada no avisa');
  if(v.showFixes) mal(tk.id+': una causa equivocada avanza igual');
  v.causes[iBuena].onClick(); v=c.renderVals().desk;
  if(!v.showFixes){ mal(tk.id+': la causa correcta no lleva al arreglo'); continue; }
  const fMala=tk.fixes.findIndex(x=>!x.correct), fBuena=tk.fixes.findIndex(x=>x.correct);
  v.fixes[fMala].onClick(); v=c.renderVals().desk;
  if(v.showDone) mal(tk.id+': un arreglo equivocado cierra el ticket');
  v.fixes[fBuena].onClick(); v=c.renderVals().desk;
  if(!v.showDone || !v.solvedText || !v.lessonText){ mal(tk.id+': no cierra bien'); continue; }
  console.log('  ✓ '+tk.id+'  '+c.loc(tk.subject).slice(0,46).padEnd(48)+bien+'/'+tk.evidence.length+' evidencias');
}
const fin=c.renderVals().desk; c.deskBack();
const cola=c.renderVals().desk;
if(cola.queue.filter(q=>q.done).length!==tickets.length) mal('la cola no marca todos los tickets como resueltos');
else console.log('\n  ✓ cola: '+cola.queueCount);
// y que una sesión no se lleve el historial de otra
c.deskOpen(tickets[0].id); escribir(0,'hostname');
const v2=c.renderVals().desk;
if(texto(1).indexOf('hostname')>=0) mal('el historial se mezcla entre sesiones');
else console.log('  ✓ cada sesión tiene su propio historial');

// --- los equipos salen del stack que hayas montado ---
console.log('\n  equipos según el stack:');
console.log('    sin montar nada (ejemplo): ' + c.deskHosts().map(h => h.name).join(', '));
const c2 = new C(); c2.props = {}; c2.setState({ mode: 'desk' });
c2.loadPreset(c2.presets()[0].id);
const mios = c2.deskHosts();
console.log('    con un stack montado:      ' + mios.map(h => h.name).join(', '));
const propios = mios.filter(h => h.mine).length;
if (!propios) mal('ningún equipo sale del stack montado');
else console.log('    ' + propios + '/' + mios.length + ' equipos son piezas tuyas de verdad');

// y la evidencia sigue encontrando su sitio aunque el equipo se llame distinto
c2.deskOpen(tickets[0].id);
const ev0 = tickets[0].evidence.find(e => e.host === 'web01');
const iw = c2.deskHosts().findIndex(h => h.id === 'web01');
let v3 = c2.renderVals().desk;
v3.terms[iw].onInput({ target: { value: ev0.cmd[0] } });
v3.terms[iw].onKey({ key: 'Enter', preventDefault() {} });
const txt = c2.renderVals().desk.terms[iw].lines.map(l => l.t).join('\n');
if (txt.indexOf(ev0.lines[0][0]) < 0) mal('con equipos propios la evidencia deja de encontrarse');
else console.log('    la evidencia llega a su equipo aunque se llame distinto');

// --- Tab autocompleta, y por sesión ---
c.deskOpen(tickets[0].id);
let v4 = c.renderVals().desk;
v4.terms[0].onInput({ target: { value: 'journ' } });
v4.terms[0].onKey({ key: 'Tab', preventDefault() {} });
const tras = c.renderVals().desk.terms[0].input;
if (tras.trim() !== 'journalctl') mal('Tab no completa un comando único (salió: "' + tras + '")');
else console.log('\n  ✓ Tab completa: "journ" -> "' + tras.trim() + '"');

v4 = c.renderVals().desk;
v4.terms[1].onInput({ target: { value: 'ip' } });
v4.terms[1].onKey({ key: 'Tab', preventDefault() {} });
const lista = c.renderVals().desk.terms[1].lines.map(l => l.t).join(' ');
if (lista.indexOf('iptables') < 0) mal('Tab no lista las opciones cuando hay varias');
else console.log('  ✓ Tab lista las opciones cuando hay varias');
if (c.renderVals().desk.terms[0].input.trim() !== 'journalctl') mal('el Tab de una sesión pisa otra');
else console.log('  ✓ el autocompletado de una sesión no toca a las demás');

// --- man sigue funcionando dentro del puesto ---
v4 = c.renderVals().desk;
v4.terms[2].onInput({ target: { value: 'man ss' } });
v4.terms[2].onKey({ key: 'Enter', preventDefault() {} });
const manTxt = c.renderVals().desk.terms[2].lines.map(l => l.t).join(' ').toLowerCase();
if (manTxt.indexOf('ss') < 0 || manTxt.indexOf('not found') >= 0) mal('man no responde en el puesto');
else console.log('  ✓ man responde dentro del puesto');


// --- cada comando sugerido tiene que decir qué te dice ---
console.log('\n  pistas de los comandos sugeridos:');
let sinPista = [];
tickets.forEach(tk => {
  c.deskOpen(tk.id);
  const v = c.renderVals().desk;
  if (v.suggest.length !== (tk.suggest || []).length) mal(tk.id + ': faltan sugerencias en la vista');
  v.suggest.forEach(sg => { if (!sg.hasWhy || !sg.why) sinPista.push(tk.id + ' » ' + sg.cmd); });
});
if (sinPista.length) mal('comandos sugeridos sin explicación: ' + sinPista.join(', '));
else {
  const total = tickets.reduce((s, tk) => s + (tk.suggest || []).length, 0);
  bien('los ' + total + ' comandos sugeridos llevan su «qué te dice»');
}
// y la explicación tiene que ser la específica, no la genérica del prefijo
c.deskOpen('T-1042');
const sug = c.renderVals().desk.suggest;
const largo = sug.find(x => x.cmd === 'systemctl status nginx');
const generico = c.cmdHint('systemctl status');
if (!largo) mal('no encuentro la sugerencia de nginx');
else if (largo.why === generico) mal('coge la explicación genérica en vez de la del comando completo');
else bien('el prefijo más largo gana: "systemctl status nginx" tiene la suya, no la de "systemctl status"');
if (c.cmdHint('comando-que-no-existe') !== '') mal('inventa explicación para un comando desconocido');
else bien('un comando sin entrada simplemente no lleva explicación');

// --- el comando bueno en la máquina equivocada avisa, y sólo ahí ---
c.deskOpen('T-1042');
const ev = c.tickets().find(x => x.id === 'T-1042').evidence.find(e => e.host === 'web01');
const idx = h => c.deskHosts().findIndex(x => x.id === h);
const lanza = (i, cmd) => { const v = c.renderVals().desk; v.terms[i].onInput({ target: { value: cmd } }); v.terms[i].onKey({ key: 'Enter', preventDefault() {} }); };
const leer = i => c.renderVals().desk.terms[i].lines.map(l => l.t).join('\n');
const AVISO = 'En otro de los equipos sí';

lanza(idx('fw01'), ev.cmd[0]);
if (leer(idx('fw01')).indexOf(AVISO) < 0) mal('el comando bueno en la máquina equivocada no avisa');
else bien('"' + ev.cmd[0] + '" en fw01 avisa de que cuenta algo en otro equipo');

lanza(idx('web01'), ev.cmd[0]);
if (leer(idx('web01')).indexOf(AVISO) >= 0) mal('avisa también en la máquina correcta');
else bien('en web01, que es la suya, no avisa: da la evidencia y punto');

lanza(idx('db01'), 'uptime');
if (leer(idx('db01')).indexOf(AVISO) >= 0) mal('avisa con un comando que no es evidencia de nadie');
else bien('un comando que vale en cualquier sitio no dispara el aviso');

// el aviso no puede delatar en qué equipo está la pista
const todos = c.deskHosts().map(h => h.name).concat(c.deskHosts().map(h => h.id));
const linea = leer(idx('fw01')).split('\n').find(l => l.indexOf(AVISO) >= 0) || '';
const delata = todos.filter(n => n !== 'fw01' && linea.indexOf(n) >= 0);
if (delata.length) mal('el aviso nombra el equipo donde está la pista: ' + delata.join(', '));
else bien('el aviso no dice cuál es: sigue habiendo que elegir');

console.log(fail? ('\n'+fail+' fallo(s)') : '\nPuesto OK');
process.exit(fail?1:0);
