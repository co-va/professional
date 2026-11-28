import {inventoryTable,inventoryRowButton,bindInventoryTableRows} from './desktop.js';
import {
  actionBlock, button, emptyState, field, list, modal, mountModal,
  v2ListEntries, v2ListEntry, initV2ListReorder,
} from '../../ui/ui.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { catalogDisclosure } from './catalog-ui.js';
import { stockGroupTree, sortedStockChildren, stockGroupValue } from './grouping.js';
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
const compare = (a,b) => String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'});
const quantity = value => Number(value || 0).toLocaleString('ru-RU',{
  maximumFractionDigits:3,
}).replaceAll('\u00a0',' ');

export function stockRootCriterion(criteria = []) {
  // Manufacturer is the platform-owned, permanently first grouping level.
  return criteria.find(group => group.legacyField === 'manufacturer' || group.id === 'manufacturer')
    || baseCriteria[0];
}
export function stockNestedCriteria(criteria = []) {
  return criteria.filter(group => group.id !== stockRootCriterion(criteria).id);
}

export function buildStockCatalogGroups(items = [], configured = null) {
  const criteria = Array.isArray(configured) ? configured : baseCriteria;
  const root = stockRootCriterion(criteria);
  const brands = new Map();
  for (const item of items) {
    const brand = stockGroupValue(item,root) || 'Без производителя';
    if (!brands.has(brand)) brands.set(brand,{name:brand,items:[],children:new Map()});
    brands.get(brand).items.push(item);
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
      aria:'Открыть карточку складской единицы ' + item.name,
      data:'data-stock-product="' + escapeHtml(item.itemId) + '"',
    }]}) + '</div>';
}

/**
 * Every assigned criterion forms one visible level in its configured order.
 * Unassigned criteria form no folder. Direct items remain visible at the
 * nearest actual parent; counts always include all descendants.
 */
export function stockGroupedSections(items, selected = new Set(), scope = INVENTORY_TOTAL_SCOPE, criteria = baseCriteria, { selectGroups = false } = {}) {
  const hierarchy = stockGroupTree(items,stockNestedCriteria(criteria));
  const productRows = rows => rows.map(item => stockRow(item, selected, scope)).join('');
  const render = node => {
    const children = sortedStockChildren(node,stockNestedCriteria(criteria));
    const sole = children.length === 1 && node.direct.length === 0;
    return children.map(child => {
      const content = render(child);
      const groupCheck = selectGroups ? compactCheck({
        checked:child.items.length > 0 &&
          child.items.every(item => selected.has(String(item.itemId))),
        aria:'Выбрать все позиции группы ' + child.value,
        data:'data-stock-group-check',
      }) : '';
      const section = catalogDisclosure(child.value,content,Boolean(node.key),child.items.length,groupCheck);
      return sole ? section.replace('<details>', '<details open>') : section;
    }).join('') + productRows(node.direct);
  };
  return '<div class="inventory-counterparty-product-list inventory-item-accordion">' +
    render(hierarchy) + '</div>';
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
      const searchableGroups=stockNestedCriteria(options.criteria||baseCriteria);
      const items=term ? brand.items.filter(item=>
        [item.name,item.catalogName,item.sku,item.barcode,item.manufacturer,
          ...searchableGroups.map(group=>stockGroupValue(item,group))].some(value=>
          name(value).toLocaleLowerCase('ru-RU').includes(term))) : brand.items;
      products.innerHTML=items.length
        ? stockGroupedSections(items,selected,scope,options.criteria||baseCriteria)
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
  if (options.desktop&&options.sort==='name-asc') groups.sort((a,b)=>compare(a.name,b.name));
  else if (options.desktop&&options.sort==='name-desc') groups.sort((a,b)=>compare(b.name,a.name));
  else if (options.sort === 'name-desc') groups.reverse();
  else if (options.sort === 'count-desc') groups.sort((a,b)=>
    b.items.length-a.items.length || compare(a.name,b.name));
  else if (options.sort === 'count-asc') groups.sort((a,b)=>
    a.items.length-b.items.length || compare(a.name,b.name));
  const ids = new Map((options.brandValues || []).map(value=>[value.name,value.id]));
  const allowReorder=typeof options.onReorder==='function';
  if(options.desktop){
    host.innerHTML=groups.length?inventoryTable(groups,[
      {key:'drag',label:'',narrow:true,render:group=>allowReorder&&ids.has(group.name)?'<span class="list-entry__reorder-handle" data-reorder-handle role="button" tabindex="0" aria-label="Изменить порядок"><span aria-hidden="true">⋮⋮</span></span>':''},
      {key:'name',label:'Производитель',render:group=>inventoryRowButton(group.name,'data-stock-brand',group.name)},
      {key:'count',label:'Позиций',narrow:true,render:group=>String(group.items.length)},
    ],'Производители'):emptyState('Товаров нет','Создайте позицию или выберите её у контрагента.');
    const body=host.querySelector('tbody');
    body?.classList.add('list-entries');
    host.querySelectorAll('[data-stock-brand]').forEach(button=>{
      if(allowReorder&&ids.has(button.dataset.stockBrand))button.closest('tr').dataset.reorderId=ids.get(button.dataset.stockBrand);
    });
    bindInventoryTableRows(host,'[data-stock-brand]',node=>{
      const brand=groups.find(group=>group.name===node.dataset.stockBrand);
      if(brand)options.onBrandOpen?.(brand);
    });
    return allowReorder?initV2ListReorder(host,{selector:'tr[data-reorder-id]',onReorder:options.onReorder,onError:options.onReorderError||(()=>{})}):()=>{};
  }
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
