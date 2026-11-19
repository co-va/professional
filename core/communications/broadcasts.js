import { apiRequest } from '../auth.js';

async function jsonResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallbackMessage);
  return payload;
}

export async function getBroadcastTemplates() {
  return jsonResponse(await apiRequest('/communications/broadcasts/templates'), 'Не удалось загрузить шаблоны');
}
export async function saveBroadcastTemplate({ id = '', name = '', body = '' } = {}) {
  return jsonResponse(await apiRequest('/communications/broadcasts/templates', { method: 'POST', body: JSON.stringify({ id, name, body }) }), 'Не удалось сохранить шаблон');
}
export async function deleteBroadcastTemplate(id = '') {
  return jsonResponse(await apiRequest(`/communications/broadcasts/templates/${encodeURIComponent(String(id || ''))}`, { method: 'DELETE' }), 'Не удалось удалить шаблон');
}

export async function getCommunicationGroups() {
  return jsonResponse(await apiRequest('/communications/broadcasts/groups'), 'Не удалось загрузить группы');
}
export async function saveCommunicationGroup({ id = '', name = '', personKeys = [] } = {}) {
  return jsonResponse(await apiRequest('/communications/broadcasts/groups', { method: 'POST', body: JSON.stringify({ id, name, personKeys }) }), 'Не удалось сохранить группу');
}
export async function deleteCommunicationGroup(id = '') {
  return jsonResponse(await apiRequest(`/communications/broadcasts/groups/${encodeURIComponent(String(id || ''))}`, { method: 'DELETE' }), 'Не удалось удалить группу');
}

export async function previewBroadcast({ channel = 'TELEGRAM', all = false, phones = [], personKeys = [], groupId = '' } = {}) {
  return jsonResponse(await apiRequest('/communications/broadcasts/preview', { method: 'POST', body: JSON.stringify({ channel, all, phones, personKeys, groupId }) }), 'Не удалось проверить аудиторию');
}
export async function sendBroadcast({ channel = 'TELEGRAM', all = false, phones = [], personKeys = [], groupId = '', name = '', body = '' } = {}) {
  return jsonResponse(await apiRequest('/communications/broadcasts/send', { method: 'POST', body: JSON.stringify({ channel, all, phones, personKeys, groupId, name, body }) }), 'Не удалось отправить сообщение');
}
