/**
 * Near-duplicate thresholds. These are the numbers the detection spike tunes.
 * Two variants are "probably the same" when they share kind and subkind, differ in
 * at most `maxDiffs` properties, and every difference is within its threshold.
 */
export interface Thresholds {
  fontSize: number; // px
  fontWeight: number;
  padding: number; // px, largest single-side difference
  radius: number; // px
  borderWidth: number; // px
  height: number; // px
  color: number; // CIE76 ΔE
  /** Minimum share of structure tokens in common for container kinds (0–1). */
  structure: number;
  maxDiffs: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  fontSize: 1,
  fontWeight: 100,
  padding: 4,
  radius: 4,
  borderWidth: 1,
  height: 4,
  color: 8,
  structure: 0.75,
  maxDiffs: 3,
};
