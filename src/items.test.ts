import { describe, expect, it } from 'vitest';
import { createItem, ITEM_NAMES, itemFromQuery } from './items';

describe('itemFromQuery', () => {
  it.each(ITEM_NAMES)('selects %s by name', (name) => {
    expect(itemFromQuery(`?item=${name}`)).toBe(name);
  });

  it.each([
    '',
    '?',
    '?item=',
    '?item=d7',
    '?item=D20',
    '?item=d20%20',
    '?other=d20',
    '?item=coin1',
  ])('falls back to the coin for %j', (search) => {
    expect(itemFromQuery(search)).toBe('coin');
  });

  it('takes the first item parameter when repeated', () => {
    expect(itemFromQuery('?item=d6&item=d20')).toBe('d6');
  });
});

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
