import { escapeHtml } from '../utils/escape-html.js';

const value = (input, fallback = '—') => {
  const text = String(input ?? '').trim();
  return escapeHtml(text || fallback);
};

export function paymentReceipt({
  workplace = '',
  date = '',
  time = '',
  person = {},
  amount = '',
  wallet = '',
  tips = '',
  totalDivider = false,
  workplaceFallback = 'Рабочее пространство',
} = {}) {
  const uei = String(person?.uei || '').trim();
  const name = [person?.name, person?.surname].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  const personBlock = uei || name
    ? `<div class="payment-receipt__person">${uei ? `<span class="payment-receipt__uei">${escapeHtml(uei)}</span>` : ''}${name ? `<strong>${escapeHtml(name)}</strong>` : ''}</div>`
    : '';
  const tipsBlock = String(tips ?? '').trim()
    ? `<div class="payment-receipt__split payment-receipt__tips"><span>Tips</span><strong>${value(tips)}</strong></div>`
    : '';
  const workplaceText = String(workplace || '').trim();
  const workplaceBlock = workplaceText || workplaceFallback
    ? `<strong class="payment-receipt__workplace">${value(workplace, workplaceFallback)}</strong>`
    : '';
  const walletText = String(wallet || '').trim();
  const amountBlock = walletText
    ? `<div class="payment-receipt__split${totalDivider ? ' payment-receipt__amount--divided' : ''}"><strong>${value(amount)}</strong><strong>${value(wallet)}</strong></div>`
    : `<div class="payment-receipt__amount${totalDivider ? ' payment-receipt__amount--divided' : ''}"><strong>${value(amount)}</strong></div>`;

  return `<section class="payment-receipt">
    ${workplaceBlock}
    <div class="payment-receipt__split"><strong>${value(date)}</strong><strong>${value(time)}</strong></div>
    ${personBlock}
    ${amountBlock}
    ${tipsBlock}
  </section>`;
}
