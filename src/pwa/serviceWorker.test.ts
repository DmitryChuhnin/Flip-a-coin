import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_TIMEOUT_MS, serviceWorkerSource, type Precache } from './serviceWorker';

const SCOPE = 'https://example.test/flip-a-coin/';
const PAGE = '<script type="module" src="/flip-a-coin/assets/index-B.js"></script>';

interface Download {
  url: string;
  mode: RequestCache | undefined;
}

/** A server: the page, then any other path as `new <url>`; `redirect` and `fail` per URL. */
function server(page = PAGE, { redirect = '', fail = '' } = {}) {
  const downloads: Download[] = [];
  const get = async (input: string | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url;
    downloads.push({ url, mode: typeof input === 'string' ? undefined : input.cache });
    if (url === fail) throw new TypeError('offline');
    const response = new Response(url === SCOPE ? page : `new ${url}`);
    if (url === redirect) Object.defineProperty(response, 'redirected', { value: true });
    return response;
  };
  return { get, downloads };
}

/** In-memory Cache Storage; an entry is the body text it was stored with. */
class FakeCaches {
  readonly stores = new Map<string, Map<string, string>>();

  constructor(private readonly get: (input: string | Request) => Promise<Response>) {}

  async open(name: string) {
    let store = this.stores.get(name);
    if (!store) this.stores.set(name, (store = new Map()));
    const urlOf = (input: string | Request) => (typeof input === 'string' ? input : input.url);
    const text = async (value: string | Response) =>
      typeof value === 'string' ? value : value.text();
    return {
      add: async (input: string | Request) => {
        store.set(urlOf(input), await (await this.get(input)).text());
      },
      put: async (url: string, value: string | Response) => {
        store.set(url, await text(value));
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

function install(precache: Precache, network = server()) {
  const handlers = new Map<string, Handler>();
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
  };
  const caches = new FakeCaches(network.get);
  const fetch = vi.fn(network.get);
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
  return { run, fetch, caches, downloads: network.downloads };
}

const BUILD: Precache = {
  cacheName: 'flip-a-coin-b2',
  entry: 'assets/index-B.js',
  hashed: ['assets/index-B.js', 'assets/three-A.js'],
  fresh: ['manifest.webmanifest'],
};

describe('serviceWorkerSource', () => {
  it('precaches the whole build on install, the page and the manifest past the HTTP cache', async () => {
    const worker = install(BUILD);
    await worker.run('install');
    const downloads = worker.downloads.map(({ url }) => url).sort();
    expect(downloads).toEqual(
      [
        SCOPE,
        `${SCOPE}assets/index-B.js`,
        `${SCOPE}assets/three-A.js`,
        `${SCOPE}manifest.webmanifest`,
      ].sort(),
    );
    for (const { url, mode } of worker.downloads) {
      if (url === SCOPE || url.endsWith('.webmanifest')) expect(mode).toBe('reload');
    }
    expect(worker.caches.stores.get('flip-a-coin-b2')!.get(SCOPE)).toBe(PAGE);
  });

  it('reuses unchanged hashed files from the previous build but downloads the page again', async () => {
    const worker = install(BUILD);
    const old = await worker.caches.open('flip-a-coin-b1');
    await old.put(`${SCOPE}assets/three-A.js`, 'old three');
    await old.put(SCOPE, 'old page');
    await worker.run('install');
    const downloads = worker.downloads.map(({ url }) => url);
    expect(downloads).not.toContain(`${SCOPE}assets/three-A.js`);
    const fresh = worker.caches.stores.get('flip-a-coin-b2')!;
    expect(fresh.get(`${SCOPE}assets/three-A.js`)).toBe('old three');
    expect(fresh.get(SCOPE)).toBe(PAGE);
  });

  it('fails the install when a file cannot be downloaded, keeping the old worker', async () => {
    const worker = install(BUILD, server(PAGE, { fail: `${SCOPE}assets/three-A.js` }));
    await expect(worker.run('install')).rejects.toThrow('offline');
  });

  it('fails the install for a redirected page or a page of another build', async () => {
    const redirected = install(BUILD, server(PAGE, { redirect: SCOPE }));
    await expect(redirected.run('install')).rejects.toThrow('not from this build');
    const stale = install(BUILD, server(PAGE.replace('index-B', 'index-A')));
    await expect(stale.run('install')).rejects.toThrow('not from this build');
  });

  it('deletes the older caches of this game on activation and leaves other caches alone', async () => {
    const worker = install(BUILD);
    for (const name of ['flip-a-coin-b1', 'flip-a-coin-b2', 'someone-else']) {
      await worker.caches.open(name);
    }
    await worker.run('activate');
    expect(await worker.caches.keys()).toEqual(['flip-a-coin-b2', 'someone-else']);
  });

  it('answers files cache-first and downloads only the ones it lacks', async () => {
    const worker = install(BUILD);
    await worker.run('install');
    worker.fetch.mockClear();
    const get = (url: string) =>
      worker.run('fetch', { request: { url, method: 'GET', mode: 'cors' } });
    expect(await get(`${SCOPE}assets/three-A.js`)).toBe(`new ${SCOPE}assets/three-A.js`);
    expect(worker.fetch).not.toHaveBeenCalled();
    const missing = await get(`${SCOPE}assets/missing.js`);
    expect(await (missing as Response).text()).toBe(`new ${SCOPE}assets/missing.js`);
  });

  describe('page loads', () => {
    const NEXT_PAGE = PAGE.replace('index-B', 'index-C');
    const open = (worker: ReturnType<typeof install>, url = `${SCOPE}?lang=ru`) =>
      worker.run('fetch', { request: { url, method: 'GET', mode: 'navigate' } });
    const text = async (answer: unknown) =>
      typeof answer === 'string' ? answer : (answer as Response).text();

    afterEach(() => {
      vi.useRealTimers();
    });

    it('take the page from the network, so a deploy shows at the next launch, and keep it out of the cache', async () => {
      const worker = install(BUILD);
      await worker.run('install');
      worker.fetch.mockImplementation(async () => new Response(NEXT_PAGE));
      expect(await text(await open(worker))).toBe(NEXT_PAGE);
      expect(worker.fetch).toHaveBeenLastCalledWith(
        expect.objectContaining({ url: `${SCOPE}?lang=ru`, mode: 'navigate' }),
      );
      expect(worker.caches.stores.get('flip-a-coin-b2')!.get(SCOPE)).toBe(PAGE);
    });

    it('fall back to the cached page offline, on an error status and on a redirect', async () => {
      const worker = install(BUILD);
      await worker.run('install');
      worker.fetch.mockRejectedValueOnce(new TypeError('offline'));
      expect(await open(worker)).toBe(PAGE);
      worker.fetch.mockResolvedValueOnce(new Response('down', { status: 503 }));
      expect(await open(worker)).toBe(PAGE);
      const redirect = { ok: false, status: 0, type: 'opaqueredirect' } as Response;
      worker.fetch.mockResolvedValueOnce(redirect);
      expect(await open(worker)).toBe(PAGE);
    });

    it('fall back to the cached page when the network is silent for the timeout', async () => {
      vi.useFakeTimers();
      const worker = install(BUILD);
      await worker.run('install');
      worker.fetch.mockReturnValueOnce(new Promise(() => {}));
      let answer: unknown = 'pending';
      void open(worker).then((value) => (answer = value));
      await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS - 1);
      expect(answer).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toBe(PAGE);
    });

    it('pass the network answer through when no page is cached', async () => {
      const worker = install(BUILD);
      worker.fetch.mockResolvedValueOnce(new Response('missing', { status: 404 }));
      expect(((await open(worker)) as Response).status).toBe(404);
      worker.fetch.mockRejectedValueOnce(new TypeError('offline'));
      await expect(open(worker)).rejects.toThrow('offline');
    });
  });

  it('leaves requests outside its scope and non-GET requests to the browser', async () => {
    const worker = install(BUILD);
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
