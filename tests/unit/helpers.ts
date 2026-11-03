import type { Candidate, Kind, StyleProps, Subkind } from '../../src/detect';

export const baseStyle: StyleProps = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 14,
  fontWeight: 500,
  paddingTop: 8,
  paddingRight: 16,
  paddingBottom: 8,
  paddingLeft: 16,
  radius: 6,
  borderWidth: 0,
  borderStyle: 'none',
  borderColor: '#00000000',
  background: '#2563ebff',
  color: '#ffffffff',
  height: 36,
  shadow: false,
};

let n = 0;
export function cand(style: Partial<StyleProps> = {}, kind: Kind = 'button', subkind: Subkind = null, structure = kind): Candidate {
  return {
    localId: n++,
    kind,
    subkind,
    fingerprint: { structure, style: { ...baseStyle, ...style }, classes: [] },
    rect: { x: 0, y: 0, width: 100, height: 36 },
    selectorPath: `body > ${kind}:nth-of-type(${n})`,
  };
}

export function comparable(style: Partial<StyleProps> = {}, kind: Kind = 'button', subkind: Subkind = null, structure: string = kind) {
  return { kind, subkind, fingerprint: { structure, style: { ...baseStyle, ...style }, classes: [] } };
}
