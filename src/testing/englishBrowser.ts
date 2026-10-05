// Node reports the machine's locale; unit tests check English text whatever it is.
Object.defineProperty(globalThis.navigator, 'languages', { value: ['en-US'], configurable: true });
