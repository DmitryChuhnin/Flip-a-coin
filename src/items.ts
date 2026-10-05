import type { Object3D } from 'three';
import { createCoinMesh } from './coin/coinMesh';
import { COIN_BODY, type CoinValue } from './coin/coinSpec';
import { createDieMesh } from './dice/dieMesh';
import { createDie, DIE_KINDS, type DieKind } from './dice/dieSpec';
import { STRINGS } from './strings';
import type { TossBody } from './toss/body';

export type ItemName = 'coin' | DieKind;
export const ITEM_NAMES: readonly ItemName[] = ['coin', ...DIE_KINDS];

export interface Item<V extends string = string> {
  name: ItemName;
  body: TossBody<V>;
  createMesh(): Object3D;
  /** Text for the polite live region. */
  announce(outcome: V): string;
  /** Large text shown above the table after the toss, or null for none. */
  caption(outcome: V): string | null;
}

/** Temporary selector until the item tabs exist: `?item=d20`. Anything else is the coin. */
export function itemFromQuery(search: string): ItemName {
  const value = new URLSearchParams(search).get('item');
  return ITEM_NAMES.find((name) => name === value) ?? 'coin';
}

/** Builds only the requested item; dice shapes and symmetry tables are computed here. */
export function createItem(name: ItemName): Item {
  if (name === 'coin') {
    const coin: Item<CoinValue> = {
      name,
      body: COIN_BODY,
      createMesh: createCoinMesh,
      announce: (outcome) => STRINGS.coin[outcome],
      caption: () => null,
    };
    return coin;
  }
  const die = createDie(name);
  return {
    name,
    body: die.body,
    createMesh: () => createDieMesh(die),
    announce: STRINGS.rolled,
    caption: (outcome) => outcome,
  };
}
