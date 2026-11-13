import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('ui/lists/list-entry.js', 'utf8');
const css = readFileSync('ui/lists/list-entry.css', 'utf8');
const procedures = readFileSync('core/service/procedures/procedures.js', 'utf8');
const products = readFileSync('core/service/products/products.js', 'utf8');
const procedureData = readFileSync('core/service/procedures/data.js', 'utf8');
const productData = readFileSync('core/service/products/data.js', 'utf8');
const inventory = readFileSync('core/inventory/inventory.js', 'utf8');

assert.match(css, /\.list-entry\.is-reordering\{[^}]*pointer-events:none/,
  'Dragging entry does not intercept target hit testing');
assert.match(css, /transition:none/, 'Dragged row has no delayed transform');
assert.match(css, /\.list-entry__reorder-handle\{[^}]*touch-action:none/,
  'Handle owns touch gestures; rest of Z remains scrollable');
assert.match(source, /document\.elementFromPoint/, 'Use direct hit testing');
assert.match(source, /host\.insertBefore\(node, before \? drop : drop\.nextSibling\)/,
  'Drag is committed once at release, never for each move');
assert.match(source, /restoreOrder\(originalIds\)/, 'Failed writes restore original list');
assert.match(source, /onError\(error\)/, 'Error feedback handled by list owner');
for (const module of [procedures,products,inventory]) {
  assert.match(module, /initV2ListReorder\(/, 'Every catalog uses the same gesture');
}
assert.match(procedures, /onReorder: \(ids\) => commitReorderProcedures\(ids\)/,
  'Service procedures save without a full screen rerender');
assert.match(products, /onReorder: \(ids\) => commitReorderProducts\(ids\)/,
  'Service products save without a full screen rerender');
assert.match(procedureData, /export async function commitReorderProcedures/,
  'Procedures use ACK-first batch persistence');
assert.match(productData, /export async function commitReorderProducts/,
  'Products use ACK-first batch persistence');

class Classes {
  constructor(){this.values=new Set();}
  add(...names){names.forEach(name=>this.values.add(name));}
  remove(...names){names.forEach(name=>this.values.delete(name));}
  contains(name){return this.values.has(name);}
}
function setup(onReorder = async()=>{}) {
  const listeners = {};
  let moves=0;
  const host={
    classList:new Classes(), isConnected:true, children:[], parentElement:null,
    matches:s=>s==='.list-entries',
    querySelectorAll:s=>s==='[data-reorder-id]'?host.children:[],
    addEventListener:(name,fn)=>{listeners[name]=fn;},
    removeEventListener:(name,fn)=>{if(listeners[name]===fn)delete listeners[name];},
    contains:node=>host.children.includes(node)||host.children.some(item=>item.handle===node),
    insertBefore:(node,reference)=>{
      moves++;
      const pos=host.children.indexOf(node);host.children.splice(pos,1);
      const at=reference ? host.children.indexOf(reference) : host.children.length;
      host.children.splice(at<0?host.children.length:at,0,node);
    },
    appendChild:(node)=>{
      moves++;
      host.children.splice(host.children.indexOf(node),1);
      host.children.push(node);
    },
  };
  const scrollParent={
    parentElement:null,scrollHeight:500,clientHeight:240,scrollTop:0,
    getBoundingClientRect:()=>({top:0,bottom:240}),
  };
  host.parentElement=scrollParent;
  const node = id=>{
    const o={
      dataset:{reorderId:id},
      classList:new Classes(),
      style:{properties:{},setProperty(k,v){this.properties[k]=v;},removeProperty(k){delete this.properties[k];}},
      getBoundingClientRect:()=>{
        const index=host.children.indexOf(o);
        return {top:index*80,bottom:index*80+78,height:78};
      },
      closest:s=>s==='[data-reorder-id]'?o:null,
    };
    let captured=false;
    o.handle={
      closest:s=>s==='[data-reorder-handle]'?o.handle:s==='[data-reorder-id]'?o:null,
      setPointerCapture:()=>{captured=true;},
      hasPointerCapture:()=>captured,
      releasePointerCapture:()=>{captured=false;},
      focus:()=>{},
    };
    return o;
  };
  const A=node('a'),B=node('b'),C=node('c');
  host.children=[A,B,C];
  const doc={
    elementFromPoint:(x,y)=>host.children[Math.max(0,Math.min(host.children.length-1,Math.floor(y/80)))]
  };
  const calls=[];
  const js=source.slice(source.indexOf('export function initV2ListReorder('))
    .replace('export function initV2ListReorder(', 'function initV2ListReorder(');
  let nextRaf=0;
  const queued=new Map();
  const init=new Function('document','getComputedStyle','requestAnimationFrame','cancelAnimationFrame',
    js+';return initV2ListReorder;')(
      doc,()=>({overflowY:'auto'}),
      fn=>{queued.set(++nextRaf,fn);return nextRaf;},
      id=>queued.delete(id),
    );
  const destroy=init(host,{onReorder:async(ids)=>{calls.push(ids);return onReorder(ids);}});
  const event=(target,y=10)=>({
    target,clientX:15,clientY:y,pointerId:7,pointerType:'touch',button:0,
    preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},
    stopImmediatePropagation(){this.stopped=true;},
  });
  const order=()=>host.children.map(item=>item.dataset.reorderId);
  return {listeners,host,A,B,C,event,order,destroy,calls,moveCount:()=>moves};
}

{
  const t=setup();
  t.listeners.pointerdown(t.event(t.A.handle,10));
  assert.deepEqual(t.order(),['a','b','c']);
  t.listeners.pointermove(t.event(t.A.handle,215));
  assert.deepEqual(t.order(),['a','b','c'], 'Moving a captured node never mutates DOM');
  assert.equal(t.moveCount(),0,'No layout moves during pointermove');
  assert.ok(t.A.style.properties['--list-entry-drag-y'],'Dragged row gets transform only');
  t.listeners.pointerup(t.event(t.A.handle,215));
  assert.deepEqual(t.order(),['b','c','a'], 'Drop commits at pointerup');
  assert.equal(t.moveCount(),1,'Exactly one DOM move for entire gesture');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(t.calls,[['b','c','a']], 'One persistence callback');
  assert.equal(t.host.isConnected,true, 'Z host remains mounted');
  t.destroy();
}
{
  const t=setup();
  t.listeners.pointerdown(t.event(t.B.handle,90));
  t.listeners.pointermove(t.event(t.B.handle,200));
  t.listeners.pointercancel(t.event(t.B.handle,200));
  assert.equal(t.moveCount(),0,'Canceled gesture never moves rows');
  assert.equal(t.A.style.properties['--list-entry-drag-y'],undefined);
  assert.deepEqual(t.calls,[],'Canceled gesture never writes');
  t.destroy();
}
{
  const t=setup(async()=>{throw Error('Network failed');});
  t.listeners.pointerdown(t.event(t.A.handle,10));
  t.listeners.pointermove(t.event(t.A.handle,215));
  t.listeners.pointerup(t.event(t.A.handle,215));
  for (let attempt=0; attempt<12; attempt++) await Promise.resolve();
  assert.deepEqual(t.order(),['a','b','c'], 'Failed persistence restores original DOM order');
  t.destroy();
}
console.log('PASS: one shared touch gesture for Service and Stock, stable Z, one drop write and rollback');
