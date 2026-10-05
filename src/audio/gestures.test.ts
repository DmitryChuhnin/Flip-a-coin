// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { GESTURE_EVENTS, unlockOnGestures } from './gestures';

describe('unlockOnGestures', () => {
  it('unlocks on every gesture event before the element under the tap handles it', () => {
    const order: string[] = [];
    const button = document.createElement('button');
    document.body.append(button);
    unlockOnGestures(window, () => order.push('unlock'));
    for (const type of GESTURE_EVENTS) {
      button.addEventListener(type, (event) => {
        // A handler that stops the event must not keep audio locked.
        event.stopPropagation();
        order.push(type);
      });
      button.dispatchEvent(new Event(type, { bubbles: true }));
    }
    expect(order).toEqual(GESTURE_EVENTS.flatMap((type) => ['unlock', type]));
    button.remove();
  });

  it('includes the touch release, where Chromium grants the activation', () => {
    expect(GESTURE_EVENTS).toEqual(expect.arrayContaining(['pointerup', 'touchend', 'click']));
    const unlock = vi.fn();
    const target = new EventTarget();
    unlockOnGestures(target, unlock);
    target.dispatchEvent(new Event('touchend'));
    expect(unlock).toHaveBeenCalledTimes(1);
  });
});
