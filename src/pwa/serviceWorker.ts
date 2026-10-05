export interface Precache {
  /** Cache name; a new one per build, so an update never mixes files of two builds. */
  cacheName: string;
  /** The page's entry script; a page that does not load it belongs to another build. */
  entry: string;
  /** Content-hashed build files: safe to copy from an older cache instead of downloading again. */
  hashed: readonly string[];
  /** Files besides the page that keep their name across builds (manifests, icons): always fetched. */
  fresh: readonly string[];
}

/** Prefix of every cache this game owns; activation deletes the others with it. */
export const CACHE_PREFIX = 'flip-a-coin-';

/**
 * Source of `sw.js`. It precaches the whole build on install and answers cache-first, every page
 * load with the cached `./`, so the game runs offline after the first visit. Paths are relative to
 * the worker's scope.
 */
export function serviceWorkerSource({ cacheName, entry, hashed, fresh }: Precache): string {
  return `const CACHE = ${JSON.stringify(cacheName)};
const PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const ENTRY = ${JSON.stringify(entry)};
const HASHED = ${JSON.stringify(hashed)};
const FRESH = ${JSON.stringify(fresh)};
const scope = self.registration.scope;
const at = (path) => new URL(path, scope).href;

// A redirected page cannot answer a navigation, and a page without this build's entry script
// came from a stale cache in front of the server; either fails the install.
async function addPage(cache) {
  const page = await fetch(new Request(scope, { cache: 'reload' }));
  if (!page.ok || page.redirected || !(await page.clone().text()).includes(ENTRY)) {
    throw new Error('The page at ' + scope + ' is not from this build');
  }
  await cache.put(scope, page);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all([
        addPage(cache),
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
