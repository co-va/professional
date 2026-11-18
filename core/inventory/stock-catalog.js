import {
  actionBlock, button, emptyState, field, list, modal, mountModal,
  v2ListEntries, v2ListEntry, initV2ListReorder,
} from '../../ui/ui.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { getInventoryItems } from './data.js';
import {
  INVENTORY_TOTAL_SCOPE, inventoryDisplayBalance, inventoryDisplayTarget,
} from './stock-targets.js';

const name = value => String(value || '').trim();
const baseCriteria = [
  {id:'manufacturer',name:'Производитель',legacyField:'manufacturer'},
  {id:'category',name:'Категория',legacyField:'category'},
  {id:'productType',name:'Тип',legacyField:'productType'},
];
const groupValue = (item, group) => {
  const field=group?.legacyField;
  if(field) return name(item[field]);
  const valueId=name(item.criteriaValues?.[group.id]);
  return group.values?.find(value=>value.id===valueId)?.name || '';
};
const brandOf = (item,criterion=baseCriteria[0]) =>
  groupValue(item,criterion) || 'Без ' + String(criterion.name||'группы').toLocaleLowerCase('ru-RU');
const compare = (a,b) => String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'});
const quantity = value => Number(value || 0).toLocaleString('ru-RU',{
  maximumFractionDigits:3,
}).replaceAll('\u00a0',' ');

function hierarchyOf(item, criteria, root) {
  // Only original Category and Type are navigation levels by default.
  // User-created criteria never add compulsory extra accordion levels.
  const fields=criteria.filter(group=>group.id!==root.id
    && (group.legacyField==='category'||group.legacyField==='productType'));
  const names=fields.map(group=>groupValue(item,group)).filter(Boolean);
  return names.filter((value,index)=>!index||value!==names[index-1]);
}

export function buildStockCatalogGroups(items = [], configured = null) {
  const criteria=Array.isArray(configured)?configured:baseCriteria;
  const root=criteria[0]||null;
  const brands=new Map();
  for(const item of items) {
    const brand=root?brandOf(item,root):'Все товары';
    if(!brands.has(brand)) brands.set(brand,{name:brand,items:[],children:new Map()});
    const group=brands.get(brand);
    group.items.push(item);
    let node=group;
    for(const part of (root?hierarchyOf(item,criteria,root):[])) {
      if(!node.children.has(part))
        node.children.set(part,{name:part,items:[],children:new Map()});
      node=node.children.get(part);
      node.items.push(item);
    }
  }
  return [...brands.values()].sort((a,b)=>compare(a.name,b.name));
}

function stockRow(item, selected, scope) {
  const balance = inventoryDisplayBalance(item, scope);
  const target = inventoryDisplayTarget(item, scope);
  const threshold = item.thresholdUnit || item.receiptUnit || item.unit || 'шт.';
  return '<div class="inventory-counterparty-product-row">' +
    compactCheck({
      checked:selected.has(String(item.itemId)),
      aria:'Выбрать позицию ' + item.name,
      data:'data-stock-item-check="' + escapeHtml(item.itemId) + '"',
    }) +
    list({className:'ui-list--dense',items:[{
      title:item.name,
      secondary:[item.sku, item.category, item.productType].filter(Boolean).join(' · ') || '—',
      right:[
        quantity(balance) + ' ' + (item.unit || ''),
        target == null ? 'Цель не задана'
          : 'Цель ' + quantity(target) + ' ' + threshold,
      ],
      interactive:true,
      aria:'Открыть карточку продукта ' + item.name,
      data:'data-stock-product="' + escapeHtml(item.itemId) + '"',
    }]}) + '</div>';
}

/**
 * Visual sections only: category -> type -> visible item rows.
 * No disclosure state, extra category API, or change to persisted item data.
 */
export function stockGroupedSections(items, selected = new Set(), scope = INVENTORY_TOTAL_SCOPE) {
  const categories = new Map();
  for (const item of items) {
    const category = name(item.category) || 'Без категории';
    const type = name(item.productType) || 'Без типа';
    if (!categories.has(category)) categories.set(category,new Map());
    const types = categories.get(category);
    if (!types.has(type)) types.set(type,[]);
    types.get(type).push(item);
  }
  return '<div class="inventory-counterparty-product-list">' +
    [...categories.entries()].sort(([a],[b])=>compare(a,b)).map(([category,types])=>{
      const count=[...types.values()].reduce((sum,rows)=>sum+rows.length,0);
      return '<section class="inventory-stock-category">' +
        '<div class="inventory-stock-category-heading"><strong>' + escapeHtml(category) +
        '</strong><small>' + count + ' поз.</small></div>' +
        [...types.entries()].sort(([a],[b])=>compare(a,b)).map(([type,rows])=>
          '<div class="inventory-stock-type-heading"><span>'+escapeHtml(type)+
          '</span><small>'+rows.length+' поз.</small></div>' +
          rows.map(item=>stockRow(item,selected,scope)).join('')
        ).join('') + '</section>';
    }).join('') + '</div>';
}

export function openStockCatalogBrand(brand, options = {}) {
  const {
    scope = INVENTORY_TOTAL_SCOPE,
    onOpen = () => {},
    onNew = () => {},
    onTarget = () => {},
  } = options;
  if (!brand) return null;
  const selected = new Set();
  let search = '';
  const layer = mountModal(document.body, modal(
    '<div data-stock-catalog-body></div>',
    {title:brand.name,variant:'q',surface:'app'},
  ));
  if (!layer) return null;
  const refresh = () => {
    // Classification values can be wrong in legacy imports. They must never
    // form compulsory folders that prevent access to an inventory item.
    const visible = typeof options.itemsForView === 'function'
      ? options.itemsForView() : getInventoryItems();
    brand = buildStockCatalogGroups(visible,options.criteria||[])
      .find(group=>group.name===brand.name) || { ...brand, items:[], children:new Map() };
    const visibleIds = new Set(brand.items.map(item=>String(item.itemId)));
    [...selected].forEach(id=>{if(!visibleIds.has(id))selected.delete(id);});
    const body = layer.querySelector('[data-stock-catalog-body]');
    if (!body) return;
    body.innerHTML = '<div class="ui-search-field">' +
      field({label:'Поиск',name:'inventoryStockItemSearch',type:'search',
        placeholder:'Название, артикул, категория, тип…',autocomplete:'off',
        data:'data-stock-catalog-search'}) + '</div>' +
      '<div data-stock-catalog-products></div>' +
      actionBlock(
        button('Желаемый остаток',{data:'data-stock-selection-target'}) +
        button('Новый товар',{variant:'secondary',data:'data-stock-selection-new'}),
        {className:'inventory-counterparty-selection-actions'},
      ) + '<p class="ui-list__secondary" data-stock-selection-count></p>';
    const input = body.querySelector('[data-stock-catalog-search]');
    const products = body.querySelector('[data-stock-catalog-products]');
    const target = body.querySelector('[data-stock-selection-target]');
    const counter = body.querySelector('[data-stock-selection-count]');
    const sync = () => {
      if (target) target.disabled = selected.size !== 1;
      if (counter) counter.textContent = selected.size ? 'Выбрано: '+selected.size : '';
      products?.querySelectorAll('[data-stock-item-check]').forEach(node=>{
        node.checked=selected.has(String(node.dataset.stockItemCheck));
      });
    };
    const draw = () => {
      if (!products) return;
      const term=search.trim().toLocaleLowerCase('ru-RU');
      const items=term ? brand.items.filter(item=>
        [item.name,item.catalogName,item.sku,item.barcode,item.manufacturer,
          item.category,item.productType].some(value=>
          name(value).toLocaleLowerCase('ru-RU').includes(term))) : brand.items;
      products.innerHTML=items.length
        ? stockGroupedSections(items,selected,scope)
        : emptyState(term ? 'Товар не найден' : 'В этой группе пока нет товаров');
      products.querySelectorAll('[data-stock-item-check]').forEach(node=>{
        node.addEventListener('change',()=>{
          const id=String(node.dataset.stockItemCheck);
          if(node.checked)selected.add(id);else selected.delete(id);
          sync();
        });
      });
      products.querySelectorAll('[data-stock-product]').forEach(node=>{
        node.addEventListener('click',()=>onOpen(node.dataset.stockProduct,refresh));
      });
      sync();
    };
    if (input) {
      input.value=search;
      input.addEventListener('input',event=>{
        search=String(event.target.value||'');
        draw();
      });
    }
    target?.addEventListener('click',()=>{
      if(selected.size===1)onTarget([...selected][0],refresh);
    });
    body.querySelector('[data-stock-selection-new]')?.addEventListener('click',()=>{
      onNew(brand.name,refresh);
    });
    draw();
  };
  refresh();
  return layer;
}

export function renderStockBrandList(host, items, options = {}) {
  if (!host) return () => {};
  const groups = buildStockCatalogGroups(items,options.criteria||[]);
  const valueOrder = new Map((options.brandValues || []).map((item,index)=>[item.name,index]));
  if (valueOrder.size) groups.sort((a,b)=>
    (valueOrder.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
    (valueOrder.get(b.name) ?? Number.MAX_SAFE_INTEGER) || compare(a.name,b.name));
  if (options.sort === 'name-desc') groups.reverse();
  else if (options.sort === 'count-desc') groups.sort((a,b)=>
    b.items.length-a.items.length || compare(a.name,b.name));
  else if (options.sort === 'count-asc') groups.sort((a,b)=>
    a.items.length-b.items.length || compare(a.name,b.name));
  const ids = new Map((options.brandValues || []).map(value=>[value.name,value.id]));
  const allowReorder=typeof options.onReorder==='function';
  host.innerHTML = groups.length ? v2ListEntries(groups.map(group=>v2ListEntry({
    title: group.name,
    rightTop: group.items.length + ' поз.',
    interactive:true, initial:'', omitEmptySubtitle:true,
    reorderHandle:allowReorder && ids.has(group.name),
    reorderAria:'Изменить порядок ' + group.name,
    data:'data-stock-brand="' + escapeHtml(group.name) + '"' +
      (allowReorder && ids.has(group.name)
        ? ' data-reorder-id="' + escapeHtml(ids.get(group.name)) + '"' : ''),
    aria:'Открыть ассортимент ' + group.name,
  }))) : emptyState('Товаров нет','Создайте позицию или выберите её у контрагента.');
  host.querySelectorAll('[data-stock-brand]').forEach(node=>{
    node.addEventListener('click',()=>{
      const brand = groups.find(group=>group.name===node.dataset.stockBrand);
      if(brand) {
        if(typeof options.onBrandOpen==='function') options.onBrandOpen(brand);
        else openStockCatalogBrand(brand,options);
      }
    });
  });
  return allowReorder ? initV2ListReorder(host,{
    selector:'[data-stock-brand][data-reorder-id]',
    onReorder:options.onReorder,
    onError:options.onReorderError || (()=>{}),
  }) : () => {};
}
