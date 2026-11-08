import { apiRequest } from '../../auth.js';
import { hydrateWalletsFromServer } from './data.js';

// Wallet identities belong to Core. This client only asks the authenticated
// server to repair its own catalog; it never synthesizes IDs or sends a full
// catalog PUT from partial browser state.
let inFlight = null;

async function readResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || 'Не удалось восстановить кошельки');
  if (!payload || !Array.isArray(payload.wallets) || !Array.isArray(payload.recovered)) {
    throw new Error('Сервер вернул неполный результат восстановления');
  }
  return payload;
}

async function recoverOnServer() {
  const result = await apiRequest('/auxiliary-state/wallets/recover', { method: 'POST' })
    .then(readResponse);
  hydrateWalletsFromServer(result.wallets);
  return {
    status: result.recovered.length ? 'restored' : 'unchanged',
    recovered: result.recovered,
    unresolvedIds: Array.isArray(result.unresolvedIds) ? result.unresolvedIds : [],
  };
}

export function recoverMissingWalletsFromFinanceHistory() {
  if (!inFlight) {
    inFlight = recoverOnServer().catch((error) => {
      inFlight = null;
      throw error;
    });
  }
  return inFlight;
}
