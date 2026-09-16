// Recorre el modo Kids de principio a fin: acierto, error y pantalla final.
const fs=require('fs');
const src=fs.readFileSync('F:/IngLab/Taller visual de infraestructura didáctico/Laboratorio.dc.html','utf8');
const code=src.match(/<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/)[1];
class DCLogic{ constructor(){this.props={}} setState(p){Object.assign(this.state, typeof p==='function'?p(this.state):p)} }
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.window={location:{hash:'',search:'',pathname:'/'},addEventListener(){}};
global.document={addEventListener(){},createElement:()=>({style:{},click(){}}),head:{appendChild(){}},body:{appendChild(){},removeChild(){}},querySelector:()=>null,querySelectorAll:()=>[]};

// cargar el contenido externo igual que hacen las <script> de la página
['piezas','capas','textos','retos','kids','tickets'].forEach(function(n){
  const code=fs.readFileSync('F:/IngLab/Taller visual de infraestructura didáctico/contenido/'+n+'.js','utf8');
  new Function('window', code)(global.window);
});
global.React={createElement:()=>({}),Fragment:'F'};
global.setInterval=()=>0;global.clearInterval=()=>{};global.setTimeout=()=>0;
const C=new Function('DCLogic','StreamableLogic','React','localStorage','window','document',code+'\nreturn Component;')(DCLogic,DCLogic,global.React,global.localStorage,global.window,global.document);
let fail=0;
const need=['pick','parts','towerShow','contShow','contLabel','guards','guardsShow','guardsTitle','chapterShow','chapterTitle','stepLabel','title','say','ask','askShow','optionsShow','options','dots','tower','towerTitle','towerEmpty','towerEmptyMsg','hintShow','hint','whyShow','why','okTitle','nextLabel','color','done','endTitle','endBody','again','toMap'];

for (const lang of ['es','en']){
  const c=new C(); c.props={}; c.setState({mode:'kids', lang});
  console.log('\n=== '+lang.toUpperCase()+' ===');
  c.kidsStart(1);
  const steps=c.kidsSteps();
  // todas las piezas referenciadas deben existir de verdad
  steps.forEach((st,i)=>{
    [st.block].concat(st.wrong).forEach(bid=>{ if(!c.blockById(bid)){ console.error('  PIEZA INEXISTENTE en paso '+(i+1)+': '+bid); fail++; } });
    if(!c.catById(st.cat)){ console.error('  CATEGORIA INEXISTENTE: '+st.cat); fail++; }
    if(c.blockById(st.block).cat!==st.cat){ console.error('  paso '+(i+1)+': '+st.block+' no pertenece a '+st.cat); fail++; }
    st.wrong.forEach(w=>{ if(c.blockById(w).cat===st.cat){ console.error('  paso '+(i+1)+': el distractor '+w+' es de la MISMA capa'); fail++; } });
  });
  for(const part of [1,2]){
  c.kidsStart(part);
  const ps=c.kidsPartSteps(part);
  console.log("  -- partida "+part+" ("+ps.length+" pasos) --");
  for(let i=0;i<ps.length;i++){
    let v=c.renderVals().kids;
    need.forEach(k=>{ if(!(k in v)){ console.error('  falta clave kids.'+k); fail++; } });
    if(v.options.length!==3){ console.error('  paso '+(i+1)+' no tiene 3 opciones'); fail++; }
    // primero fallamos a propósito: debe dar pista, no castigo
    const bad=v.options.find(o=>o.name!==c.loc(c.blockById(ps[i].block).name));
    bad.onClick(); v=c.renderVals().kids;
    if(!v.hintShow){ console.error('  paso '+(i+1)+': un fallo no muestra pista'); fail++; }
    if(v.whyShow){ console.error('  paso '+(i+1)+': un fallo avanza'); fail++; }
    // y ahora acertamos
    const good=v.options.find(o=>o.name===c.loc(c.blockById(ps[i].block).name));
    good.onClick(); v=c.renderVals().kids;
    if(!v.whyShow){ console.error('  paso '+(i+1)+': acertar no muestra el porqué'); fail++; }
    const puestas=(part===1? v.tower.length : v.guards.length);
    if(puestas!==i+1){ console.error('  p'+part+' paso '+(i+1)+': colocadas '+puestas+', esperadas '+(i+1)); fail++; }
    if(lang==='es') console.log('  '+String(i+1).padStart(2)+'/'+ps.length+' cap'+ps[i].chapter+'  '+v.title.padEnd(24)+' -> '+good.name.padEnd(18)+(ps[i].side?'guardián':'piso '+v.tower.length));
    v.onNext();
  }
  const fin=c.renderVals().kids;
  if(!fin.done){ console.error('  partida '+part+' no llega al final'); fail++; }
  console.log('     final: "'+fin.endTitle+'" '+(fin.contShow?'(ofrece seguir)':''));
  }
  const end=c.renderVals().kids;
  const floors=steps.filter(x=>!x.side).length, sides=steps.length-floors;
  if(end.tower.length!==floors || end.guards.length!==sides){ console.error('  el resumen final no cuadra'); fail++; }
  console.log('  TOTAL: '+end.tower.length+' pisos + '+end.guards.length+' ayudantes');
  end.onAgain(); const again=c.renderVals().kids;
  if(!again.pick){ console.error('  no vuelve a la eleccion de partida'); fail++; }
  else console.log('  volver -> pantalla de elegir partida');
}
console.log(fail? ('\nFALLOS: '+fail) : '\nKids OK');
process.exit(fail?1:0);
