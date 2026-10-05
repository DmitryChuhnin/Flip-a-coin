import { DIE_KINDS, type DieKind } from './dice/dieSpec';
import type { ItemName } from './items';

export type Tab = 'coin' | 'dice';

export interface Settings {
  tab: Tab;
  /** Die shown on the dice tab; kept while the coin tab is open. */
  die: DieKind;
  sound: boolean;
  /** Set after the first toss ever; the hint shows until then. */
  tossed: boolean;
}

export const DEFAULT_SETTINGS: Settings = { tab: 'coin', die: 'd20', sound: true, tossed: false };

export const SETTINGS_KEY = 'flip-a-coin:settings';

export function itemOf(settings: Settings): ItemName {
  return settings.tab === 'coin' ? 'coin' : settings.die;
}

/**
 * Settings saved earlier, field by field: a missing or malformed field gets its default. Storage
 * that is unavailable or throws gives the defaults; the player sees no error.
 */
export function readSettings(storage: () => Storage | null): Settings {
  let saved: unknown;
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const field = (name: keyof Settings): unknown =>
    typeof saved === 'object' && saved !== null
      ? (saved as Record<string, unknown>)[name]
      : undefined;
  const tab = field('tab');
  const die = field('die');
  const sound = field('sound');
  const tossed = field('tossed');
  return {
    tab: tab === 'coin' || tab === 'dice' ? tab : DEFAULT_SETTINGS.tab,
    die: DIE_KINDS.find((kind) => kind === die) ?? DEFAULT_SETTINGS.die,
    sound: typeof sound === 'boolean' ? sound : DEFAULT_SETTINGS.sound,
    tossed: typeof tossed === 'boolean' ? tossed : DEFAULT_SETTINGS.tossed,
  };
}

/** Saves the settings if storage allows; a full or blocked storage is ignored. */
export function writeSettings(storage: () => Storage | null, settings: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The game works the same without saved settings.
  }
}
