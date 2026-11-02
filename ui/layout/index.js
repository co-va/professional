const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
}[char]));

/**
 * Canonical neutral two-column layout.
 * It owns only geometry: two equal columns on one visual axis.
 * The content of each column is supplied by the caller and may be any shared UI.
 */
export function twoColumnLayout(left = '', right = '', { ariaLabel = '' } = {}) {
  const aria = ariaLabel ? ` role="group" aria-label="${esc(ariaLabel)}"` : '';
  return `<div class="two-column-layout"${aria}><div class="two-column-layout__column">${left}</div><div class="two-column-layout__column">${right}</div></div>`;
}

/**
 * Canonical neutral 1–3 column layout.
 * It owns only equal-column geometry; business meaning stays with the caller.
 */
export function columnLayout(items = [], { columns = 0, ariaLabel = '' } = {}) {
  const values = (Array.isArray(items) ? items : []).filter((item) => item !== null && item !== undefined).slice(0, 3);
  const count = Math.max(1, Math.min(3, Number(columns) || values.length || 1));
  const aria = ariaLabel ? ` role="group" aria-label="${esc(ariaLabel)}"` : '';
  return `<div class="column-layout column-layout--${count}"${aria}>${values.map((item) => `<div class="column-layout__column">${item}</div>`).join('')}</div>`;
}
