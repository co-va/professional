function rootApp(root) {
  return root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
}

export function setV2Y(root, content = '') {
  const app = rootApp(root);
  const host = app?.querySelector?.(':scope > [data-v2-y-host]');
  if (!host) return null;
  const html = String(content || '');
  host.innerHTML = html;
  const active = Boolean(html.trim());
  host.hidden = !active;
  host.style.paddingBottom = active ? '12px' : '';
  if (active) {
    // Reserve exactly the sticker strip's measured height. F/E and incoming Z
    // collapse that height without discarding the note cards or their handlers.
    host.style.setProperty('--v2-y-expanded-height', `${Math.ceil(host.scrollHeight)}px`);
  } else {
    host.style.removeProperty('--v2-y-expanded-height');
  }
  app.classList.toggle('has-v2-y', active);
  return host;
}

export function clearV2Y(root) {
  return setV2Y(root, '');
}
