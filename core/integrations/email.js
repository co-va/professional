import { apiRequest, apiResponseJson as jsonResponse } from '../auth.js';

export async function getEmailConnection() {
  return jsonResponse(await apiRequest('/communications/integrations/email'), 'Не удалось проверить подключение почты');
}

export async function beginEmailConnection(email) {
  return jsonResponse(await apiRequest('/communications/integrations/email/connect', {
    method: 'POST',
    body: JSON.stringify({ email: String(email || '').trim() }),
  }), 'Не удалось начать подключение почты');
}

export async function disconnectEmail() {
  return jsonResponse(await apiRequest('/communications/integrations/email', { method: 'DELETE' }), 'Не удалось отключить почту');
}
