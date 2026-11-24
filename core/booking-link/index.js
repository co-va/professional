function routeSegment(value) {
  return String(value || '').trim();
}

export function buildBookingLink({ origin = '', profileSlug = '', workplaceSlug = '' } = {}) {
  const host = String(origin || '').trim();
  const profile = routeSegment(profileSlug);
  if (!host || !profile) return '';

  const segments = [profile];
  const workplace = routeSegment(workplaceSlug);
  if (workplace) segments.push(workplace);

  const url = new URL('/', host);
  url.pathname = `/booking/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
