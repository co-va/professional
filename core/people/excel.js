import {
  button, modal, mountModal, openNotice, selectFile,
  segmentControl, initSegmentControls,
} from '../../ui/ui.js';
import { apiRequest } from '../auth.js';
import { getPersonPriceCondition } from './data.js';
import { openContactImportBatches, openContactImportUpload } from './contact-import-review.js';

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
function birthdayLabel(value) {
  const raw=String(value||'').trim();
  const full=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if(full)return full[3]+'.'+full[2]+'.'+full[1];
  const partial=/^(\d{2})-(\d{2})$/.exec(raw);
  return partial?partial[2]+'.'+partial[1]:raw;
}
function contactRows(people) {
  return (Array.isArray(people) ? people : []).map(person => ({
    uei: String(person.uei || ''),
    name: String(person.name || ''),
    surname: String(person.surname || ''),
    gender: person.gender === 'female' ? 'Ж'
      : person.gender === 'male' ? 'М' : '',
    birthday: birthdayLabel(person.birthDate),
    // Export only an active personal percentage, never duplicate a program's
    // historical rate as a new independently assigned manual discount.
    discountPercent: String(getPersonPriceCondition(person).sources
      .find(source => source.type === 'personal')?.percent || ''),
    phone: String(person.phones?.[0] || ''),
    additionalPhone: String(person.phones?.[1] || ''),
    email: String(person.emails?.[0] || ''),
    additionalEmail: String(person.emails?.[1] || ''),
    telegram: String(person.telegrams?.[0] || ''),
    additionalTelegram: String(person.telegrams?.[1] || ''),
    note: String(person.note || ''),
    personKey: String(person.key || ''),
  }));
}
const CONTACT_EXPORT_COLUMNS = [
  ['uei', 'Код клиента'],
  ['name', 'Имя'], ['surname', 'Фамилия'],
  ['gender', 'Пол'], ['birthday', 'Дата рождения'],
  ['discountPercent', 'Скидка, %'],
  ['phone', 'Телефон'], ['additionalPhone', 'Дополнительный телефон'],
  ['email', 'Email'], ['additionalEmail', 'Дополнительный Email'],
  ['telegram', 'Telegram'], ['additionalTelegram', 'Дополнительный Telegram'],
  ['note', 'Примечание'],
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

async function chooseAndLoad(root, onLoaded) {
  // Must start directly inside the iOS click gesture.
  const file = await selectFile({
    accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
  });
  if (!file) return;
  if (!/\.(xlsx|csv)$/i.test(String(file.name || '')) || Number(file.size) > 25 * 1024 * 1024) {
    throw new Error('Выберите Excel или CSV размером до 25 МБ');
  }
  openContactImportUpload(root, file, { onLoaded });
}

export function openPeopleExcelMenu(root, { getRows = () => [], onLoaded = () => {} } = {}) {
  const actions = [
    { id: 'export', label: 'Выгрузка', run: () => openPeopleExport(root, getRows) },
    { id: 'import', label: 'Загрузка', run: () => chooseAndLoad(root, onLoaded) },
    { id: 'template', label: 'Шаблон', run: () => getWorkbook([], true) },
    { id: 'uploads', label: 'Загрузки', run: () =>
      openContactImportBatches(root, { onLoaded }) },
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
