import type { CoinValue } from './coin/coinSpec';

export type Language = 'en' | 'ru';

export interface Strings {
  title: string;
  /** Name under the home screen icon on iOS; Android takes it from the manifest. */
  shortName: string;
  coin: Record<CoinValue, string>;
  rolled: (value: string) => string;
  tabs: { label: string; coin: string; dice: string };
  dice: string;
  sound: string;
  hint: string;
  webglError: string;
  engineError: string;
  reload: string;
}

export const DICTIONARY: Record<Language, Strings> = {
  en: {
    title: 'Flip a Coin',
    shortName: 'Flip a Coin',
    coin: { heads: 'Heads', tails: 'Tails' },
    rolled: (value) => `Rolled ${value}`,
    tabs: { label: 'Item', coin: 'Coin', dice: 'Dice' },
    dice: 'Die',
    sound: 'Sound',
    hint: 'Tap to toss',
    webglError: 'WebGL is not available',
    engineError: 'Something went wrong. Reload the page to try again.',
    reload: 'Reload',
  },
  ru: {
    title: 'Подбрось монетку',
    shortName: 'Монетка',
    coin: { heads: 'Орёл', tails: 'Решка' },
    rolled: (value) => `Выпало ${value}`,
    tabs: { label: 'Предмет', coin: 'Монетка', dice: 'Кость' },
    dice: 'Кость',
    sound: 'Звук',
    hint: 'Тапни, чтобы бросить',
    webglError: 'WebGL недоступен',
    engineError: 'Что-то пошло не так. Перезагрузи страницу и попробуй снова.',
    reload: 'Перезагрузить',
  },
};

/** Russian when the browser's first preferred language is Russian, English otherwise. */
export function languageOf(preferred: readonly string[]): Language {
  return /^ru(-|$)/i.test(preferred[0] ?? '') ? 'ru' : 'en';
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export const LANGUAGE = languageOf(browserLanguages());
/** User-facing text in the browser's language. */
export const STRINGS = DICTIONARY[LANGUAGE];
