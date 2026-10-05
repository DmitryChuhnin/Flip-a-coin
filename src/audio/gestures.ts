/**
 * Events that count as a user activation somewhere: Chromium on touch grants it on the release,
 * not on `pointerdown`, and Safari on `touchend` and `click`.
 */
export const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

/** Capture phase: `unlock` runs before the same tap reaches the canvas and starts the toss. */
export function unlockOnGestures(target: EventTarget, unlock: () => void): void {
  for (const type of GESTURE_EVENTS) target.addEventListener(type, unlock, { capture: true });
}
