import { describe, expect, it, vi } from 'vitest';
import { serviceWorkerSource, type Precache } from './serviceWorker';

const SCOPE = 'https://example.test/flip-a-coin/';

/** In-memory Cache Storage; a cached entry is the body text it was stored with. */
class FakeCaches {
  readonly stores = new Map<string, Map<string, string>>();

  constructor(private readonly download: (url: string) => Promise<string>) {}

  async open(name: string) {
    let store = this.stores.get(name);
    if (!store) this.stores.set(name, (store = new Map()));
    const urlOf = (input: string | Request) => (typeof input === 'string' ? input : input.url);
    return {
      add: async (input: string | Request) => {
        store.set(urlOf(input), await this.download(urlOf(input)));
      },
      put: async (url: string, body: string) => {
        store.set(url, body);
      },
      match: async (url: string) => store.get(url),
    };
  }

  async match(url: string) {
    for (const store of this.stores.values()) if (store.has(url)) return store.get(url);
    return undefined;
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name: string) {
    return this.stores.delete(name);
  }
}

type Handler = (event: Record<string, unknown>) => void;

function install(precache: Precache, caches: FakeCaches, network: (url: string) => string) {
  const handlers = new Map<string, Handler>();
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
  };
  const fetch = vi.fn(async (request: { url: string }) => network(request.url));
  new Function('self', 'caches', 'fetch', serviceWorkerSource(precache))(self, caches, fetch);

  async function run(type: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({
      waitUntil: (p: Promise<unknown>) => (pending = p),
      respondWith: (p: Promise<unknown>) => (pending = p),
      ...extra,
    });
    return pending;
  }
  return { run, fetch, handles: (type: string) => handlers.has(type) };
}

const BUILD: Precache = {
  cacheName: 'flip-a-coin-b2',
  hashed: ['assets/index-B.js', 'assets/three-A.js'],
  fresh: ['./', 'manifest.webmanifest'],
};

describe('serviceWorkerSource', () => {
  it('precaches the whole build on install', async () => {
    const downloads: string[] = [];
    const caches = new FakeCaches(async (url) => {
      downloads.push(url);
      return `new ${url}`;
    });
    const worker = install(BUILD, caches, () => 'network');
    await worker.run('install');
    expect(downloads.sort()).toEqual(
      [
        `${SCOPE}`,
        `${SCOPE}assets/index-B.js`,
        `${SCOPE}assets/three-A.js`,
        `${SCOPE}manifest.webmanifest`,
      ].sort(),
    );
  });

  it('reuses unchanged hashed files from the previous build but downloads the page again', async () => {
    const downloads: string[] = [];
    const caches = new FakeCaches(async (url) => {
      downloads.push(url);
      return `new ${url}`;
    });
    const old = await caches.open('flip-a-coin-b1');
    await old.put(`${SCOPE}assets/three-A.js`, 'old three');
    await old.put(`${SCOPE}`, 'old page');
    const worker = install(BUILD, caches, () => 'network');
    await worker.run('install');
    expect(downloads).not.toContain(`${SCOPE}assets/three-A.js`);
    expect(downloads).toContain(`${SCOPE}`);
    const fresh = caches.stores.get('flip-a-coin-b2')!;
    expect(fresh.get(`${SCOPE}assets/three-A.js`)).toBe('old three');
    expect(fresh.get(`${SCOPE}`)).toBe(`new ${SCOPE}`);
  });

  it('fails the install when a file cannot be downloaded, keeping the old worker', async () => {
    const caches = new FakeCaches(async (url) => {
      if (url.endsWith('three-A.js')) throw new TypeError('offline');
      return 'ok';
    });
    const worker = install(BUILD, caches, () => 'network');
    await expect(worker.run('install')).rejects.toThrow('offline');
  });

  it('deletes the older caches of this game on activation and leaves other caches alone', async () => {
    const caches = new FakeCaches(async () => 'ok');
    for (const name of ['flip-a-coin-b1', 'flip-a-coin-b2', 'someone-else'])
      await caches.open(name);
    const worker = install(BUILD, caches, () => 'network');
    await worker.run('activate');
    expect(await caches.keys()).toEqual(['flip-a-coin-b2', 'someone-else']);
  });

  it('serves the cached page for any navigation in scope and cached files cache-first', async () => {
    const caches = new FakeCaches(async (url) => `cached ${url}`);
    const worker = install(BUILD, caches, () => 'network');
    await worker.run('install');
    const get = (url: string, mode = 'cors') =>
      worker.run('fetch', { request: { url, method: 'GET', mode } });
    expect(await get(`${SCOPE}?lang=ru`, 'navigate')).toBe(`cached ${SCOPE}`);
    expect(await get(`${SCOPE}assets/three-A.js`)).toBe(`cached ${SCOPE}assets/three-A.js`);
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(await get(`${SCOPE}assets/missing.js`)).toBe('network');
  });

  it('leaves requests outside its scope and non-GET requests to the browser', async () => {
    const caches = new FakeCaches(async () => 'ok');
    const worker = install(BUILD, caches, () => 'network');
    const responded = vi.fn();
    for (const request of [
      { url: 'https://example.test/other/', method: 'GET', mode: 'navigate' },
      { url: `${SCOPE}api`, method: 'POST', mode: 'cors' },
    ]) {
      await worker.run('fetch', { request, respondWith: responded });
    }
    expect(responded).not.toHaveBeenCalled();
  });
});
