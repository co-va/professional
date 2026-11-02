let historyState = [];
let persistHistory = null;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalize(item = {}) {
  return {
    id: String(item.id || crypto.randomUUID()),
    documentId: String(item.documentId || ''),
    documentTitle: String(item.documentTitle || 'Документ'),
    documentVersion: Math.max(1, Number(item.documentVersion || 1)),
    action: String(item.action || 'updated'),
    createdAt: String(item.createdAt || new Date().toISOString()),
    source: String(item.source || 'manual'),
    snapshot: item.snapshot && typeof item.snapshot === 'object' ? clone(item.snapshot) : null,
  };
}

function read() {
  return clone(historyState);
}

function writeItems(items = []) {
  historyState = (Array.isArray(items) ? items : []).map(normalize).filter((item) => item.documentId);
  if (typeof persistHistory === 'function') void persistHistory(clone(historyState));
  return clone(historyState);
}

export function configureDocumentHistoryPersistence(handler = null) {
  persistHistory = typeof handler === 'function' ? handler : null;
}

export function hydrateDocumentHistoryFromServer(items = []) {
  historyState = (Array.isArray(items) ? items : []).map(normalize).filter((item) => item.documentId);
  return getDocumentHistory();
}

export function getDocumentHistory() {
  return read().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

export function recordDocumentHistory({ documentId, documentTitle, documentVersion = 1, action = 'updated', source = 'manual', snapshot = null } = {}) {
  if (!documentId) return null;
  const item = normalize({ documentId, documentTitle, documentVersion, action, source, snapshot, createdAt: new Date().toISOString() });
  const items = read();
  items.push(item);
  writeItems(items);
  return item;
}
