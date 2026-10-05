import { describe, expect, it } from 'vitest';
import { DICTIONARY, languageOf } from './strings';

describe('languageOf', () => {
  it('picks Russian for a browser that prefers Russian first', () => {
    for (const preferred of [['ru-RU'], ['ru'], ['RU-ru', 'en']]) {
      expect(languageOf(preferred)).toBe('ru');
    }
  });

  it('falls back to English for any other first language, Rusyn, a later Russian and no list', () => {
    for (const preferred of [['en-US'], ['uk-UA'], ['rue'], ['en-GB', 'ru'], [], ['']]) {
      expect(languageOf(preferred)).toBe('en');
    }
  });
});

describe('DICTIONARY', () => {
  it('has every English entry in Russian too, with nothing left empty', () => {
    const keys = (strings: object): string[] =>
      Object.entries(strings).flatMap(([key, value]) =>
        typeof value === 'object' ? keys(value).map((inner) => `${key}.${inner}`) : [key],
      );
    expect(keys(DICTIONARY.ru)).toEqual(keys(DICTIONARY.en));
    const texts = (strings: object): unknown[] =>
      Object.values(strings).flatMap((value) =>
        typeof value === 'object' ? texts(value) : [value],
      );
    for (const text of texts(DICTIONARY.ru)) {
      const shown = typeof text === 'function' ? text('7') : text;
      expect(shown).toMatch(/\S/);
    }
    expect(DICTIONARY.ru.rolled('17')).toBe('Выпало 17');
  });
});
