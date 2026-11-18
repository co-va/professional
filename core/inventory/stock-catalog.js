import {
  actionBlock, button, emptyState, list, modal, mountModal,
  v2ListEntries, v2ListEntry,
} from '../../ui/ui.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { catalogDisclosure } from './catalog-ui.js';
import { getInventoryItems } from './data.js';
import {
  INVENTORY_TOTAL_SCOPE, inventoryDisplayBalance, inventoryDisplayTarget,
} from './stock-targets.js';

const name = value => String(value || '').trim();
const brandOf = item => name(item.manufacturer) || 'Без производителя';
const compare = (a,b) => String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'});
const quantity = value => Number(value || 0).toLocaleString('ru-RU',{
  maximumFractionDigits:3,
}).replaceAll('\u00a0',' ');

function hierarchyOf(item) {
  const full = Array.isArray(item.classificationPath) ? item.classificationPath.map(name).filter(Boolean) : [];
  if (full.length) return full[0] === brandOf(item) ? full.slice(1) : full;
  const values = [name(item.category), name(item.productType)].filter(Boolean);
  return values.filter((value,index) => !index || value !== values[index-1]);
}

export function buildStockCatalogGroups(items = []) {
  const brands = new Map();
  for (const item of items) {
    const brand = brandOf(item);
    if (!brands.has(brand)) brands.set(brand, {name: brand, items: [], children:new Map()});
    const root = brands.get(brand);
    root.items.push(item);
    let node = root;
    for (const part of hierarchyOf(item)) {
      if (!node.children.has(part))
        node.children.set(part,{name:part,items:[],children:new Map()});
      node = node.children.get(part);
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
      secondary:[item.sku, item.productType || item.category].filter(Boolean).join(' · ') || '—',
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

export function openStockCatalogBrand(brand, {
  scope = INVENTORY_TOTAL_SCOPE,
  onOpen = () => {},
  onNew = () => {},
  onTarget = () => {},
} = {}) {
  if (!brand) return null;
  const selected = new Set();
  const groupLookup = new Map();
  const makeList = (node, key = 'root', depth = 0) => {
    const flat = node.items.filter(item => ![...node.children.values()]
      .some(child => child.items.some(other=>other.itemId===item.itemId)));
    let html = flat.length
      ? '<div class="inventory-counterparty-product-list">' +
        flat.map(item=>stockRow(item,selected,scope)).join('') + '</div>'
      : '';
    [...node.children.values()].sort((a,b)=>compare(a.name,b.name))
      .forEach((child,index)=>{
        const groupKey = key + '-' + index;
        groupLookup.set(groupKey,child.items.map(item=>String(item.itemId)));
        const allChecked = child.items.length > 0 && child.items.every(item=>selected.has(String(item.itemId)));
        html += catalogDisclosure(child.name, makeList(child,groupKey,depth+1),
          depth>0,child.items.length,compactCheck({
            checked:allChecked,
            aria:'Выбрать группу ' + child.name,
            data:'data-stock-group-check="' + escapeHtml(groupKey) + '"',
          }));
      });
    return html;
  };
  const layer = mountModal(document.body, modal(
    '<div data-stock-catalog-body></div>',
    {title:brand.name,variant:'q',surface:'app'},
  ));
  if (!layer) return null;
  const refresh = () => {
    // Refresh from the server snapshot after any Q edit; old row objects
    // must never hide a saved name, target or classification change.
    brand = buildStockCatalogGroups(getInventoryItems())
      .find(group=>group.name===brand.name) || brand;
    const visibleIds = new Set(brand.items.map(item=>String(item.itemId)));
    [...selected].forEach(id=>{if(!visibleIds.has(id))selected.delete(id);});
    const body = layer.querySelector('[data-stock-catalog-body]');
    if (!body) return;
    groupLookup.clear();
    body.innerHTML = '<div class="inventory-item-accordion">' +
      makeList(brand) + '</div>' +
      actionBlock(
        button('Желаемый остаток',{data:'data-stock-selection-target'}) +
        button('Новый товар',{variant:'secondary',data:'data-stock-selection-new'}),
        {className:'inventory-counterparty-selection-actions'},
      ) + '<p class="ui-list__secondary" data-stock-selection-count></p>';
    const target = layer.querySelector('[data-stock-selection-target]');
    const counter = layer.querySelector('[data-stock-selection-count]');
    const sync = () => {
      if (target) target.disabled = selected.size !== 1;
      if (counter) counter.textContent = selected.size ? 'Выбрано: '+selected.size : '';
      layer.querySelectorAll('[data-stock-item-check]').forEach(node=>{
        node.checked=selected.has(String(node.dataset.stockItemCheck));
      });
      layer.querySelectorAll('[data-stock-group-check]').forEach(node=>{
        const ids=groupLookup.get(node.dataset.stockGroupCheck)||[];
        const count=ids.filter(id=>selected.has(id)).length;
        node.checked=ids.length>0&&count===ids.length;
        node.indeterminate=count>0&&count<ids.length;
      });
    };
    layer.querySelectorAll('[data-stock-item-check]').forEach(node=>{
      node.addEventListener('change',()=>{
        const id=String(node.dataset.stockItemCheck);
        if(node.checked)selected.add(id);else selected.delete(id);
        sync();
      });
    });
    layer.querySelectorAll('[data-stock-group-check]').forEach(node=>{
      node.addEventListener('change',()=>{
        const ids=groupLookup.get(node.dataset.stockGroupCheck)||[];
        ids.forEach(id=>node.checked?selected.add(id):selected.delete(id));
        sync();
      });
    });
    layer.querySelectorAll('[data-stock-product]').forEach(node=>{
      node.addEventListener('click',()=>onOpen(node.dataset.stockProduct,refresh));
    });
    target?.addEventListener('click',()=>{
      if(selected.size===1)onTarget([...selected][0],refresh);
    });
    layer.querySelector('[data-stock-selection-new]')?.addEventListener('click',()=>{
      onNew(brand.name,refresh);
    });
    sync();
  };
  refresh();
  return layer;
}

export function renderStockBrandList(host, items, options = {}) {
  if (!host) return;
  const groups = buildStockCatalogGroups(items);
  if (options.sort === 'name-desc') groups.reverse();
  else if (options.sort === 'count-desc') groups.sort((a,b)=>
    b.items.length-a.items.length || compare(a.name,b.name));
  else if (options.sort === 'count-asc') groups.sort((a,b)=>
    a.items.length-b.items.length || compare(a.name,b.name));
  host.innerHTML = groups.length ? v2ListEntries(groups.map(group=>v2ListEntry({
    title: group.name,
    rightTop: group.items.length + ' поз.',
    interactive:true, initial:'', omitEmptySubtitle:true,
    data:'data-stock-brand="' + escapeHtml(group.name) + '"',
    aria:'Открыть ассортимент ' + group.name,
  }))) : emptyState('Товаров нет','Создайте позицию или выберите её у контрагента.');
  host.querySelectorAll('[data-stock-brand]').forEach(node=>{
    node.addEventListener('click',()=>{
      const brand = groups.find(group=>group.name===node.dataset.stockBrand);
      if(brand)openStockCatalogBrand(brand,options);
    });
  });
}
