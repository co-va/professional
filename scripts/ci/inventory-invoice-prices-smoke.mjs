import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const orders = readFileSync('core/inventory/orders.js', 'utf8');
const service = readFileSync('core/inventory/service.js', 'utf8');
assert.match(orders, /id: 'invoice', label: 'Цены по счёту'/);
assert.match(orders, /openInventoryOrderInvoice\(layer, orderId, saveAndRefresh\)/);
assert.match(orders, /const suggestedPrice = oldLine/);
assert.match(orders, /data-inventory-order-refresh-prices/);
assert.match(orders, /data-inventory-order-total/);
assert.match(orders, /Известная сумма:/);
assert.match(service, /verifySnapshot: payload => verifyPurchaseOrderLines\(payload, orderId, value\)/);

const quoteSource = orders.slice(orders.indexOf('const orderSupplierQuote ='), orders.indexOf('const headSearch ='));
const { orderSupplierQuote, orderPriceInput } = new Function(quoteSource + '\nreturn {orderSupplierQuote,orderPriceInput}')();
const product = { itemId:'paint', unit:'г', receiptUnit:'шт.', packageQuantity:85,
  primaryOfferId:'a', supplierOffers:[
    { offerId:'a', supplier:'CHI', listPrice:1389.75, actualPrice:1200, unitsPerOffer:85 },
    { offerId:'b', supplier:'Other', listPrice:100, actualPrice:85, unitsPerOffer:85 },
  ] };
assert.equal(orderSupplierQuote(product, 'CHI').price, 1389.75);
assert.equal(orderSupplierQuote(product, 'CHI').expectedPrice, 1200);
assert.equal(orderSupplierQuote(product, 'Other').price, 100);
assert.equal(orderSupplierQuote(product, 'Missing'), null);
assert.equal(orderPriceInput('1245,50'), 1245.5);
assert.equal(orderPriceInput(''), null);
assert.ok(Number.isNaN(orderPriceInput('-5')));

const invoiceStart = orders.indexOf('function openInventoryOrderInvoice(');
const invoiceEnd = orders.indexOf('function openInventoryOrderZ(', invoiceStart);
assert.ok(invoiceStart > 0 && invoiceEnd > invoiceStart);
const invoiceSource = orders.slice(invoiceStart, invoiceEnd);
const inputs = [{value:''}, {value:'350'}];
const rowTotals = [{textContent:''}, {textContent:''}];
const differences = [{textContent:''}, {textContent:''}];
const grand = {textContent:''}, error = {textContent:''};
let onSave = null, onInput = null, request = null, didClose = false, didRefresh = false;
let markup = '';
const save = {disabled:false, addEventListener: (type, fn) => {
  if (type === 'click') onSave = fn;
}};
const rowHosts = [0,1].map(i => ({querySelector: name =>
  name === '[data-inventory-invoice-line-total]' ? rowTotals[i] : differences[i],
}));
const layer = {
  isConnected:true,
  v2Close() { this.isConnected = false; didClose = true; },
  querySelector(name) {
    if (name === '[data-inventory-invoice-total]') return grand;
    if (name === '[data-inventory-invoice-error]') return error;
    if (name === '[data-inventory-invoice-save]') return save;
    if (name === '[data-inventory-order-invoice]') return {
      addEventListener(type, fn) { if (type === 'input') onInput = fn; },
    };
    const price = /invoicePrice-(\d+)/.exec(name);
    if (price) return inputs[Number(price[1])];
    const row = /invoice-row="(\d+)"/.exec(name);
    if (row) return rowHosts[Number(row[1])];
    return null;
  },
};
const purchase = { orderId:'abc', status:'formed', supplier:'CHI', note:'keep-original',
  lines:[
    { itemId:'paint', name:'Краска', packages:2, packPrice:0, offerId:'a' },
    { itemId:'oxidant', name:'Оксид', packages:1, packPrice:350, offerId:'b' },
  ],
};
const mocks = {
  getInventoryOrder: () => purchase,
  getInventoryItem: id => ({itemId:id}),
  orderSupplierQuote: item => ({price:item.itemId === 'paint' ? 1000 : 400}),
  orderPriceInput,
  field: opts => '<input name="' + opts.name + '">',
  actionBlock: markup => markup,
  button: label => '<button>' + label + '</button>',
  rubles: value => Number(value).toFixed(2) + ' ₽',
  escapeHtml: value => String(value ?? ''),
  mountModal: (_root, content) => { markup = content; return layer; },
  modal: content => content,
  openNotice: () => { throw new Error('Unexpected warning'); },
  updateInventoryPurchaseOrder: async (id, payload) => { request = {id, payload}; },
};
const openInvoice = new Function(...Object.keys(mocks), invoiceSource +
  '\nreturn openInventoryOrderInvoice;')(...Object.values(mocks));
openInvoice({}, 'abc', () => { didRefresh = true; });
assert.match(markup, /invoicePrice-0/);
assert.match(grand.textContent, /без цены: 1 поз/);
assert.equal(typeof onSave, 'function');
assert.equal(typeof onInput, 'function');
inputs[0].value = '-12';
onInput({target:{name:'invoicePrice-0'}});
assert.equal(save.disabled, true, 'Invalid price must disable saving');
inputs[0].value = '800';
inputs[1].value = '410';
onInput({target:{name:'invoicePrice-0'}});
assert.equal(grand.textContent, 'Итого: 2010.00 ₽');
assert.equal(rowTotals[0].textContent, '1600.00 ₽');
assert.match(differences[0].textContent, /20%/);
assert.equal(save.disabled, false);
await onSave();
assert.deepEqual(request, {id:'abc',payload:{
  supplier:'CHI', note:'keep-original',
  lines:[
    {itemId:'paint', packages:2, packPrice:800, offerId:'a'},
    {itemId:'oxidant', packages:1, packPrice:410, offerId:'b'},
  ],
}});
assert.equal(error.textContent, '');
assert.equal(didClose, true);
assert.equal(didRefresh, true);

const verifierStart = service.indexOf('function verifyPurchaseOrderLines(');
const verifierEnd = service.indexOf('export async function updateInventoryPurchaseOrder(', verifierStart);
assert.ok(verifierStart > 0 && verifierEnd > verifierStart);
const verify = new Function('verifyOrderState', service.slice(verifierStart, verifierEnd) +
  '\nreturn verifyPurchaseOrderLines;')(
    (payload,id) => payload.orders.find(order => order.orderId === id),
  );
const requested = request.payload;
verify({orders:[{orderId:'abc',status:'formed',lines:requested.lines}]}, 'abc', requested);
assert.throws(() => verify({orders:[{orderId:'abc',status:'formed',lines:[
  {...requested.lines[0],packPrice:1200},requested.lines[1],
]}]}, 'abc', requested), /не подтвердил/);
assert.throws(() => verify({orders:[{orderId:'abc',status:'formed',lines:[
  requested.lines[0],
]}]}, 'abc', requested), /неполный состав/);
console.log('PASS: invoice Q, supplier quote, live totals, full line persistence, server verification');
