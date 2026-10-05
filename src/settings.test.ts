import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  itemOf,
  readSettings,
  SETTINGS_KEY,
  writeSettings,
  type Settings,
} from './settings';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

const saved = (value: string) => () => memoryStorage({ [SETTINGS_KEY]: value });

describe('readSettings', () => {
  it('reads back what was written', () => {
    const storage = memoryStorage();
    const settings: Settings = { tab: 'dice', die: 'd6', sound: false, tossed: true };
    writeSettings(() => storage, settings);
    expect(readSettings(() => storage)).toEqual(settings);
  });

  it('gives the defaults when nothing is saved', () => {
    expect(readSettings(() => memoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('gives the defaults when storage is missing or throws on access or read', () => {
    expect(readSettings(() => null)).toEqual(DEFAULT_SETTINGS);
    expect(
      readSettings(() => {
        throw new DOMException('denied', 'SecurityError');
      }),
    ).toEqual(DEFAULT_SETTINGS);
    const broken = memoryStorage();
    broken.getItem = () => {
      throw new Error('read failed');
    };
    expect(readSettings(() => broken)).toEqual(DEFAULT_SETTINGS);
  });

  it.each(['not json', '', 'null', '42', '"dice"', '[]', 'true'])(
    'gives the defaults for a saved value %j that is not an object',
    (value) => {
      expect(readSettings(saved(value))).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('replaces only the malformed fields with defaults', () => {
    const value = JSON.stringify({ tab: 'dice', die: 'd7', sound: 'no', tossed: true });
    expect(readSettings(saved(value))).toEqual({
      tab: 'dice',
      die: DEFAULT_SETTINGS.die,
      sound: DEFAULT_SETTINGS.sound,
      tossed: true,
    });
  });

  it.each([
    { tab: 'Dice' },
    { tab: null },
    { die: 'D20' },
    { die: 20 },
    { sound: 0 },
    { tossed: 1 },
  ])('falls back to the default for %j', (fields) => {
    expect(readSettings(saved(JSON.stringify(fields)))).toEqual(DEFAULT_SETTINGS);
  });
});

describe('writeSettings', () => {
  it('ignores storage that is missing, full or blocked', () => {
    const full = memoryStorage();
    full.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    expect(() => writeSettings(() => full, DEFAULT_SETTINGS)).not.toThrow();
    expect(() => writeSettings(() => null, DEFAULT_SETTINGS)).not.toThrow();
    expect(() =>
      writeSettings(() => {
        throw new DOMException('denied', 'SecurityError');
      }, DEFAULT_SETTINGS),
    ).not.toThrow();
  });
});

describe('itemOf', () => {
  it('is the coin on the coin tab and the chosen die on the dice tab', () => {
    expect(itemOf({ ...DEFAULT_SETTINGS, tab: 'coin', die: 'd8' })).toBe('coin');
    expect(itemOf({ ...DEFAULT_SETTINGS, tab: 'dice', die: 'd8' })).toBe('d8');
  });
});
