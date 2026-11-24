export function bindCalendarHeaderHost(root, headerHost) {
  if (!root || !headerHost?.replaceChildren) return () => {};

  const sync = () => {
    const header = root.querySelector(':scope > [data-calendar] > .calendar__header');
    if (!header || header.parentElement === headerHost) return;
    header.style.margin = '0';
    headerHost.replaceChildren(header);
  };

  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
  sync();

  return () => observer.disconnect();
}
