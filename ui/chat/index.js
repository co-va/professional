import { button } from '../buttons/index.js';
import { escapeHtml } from '../utils/escape-html.js';
import { openNotice } from '../modals/index.js';

function text(value = '') {
  return escapeHtml(String(value ?? ''));
}

function attachmentMarkup(attachment = {}) {
  const dataUrl = String(attachment?.dataUrl || '').trim();
  const type = String(attachment?.type || '').toLowerCase();
  const name = text(attachment?.name || 'Вложение');
  if (type.startsWith('image/') && dataUrl.startsWith('data:image/')) {
    return `<a class="message-attachment message-attachment--image" href="${text(dataUrl)}" target="_blank" rel="noopener" aria-label="Открыть ${name}"><img src="${text(dataUrl)}" alt="${name}"></a>`;
  }
  if (type.startsWith('video/') && dataUrl.startsWith('data:video/')) {
    return `<video class="message-attachment message-attachment--video" controls preload="metadata"><source src="${text(dataUrl)}" type="${text(type)}"></video>`;
  }
  if (type === 'application/pdf' && dataUrl.startsWith('data:application/pdf')) {
    return `<a class="message-attachment message-attachment--file" href="${text(dataUrl)}" target="_blank" rel="noopener" aria-label="Открыть ${name}"><strong>PDF</strong><span>${name}</span></a>`;
  }
  return '';
}

function messageStatusMarkup(message = {}, outgoing = false, system = false) {
  if (!outgoing || system) return '';
  const status = String(message.status || '').trim().toLowerCase();
  const failed = Boolean(message.failedAt) || status === 'failed';
  const read = Boolean(message.readAt) || status === 'read';
  const delivered = Boolean(message.deliveredAt) || status === 'delivered';
  const sent = Boolean(message.sentAt) || ['sent', 'delivered', 'read'].includes(status);
  if (failed) {
    return '<span class="message-bubble__status message-bubble__status--failed" role="img" aria-label="Не отправлено" title="Не отправлено">!</span>';
  }
  if (read) {
    return '<span class="message-bubble__status message-bubble__status--read" role="img" aria-label="Прочитано" title="Прочитано"><span class="message-bubble__status-tick message-bubble__status-tick--read-primary">✓</span><span class="message-bubble__status-tick message-bubble__status-tick--read-secondary">✓</span></span>';
  }
  if (delivered) {
    return '<span class="message-bubble__status message-bubble__status--delivered" role="img" aria-label="Доставлено" title="Доставлено"><span class="message-bubble__status-tick">✓</span><span class="message-bubble__status-tick">✓</span></span>';
  }
  if (sent) {
    return '<span class="message-bubble__status message-bubble__status--sent" role="img" aria-label="Отправлено" title="Отправлено">✓</span>';
  }
  return '';
}

function reactionsMarkup(message = {}) {
  const values = Array.isArray(message.reactions) ? message.reactions : [];
  const counts = new Map();
  values.forEach((reaction) => {
    const emoji = String(reaction?.emoji || '').trim();
    if (!emoji) return;
    counts.set(emoji, (counts.get(emoji) || 0) + 1);
  });
  if (!counts.size) return '';
  return `<div class="message-bubble__reactions">${[...counts.entries()].map(([emoji, count]) => `<span class="message-bubble__reaction">${text(emoji)}${count > 1 ? ` ${count}` : ''}</span>`).join('')}</div>`;
}

function pollMarkup(message = {}) {
  const poll = message?.poll && typeof message.poll === 'object' ? message.poll : null;
  const options = Array.isArray(poll?.options) ? poll.options : [];
  if (!poll || !options.length) return '';
  return `<div class="message-poll" data-message-poll>${options.map((option) => {
    const votes = Array.isArray(option?.votes) ? option.votes.length : 0;
    return `<button type="button" class="message-poll__option" data-message-poll-option="${text(option?.id || '')}"><span>${text(option?.label || '')}</span><strong>${votes}</strong></button>`;
  }).join('')}</div>`;
}

export function messageBubble(message = {}, { viewer = 'account' } = {}) {
  const direction = String(message.direction || '').toLowerCase();
  const system = direction === 'system' || String(message.kind || '').toLowerCase() === 'system';
  const outgoing = viewer === 'profile' ? direction === 'outbound' : direction === 'inbound';
  const classes = ['message-bubble', system ? 'message-bubble--system' : outgoing ? 'message-bubble--outgoing' : 'message-bubble--incoming'].join(' ');
  const time = message.time || message.createdAt || '';
  const deleted = Boolean(message.deleted || message.deletedAt);
  const attachments = deleted ? '' : (Array.isArray(message.attachments) ? message.attachments : []).map(attachmentMarkup).filter(Boolean).join('');
  const body = deleted ? 'Сообщение удалено' : text(message.body || '').replaceAll('\n', '<br>');
  const status = messageStatusMarkup(message, outgoing, system);
  const edited = !deleted && message.editedAt ? '<span class="message-bubble__edited">изменено</span>' : '';
  const meta = time || status || edited ? `<span class="message-bubble__meta">${edited}${time ? `<span class="message-bubble__time">${text(time)}</span>` : ''}${status}</span>` : '';
  const reply = !deleted && message.replyToId
    ? `<div class="message-bubble__reply"><strong>Ответ</strong><span>${text(message.replyPreview || 'Сообщение')}</span></div>`
    : '';
  const forwarded = !deleted && message.forwardedFromId ? '<div class="message-bubble__forwarded">Переслано</div>' : '';
  const poll = deleted ? '' : pollMarkup(message);
  const reactions = deleted ? '' : reactionsMarkup(message);
  return `<div class="${classes}${deleted ? ' message-bubble--deleted' : ''}" data-message-id="${text(message.id || '')}">${forwarded}${reply}${attachments ? `<div class="message-bubble__attachments">${attachments}</div>` : ''}${body ? `<div class="message-bubble__body">${body}</div>` : ''}${poll}${reactions}${meta}</div>`;
}

export function messageThread(messages = [], options = {}) {
  const values = Array.isArray(messages) ? messages : [];
  const byId = new Map(values.map((message) => [String(message?.id || ''), message]));
  return `<div class="message-thread" data-message-thread>${values.map((message) => {
    const replied = message?.replyToId ? byId.get(String(message.replyToId)) : null;
    return messageBubble({ ...message, replyPreview: replied?.body || '' }, options);
  }).join('')}</div>`;
}

export function bindMessageActivation(node, onActivate, { delay = 480 } = {}) {
  if (!node || typeof onActivate !== 'function') return () => {};
  let timer = 0;
  let longPressed = false;
  const ignored = (event) => Boolean(event?.target?.closest?.('a,video,button,input,textarea'));
  const open = (event) => {
    if (!ignored(event)) onActivate(event);
  };
  const click = (event) => {
    if (longPressed) {
      longPressed = false;
      return;
    }
    open(event);
  };
  const pointerDown = (event) => {
    if (ignored(event)) return;
    longPressed = false;
    timer = window.setTimeout(() => {
      longPressed = true;
      open(event);
    }, delay);
  };
  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  node.addEventListener('click', click);
  node.addEventListener('pointerdown', pointerDown);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  return () => {
    cancel();
    node.removeEventListener('click', click);
    node.removeEventListener('pointerdown', pointerDown);
    node.removeEventListener('pointerup', cancel);
    node.removeEventListener('pointercancel', cancel);
    node.removeEventListener('pointerleave', cancel);
  };
}

async function fileAttachment(file) {
  if (!(file instanceof File)) return null;
  if (!/^(image|video)\//i.test(file.type || '') && String(file.type || '').toLowerCase() !== 'application/pdf') {
    throw new Error('Можно прикрепить фото, видео или PDF');
  }
  if (file.size > 8 * 1024 * 1024) throw new Error('Один файл должен быть не больше 8 МБ');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
  return { name: file.name || 'Файл', type: file.type || '', size: file.size || 0, dataUrl };
}

export function bindMessageAttachments(form) {
  const selected = [];
  const input = form?.querySelector('[data-message-attachment-input]');
  const trigger = form?.querySelector('[data-message-attachment]');
  const preview = form?.querySelector('[data-message-attachment-preview]');
  const redraw = () => {
    if (!preview) return;
    preview.innerHTML = selected.map((item) => `<span class="message-composer__attachment-chip">${text(item.name || 'Медиа')}</span>`).join('');
  };
  trigger?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    const files = [...(input.files || [])].slice(0, 3);
    try {
      const next = (await Promise.all(files.map(fileAttachment))).filter(Boolean);
      selected.splice(0, selected.length, ...next);
      redraw();
    } catch (error) {
      selected.splice(0, selected.length);
      if (input) input.value = '';
      redraw();
      openNotice({
        title: 'Файл не прикреплён',
        message: error instanceof Error ? error.message : 'Не удалось прикрепить файл',
        action: 'Закрыть',
        variant: 'technical',
      });
    }
  });
  return () => [...selected];
}

export function initMessageComposer(root = document) {
  root.querySelectorAll?.('[data-message-composer]').forEach((form) => {
    const input = form.querySelector('.message-composer__input');
    if (!input || input.dataset.messageComposerReady === 'true') return;
    input.dataset.messageComposerReady = 'true';
    const resize = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 116)}px`;
      input.style.overflowY = input.scrollHeight > 116 ? 'auto' : 'hidden';
    };
    input.addEventListener('input', resize);
    requestAnimationFrame(resize);
  });
}

export function messageComposer({
  placeholder = 'Написать сообщение...',
  data = 'data-message-composer',
  sendData = 'data-message-send',
  attachments = false,
  attachmentTrigger = 'composer',
} = {}) {
  const externalAttachmentTrigger = attachments && attachmentTrigger === 'external';
  const classes = [
    'message-composer',
    attachments && !externalAttachmentTrigger ? 'message-composer--with-attachments' : 'message-composer--plain',
  ].filter(Boolean).join(' ');
  return `<form class="${classes}" ${data}>${attachments ? `<input class="sr-only" type="file" accept="image/*,video/*,application/pdf,.pdf" multiple data-message-attachment-input><button type="button" class="message-composer__attach${externalAttachmentTrigger ? ' sr-only' : ''}" data-message-attachment aria-label="Прикрепить файл">📎</button>` : ''}<textarea class="message-composer__input" name="message" rows="1" placeholder="${text(placeholder)}" aria-label="${text(placeholder)}"></textarea>${button('➤', { className: 'message-composer__send', type: 'submit', data: sendData, aria: 'Отправить' })}${attachments ? '<div class="message-composer__attachments" data-message-attachment-preview></div>' : ''}</form>`;
}
