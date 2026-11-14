export function initMultiSelect(root, { selectedDates = [], selectedValues = [], selector = '[data-calendar-date]', valueAttribute = 'calendarDate', onChange = () => {} } = {}) {
  const initial = selectedValues.length ? selectedValues : selectedDates;
  const selection = new Set(initial.filter(Boolean));
  const valueOf = (element) => element?.dataset?.[valueAttribute] || '';
  const sync = () => root.querySelectorAll(selector).forEach((element) => { const selected = selection.has(valueOf(element)); element.classList.toggle('is-selected', selected); element.setAttribute('aria-pressed', String(selected)); const checkbox = element.matches('input[type="checkbox"]') ? element : element.querySelector('input[type="checkbox"]'); if (checkbox) checkbox.checked = selected; });
  const toggle = (value) => { if (!value) return; if (selection.has(value)) selection.delete(value); else selection.add(value); sync(); onChange([...selection]); };
  const handleClick = (event) => { if (event.target.closest('[data-selection-action]')) return; const element = event.target.closest(selector); if (!element || !root.contains(element)) return; event.preventDefault(); event.stopPropagation(); toggle(valueOf(element)); };
  root.addEventListener('click', handleClick, true);
  const observer = new MutationObserver(sync); observer.observe(root, { childList: true, subtree: true }); sync();
  return { getSelectedValues: () => [...selection], getSelectedDates: () => [...selection], isSelected: (value) => selection.has(value), setSelectedValues: (values = []) => { selection.clear(); values.filter(Boolean).forEach((value) => selection.add(value)); sync(); onChange([...selection]); }, setSelectedDates: (values = []) => { selection.clear(); values.filter(Boolean).forEach((value) => selection.add(value)); sync(); onChange([...selection]); }, toggle, destroy: () => { observer.disconnect(); root.removeEventListener('click', handleClick, true); } };
}
