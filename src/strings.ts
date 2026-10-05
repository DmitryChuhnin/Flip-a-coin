import type { CoinValue } from './coin/coinSpec';

/** User-facing text, kept in one place for later localization. */
export const STRINGS = {
  coin: { heads: 'Heads', tails: 'Tails' } satisfies Record<CoinValue, string>,
  rolled: (value: string) => `Rolled ${value}`,
};
