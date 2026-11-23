import {
  button, escapeHtml, modal, mountModal, openNotice, selectFile,
  segmentControl, initSegmentControls, v2ListEntries, v2ListEntry, v2Section,
} from '../../ui/ui.js';
import { apiRequest } from '../auth.js';
import { hydratePeopleFromServer } from './data.js';
import { hydrateUEIFromServer } from '../uei.js';

function message(error) {
  if (error instanceof Error && error.message && !/HTTP|fetch|network|404|500|502|503|JSON|API|Failed to|Prisma|SQL|P20\d+|transaction|sourceKey|tenantId|stack|undefined|constraint|database/i.test(error.message))
    return error.message;
  return 'Не удалось выполнить действие. Повторите попытку.';
}
function notice(error) {
  openNotice({ title: 'Контакты', message: message(error) });
}
async function request(path, body) {
  const response = await apiRequest('/data-transfer/' + path, {
    method: 'POST', body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const reason = Array.isArray(data.message) ? data.message[0] : data.message;
    throw new Error(typeof reason === 'string' && reason.length < 240 ? reason
      : 'Не удалось обработать файл');
  }
  return response;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function getWorkbook(rows, template = false) {
  const response = await request('table', { domain: 'people', rows, template });
  downloadBlob(await response.blob(), template ? 'Контакты-шаблон.xlsx' : 'Контакты.xlsx');
}
function contactRows(people) {
  return (Array.isArray(people) ? people : []).map(person => ({
    name: String(person.name || ''),
    surname: String(person.surname || ''),
    phone: String(person.phones?.[0] || ''),
    additionalPhone: String(person.phones?.[1] || ''),
    email: String(person.emails?.[0] || ''),
    birthday: String(person.birthDate || '').slice(0, 10),
    gender: person.gender === 'female' ? 'Женский' :
      person.gender === 'male' ? 'Мужской' : '',
    uei: String(person.uei || ''),
    personKey: String(person.key || ''),
  }));
}
const CONTACT_EXPORT_COLUMNS = [
  ['name', 'Имя'], ['surname', 'Фамилия'], ['phone', 'Телефон'],
  ['additionalPhone', 'Дополнительный телефон'], ['email', 'Email'],
  ['birthday', 'Дата рождения'], ['gender', 'Пол'], ['uei', 'UEI'],
];

function getCsv(rows) {
  const encodeCell = (value) => {
    let raw = String(value ?? '').replaceAll('\u0000', '');
    // Spreadsheet applications can execute CSV values beginning with a formula sign.
    // Keep names, phone numbers and comments as text, not executable formulas.
    if (/^[\s\u0009\r\n]*[=+\-@]/.test(raw)) raw = "'" + raw;
    return '"' + raw.replaceAll('"', '""') + '"';
  };
  const columns = CONTACT_EXPORT_COLUMNS;
  const lines = [
    columns.map(([, label]) => label),
    ...rows.map(row => columns.map(([field]) => row[field])),
  ];
  return '\uFEFF' + lines.map(row => row.map(encodeCell).join(';')).join('\r\n');
}

function openPeopleExport(root, getRows) {
  const content = '<form class="form-grid" data-people-excel-export-form>'
    + segmentControl([
      {value: 'xlsx', label: 'Excel'}, {value: 'csv', label: 'CSV'},
    ], {value:'xlsx', name:'format', aria:'Формат выгрузки'})
    + button('Выгрузить', {type:'submit'})
    + '</form>';
  const layer = mountModal(root, modal(content, {
    title: 'Выгрузка', variant: 'x', surface: 'app', xRole: 'action',
  }));
  if (!layer) return null;
  initSegmentControls(layer);
  const form = layer.querySelector('[data-people-excel-export-form]');
  let running = false;
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (running) return;
    running = true;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      // Read the filtered list only at the moment the professional exports it.
      const rows = contactRows(getRows());
      const format = String(new FormData(form).get('format') || 'xlsx');
      if (format === 'csv') {
        downloadBlob(new Blob([getCsv(rows)], {
          type: 'text/csv;charset=utf-8',
        }), 'Контакты.csv');
      } else {
        await getWorkbook(rows);
      }
      layer.v2Close?.();
    } catch (error) {
      notice(error);
    } finally {
      running = false;
      if (submit) submit.disabled = false;
    }
  });
  return layer;
}

function fileInput(file) {
  return {
    dataUrl: String(file.dataUrl || ''),
    filename: String(file.name || ''),
    source: 'Контакты',
    strict: true,
    expectedDomain: 'people',
    sheets: { 'Люди': { domain: 'people' } },
  };
}
function previewContent(result) {
  const total = Number(result.transferred || 0);
  const same = Number(result.unchanged || 0);
  const failed = Number(result.failed || 0);
  const summary = 'К загрузке: ' + total
    + (same ? ' · Уже есть: ' + same : '')
    + (failed ? ' · Ошибок: ' + failed : '');
  const errors = (Array.isArray(result.rows) ? result.rows : [])
    .filter(row => row?.reason)
    .slice(0, 25).map(row => {
      const detail = String(row.reason || '');
      const plain = /SQL|Prisma|P20\d+|foreign key|constraint|sourceKey|tenantId|stack|undefined|database|transaction|Internal Server Error/i.test(detail)
        ? 'Проверьте сведения в этой строке'
        : detail;
      return v2ListEntry({
        title: 'Строка ' + String(row.row || '—'),
        subtitle: plain, interactive: false,
      });
    });
  return v2Section('Загрузка', '<div>' + escapeHtml(summary) + '</div>')
    + (errors.length ? v2Section('Что исправить', v2ListEntries(errors)) : '');
}
function openPreview(root, file, onLoaded) {
  const layer = mountModal(root, modal(
    '<div class="form-grid">'
      + '<div>' + escapeHtml(file.name || 'Контакты.xlsx') + '</div>'
      + '<div data-people-excel-preview aria-live="polite">Читаем файл…</div>'
      + '</div>',
    { title: 'Загрузка', variant: 'q', surface: 'app' },
  ));
  if (!layer) return null;
  const host = layer.querySelector('[data-people-excel-preview]');
  const payload = fileInput(file);
  let ready = false;
  let saving = false;
  async function showPreview() {
    ready = false;
    if (host) host.textContent = 'Читаем файл…';
    try {
      const response = await request('check', payload);
      const result = await response.json();
      if (!layer.isConnected) return;
      ready = !result.failed && Number(result.transferred) > 0;
      host.innerHTML = previewContent(result)
        + (ready ? button('Загрузить', { type: 'button', data: 'data-people-excel-save' }) : '');
      if (!ready && !result.failed && !result.transferred) {
        host.insertAdjacentHTML('beforeend', '<div>Новых сведений нет.</div>');
      }
    } catch (error) {
      if (host && layer.isConnected) host.textContent = message(error);
    }
  }
  host?.addEventListener('click', async event => {
    const control = event.target?.closest?.('[data-people-excel-save]');
    if (!control || !ready || saving) return;
    ready = false;
    saving = true;
    control.disabled = true;
    try {
      const response = await request('commit', payload);
      const result = await response.json();
      const loaded = Number(result.transferred || 0);
      if (result.failed) throw new Error('В файле есть ошибки. Изменения не сохранены.');
      const contacts = await apiRequest('/business-state/journal');
      if (!contacts.ok) throw new Error('Контакты загружены, но список не обновился. Откройте его ещё раз.');
      const saved = await contacts.json();
      hydratePeopleFromServer(saved.people || []);
      hydrateUEIFromServer(saved.uei || {});
      layer.v2Close?.();
      onLoaded?.();
      openNotice({ title: 'Контакты', message: 'Загружено: ' + loaded });
    } catch (error) {
      notice(error);
      saving = false;
      await showPreview();
    }
  });
  void showPreview();
  return layer;
}
async function chooseAndLoad(root, onLoaded) {
  // Must start directly inside the iOS click gesture.
  const file = await selectFile({
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  if (!file) return;
  if (!String(file.name || '').toLowerCase().endsWith('.xlsx') || Number(file.size) > 25 * 1024 * 1024) {
    throw new Error('Выберите файл Excel размером до 25 МБ');
  }
  openPreview(root, file, onLoaded);
}

export function openPeopleExcelMenu(root, { getRows = () => [], onLoaded = () => {} } = {}) {
  const actions = [
    { id: 'export', label: 'Выгрузка', run: () => openPeopleExport(root, getRows) },
    { id: 'import', label: 'Загрузка', run: () => chooseAndLoad(root, onLoaded) },
    { id: 'template', label: 'Шаблон', run: () => getWorkbook([], true) },
  ];
  const markup = '<div class="modal-actions">'
    + actions.map(action => button(action.label, {
      type: 'button', variant: 'secondary', data: 'data-people-excel-' + action.id,
    })).join('') + '</div>';
  const layer = mountModal(root, modal(markup, {
    title: 'Excel', variant: 'x', surface: 'app', xRole: 'action',
  }));
  if (!layer) return null;
  for (const action of actions) {
    layer.querySelector('[data-people-excel-' + action.id + ']')?.addEventListener('click', () => {
      layer.v2Close?.();
      try { Promise.resolve(action.run()).catch(notice); }
      catch (error) { notice(error); }
    });
  }
  return layer;
}
