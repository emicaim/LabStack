// Recorre el modo Puesto: abre tickets, lanza comandos en varias sesiones a la
// vez y comprueba que la evidencia sólo aparece en el equipo que toca.
//   node desk-test.js
const fs=require('fs'), path=require('path');
const D=__dirname;
const src=fs.readFileSync(path.join(D,'Laboratorio.dc.html'),'utf8');
const code=src.match(/<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/)[1];
class DCLogic{ constructor(){this.props={}} setState(p){Object.assign(this.state, typeof p==='function'?p(this.state):p)} }
const win={location:{hash:'',search:'',pathname:'/'},addEventListener(){}};
['piezas','capas','textos','retos','kids','tickets'].forEach(n=>
  new Function('window', fs.readFileSync(path.join(D,'contenido',n+'.js'),'utf8'))(win));
const doc={addEventListener(){},createElement:()=>({style:{},click(){}}),head:{appendChild(){}},body:{appendChild(){},removeChild(){}},querySelector:()=>null,querySelectorAll:()=>[]};
const C=new Function('DCLogic','StreamableLogic','React','localStorage','window','document','setInterval','clearInterval','setTimeout',
  code+'\nreturn Component;')(DCLogic,DCLogic,{createElement:()=>({}),Fragment:'F'},{getItem:()=>null,setItem(){},removeItem(){}},win,doc,()=>0,()=>{},()=>0);

let fail=0; const mal=m=>{ console.error('  ✕ '+m); fail++; };
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
console.log(fail? ('\n'+fail+' fallo(s)') : '\nPuesto OK');
process.exit(fail?1:0);
