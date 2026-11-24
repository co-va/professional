import { apiRequest } from './auth.js';
import { actionBlock, button, escapeHtml, initSegmentControls, modal, mountModal, segmentControl, v2Section } from '../ui/ui.js';

let activeFlow = null;
async function request(path = '', options = {}) {
  const response = await apiRequest('/saas-commercial' + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || 'Тарифы временно недоступны');
  return data;
}
function price(minor) {
  return new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB',maximumFractionDigits:0})
    .format(Number(minor || 0)/100);
}
function isAdminManaged(data) {
  return data.access?.commercialMode === 'LIVE' && data.selfServiceManaged !== true;
}
function pendingContent(data) {
  const order = data.order || {};
  const name = order.tariffKey === 'tariff.pro' ? 'Pro' : order.tariffKey === 'tariff.start-plus' ? 'Start+' : 'LIVE';
  return '<div class="modal-title"><h2>Ожидает оплаты</h2><p>Пока оплата не подтверждена, доступен бесплатный LIVE Start.</p></div>' +
    v2Section('Счёт', '<div><strong>' + escapeHtml(price(order.totalMinor)) +
      '</strong></div><p>' + escapeHtml(name) + ' · ' + Number(order.accessDays || 30) +
      ' дней после оплаты. Счёт отправляется на email.</p>') +
    '<p class="form-error" data-commercial-error></p>' +
    actionBlock(button('Продолжить работать', {data:'data-commercial-check'}));
}
function selectionContent(data) {
  const plans = data.tariffOffers.professional || [];
  const durations = data.tariffOffers.periods || [];
  const current = plans.some(p => p.key === data.currentTariffKey)
    ? data.currentTariffKey : 'tariff.start';
  return '<div class="modal-title"><h2>Выбор тарифа</h2>' +
    '<p>DEMO необязателен. Можно сразу начать работать в LIVE.</p></div>' +
    v2Section('Тариф', segmentControl(plans.map(p => ({value:p.key,label:p.name})),
      {value:current,name:'tariff',aria:'Тариф'})) +
    v2Section('Срок оплаты', segmentControl(durations.map(p => ({
      value:String(p.months),label:p.months === 1 ? '1 месяц' : p.months + ' месяцев'
    })), {value:'1',name:'period',aria:'Срок оплаты'})) +
    v2Section('Условия', '<div><strong data-commercial-total>—</strong></div>' +
      '<p data-commercial-summary></p>') +
    '<p class="form-error" data-commercial-error></p>' +
    actionBlock(button('Продолжить', {data:'data-commercial-confirm'}));
}
function content(data, {manage = false} = {}) {
  if (data.order?.status === 'PENDING') return pendingContent(data);
  if (manage && isAdminManaged(data)) {
    return '<div class="modal-title"><h2>Индивидуальный доступ</h2>' +
      '<p>Текущие условия назначены администратором и сохраняются.</p></div>' +
      actionBlock(button('Продолжить работать', {data:'data-commercial-protected-close'}));
  }
  return selectionContent(data);
}
function bindPending(layer, finish) {
  layer.querySelector('[data-commercial-check]')?.addEventListener('click', async (event) => {
    const node = event.currentTarget;
    node.disabled = true;
    try {
      const latest = await request('/me');
      layer.v2Close?.();
      finish({access:latest.access,commercial:latest,order:latest.order || null});
    } catch (error) {
      const message = layer.querySelector('[data-commercial-error]');
      if (message) message.textContent = error instanceof Error ? error.message : 'Ошибка';
      node.disabled = false;
    }
  });
}
function bindSelection(layer, data, finish) {
  initSegmentControls(layer);
  const plans = new Map((data.tariffOffers.professional || []).map(p => [p.key,p]));
  const periods = new Map((data.tariffOffers.periods || []).map(p => [String(p.months),p]));
  const tier = layer.querySelector('[data-segment-value][name="tariff"]');
  const months = layer.querySelector('[data-segment-value][name="period"]');
  const total = layer.querySelector('[data-commercial-total]');
  const summary = layer.querySelector('[data-commercial-summary]');
  const confirm = layer.querySelector('[data-commercial-confirm]');
  for (const choice of layer.querySelectorAll('[data-segment-option^="tariff."]')) {
    if (!plans.get(choice.dataset.segmentOption)?.purchasable) {
      choice.disabled = true;
      choice.title = 'Цена пока не установлена';
    }
  }
  function sync() {
    const plan = plans.get(tier?.value);
    const period = plan?.periods?.find((item) => String(item.months) === months?.value)
      || periods.get(months?.value);
    const isStart = plan?.key === 'tariff.start';
    const ready = Boolean(plan?.purchasable && period);
    if (total) total.textContent = !ready ? 'Цена не установлена'
      : isStart ? 'Бесплатно' : price(plan.priceMinor * period.months);
    if (summary) summary.textContent = isStart
      ? 'LIVE Start, бесплатно и без ограничения срока.'
      : period ? period.accessDays + ' дней, в том числе ' + period.bonusDays + ' бонусных.' : '';
    if (confirm) {
      confirm.disabled = !ready;
      confirm.textContent = isStart ? 'Начать LIVE Start' : 'Получить счёт';
    }
  }
  tier?.addEventListener('change',sync);
  months?.addEventListener('change',sync);
  confirm?.addEventListener('click',async () => {
    const error = layer.querySelector('[data-commercial-error]');
    confirm.disabled = true;
    if (error) error.textContent = '';
    try {
      const result = await request('/confirm-tariff', {
        method:'POST',body:JSON.stringify({
          tariffKey:tier?.value,periodMonths:Number(months?.value || 1)
        }),
      });
      if (result.requiresPayment) {
        const next = result.commercial || data;
        next.order = result.order || next.order;
        const host = layer.querySelector('[data-v2-q-body]');
        if (host) {
          host.innerHTML = pendingContent(next);
          if (result.invoice?.error) {
            const notice = host.querySelector('[data-commercial-error]');
            if (notice) notice.textContent = result.invoice.error;
          }
          bindPending(layer,finish);
          return;
        }
      }
      layer.v2Close?.();
      finish(result);
    } catch (cause) {
      if (error) error.textContent = cause instanceof Error ? cause.message : 'Ошибка выбора тарифа';
      sync();
    }
  });
  sync();
}
function bind(layer, data, finish, opts) {
  if (data.order?.status === 'PENDING') return bindPending(layer,finish);
  if (opts.manage && isAdminManaged(data)) {
    layer.querySelector('[data-commercial-protected-close]')?.addEventListener('click', () => {
      layer.v2Close?.();
      finish({access:data.access,commercial:data,protectedGrant:true});
    });
    return;
  }
  bindSelection(layer,data,finish);
}
export function openCommercialLiveFlow({required = false,manage = false} = {}) {
  if (activeFlow) return activeFlow;
  activeFlow = (async () => {
    const data = await request('/me');
    if (!data?.tenantId || !data?.tariffOffers?.professional) {
      throw new Error('Тарифы временно недоступны');
    }
    if (data.access?.commercialMode === 'LIVE' && data.access?.paidAccessExpired !== true && !manage) {
      return {access:data.access,commercial:data,order:data.order || null};
    }
    return new Promise(resolve => {
      const layer = mountModal(document.body,modal(content(data,{manage}),{
        variant:'q',title:'LIVE',surface:'app',
      }));
      if (!layer) return resolve({cancelled:true});
      const close = layer.querySelector('[data-modal-close]');
      if (required) close?.remove();
      else close?.addEventListener('click',() => resolve({cancelled:true}),{once:true});
      bind(layer,data,resolve,{manage});
    });
  })().finally(() => {activeFlow = null;});
  return activeFlow;
}
