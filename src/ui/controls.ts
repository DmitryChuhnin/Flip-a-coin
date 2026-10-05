import { DIE_KINDS, type DieKind } from '../dice/dieSpec';
import type { Settings, Tab } from '../settings';
import { STRINGS } from '../strings';

export interface ControlsHandlers {
  /** Tab or die changed; `settings` is the new state. */
  onChange(settings: Settings): void;
}

export interface Controls {
  /** Disables the item tabs and dice; the sound button stays on. */
  setLocked(locked: boolean): void;
  hideHint(): void;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector} in the page`);
  return element;
}

/** Wires the item tabs, the dice tray, the sound button and the hint to `initial` settings. */
export function bindControls(
  root: ParentNode,
  initial: Settings,
  handlers: ControlsHandlers,
): Controls {
  let settings = initial;
  const container = required<HTMLElement>(root, '#controls');
  const tabs = required<HTMLElement>(root, '#tabs');
  const tabButtons = [...tabs.querySelectorAll<HTMLButtonElement>('button[data-tab]')];
  const tray = required<HTMLElement>(root, '#tray');
  const sound = required<HTMLButtonElement>(root, '#sound');
  const hint = required<HTMLElement>(root, '#hint');

  tabs.setAttribute('aria-label', STRINGS.tabs.label);
  for (const button of tabButtons) button.textContent = STRINGS.tabs[button.dataset.tab as Tab];
  tray.setAttribute('aria-label', STRINGS.dice);
  const pills = DIE_KINDS.map((kind) => {
    const pill = tray.ownerDocument.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.textContent = kind;
    pill.dataset.die = kind;
    tray.append(pill);
    return pill;
  });
  sound.setAttribute('aria-label', STRINGS.sound);
  hint.textContent = STRINGS.hint;
  hint.hidden = settings.tossed;

  function render(): void {
    tabs.dataset.tab = settings.tab;
    for (const button of tabButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.tab === settings.tab));
    }
    for (const pill of pills) {
      pill.setAttribute('aria-pressed', String(pill.dataset.die === settings.die));
    }
    tray.hidden = settings.tab !== 'dice';
    sound.setAttribute('aria-pressed', String(settings.sound));
  }

  function update(next: Partial<Settings>): void {
    settings = { ...settings, ...next };
    render();
    handlers.onChange(settings);
  }

  for (const button of tabButtons) {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab as Tab;
      if (tab !== settings.tab) update({ tab });
    });
  }
  for (const pill of pills) {
    pill.addEventListener('click', () => {
      const die = pill.dataset.die as DieKind;
      if (die !== settings.die) update({ die });
    });
  }
  sound.addEventListener('click', () => update({ sound: !settings.sound }));

  render();
  container.hidden = false;

  return {
    setLocked(locked) {
      for (const button of [...tabButtons, ...pills]) button.disabled = locked;
    },
    hideHint() {
      if (settings.tossed) return;
      hint.hidden = true;
      update({ tossed: true });
    },
  };
}
