import type { Object3D } from 'three';
import { createCoinMesh } from './coin/coinMesh';
import { COIN_BODY, type CoinValue } from './coin/coinSpec';
import { createDieMesh } from './dice/dieMesh';
import { createDie, type DieKind } from './dice/dieSpec';
import { STRINGS } from './strings';
import type { TossBody } from './toss/body';

export type ItemName = 'coin' | DieKind;

export interface Item<V extends string = string> {
  name: ItemName;
  body: TossBody<V>;
  createMesh(): Object3D;
  /** Text for the polite live region. */
  announce(outcome: V): string;
  /** Large text shown above the table after the toss, or null for none. */
  caption(outcome: V): string | null;
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
