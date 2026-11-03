/** Colour parsing and perceptual distance. Colours are stored as "#rrggbbaa". */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

export function toHex({ r, g, b, a }: RGBA): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a * 255)}`;
}

/**
 * Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax) and
 * "transparent". Returns null for anything else (the DOM layer falls back to a canvas).
 */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  const out = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
  if ([out.r, out.g, out.b, out.a].some(Number.isNaN)) return null;
  return out;
}

export function normalizeColor(input: string): string | null {
  const c = parseColor(input);
  return c ? toHex(c) : null;
}

export function isTransparent(hex: string): boolean {
  const c = parseColor(hex);
  return !c || c.a < 0.05;
}

/** Composite over white, so "transparent" and "white" on a white page compare as equal. */
function overWhite(c: RGBA): RGBA {
  return {
    r: c.r * c.a + 255 * (1 - c.a),
    g: c.g * c.a + 255 * (1 - c.a),
    b: c.b * c.a + 255 * (1 - c.a),
    a: 1,
  };
}

function toLab({ r, g, b }: RGBA): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 ΔE between two colours composited over white. ~2.3 is a just-noticeable difference. */
export function deltaE(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a === b ? 0 : Infinity;
  const [l1, a1, b1] = toLab(overWhite(ca));
  const [l2, a2, b2] = toLab(overWhite(cb));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Short human form for summaries: "#2563eb", "#2563eb 50%", "none". */
export function displayColor(hex: string): string {
  const c = parseColor(hex);
  if (!c || c.a < 0.05) return 'none';
  const base = hex.slice(0, 7);
  return c.a > 0.99 ? base : `${base} ${Math.round(c.a * 100)}%`;
}
