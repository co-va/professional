import { apiRequest, apiResponseJson as jsonResponse } from '../auth.js';

export async function getTelegramBotConnection() {
  return jsonResponse(await apiRequest('/communications/integrations/telegram'), 'Не удалось загрузить Telegram-интеграцию');
}

export async function connectTelegramBot(token) {
  return jsonResponse(await apiRequest('/communications/integrations/telegram', {
    method: 'PUT', body: JSON.stringify({ token: String(token || '').trim() }),
  }), 'Не удалось подключить Telegram-бота');
}

export async function disconnectTelegramBot() {
  return jsonResponse(await apiRequest('/communications/integrations/telegram', { method: 'DELETE' }), 'Не удалось отключить Telegram-бота');
}
