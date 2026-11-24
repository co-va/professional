import { button, modal, mountModal } from '../../ui/ui.js';
import { apiRequest } from '../auth.js';

// Native iOS sharing requires a fresh user click AFTER the authenticated
// document has been downloaded. Never call navigator.share from a fetch
// completion callback (the browser may have lost transient activation).
export function openInventoryOrderExport(root, orderId, orderNumber) {
  const markup = '<div class="form-grid" data-inventory-order-export>' +
    button('PDF', { variant: 'outline', data: 'data-inventory-order-export-format="pdf"' }) +
    button('Excel', { variant: 'outline', data: 'data-inventory-order-export-format="xlsx"' }) +
    '<p data-inventory-order-export-status role="status"></p>' +
    '<div data-inventory-order-export-ready hidden>' +
      button('Поделиться', { variant: 'outline', data: 'data-inventory-order-export-share' }) +
      button('Сохранить файл', { variant: 'outline', data: 'data-inventory-order-export-save' }) +
    '</div>' +
  '</div>';
  const layer = mountModal(root, modal(markup, { variant: 'q', title: 'Выгрузить заказ' }));
  if (!layer) return null;

  const status = layer.querySelector('[data-inventory-order-export-status]');
  const ready = layer.querySelector('[data-inventory-order-export-ready]');
  const share = layer.querySelector('[data-inventory-order-export-share]');
  const save = layer.querySelector('[data-inventory-order-export-save]');
  const formats = [...layer.querySelectorAll('[data-inventory-order-export-format]')];
  let file = null;
  let busy = false;
  const filename = format => 'zakaz_' + String(orderNumber || 'order') + '.' + format;

  const saveFile = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const shareSupported = data => typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [data] });

  const updateReady = () => {
    ready.hidden = !file;
    share.hidden = !file || !shareSupported(file);
    save.hidden = !file;
  };
  formats.forEach(control => control.addEventListener('click', async () => {
    if (busy) return;
    const format = control.dataset.inventoryOrderExportFormat;
    if (format !== 'pdf' && format !== 'xlsx') return;
    busy = true;
    file = null;
    updateReady();
    formats.forEach(item => { item.disabled = true; });
    status.textContent = 'Подготавливается ' + (format === 'pdf' ? 'PDF' : 'Excel') + '…';
    try {
      const response = await apiRequest(
        '/inventory/orders/' + encodeURIComponent(orderId) + '/export/' + format,
        { timeoutMs: 60000 },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(Array.isArray(error.message)
          ? error.message.join(', ')
          : error.message || 'Не удалось выгрузить заказ.');
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('Получен пустой файл заказа.');
      file = new File([blob], filename(format), {
        type: format === 'pdf' ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      status.textContent = (format === 'pdf' ? 'PDF' : 'Excel') + ' готов.';
      updateReady();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось подготовить файл.';
    } finally {
      busy = false;
      formats.forEach(item => { item.disabled = false; });
    }
  }));

  share.addEventListener('click', async () => {
    if (!file || !shareSupported(file)) return;
    try {
      await navigator.share({ title: 'Заказ № ' + orderNumber, files: [file] });
    } catch (error) {
      // "Отмена" in the native share sheet is not an application error.
      if (error?.name !== 'AbortError') {
        status.textContent = 'Не удалось открыть «Поделиться». Используйте «Сохранить файл».';
      }
    }
  });
  save.addEventListener('click', saveFile);
  updateReady();
  return layer;
}
