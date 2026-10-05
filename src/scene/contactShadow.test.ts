import { describe, expect, it } from 'vitest';
import { SHADOW, shadowLook } from './contactShadow';

describe('shadowLook', () => {
  it('is full size and darkest at rest', () => {
    expect(shadowLook(0)).toEqual({ scale: 1, opacity: 0.9 * SHADOW.opacity });
  });

  it('grows and fades as the body rises, down to the minimum opacity', () => {
    const low = shadowLook(1);
    const high = shadowLook(2);
    expect(high.scale).toBeGreaterThan(low.scale);
    expect(high.opacity).toBeLessThan(low.opacity);
    expect(shadowLook(100).opacity).toBe(SHADOW.minOpacity * SHADOW.opacity);
  });

  it('treats a body below its rest height or a non-finite height as resting', () => {
    for (const h of [-0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(shadowLook(h)).toEqual(shadowLook(0));
    }
  });
});
