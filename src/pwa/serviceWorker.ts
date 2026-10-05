export interface Precache {
  /** Cache name; a new one per build, so an update never mixes files of two builds. */
  cacheName: string;
  /** Content-hashed build files: safe to copy from an older cache instead of downloading again. */
  hashed: readonly string[];
  /** Files that keep their name across builds (the page, the manifest, icons): always fetched. */
  fresh: readonly string[];
}

/** Prefix of every cache this game owns; activation deletes the others with it. */
export const CACHE_PREFIX = 'flip-a-coin-';

/**
 * Source of `sw.js`. It precaches the whole build on install and answers cache-first, every page
 * load with the cached `./`, so the game runs offline after the first visit. Paths are relative to
 * the worker's scope.
 */
export function serviceWorkerSource({ cacheName, hashed, fresh }: Precache): string {
  return `const CACHE = ${JSON.stringify(cacheName)};
const PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const HASHED = ${JSON.stringify(hashed)};
const FRESH = ${JSON.stringify(fresh)};
const scope = self.registration.scope;
const at = (path) => new URL(path, scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all([
        ...HASHED.map(async (path) => {
          const kept = await caches.match(at(path));
          await (kept ? cache.put(at(path), kept) : cache.add(at(path)));
        }),
        ...FRESH.map((path) => cache.add(new Request(at(path), { cache: 'reload' }))),
      ]),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  const key = request.mode === 'navigate' ? scope : request.url;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(key))
      .then((hit) => hit || fetch(request)),
  );
});
`;
}
