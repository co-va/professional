import { actionBlock, button, emptyState, field, list, modal, mountModal } from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { applyInventoryCriteriaRecovery, loadInventory, loadInventoryCriteria,
  previewInventoryCriteriaRecovery } from './service.js';

// The original inventory export has quoted multi-line headers. Data rows
// begin with their Excel row number and have stable historical positions.
// The four-column TSV is generated from the same source outside the app.
export function parseInventoryCriteriaRecoveryFile(source) {
  const lines=String(source||'').replace(/^\uFEFF/,'').split(/\r?\n/);
  const header=lines[0]?.split('\t').map(value=>value.trim())||[];
  const isPrepared=header.length===4 &&
    ['Артикул','Производитель','Категория','Тип'].every((value,index)=>header[index]===value);
  const isOriginal=!isPrepared && source.includes('КОМПАНИЯ') &&
    source.includes('ПРОДУКТ') && source.includes('КАТЕГОРИЯ 3');
  if(!isPrepared&&!isOriginal)throw new Error(
    'Выберите исходную таблицу склада или файл восстановления с четырьмя колонками.');
  const rows=[];
  const keys=new Set();
  for(const [i,line] of lines.entries()){
    if(!line.trim()||(isPrepared&&i===0))continue;
    if(isOriginal&&!/^\d+\t/.test(line))continue;
    const columns=line.split('\t');
    if(columns.length<(isOriginal?19:4))throw new Error('Неполная строка '+(i+1)+'.');
    const row=isOriginal
      ? {sku:columns[2],manufacturer:columns[16],
        category:columns[18],productType:columns[17]}
      : {sku:columns[0],manufacturer:columns[1],
        category:columns[2],productType:columns[3]};
    Object.keys(row).forEach(key=>{row[key]=String(row[key]||'').trim();});
    if(Object.values(row).some(value=>!value))throw new Error(
      'Отсутствует производитель, артикул, категория или тип в строке '+(i+1)+'.');
    const id=(row.manufacturer+'::'+row.sku).toLocaleUpperCase('ru-RU');
    if(keys.has(id))throw new Error('Повторяющийся артикул: '+row.sku+'.');
    keys.add(id);
    rows.push(row);
  }
  if(!rows.length||rows.length>1000)throw new Error('Ожидалось от 1 до 1000 товаров.');
  return rows;
}

export function openInventoryClassificationRecovery(onSaved = () => {}) {
  const layer=mountModal(document.body,modal(
    '<div data-inventory-classification-restore>' +
      '<p>Сверьте исходные категории и типы с нынешними товарами по производителю и артикулу. ' +
      'Товары, которых нет в файле, не изменятся.</p>' +
      field({label:'Исходная таблица',name:'classificationSource',type:'file',
        data:'data-inventory-restore-file accept=".tsv,.txt,text/plain"'}) +
      '<p class="form-error" role="alert" data-inventory-restore-status></p>' +
      '<div data-inventory-restore-preview></div>' +
      actionBlock(button('Сверить с остатками',{data:'data-inventory-restore-preview-button'}) +
        button('Восстановить классификацию',{variant:'secondary',
          data:'data-inventory-restore-apply-button',disabled:true})) +
    '</div>',{title:'Восстановление классификации',variant:'q',surface:'app'},
  ));
  if(!layer)return null;
  const fileInput=layer.querySelector('[data-inventory-restore-file]');
  const status=layer.querySelector('[data-inventory-restore-status]');
  const summary=layer.querySelector('[data-inventory-restore-preview]');
  const previewButton=layer.querySelector('[data-inventory-restore-preview-button]');
  const applyButton=layer.querySelector('[data-inventory-restore-apply-button]');
  let preview=null;
  let busy=false;
  const showError=cause=>{if(status)status.textContent=
    cause instanceof Error?cause.message:'Не удалось восстановить классификацию.';};
  fileInput?.addEventListener('change',()=>{
    preview=null;if(applyButton)applyButton.disabled=true;
    if(summary)summary.innerHTML='';
    if(status)status.textContent='';
  });
  previewButton?.addEventListener('click',async()=>{
    if(busy)return;
    busy=true;
    previewButton.disabled=true;
    if(applyButton)applyButton.disabled=true;
    if(status)status.textContent='';
    try {
      const file=fileInput?.files?.[0];
      if(!file)throw new Error('Выберите исходную таблицу.');
      if(file.size>2*1024*1024)throw new Error('Размер файла не должен превышать 2 МБ.');
      const rows=parseInventoryCriteriaRecoveryFile(await file.text());
      preview=await previewInventoryCriteriaRecovery(rows);
      const changed=Array.isArray(preview.changes)?preview.changes:[];
      const missing=Array.isArray(preview.notFound)?preview.notFound:[];
      const ambiguous=Array.isArray(preview.ambiguous)?preview.ambiguous:[];
      summary.innerHTML=
        '<p>В файле: <strong>'+Number(preview.sourceCount||0)+'</strong> · '+
        'совпало со складом: <strong>'+Number(preview.matchedCount||0)+'</strong> · '+
        'исправить: <strong>'+changed.length+'</strong> · '+
        'уже правильно: <strong>'+Number(preview.unchangedCount||0)+'</strong></p>'+
        (missing.length?'<p>Нет на складе ('+missing.length+'): '+
          escapeHtml(missing.slice(0,12).join(', '))+'</p>':'')+
        (ambiguous.length?'<p>Неоднозначные артикулы ('+ambiguous.length+'): '+
          escapeHtml(ambiguous.slice(0,12).join(', '))+'</p>':'')+
        (changed.length?list({className:'ui-list--dense',
          items:changed.slice(0,10).map(item=>({
            title:item.sku+' · '+item.name,
            secondary:[item.beforeCategory+' / '+item.beforeProductType,
              '→ '+item.category+' / '+item.productType],
          })),
        }):emptyState('Изменений не требуется'))+
        (changed.length>10?'<p>И ещё '+(changed.length-10)+' поз.</p>':'')+
        '<p>Восстановление изменит только категорию и тип этих позиций. '+
        'Остатки, цены и движения останутся без изменений.</p>';
      if(applyButton)applyButton.disabled=!changed.length;
    } catch(cause){preview=null;showError(cause);}
    finally{busy=false;previewButton.disabled=false;}
  });
  applyButton?.addEventListener('click',async()=>{
    if(busy||!preview?.changes?.length)return;
    busy=true;
    applyButton.disabled=true;
    if(previewButton)previewButton.disabled=true;
    if(status)status.textContent='Сохраняем проверенные значения…';
    try {
      const result=await applyInventoryCriteriaRecovery(preview.changes);
      await Promise.all([loadInventory(),loadInventoryCriteria()]);
      if(status)status.textContent='Восстановлено: '+Number(result.updatedCount||0)+' поз.';
      if(summary)summary.innerHTML='';
      preview=null;
      onSaved();
    }catch(cause){
      if(status)status.textContent='';
      showError(cause);
    }finally{busy=false;if(previewButton)previewButton.disabled=false;}
  });
  return layer;
}
