// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import PAGE from '../../index.html?raw';
import { bindControls } from './controls';

// The page markup without its entry script, which the test does not run.
const BODY = /<body>([\s\S]*)<\/body>/.exec(PAGE)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');

const byId = (id: string) => document.getElementById(id)!;
const pressed = (element: Element) => element.getAttribute('aria-pressed');
const tab = (name: string) =>
  document.querySelector<HTMLButtonElement>(`.tab[data-tab="${name}"]`)!;
const pill = (die: string) =>
  document.querySelector<HTMLButtonElement>(`.pill[data-die="${die}"]`)!;

function bind(settings: Partial<Settings> = {}) {
  const onChange = vi.fn();
  const controls = bindControls(document, { ...DEFAULT_SETTINGS, ...settings }, { onChange });
  return { controls, onChange };
}

beforeEach(() => {
  document.body.innerHTML = BODY;
});

describe('bindControls', () => {
  it('shows the controls with labels, the coin tab chosen and the tray hidden', () => {
    bind();
    expect(byId('controls').hidden).toBe(false);
    expect(tab('coin').textContent).toBe('Coin');
    expect(tab('dice').textContent).toBe('Dice');
    expect(pressed(tab('coin'))).toBe('true');
    expect(byId('tray').hidden).toBe(true);
    expect([...byId('tray').children].map((p) => p.textContent)).toEqual([
      'd4',
      'd6',
      'd8',
      'd10',
      'd12',
      'd20',
    ]);
    expect(byId('sound').getAttribute('aria-label')).toBe('Sound');
    expect(byId('hint').hidden).toBe(false);
  });

  it('opens the dice tab with the saved die and reports the change', () => {
    const { onChange } = bind({ die: 'd8' });
    tab('dice').click();
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tab: 'dice', die: 'd8' });
    expect(byId('tabs').dataset.tab).toBe('dice');
    expect(byId('tray').hidden).toBe(false);
    expect(pressed(pill('d8'))).toBe('true');
    expect(pressed(pill('d20'))).toBe('false');
  });

  it('reports nothing for a click on the tab or die already chosen', () => {
    const { onChange } = bind({ tab: 'dice', die: 'd6' });
    tab('dice').click();
    pill('d6').click();
    expect(onChange).not.toHaveBeenCalled();
    pill('d12').click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].die).toBe('d12');
  });

  it('toggles sound', () => {
    const { onChange } = bind({ sound: false });
    expect(pressed(byId('sound'))).toBe('false');
    byId('sound').click();
    expect(pressed(byId('sound'))).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, sound: true });
  });

  it('locks the tabs and dice but not the sound button', () => {
    const { controls, onChange } = bind({ tab: 'dice' });
    controls.setLocked(true);
    expect(tab('coin').disabled).toBe(true);
    expect(pill('d4').disabled).toBe(true);
    expect(byId('sound').hasAttribute('disabled')).toBe(false);
    tab('coin').click();
    expect(onChange).not.toHaveBeenCalled();
    controls.setLocked(false);
    tab('coin').click();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('hides the hint after the first toss and remembers it once', () => {
    const { controls, onChange } = bind();
    controls.hideHint();
    controls.hideHint();
    expect(byId('hint').hidden).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tossed: true });
  });

  it('keeps the hint hidden for a player who has tossed before', () => {
    bind({ tossed: true });
    expect(byId('hint').hidden).toBe(true);
  });

  it('throws when the page lacks a control', () => {
    byId('sound').remove();
    expect(() => bind()).toThrow('Missing #sound');
  });
});
