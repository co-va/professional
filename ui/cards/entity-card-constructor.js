import { escapeHtml } from '../utils/escape-html.js';
import { selectPhotoFile } from '../inputs/index.js';
import { button } from '../buttons/index.js';
import { select } from '../selectors/index.js';
import { colorPicker, initColorPickers } from '../colors/index.js';
import { rangeField } from '../inputs/index.js';

export const ENTITY_CARD_LINE_COUNT = 9;
export const ENTITY_CARD_DEFAULT_GRADIENT = Object.freeze({
  from:'#2C2A28',
  mid:'#817A73',
  to:'#D7D1CA',
  angle:145,
});

const COLUMNS = ['left','center','right'];
const ALIGNS = new Set(['left','center','right']);
const SIZES = new Set(['s','m','l','xl']);
const COLORS = new Set(['black','gray','white']);

function bool(value){return Boolean(value)}
function choice(value,set,fallback){const next=String(value||'');return set.has(next)?next:fallback}
function hex(value,fallback){const next=String(value||'').trim().toUpperCase();return /^#[0-9A-F]{6}$/.test(next)?next:fallback}
function number(value,fallback,min,max){const next=Number(value);return Number.isFinite(next)?Math.max(min,Math.min(max,next)):fallback}


function normalizeCell(input = {}, column = 'left') {
  const cell=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  return {
    field:String(cell.field||''),align:choice(cell.align,ALIGNS,column==='right'?'right':column==='center'?'center':'left'),
    size:choice(cell.size,SIZES,'m'),color:choice(cell.color,COLORS,'white'),
    bold:bool(cell.bold),italic:bool(cell.italic),underline:bool(cell.underline),uppercase:bool(cell.uppercase),
  };
}

export function hasConfiguredEntityCardAppearance(value = {}) {
  return Array.isArray(value?.lines)&&value.lines.some(row=>
    Boolean(String(row?.field||'').trim()) ||
    COLUMNS.some(col=>Boolean(String(row?.cells?.[col]?.field||'').trim()))
  );
}

export function normalizeEntityCardAppearance(value = {}) {
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const gradient=source.gradient&&typeof source.gradient==='object'&&!Array.isArray(source.gradient)?source.gradient:{};
  const lines=Array.isArray(source.lines)?source.lines:[];
  return {
    gradient:{
      from:hex(gradient.from,ENTITY_CARD_DEFAULT_GRADIENT.from),
      mid:hex(gradient.mid,ENTITY_CARD_DEFAULT_GRADIENT.mid),
      to:hex(gradient.to,ENTITY_CARD_DEFAULT_GRADIENT.to),
      angle:number(gradient.angle,ENTITY_CARD_DEFAULT_GRADIENT.angle,0,360),
    },
    lines:Array.from({length:ENTITY_CARD_LINE_COUNT},(_,index)=>{
      const raw=lines[index]&&typeof lines[index]==='object'&&!Array.isArray(lines[index])?lines[index]:{};
      const existing=raw.cells&&typeof raw.cells==='object'&&!Array.isArray(raw.cells)?raw.cells:{};
      const cells=Object.fromEntries(COLUMNS.map(col=>[col,normalizeCell(existing[col],col)]));
      // Previously there was one value per row. Its old position determines
      // the new cell; text alignment remains an independent formatting choice.
      if(String(raw.field||'').trim()){
        const position=raw.zone==='left'||raw.zone==='right'?raw.zone
          :raw.align==='center'||raw.align==='right'?raw.align:'left';
        const target=!cells[position].field?position:
          COLUMNS.find(col=>!cells[col].field);
        if(target)cells[target]=normalizeCell(raw,target);
      }
      return {cells};
    }),
  };
}

// Field-name changes are defined by the card type, never by the shared grid.
export function remapEntityCardAppearanceFields(value = {}, names = {}) {
  const appearance=normalizeEntityCardAppearance(value);
  return {
    ...appearance,
    lines:appearance.lines.map(row=>({
      cells:Object.fromEntries(COLUMNS.map(column=>[column,{
        ...row.cells[column],
        field:Object.prototype.hasOwnProperty.call(names,row.cells[column].field)
          ? String(names[row.cells[column].field]) : row.cells[column].field,
      }])),
    })),
  };
}

// One canonical default layout builder for every card type.
export function entityCardDefaultRows(entries = []) {
  const rows=normalizeEntityCardAppearance({}).lines;
  for(const entry of Array.isArray(entries)?entries:[]){
    const index=Number(entry?.row)-1;
    if(!Number.isInteger(index)||index<0||index>=ENTITY_CARD_LINE_COUNT)continue;
    const column=COLUMNS.includes(entry?.column)?entry.column:'left';
    rows[index].cells[column]=normalizeCell(entry,column);
  }
  return rows;
}

export function entityCardFieldRegistry(items = []) {
  const seen=new Set();
  return (Array.isArray(items)?items:[]).map((item)=>{
    const value=String(item?.value||'').trim();
    if(!value||seen.has(value))return null;
    seen.add(value);
    return {value,label:String(item?.label||value),text:String(item?.text??'')};
  }).filter(Boolean);
}

function fieldMap(fields){return new Map(entityCardFieldRegistry(fields).map((item)=>[item.value,item]))}
function lineText(line,map){
  const text=map.get(line.field)?.text||'';
  return line.uppercase?String(text).toLocaleUpperCase('ru-RU'):String(text);
}

export function entityVisualCard({appearance={},fields=[],image='',imagePosition='50% 50%',interactive=false,data='',aria='',className=''}={}) {
  const config=normalizeEntityCardAppearance(appearance);
  const map=fieldMap(fields);
  const style=[
    `--entity-visual-gradient:linear-gradient(${config.gradient.angle}deg,${config.gradient.from} 0%,${config.gradient.mid} 54%,${config.gradient.to} 100%)`,
    image?`--entity-visual-image:url('${escapeHtml(String(image))}')`:'',
    `--entity-visual-image-position:${escapeHtml(String(imagePosition||'50% 50%'))}`,
  ].filter(Boolean).join(';');
  const tag=interactive?'button':'section';
  const attrs=interactive?`type="button"${data?` ${data}`:''}${aria?` aria-label="${escapeHtml(aria)}"`:''}`:'';

  const rows=config.lines.map((row,index)=>{
    const cells=COLUMNS.map((col,i)=>{
      const cell=row.cells[col];
      // Reserve configured cells. Text may extend into adjacent empty cells
      // in its alignment direction, but never over a configured neighbor.
      let left=0,right=0;
      for(let j=i-1;j>=0&&!row.cells[COLUMNS[j]].field;j--)left++;
      for(let j=i+1;j<3&&!row.cells[COLUMNS[j]].field;j++)right++;
      const available=cell.align==='left'?1+right
        :cell.align==='right'?1+left
        :1+2*Math.min(left,right);
      const classes=[
        'entity-visual-card__cell','is-align-'+cell.align,
        'is-size-'+cell.size,'is-color-'+cell.color,
        cell.bold?'is-bold':'',cell.italic?'is-italic':'',cell.underline?'is-underline':'',
      ].filter(Boolean).join(' ');
      return `<span class="${classes}" data-entity-card-line="${index+1}" data-entity-card-column="${col}"><span class="entity-visual-card__text" style="--spill-width:${available}">${escapeHtml(lineText(cell,map))}</span></span>`;
    }).join('');
    return `<span class="entity-visual-card__row">${cells}</span>`;
  }).join('');
  return `<${tag} class="entity-visual-card${image?' has-image':''}${className?` ${escapeHtml(className)}`:''}" style="${style}"${attrs}><span class="entity-visual-card__surface" aria-hidden="true"></span><span class="entity-visual-card__grid">${rows}</span></${tag}>`;
}

function toolButton(label,key,active=false,title='',className=''){
  return `<button type="button" class="entity-card-editor__tool${active?' is-active':''}${className?` ${className}`:''}" data-card-tool="${escapeHtml(key)}"${title?` aria-label="${escapeHtml(title)}"`:''}>${label}</button>`;
}

function colorTool(value,label,active){
  return toolButton(
    `<span class="entity-card-editor__color-dot is-${escapeHtml(value)}" aria-hidden="true"></span>`,
    `color:${value}`,
    active,
    label,
    'entity-card-editor__tool--color',
  );
}

function fieldControl(line,fields){
  const registry=entityCardFieldRegistry(fields);
  return select({
    name:'entityCardLineField',
    label:'Данные',
    value:line.field,
    options:[{value:'',label:'Пусто'},...registry.map((item)=>({value:item.value,label:item.label}))],
    data:'data-card-line-field',
    aria:'Показатель выбранной строки и столбца',
  });
}

function editorWorkspace(state,fields,allowPhoto=true){
  if(allowPhoto && state.tab==='photo'){
    return `<div class="entity-card-editor__photo">
      ${button(state.photo?'Заменить фото':'Добавить фото',{variant:'secondary',data:'data-card-photo-select'})}
      ${state.photo?button('Удалить фото',{variant:'outline',className:'ui-button--delete-outline',data:'data-card-photo-remove'}):''}
      <p>Фото заполняет карту. Если фото нет, используется градиентный фон.</p>
    </div>`;
  }
  if(state.tab==='background'){
    const g=state.appearance.gradient;
    return `<div class="entity-card-editor__background">
      <div data-card-gradient-color="from">${colorPicker({name:'entityCardGradientFrom',value:g.from})}</div>
      <div data-card-gradient-color="mid">${colorPicker({name:'entityCardGradientMid',value:g.mid})}</div>
      <div data-card-gradient-color="to">${colorPicker({name:'entityCardGradientTo',value:g.to})}</div>
      <div class="entity-card-editor__direction">${rangeField({label:'Направление',name:'entityCardGradientAngle',value:g.angle,min:0,max:360,step:5,data:'data-card-gradient-angle',aria:'Направление градиента'})}</div>
    </div>`;
  }


  const row=state.appearance.lines[state.line];
  const cell=row.cells[state.column];
  return `<div class="entity-card-editor__card-tools">
    <div class="entity-card-editor__control-label">Столбец</div>
    <div class="segment-control entity-card-editor__columns" role="group" aria-label="Выбор столбца">
      ${COLUMNS.map((column,index)=>`<button type="button" class="${state.column===column?'is-active':''}" data-card-tool="column:${column}" aria-pressed="${state.column===column}" aria-label="Столбец ${index+1}: ${['левый','центральный','правый'][index]}">${['Лево','Центр','Право'][index]}</button>`).join('')}
    </div>
    <div class="entity-card-editor__control-label">Строка</div>
    <div class="entity-card-editor__line-picker">${Array.from({length:ENTITY_CARD_LINE_COUNT},(_,i)=>`<button type="button" class="${i===state.line?'is-active':''}" data-card-line-select="${i}" aria-pressed="${i===state.line}" aria-label="Строка ${i+1}">${i+1}</button>`).join('')}</div>
    <div class="entity-card-editor__data">${fieldControl(cell,fields)}</div>
    <div class="entity-card-editor__control-label">Выравнивание текста</div>
    <div class="entity-card-editor__tool-group entity-card-editor__tool-group--three" aria-label="Выравнивание">
      ${toolButton('←','align:left',cell.align==='left','Текст слева')}
      ${toolButton('↔','align:center',cell.align==='center','Текст по центру')}
      ${toolButton('→','align:right',cell.align==='right','Текст справа')}
    </div>
    <div class="entity-card-editor__tool-row entity-card-editor__tool-row--visual" aria-label="Размер и цвет">
      <div class="entity-card-editor__tool-group entity-card-editor__tool-group--four">
        ${['s','m','l','xl'].map(value=>toolButton(value.toUpperCase(),`size:${value}`,cell.size===value,`Размер ${value.toUpperCase()}`)).join('')}
      </div>
      <div class="entity-card-editor__tool-group entity-card-editor__tool-group--three entity-card-editor__tool-group--colors">
        ${colorTool('black','Чёрный',cell.color==='black')}
        ${colorTool('gray','Серый',cell.color==='gray')}
        ${colorTool('white','Белый',cell.color==='white')}
      </div>
    </div>
    <div class="entity-card-editor__tool-row entity-card-editor__tool-row--font" aria-label="Шрифт">
      <div class="entity-card-editor__tool-group entity-card-editor__tool-group--four">
        ${toolButton('B','bold',cell.bold,'Жирный')}
        ${toolButton('I','italic',cell.italic,'Курсив')}
        ${toolButton('U','underline',cell.underline,'Подчёркнутый')}
        ${toolButton('AA','uppercase',cell.uppercase,'Верхний регистр')}
      </div>
    </div>
  </div>`;
}

export function mountEntityCardConstructor(root,{appearance={},fields=[],photo='',photoPosition='50% 50%',allowPhoto=true,onSave=async()=>{},onPhotoChange=()=>{},onStateChange=()=>{}}={}) {
  if(!root)return null;
  const state={
    appearance:normalizeEntityCardAppearance(appearance),
    photo:String(photo||''),
    photoPosition:String(photoPosition||'50% 50%'),
    tab:'card',
    line:0,
    column:'left',
    saving:false,
    error:'',
    dirty:false,
    savedSnapshot:'',
  };

  const snapshot=()=>JSON.stringify({
    appearance:normalizeEntityCardAppearance(state.appearance),
    photo:state.photo,
  });
  state.savedSnapshot=snapshot();

  const notifyState=()=>onStateChange({
    dirty:Boolean(state.dirty),
    saving:Boolean(state.saving),
    error:String(state.error||''),
  });

  const markDirty=()=>{
    state.dirty=snapshot()!==state.savedSnapshot;
    notifyState();
  };

  const render=()=>{
    root.innerHTML=`<div class="entity-card-editor" data-entity-card-editor>
      <div class="entity-card-editor__preview" data-card-preview>${entityVisualCard({appearance:state.appearance,fields,image:state.photo,imagePosition:state.photoPosition})}</div>
      <div class="segment-control entity-card-editor__tabs" role="group" aria-label="Вид карты">
        ${(allowPhoto?[['photo','Фото'],['background','Фон'],['card','Карта']]:[['background','Фон'],['card','Карта']]).map(([value,label])=>`<button type="button" class="${state.tab===value?'is-active':''}" data-card-tab="${value}" aria-pressed="${state.tab===value?'true':'false'}">${label}</button>`).join('')}
      </div>
      <div class="entity-card-editor__workspace" data-card-workspace>${editorWorkspace(state,fields,allowPhoto)}</div>
      <div class="form-error" data-card-error>${escapeHtml(state.error||'')}</div>
    </div>`;
    bind();
    notifyState();
  };

  const updatePreview=()=>{
    const host=root.querySelector('[data-card-preview]');
    if(host)host.innerHTML=entityVisualCard({appearance:state.appearance,fields,image:state.photo,imagePosition:state.photoPosition});
  };

  const rerenderWorkspace=()=>{
    const workspace=root.querySelector('[data-card-workspace]');
    if(workspace)workspace.innerHTML=editorWorkspace(state,fields,allowPhoto);
    bindWorkspace();
    updatePreview();
    notifyState();
  };

  const bindWorkspace=()=>{
    root.querySelectorAll('[data-card-line-select]').forEach((control)=>control.addEventListener('click',()=>{
      state.line=Number(control.dataset.cardLineSelect)||0;
      // The selected column is independent of the selected row.
      rerenderWorkspace();
    }));

    root.querySelector('input[data-card-line-field]')?.addEventListener('change',(event)=>{
      state.appearance.lines[state.line].cells[state.column].field=event.target.value;
      updatePreview();
      markDirty();
    });

    root.querySelectorAll('[data-card-tool]').forEach((control)=>control.addEventListener('click',()=>{
      const key=control.dataset.cardTool||'';
      const row=state.appearance.lines[state.line];
      if(key.startsWith('column:'))state.column=COLUMNS.includes(key.slice(7))?key.slice(7):'left';
      else {
        const cell=row.cells[state.column];
        if(key.startsWith('align:'))cell.align=key.slice(6);
        else if(key.startsWith('size:'))cell.size=key.slice(5);
        else if(key.startsWith('color:'))cell.color=key.slice(6);
        else if(key==='bold')cell.bold=!cell.bold;
        else if(key==='italic')cell.italic=!cell.italic;
        else if(key==='underline')cell.underline=!cell.underline;
        else if(key==='uppercase')cell.uppercase=!cell.uppercase;
      }
      markDirty();
      rerenderWorkspace();
    }));

    initColorPickers(root);
    root.querySelectorAll('[data-card-gradient-color]').forEach((holder)=>{
      holder.querySelector('[data-color-value]')?.addEventListener('change',(event)=>{
        const key=holder.dataset.cardGradientColor;
        if(!key)return;
        state.appearance.gradient[key]=String(event.target.value||'').toUpperCase();
        updatePreview();
        markDirty();
      });
    });
    root.querySelector('[data-card-gradient-angle]')?.addEventListener('input',(event)=>{
      state.appearance.gradient.angle=Number(event.target.value);
      updatePreview();
      markDirty();
    });

    root.querySelector('[data-card-photo-select]')?.addEventListener('click',async()=>{
      const src=await selectPhotoFile().catch(()=> '');
      if(!src)return;
      state.photo=src;
      onPhotoChange(state.photo);
      markDirty();
      render();
    });

    root.querySelector('[data-card-photo-remove]')?.addEventListener('click',()=>{
      state.photo='';
      onPhotoChange('');
      markDirty();
      render();
    });
  };

  const save=async()=>{
    if(state.saving||!state.dirty)return;
    state.saving=true;
    state.error='';
    notifyState();
    try{
      await onSave({appearance:normalizeEntityCardAppearance(state.appearance),photo:state.photo});
      state.savedSnapshot=snapshot();
      state.dirty=false;
    }catch(error){
      state.error=error instanceof Error?error.message:'Не удалось сохранить вид карты';
    }finally{
      state.saving=false;
      notifyState();
      render();
    }
  };

  const bind=()=>{
    root.querySelectorAll('[data-card-tab]').forEach((control)=>control.addEventListener('click',()=>{
      state.tab=control.dataset.cardTab||'card';
      render();
    }));
    bindWorkspace();
  };

  render();
  return {getValue:()=>({appearance:normalizeEntityCardAppearance(state.appearance),photo:state.photo}),save,isDirty:()=>Boolean(state.dirty),isSaving:()=>Boolean(state.saving)};
}
