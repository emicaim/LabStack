// Compara el contenido externalizado contra el fichero original.
// Si mover 139 KB cambió aunque sea una coma, esto lo canta.
const fs=require('fs');
const DIR='F:/IngLab/Taller visual de infraestructura didáctico/';
function build(file, loadContent){
  const src=fs.readFileSync(file,'utf8');
  const code=src.match(/<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/)[1];
  class DCLogic{ constructor(){this.props={}} setState(p){Object.assign(this.state, typeof p==='function'?p(this.state):p)} }
  const win={location:{hash:'',search:'',pathname:'/'},addEventListener(){}};
  if(loadContent) ['piezas','capas','textos','retos','kids'].forEach(n=>{
    new Function('window', fs.readFileSync(DIR+'contenido/'+n+'.js','utf8'))(win);
  });
  const doc={addEventListener(){},createElement:()=>({style:{},click(){}}),head:{appendChild(){}},body:{appendChild(){},removeChild(){}},querySelector:()=>null,querySelectorAll:()=>[]};
  const C=new Function('DCLogic','StreamableLogic','React','localStorage','window','document','setInterval','clearInterval','setTimeout',
    code+'\nreturn Component;')(DCLogic,DCLogic,{createElement:()=>({}),Fragment:'F'},{getItem:()=>null,setItem(){},removeItem(){}},win,doc,()=>0,()=>{},()=>0);
  return new C();
}
const viejo=build(DIR+'Laboratorio.dc.html'.replace('Laboratorio.dc.html','Laboratorio.dc.html'), true); // placeholder
const nuevo=build(DIR+'Laboratorio.dc.html', true);
const orig =build('C:/Users/Emilio/AppData/Local/Temp/claude/f--IngLab-Taller-visual-de-infraestructura-did-ctico/f5534dd4-790d-4b5e-b1ed-f29e9dcfd4d9/scratchpad/backup.dc.html', false);

let fail=0;
const metodos=['catsBase','blocksBase','extrasBase','pieceIconsBase','specsBase','layerMeta','missionsBase','incidents','kidsSteps'];
console.log('Contenido externalizado vs original:');
for(const m of metodos){
  for(const lang of ['es','en']){
    orig.state.lang=lang; nuevo.state.lang=lang;
    const a=JSON.stringify(orig[m]()), b=JSON.stringify(nuevo[m]());
    if(a!==b){ console.error('  DIFIERE  '+m+' ('+lang+')  original '+a.length+' B vs nuevo '+b.length+' B'); fail++; }
  }
  const n=orig[m]();
  console.log('  igual    '+m.padEnd(16)+(Array.isArray(n)? n.length+' entradas' : Object.keys(n).length+' claves'));
}
// strings: el original devuelve el idioma elegido
for(const lang of ['es','en']){
  orig.state.lang=lang; nuevo.state.lang=lang;
  const a=JSON.stringify(orig.strings()), b=JSON.stringify(nuevo.strings());
  if(a!==b){ console.error('  DIFIERE  strings ('+lang+')'); fail++; }
}
console.log('  igual    strings          '+Object.keys(orig.strings()).length+' claves x2 idiomas');
// y que mutar lo devuelto no contamine la siguiente llamada
const e1=nuevo.extrasBase(); e1.__sucio=1;
if(nuevo.extrasBase().__sucio){ console.error('  extrasBase comparte objeto entre llamadas'); fail++; }
else console.log('  ok       cada llamada devuelve un objeto nuevo (no se contamina)');
console.log(fail? ('\nFALLOS: '+fail) : '\nContenido idéntico al original');
process.exit(fail?1:0);
