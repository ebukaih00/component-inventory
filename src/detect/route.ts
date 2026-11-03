/** Route patterns: /projects/42/edit → /projects/:id/edit. Pages with one pattern are one screen. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEXISH = /^(?=.*\d)[0-9a-f]{8,}$/i;
const NUMERIC = /^\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A slug ending in a long number or id: "invoice-20231", "acme-corp-8f3a91c2". */
const SLUG_WITH_ID = /^[a-z0-9-]+-(\d{3,}|[0-9a-f]{8,})$/i;

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export function routePattern(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  const segments = path.split('/').map((seg) => {
    if (!seg) return seg;
    const decoded = (() => { try { return decodeURIComponent(seg); } catch { return seg; } })();
    if (NUMERIC.test(decoded) || UUID.test(decoded) || HEXISH.test(decoded)) return ':id';
    if (DATE.test(decoded)) return ':date';
    if (SLUG_WITH_ID.test(decoded)) return ':slug';
    return decoded;
  });
  let out = segments.join('/');
  out = out.replace(/\/index\.html?$/, '/');
  return out || '/';
}
