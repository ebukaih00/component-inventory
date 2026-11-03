import { describe, expect, it } from 'vitest';
import { deltaE, displayColor, normalizeColor, parseColor } from '../../src/detect';

describe('colour', () => {
  it('parses computed-style and hex forms', () => {
    expect(normalizeColor('rgb(37, 99, 235)')).toBe('#2563ebff');
    expect(normalizeColor('rgba(0, 0, 0, 0.5)')).toBe('#00000080');
    expect(normalizeColor('rgb(37 99 235 / 50%)')).toBe('#2563eb80');
    expect(normalizeColor('#abc')).toBe('#aabbccff');
    expect(normalizeColor('transparent')).toBe('#00000000');
    expect(parseColor('oklch(0.6 0.1 200)')).toBeNull();
  });

  it('measures perceptual distance, compositing over white', () => {
    expect(deltaE('#2563ebff', '#2563ebff')).toBe(0);
    expect(deltaE('#2563ebff', '#2664eaff')).toBeLessThan(2);
    expect(deltaE('#2563ebff', '#b91c1cff')).toBeGreaterThan(50);
    expect(deltaE('#00000000', '#ffffffff')).toBeLessThan(0.01);
  });

  it('formats for summaries', () => {
    expect(displayColor('#2563ebff')).toBe('#2563eb');
    expect(displayColor('#2563eb80')).toBe('#2563eb 50%');
    expect(displayColor('#00000000')).toBe('none');
  });
});
