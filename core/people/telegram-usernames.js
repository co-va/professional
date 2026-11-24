import { apiRequest } from '../auth.js';

// Telegram IDs are stable identity keys. The nickname is presentation only.
const USER_ID_PATTERN = /^-?\d{5,20}$/;
const USERNAME_PATTERN = /^@[A-Za-z0-9_]{5,32}$/;
const usernames = new Map();

export function isTelegramUserId(value) {
  return USER_ID_PATTERN.test(String(value ?? '').trim());
}

export function telegramDisplay(value) {
  const key = String(value ?? '').trim();
  return isTelegramUserId(key) ? (usernames.get(key) || 'Никнейм не получен') : key;
}

export async function loadTelegramUsernames(values = []) {
  const ids = [...new Set((Array.isArray(values) ? values : []).map((id) => String(id ?? '').trim())
    .filter(isTelegramUserId))].slice(0, 40);
  if (!ids.length) return usernames;
  const response = await apiRequest('/communications/telegram/contact-usernames?ids=' + encodeURIComponent(ids.join(',')));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Не удалось загрузить Telegram usernames');
  for (const item of Array.isArray(payload?.usernames) ? payload.usernames : []) {
    const id = String(item?.id ?? '').trim();
    const username = String(item?.username ?? '').trim();
    if (ids.includes(id) && USERNAME_PATTERN.test(username)) usernames.set(id, username);
  }
  return usernames;
}
