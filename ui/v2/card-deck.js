import { text } from './html.js';

function v2NavigationIcon(id = '') {
  const key = String(id || '').toLowerCase();
  const paths = {
    people: '<circle cx="8" cy="9" r="3"></circle><circle cx="16" cy="9" r="3"></circle><path d="M3 20c.7-3.2 2.4-5 5-5s4.3 1.8 5 5M12 20c.6-2.8 2.1-4.4 4.4-4.4 2.2 0 3.7 1.6 4.3 4.4"></path>',
    contacts: '<circle cx="8" cy="9" r="3"></circle><circle cx="16" cy="9" r="3"></circle><path d="M3 20c.7-3.2 2.4-5 5-5s4.3 1.8 5 5M12 20c.6-2.8 2.1-4.4 4.4-4.4 2.2 0 3.7 1.6 4.3 4.4"></path>',
    finance: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9V6l14-3v2M21 11h-5a2 2 0 0 0 0 4h5M16 13h.01"/>',
    cash: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 8v4l3 2M6 6h.01M18 18h.01"/>',
    dds: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
    'income-expense': '<path d="M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4"></path>',
    articles: '<path d="M5 5h14M5 10h14M5 15h9M5 20h9"></path>',
    special: '<path d="M4 8h16M4 16h16M8 4 4 8l4 4M16 12l4 4-4 4"></path>',
    'z-report': '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 7h6M9 11h6M9 15h4"/>',
    timetable: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path>',
    workplaces: '<path d="m3 11 9-7 9 7v9h-6v-6H9v6H3Z"></path>',
    home: '<path d="m3 11 9-7 9 7v9h-6v-6H9v6H3Z"></path>',
    journal: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"></path><path d="M8 4v16"></path>',
    history: '<path d="M4 7h16M4 12h16M4 17h11"></path><circle cx="2.5" cy="7" r=".8"></circle><circle cx="2.5" cy="12" r=".8"></circle><circle cx="2.5" cy="17" r=".8"></circle>',
    profile: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c1-4.4 3.7-7 8-7s7 2.6 8 7"></path>',
    settings: '<path d="M10.3 2h3.4l.6 2.5 2 .9 2.2-1.3 2.4 2.4-1.3 2.2.9 2 2.5.6v3.4l-2.5.6-.9 2 1.3 2.2-2.4 2.4-2.2-1.3-2 .9-.6 2.5h-3.4l-.6-2.5-2-.9-2.2 1.3-2.4-2.4 1.3-2.2-.9-2-2.5-.6v-3.4l2.5-.6.9-2-1.3-2.2 2.4-2.4 2.2 1.3 2-.9L10.3 2Z" transform="translate(1.2 1.2) scale(.9)"/><circle cx="12" cy="12" r="3"/>',
    service: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18M10 13v2h4v-2"/>',
    'online-booking': '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18M8 15h8"></path>',
    communications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>',
    integrations: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"></path>',
    documents: '<path d="M6 3h9l4 4v14H6Z"></path><path d="M15 3v5h5M9 13h6M9 17h6"></path>',
    tags: '<path d="M3 12V4h8l10 10-8 8Z"></path><circle cx="8" cy="8" r="1"></circle>',
    day: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path>',
    month: '<path d="M5 20V11M10 20V6M15 20V9M20 20V3"></path>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"></path><circle cx="3.5" cy="6" r="1"></circle><circle cx="3.5" cy="12" r="1"></circle><circle cx="3.5" cy="18" r="1"></circle>',
    loyalty: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8H7.5A2.5 2.5 0 1 1 10 5.5L12 8Zm0 0h4.5A2.5 2.5 0 1 0 14 5.5L12 8Z"/>',
    inventory: '<path d="M3 7 12 3l9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7.5 5l9 4"/>',
    deposit: '<path d="M4 11c0-4 4-6 8-6 3 0 5 1 6 3l3-1v6h-2l-2 3v4h-3v-3H9v3H6v-4c-2-1-3-3-3-5H1M12 8h3"/><circle cx="16" cy="10" r=".5"/>',
    'personal-account': '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M6 16c0-2 1-3 3-3s3 1 3 3M15 10h3M15 14h3"/>',
    certificate: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 8h10M7 11h5"/><circle cx="16" cy="15" r="3"/><path d="m14 17-1 4 3-2 3 2-1-4"/>',
    subscription: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16m-12 5 3 3 5-5"/>',
    referral: '<circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="m8 11 8-5m-8 7 8 5"/>',
    bonus: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    stock: '<path d="M4 4h16v16H4zM4 10h16M4 15h16M8 7h3M8 12h3M8 17h3"/>',
    movements: '<path d="M3 6h13l-3-3m3 3-3 3M21 18H8l3-3m-3 3 3 3"/>',
    orders: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="2" width="6" height="5" rx="1"/><path d="M9 11h6M9 15h6M9 18h4"/>',
    counterparties: '<path d="M3 21V5h12v16M15 10h6v11M1 21h22M7 9h4M7 13h4M7 17h4M18 14h1M18 17h1"/>',
    'consumption-groups': '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    'data-transfer': '<path d="M7 3v18m-4-4 4 4 4-4M17 21V3m-4 4 4-4 4 4"/>',
  };
  const body = paths[key] || paths.list;
  return `<span class="v2-nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${body}</svg></span>`;
}

function v2NestedMark(count = 0) {
  const value = Math.max(0, Number(count || 0));
  if (!value) return '';
  return `<span class="v2-f-nested" aria-hidden="true"><i></i><i></i><i></i><b>${value}</b></span>`;
}

export function v2CardDeck(items = [], {
  axis = 'x',
  active = '',
  data = 'data-v2-deck-item',
  className = '',
  role = '',
  level = 'f',
} = {}) {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!values.length) return '';
  const resolvedAxis = axis === 'y' ? 'y' : 'x';
  const activeId = String(active || values[0]?.id || '0');
  const activeIndex = Math.max(0, values.findIndex((item, index) => String(item.id || index) === activeId));
  const classes = ['v2-card-deck', `v2-card-deck--${resolvedAxis}`, className].filter(Boolean).join(' ');
  const roleData = role ? ` data-v2-deck-role="${text(role)}"` : '';
  return `<div class="${text(classes)}" data-v2-card-deck data-v2-deck-axis="${resolvedAxis}" data-v2-deck-level="${text(level)}" data-v2-deck-count="${values.length}"${roleData}>${values.map((item, index) => {
    const id = String(item.id || index);
    const isActive = index === activeIndex;
    const childrenCount = Number(item.childrenCount || item.children || 0);
    const customData = data ? ` ${data}="${text(id)}"` : '';
    return `<button type="button" class="v2-card-deck__card${isActive ? ' is-active' : ''}" data-v2-card-item="${text(id)}"${customData} data-v2-card-index="${index}" aria-label="${text(item.aria || item.label || '')}"${isActive ? ' aria-current="true"' : ''}>${level === 'f' ? v2NestedMark(childrenCount) : ''}${v2NavigationIcon(item.icon || id)}<strong>${text(item.label || '')}</strong></button>`;
  }).join('')}</div>`;
}
