/**
 * Class tokens with generated names removed, so two builds of the same component compare equal.
 * Handles styled-components, Emotion, CSS Modules, Svelte and JSX scoped names.
 */

/** Tokens that are entirely generated. */
const HASHED = [
  /^(css|sc|jsx|svelte|emotion|tw|astro|vue|ng)-[a-z0-9_-]*\d[a-z0-9_-]*$/i, // css-1x2y3z, svelte-ab12cd
  /^sc-[a-z0-9]+$/i, // styled-components component id: sc-bdVaJa
  /^_?[a-z]{0,2}\d[a-z0-9]{4,}$/i, // e1x2y3z0, _3xYz12
];

/** styled-components class names: 5–8 random letters with case changes inside, e.g. "kDjEaB". */
function isStyledRandom(token: string): boolean {
  if (!/^[a-zA-Z]{5,8}$/.test(token)) return false;
  const innerUpper = /[A-Z]/.test(token.slice(1));
  const hasLower = /[a-z]/.test(token);
  // camelCase words like "navItem" have one inner capital; random ids have several.
  const capitals = (token.slice(1).match(/[A-Z]/g) ?? []).length;
  return innerUpper && hasLower && capitals >= 2;
}

/** CSS Modules: "Button_primary__x7Yz2" → "Button_primary". The suffix must contain a digit. */
const MODULE_SUFFIX = /^(.+?)_{1,3}([a-zA-Z0-9-]{5,})$/;

export function cleanClassTokens(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;
    if (HASHED.some((re) => re.test(t)) || isStyledRandom(t)) continue;
    const mod = MODULE_SUFFIX.exec(t);
    if (mod && /\d/.test(mod[2])) {
      out.add(mod[1]);
      continue;
    }
    out.add(t);
  }
  return [...out].sort();
}
