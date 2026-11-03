/** Mirrors src/styles/tokens.css. Figma colours are 0–1 RGB. */
const hex = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });

export const color = {
  grey0: hex('#ffffff'),
  grey1: hex('#f7f7f6'),
  grey2: hex('#eeeeec'),
  grey3: hex('#e0e0dd'),
  grey5: hex('#8d8d88'),
  grey6: hex('#5c5c58'),
  grey7: hex('#1f1f1d'),
  common: hex('#2f8a4f'),
  commonSoft: hex('#e6f3ea'),
  couldBeOne: hex('#b7791f'),
  couldBeOneSoft: hex('#fbf1e1'),
  oneOff: hex('#8d8d88'),
  oneOffSoft: hex('#eeeeec'),
};

export const text = { s11: 11, s12: 12, s13: 13, s15: 15 };
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s6: 24 };
export const radius = { control: 4, tile: 6 };
export const THUMB_HEIGHT = 48;
