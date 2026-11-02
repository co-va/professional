import { getCommunicationChannels, getCommunicationThread, getCommunicationThreads, sendCommunicationMessage } from '../core/communications/chat.js';
import {
  deleteBroadcastTemplate,
  deleteCommunicationGroup,
  getBroadcastTemplates,
  getCommunicationGroups,
  saveBroadcastTemplate,
  saveCommunicationGroup,
  sendBroadcast,
} from '../core/communications/broadcasts.js';
import { findPeopleByPhone, getAllPeople } from '../core/people/data.js';
import {
  button,
  checkList,
  clearV2ZHeaderRows,
  collectCheckList,
  emptyState,
  escapeHtml,
  field,
  initCheckList,
  v2ListEntries,
  v2ListEntry,
  modal,
  mountModal,
  mountV2ZLayer,
  openNotice,
  select,
  textareaField,
  v2ZLayer,
  workspaceHeaderContext,
} from '../ui/ui.js';
import { bindMessageAttachments, initMessageComposer, messageComposer } from '../ui/chat/index.js';
import { mountChatChannelHeader, mountChatList, mountChatThread } from '../core/chat/runtime.js';
import { settingsPanel } from '../ui/settings/index.js';
import { formView } from '../ui/forms/index.js';

const DIRECT_CHANNEL_LABELS = Object.freeze({
  PUSH: 'Push',
  TELEGRAM: 'Telegram',
  EMAIL: 'Email',
});

function directChannelOptions(channels = [], { defaultPush = true } = {}) {
  const normalized = (Array.isArray(channels) ? channels : [])
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => DIRECT_CHANNEL_LABELS[value]);
  const available = new Set(normalized.length ? normalized : (defaultPush ? ['PUSH'] : []));
  return ['PUSH', 'TELEGRAM', 'EMAIL']
    .filter((value) => available.has(value))
    .map((value) => ({ value, label: DIRECT_CHANNEL_LABELS[value] }));
}

function personNameByPhone(phone, uei = '') {
  const people = findPeopleByPhone(phone);
  const person = people.find((item) => !uei || String(item.uei || '') === String(uei)) || people[0];
  const name = [person?.name, person?.surname].filter(Boolean).join(' ').trim();
  return name || String(phone || 'Человек');
}

function threadTitle(thread = {}) {
  const phone = String(thread?.personPhone || '').trim();
  const uei = String(thread?.uei || '').trim();
  if (phone) return personNameByPhone(phone, uei);
  if (uei) {
    const person = getAllPeople().find((item) => String(item?.uei || '') === uei);
    const name = [person?.name, person?.surname].filter(Boolean).join(' ').trim();
    if (name) return name;
  }
  const display = String(thread?.display || '').trim();
  if (display) return display;
  if (String(thread?.channel || '').trim().toUpperCase() === 'TELEGRAM' && String(thread?.externalThreadId || '').trim()) return 'Telegram';
  return 'Человек';
}

function personName(person = {}) {
  return [person.name, person.surname].filter(Boolean).join(' ').trim() || person.phones?.[0] || 'Человек';
}

function phoneOf(person = {}) {
  return String((Array.isArray(person.phones) ? person.phones : []).find(Boolean) || '');
}

function messageTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function directChannelValue(value) {
  const channel = String(value || '').trim().toUpperCase();
  if (channel === 'IN_APP' || channel === 'PUSH') return 'PUSH';
  if (channel === 'TELEGRAM' || channel === 'EMAIL') return channel;
  return '';
}

function lastDirectChannel(messages = []) {
  const values = Array.isArray(messages) ? messages : [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (String(values[index]?.direction || '').toLowerCase() !== 'outbound') continue;
    const channel = directChannelValue(values[index]?.channel);
    if (channel) return channel;
  }
  return 'PUSH';
}

function renderChatSurface(root, {
  title = 'Чат',
  a = { kind: 'settings', data: 'data-chat-settings', aria: 'Настройки чата' },
  c = null,
  d = null,
  body = '',
} = {}) {
  clearV2ZHeaderRows(root);
  root.classList.add('v2-workspace-surface--chat');
  root.innerHTML = `${workspaceHeaderContext({
    title,
    a,
    c,
    d,
    hideD: !d,
  })}${body}`;
  initMessageComposer(root);
}

function peopleList() {
  return getAllPeople().filter((person) => person.key && phoneOf(person));
}

function personByKey(key) {
  return peopleList().find((person) => String(person.key) === String(key)) || null;
}

function normalizedPersonKeys(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function openProfessionalContacts(root, state) {
  const people = peopleList();
  const layer = mountModal(document.body, modal(
    people.length
      ? v2ListEntries(people.map((person, index) => v2ListEntry({
          title: personName(person),
          subtitle: phoneOf(person),
          data: `data-chat-contact="${index}"`,
          aria: `Открыть диалог с ${personName(person)}`,
        })))
      : emptyState('Контактов пока нет', 'База людей пока пустая.'),
    { title: 'Контакты', variant: 'q', surface: 'app' },
  ));
  layer?.querySelectorAll('[data-chat-contact]').forEach((node) => node.addEventListener('click', () => {
    const person = people[Number(node.dataset.chatContact)];
    if (!person) return;
    layer.remove();
    void openThread(root, state, {
      personPhone: phoneOf(person),
      uei: person.uei || '',
    });
  }));
}

function recipientLabel(recipient = {}) {
  if (recipient.mode === 'one') return personName(personByKey(recipient.personKeys?.[0]) || {});
  if (recipient.mode === 'many') return `Выбрано: ${recipient.personKeys?.length || 0}`;
  if (recipient.mode === 'group') return recipient.groupName || 'Группа';
  if (recipient.mode === 'all') return 'Все люди';
  return 'Получатели';
}

async function chooseTemplate(input) {
  const templates = await getBroadcastTemplates();
  if (!templates.length) return;
  const layer = mountModal(document.body, modal(v2ListEntries(templates.map((template, index) => v2ListEntry({
    title: template.name,
    subtitle: template.body,
    data: `data-chat-template="${index}"`,
    aria: `Выбрать шаблон ${template.name}`,
  }))), { title: 'Шаблоны', variant: 'q', surface: 'app' }));
  layer?.querySelectorAll('[data-chat-template]').forEach((node) => node.addEventListener('click', () => {
    const template = templates[Number(node.dataset.chatTemplate)];
    if (template && input) input.value = template.body || '';
    layer.remove();
    input?.focus();
  }));
}

async function renderCompose(root, state, recipient) {
  state.view = 'compose';
  state.recipient = recipient;
  const allowsAttachments = recipient.mode === 'one';
  const directPerson = allowsAttachments ? personByKey(recipient.personKeys?.[0]) : null;
  if (allowsAttachments && !directPerson) throw new Error('Человек не найден');
  const channelState = directPerson
    ? await getCommunicationChannels({ phone: phoneOf(directPerson), uei: directPerson.uei || '' }).catch(() => ({ channels: ['PUSH'] }))
    : null;
  const directOptions = directPerson ? directChannelOptions(channelState?.channels) : [];
  const broadcastChannel = recipient.mode === 'one'
    ? ''
    : select({
        label: 'Канал',
        name: 'broadcastChannel',
        value: 'TELEGRAM',
        options: [
          { value: 'TELEGRAM', label: 'Telegram' },
          { value: 'EMAIL', label: 'Email' },
        ],
      });
  renderChatSurface(root, {
    title: recipient.mode === 'many' ? 'Групповой чат' : 'Новое сообщение',
    c: { kind: 'contacts', data: 'data-chat-contacts', aria: 'Контакты' },
    d: allowsAttachments ? { kind: 'attachment', data: 'data-profile-compose-attachment', aria: 'Вложения' } : null,
    body: `
      <div class="action-block"><strong>Кому: ${recipientLabel(recipient)}</strong></div>
      ${broadcastChannel}
      ${button('Выбрать шаблон', { variant: 'secondary', data: 'data-profile-template-choose' })}
      ${messageComposer({
        placeholder: 'Написать сообщение...',
        attachments: allowsAttachments,
        attachmentTrigger: allowsAttachments ? 'external' : 'composer',
      })}
    `,
  });
  const selectedDirectChannel = directPerson
    ? mountChatChannelHeader(root, { channelOptions: directOptions, channel: 'PUSH' })
    : () => '';
  root.querySelector('[data-chat-settings]')?.addEventListener('click', () => openProfileChatSettings(root, state));
  root.querySelector('[data-chat-contacts]')?.addEventListener('click', () => openProfessionalContacts(root, state));
  const form = root.querySelector('[data-message-composer]');
  const input = form?.querySelector('[name="message"]');
  root.querySelector('[data-profile-compose-attachment]')?.addEventListener('click', () => form?.querySelector('[data-message-attachment]')?.click());
  const getAttachments = allowsAttachments ? bindMessageAttachments(form) : () => [];
  root.querySelector('[data-profile-template-choose]')?.addEventListener('click', () => void chooseTemplate(input));
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = String(input?.value || '').trim();
    const attachments = getAttachments();
    if (!body && !attachments.length) return;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      if (recipient.mode === 'one') {
        await sendCommunicationMessage({
          channel: selectedDirectChannel() || 'PUSH',
          phone: phoneOf(directPerson),
          uei: directPerson.uei || '',
          body,
          attachments,
        });
      } else {
        await sendBroadcast({
          channel: String(root.querySelector('[name="broadcastChannel"]')?.value || 'TELEGRAM'),
          all: recipient.mode === 'all',
          personKeys: recipient.mode === 'many' ? recipient.personKeys || [] : [],
          groupId: recipient.mode === 'group' ? recipient.groupId || '' : '',
          name: recipientLabel(recipient),
          body,
        });
      }
      await renderThreads(root, state);
    } catch (error) {
      if (submit) submit.disabled = false;
      openNotice({
        title: 'Сообщение не отправлено',
        message: error instanceof Error && error.message ? error.message : 'Не удалось отправить сообщение',
        action: 'Закрыть',
        variant: 'technical',
      });
    }
  });
}

function recipientOptions(root, state) {
  const layer = mountModal(document.body, modal(settingsPanel([
    { label: 'Один человек', data: 'data-recipient-one' },
    { label: 'Несколько людей', data: 'data-recipient-many' },
    { label: 'Группа', data: 'data-recipient-group' },
    { label: 'Все люди', data: 'data-recipient-all' },
  ]), { title: 'Кому?', variant: 'x', surface: 'app' }));
  layer?.querySelector('[data-recipient-one]')?.addEventListener('click', () => { layer.remove(); void chooseOne(root, state); });
  layer?.querySelector('[data-recipient-many]')?.addEventListener('click', () => { layer.remove(); void chooseMany(root, state); });
  layer?.querySelector('[data-recipient-group]')?.addEventListener('click', () => { layer.remove(); void chooseGroup(root, state); });
  layer?.querySelector('[data-recipient-all]')?.addEventListener('click', () => { layer.remove(); void renderCompose(root, state, { mode: 'all' }); });
}

async function chooseOne(root, state) {
  const people = peopleList();
  const layer = mountModal(document.body, modal(people.length ? v2ListEntries(people.map((person, index) => v2ListEntry({
    title: personName(person),
    subtitle: phoneOf(person),
    data: `data-recipient-person="${index}"`,
  }))) : emptyState('Людей нет', 'Некого выбрать для сообщения.'), { title: 'Человек', variant: 'q', surface: 'app' }));
  layer?.querySelectorAll('[data-recipient-person]').forEach((node) => node.addEventListener('click', () => {
    const person = people[Number(node.dataset.recipientPerson)];
    if (!person) return;
    layer.remove();
    void renderCompose(root, state, { mode: 'one', personKeys: [person.key] });
  }));
}

async function chooseMany(root, state) {
  const people = peopleList();
  const content = `<div class="form-grid">${checkList(people.map((person) => ({ value: person.key, label: personName(person), secondary: phoneOf(person) })))}${button('Далее', { data: 'data-recipient-many-next' })}</div>`;
  const layer = mountModal(document.body, modal(content, { title: 'Несколько людей', variant: 'q', surface: 'app' }));
  if (!layer) return;
  initCheckList(layer);
  layer.querySelector('[data-recipient-many-next]')?.addEventListener('click', () => {
    const personKeys = collectCheckList(layer);
    if (!personKeys.length) return;
    layer.remove();
    void renderCompose(root, state, { mode: 'many', personKeys });
  });
}

async function chooseGroup(root, state) {
  const groups = await getCommunicationGroups();
  const layer = mountModal(document.body, modal(groups.length ? v2ListEntries(groups.map((group, index) => v2ListEntry({
    title: group.name,
    subtitle: `${group.personKeys?.length || 0} людей`,
    data: `data-recipient-group-choice="${index}"`,
  }))) : emptyState('Групп пока нет', 'Создайте группу в настройках чата.'), { title: 'Группа', variant: 'q', surface: 'app' }));
  layer?.querySelectorAll('[data-recipient-group-choice]').forEach((node) => node.addEventListener('click', () => {
    const group = groups[Number(node.dataset.recipientGroupChoice)];
    if (!group) return;
    layer.remove();
    void renderCompose(root, state, { mode: 'group', groupId: group.id, groupName: group.name });
  }));
}

async function editGroup(group = null) {
  const people = peopleList();
  const content = formView(`
    ${field({ label: 'Название группы', name: 'name', value: group?.name || '', required: true })}
    ${checkList(people.map((person) => ({ value: person.key, label: personName(person), secondary: phoneOf(person), checked: (group?.personKeys || []).includes(person.key) })))}
    ${button('Сохранить', { type: 'submit' })}
    ${group?.id ? button('Удалить группу', { type: 'button', variant: 'danger', data: 'data-group-delete' }) : ''}
  `, { className: 'form-grid', data: 'data-group-form' });
  const layer = mountModal(document.body, modal(content, { title: group ? group.name : 'Новая группа', variant: 'q', surface: 'app' }));
  if (!layer) return;
  initCheckList(layer);
  const form = layer.querySelector('[data-group-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const personKeys = collectCheckList(layer);
    await saveCommunicationGroup({ id: group?.id || '', name: data.get('name'), personKeys });
    layer.remove();
    await manageGroups();
  });
  layer.querySelector('[data-group-delete]')?.addEventListener('click', async () => {
    await deleteCommunicationGroup(group.id);
    layer.remove();
    await manageGroups();
  });
}

async function manageGroups() {
  const groups = await getCommunicationGroups();
  const content = `<div class="form-grid">${button('Новая группа', { data: 'data-group-new' })}${groups.length ? v2ListEntries(groups.map((group, index) => v2ListEntry({ title: group.name, subtitle: `${group.personKeys?.length || 0} людей`, data: `data-group-edit="${index}"` }))) : emptyState('Групп пока нет', 'Создайте первую группу людей.')}</div>`;
  const layer = mountModal(document.body, modal(content, { title: 'Группы', variant: 'q', surface: 'app' }));
  layer?.querySelector('[data-group-new]')?.addEventListener('click', () => { layer.remove(); void editGroup(); });
  layer?.querySelectorAll('[data-group-edit]').forEach((node) => node.addEventListener('click', () => {
    const group = groups[Number(node.dataset.groupEdit)];
    layer.remove();
    void editGroup(group);
  }));
}

async function editTemplate(template = null) {
  const content = formView(`
    ${field({ label: 'Название шаблона', name: 'name', value: template?.name || '', required: true })}
    ${textareaField({ label: 'Текст сообщения', name: 'body', value: template?.body || '', required: true, rows: 6 })}
    ${button('Сохранить', { type: 'submit' })}
    ${template?.id ? button('Удалить шаблон', { type: 'button', variant: 'danger', data: 'data-template-delete' }) : ''}
  `, { className: 'form-grid', data: 'data-template-form' });
  const layer = mountModal(document.body, modal(content, { title: template ? template.name : 'Новый шаблон', variant: 'q', surface: 'app' }));
  const form = layer?.querySelector('[data-template-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    await saveBroadcastTemplate({ id: template?.id || '', name: data.get('name'), body: data.get('body') });
    layer.remove();
    await manageTemplates();
  });
  layer?.querySelector('[data-template-delete]')?.addEventListener('click', async () => {
    await deleteBroadcastTemplate(template.id);
    layer.remove();
    await manageTemplates();
  });
}

async function manageTemplates() {
  const templates = await getBroadcastTemplates();
  const content = `<div class="form-grid">${button('Новый шаблон', { data: 'data-template-new' })}${templates.length ? v2ListEntries(templates.map((template, index) => v2ListEntry({ title: template.name, subtitle: template.body, data: `data-template-edit="${index}"` }))) : emptyState('Шаблонов пока нет', 'Создайте первый шаблон сообщения.')}</div>`;
  const layer = mountModal(document.body, modal(content, { title: 'Шаблоны', variant: 'q', surface: 'app' }));
  layer?.querySelector('[data-template-new]')?.addEventListener('click', () => { layer.remove(); void editTemplate(); });
  layer?.querySelectorAll('[data-template-edit]').forEach((node) => node.addEventListener('click', () => {
    const template = templates[Number(node.dataset.templateEdit)];
    layer.remove();
    void editTemplate(template);
  }));
}

function openProfileChatSettings(root, state) {
  const layer = mountModal(document.body, modal(settingsPanel([
    { label: 'Новое сообщение', data: 'data-chat-new-message' },
    { label: 'Группы людей', data: 'data-chat-groups' },
    { label: 'Шаблоны сообщений', data: 'data-chat-templates' },
  ]), { title: 'Настройки сообщений', variant: 'x', surface: 'app' }));
  layer?.querySelector('[data-chat-new-message]')?.addEventListener('click', () => {
    layer.remove();
    recipientOptions(root, state);
  });
  layer?.querySelector('[data-chat-groups]')?.addEventListener('click', () => { layer.remove(); void manageGroups(); });
  layer?.querySelector('[data-chat-templates]')?.addEventListener('click', () => { layer.remove(); void manageTemplates(); });
}

async function openThread(root, state, thread) {
  state.view = 'thread';
  state.thread = thread;
  const phone = String(thread?.personPhone || '').trim();
  const uei = String(thread?.uei || '').trim();
  const externalThreadId = String(thread?.externalThreadId || '').trim();
  const title = threadTitle(thread);

  renderChatSurface(root, {
    title,
    c: { kind: 'contacts', data: 'data-chat-contacts', aria: 'Контакты' },
    body: emptyState('Загрузка', 'Получаем переписку.'),
  });

  try {
    const [messages, channelState] = await Promise.all([
      getCommunicationThread({ phone, uei, externalThreadId }),
      getCommunicationChannels({ phone, uei, externalThreadId }).catch(() => ({ channels: externalThreadId ? [] : ['PUSH'] })),
    ]);
    const channelOptions = directChannelOptions(channelState?.channels, { defaultPush: !externalThreadId });
    const previousChannel = lastDirectChannel(messages);
    const channel = channelOptions.some((option) => option.value === previousChannel)
      ? previousChannel
      : (channelOptions[0]?.value || '');
    mountChatThread(root, {
      title,
      messages,
      viewer: 'profile',
      surface: (surface) => renderChatSurface(root, surface),
      onSettings: () => openProfileChatSettings(root, state),
      onContacts: () => openProfessionalContacts(root, state),
      channelOptions,
      channel,
      onSend: async ({ body, attachments, channel: selectedChannel }) => {
        await sendCommunicationMessage({ channel: selectedChannel, phone, uei, externalThreadId, body, attachments });
        await openThread(root, state, thread);
      },
    });
  } catch (error) {
    renderChatSurface(root, {
      title,
      c: { kind: 'contacts', data: 'data-chat-contacts', aria: 'Контакты' },
      body: emptyState('Чат недоступен', 'Не удалось загрузить переписку.'),
    });
    root.querySelector('[data-chat-settings]')?.addEventListener('click', () => openProfileChatSettings(root, state));
    root.querySelector('[data-chat-contacts]')?.addEventListener('click', () => openProfessionalContacts(root, state));
    openNotice({
      title: 'Чат недоступен',
      message: error instanceof Error && error.message ? error.message : 'Не удалось загрузить переписку',
      action: 'Закрыть',
      variant: 'technical',
    });
  }
}

async function renderThreads(root, state) {
  state.view = 'threads';
  state.thread = null;
  renderChatSurface(root, {
    title: 'Чат',
    c: { kind: 'contacts', data: 'data-chat-contacts', aria: 'Контакты' },
    body: emptyState('Загрузка', 'Получаем диалоги.'),
  });

  try {
    const threads = await getCommunicationThreads();
    mountChatList(root, {
      title: 'Чат',
      threads,
      surface: (surface) => renderChatSurface(root, surface),
      onSettings: () => openProfileChatSettings(root, state),
      onContacts: () => openProfessionalContacts(root, state),
      onOpenThread: (thread) => void openThread(root, state, thread),
      threadTitle: (thread) => threadTitle(thread),
      threadSubtitle: (thread) => thread.body || (Array.isArray(thread.attachments) && thread.attachments.length ? 'Медиа' : 'Открыть диалог'),
      threadTime: (thread) => messageTime(thread.createdAt),
      emptyTitle: 'Чат пока пуст',
      emptyText: 'Сообщения и системные уведомления людей появятся здесь.',
    });
  } catch (error) {
    renderChatSurface(root, {
      title: 'Чат',
      c: { kind: 'contacts', data: 'data-chat-contacts', aria: 'Контакты' },
      body: emptyState('Чат недоступен', 'Не удалось загрузить диалоги.'),
    });
    root.querySelector('[data-chat-settings]')?.addEventListener('click', () => openProfileChatSettings(root, state));
    root.querySelector('[data-chat-contacts]')?.addEventListener('click', () => openProfessionalContacts(root, state));
    openNotice({
      title: 'Чат недоступен',
      message: error instanceof Error && error.message ? error.message : 'Не удалось загрузить диалоги',
      action: 'Закрыть',
      variant: 'technical',
    });
  }
}

function openRecordGroupChat(personKeys = []) {
  const keys = normalizedPersonKeys(personKeys);
  if (keys.length < 2) return false;
  const app = document.querySelector('#app') || document.body;
  const layer = mountV2ZLayer(app, v2ZLayer('', { className: 'record-chat-z' }), { stack: true });
  if (!layer) return true;
  const state = { view: 'compose', thread: null, recipient: null };
  void renderCompose(layer, state, { mode: 'many', personKeys: keys });
  return true;
}

if (typeof window !== 'undefined') {
  window.addEventListener('book:record-chat-request', (event) => {
    const keys = normalizedPersonKeys(event?.detail?.personKeys);
    if (keys.length < 2) return;
    event.stopImmediatePropagation();
    openRecordGroupChat(keys);
  }, { capture: true });
}

export function renderChat(root, { personKey = '', personKeys = [] } = {}) {
  const state = { view: 'threads', thread: null, recipient: null };
  const keys = normalizedPersonKeys(personKeys);
  if (keys.length > 1) {
    void renderCompose(root, state, { mode: 'many', personKeys: keys });
    return;
  }
  const person = personKey ? personByKey(personKey) : null;
  if (person && phoneOf(person)) {
    void openThread(root, state, {
      personPhone: phoneOf(person),
      uei: person.uei || '',
    });
    return;
  }
  void renderThreads(root, state);
}
