const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };

export const escapeHtml = (v = '') => String(v).replace(/[&<>\"']/g, (c) => escapeMap[c]);
