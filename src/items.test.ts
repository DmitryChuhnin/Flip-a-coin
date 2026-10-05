import { describe, expect, it } from 'vitest';
import { createItem } from './items';

describe('createItem', () => {
  it('announces the coin side without a caption', () => {
    const coin = createItem('coin');
    expect(coin.announce('heads')).toBe('Heads');
    expect(coin.announce('tails')).toBe('Tails');
    expect(coin.caption('heads')).toBeNull();
  });

  it('announces and captions the rolled number of a die', () => {
    const d20 = createItem('d20');
    expect(d20.body.faces).toHaveLength(20);
    expect(d20.announce('17')).toBe('Rolled 17');
    expect(d20.caption('17')).toBe('17');
  });
});
