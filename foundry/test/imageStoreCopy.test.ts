import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal stand-ins for the Foundry user data directory and the proxy.
let files: Map<string, string>; // path → content marker
let dirs: Set<string>;
let downloads: string[];
let proxyOk: boolean;

const GOBLIN_V1 = 'https://www.dndbeyond.com/avatars/thumbnails/1/1/1000/1000/111.png';
const GOBLIN_V2 = 'https://www.dndbeyond.com/avatars/thumbnails/9/9/1000/1000/999.png';

async function loadStore() {
  vi.resetModules(); // a fresh module is a fresh browser session
  return (await import('../src/modules/ImageStore.js')).ImageStore;
}

beforeEach(() => {
  files = new Map();
  dirs = new Set();
  downloads = [];
  proxyOk = true;
  vi.useFakeTimers();

  const FilePicker = {
    async browse(_source: string, target: string) {
      if (target && !dirs.has(target)) throw new Error('Directory does not exist');
      const prefix = target ? `${target}/` : '';
      const direct = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/');
      return { dirs: [...dirs].filter(direct), files: [...files.keys()].filter(direct) };
    },
    async createDirectory(_source: string, target: string) {
      dirs.add(target);
    },
    async upload(_source: string, dir: string, file: File) {
      if (!dirs.has(dir)) return undefined;
      const path = `${dir}/${file.name}`;
      files.set(path, await file.text());
      return { path };
    },
  };

  vi.stubGlobal('foundry', {
    applications: { apps: { FilePicker: { implementation: FilePicker } } },
    utils: { getRoute: (p: string) => `/${p}` },
  });
  vi.stubGlobal('game', { settings: { get: () => 'http://proxy' } });
  vi.stubGlobal('ui', { notifications: { warn: vi.fn() } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('http://proxy/image')) {
        if (!proxyOk) throw new TypeError('Failed to fetch');
        const src = new URL(url).searchParams.get('url')!;
        downloads.push(src);
        return new Response(new Blob([`bytes of ${src}`], { type: 'image/png' }));
      }
      const stored = files.get(url.slice(1));
      return stored ? new Response(stored) : new Response('', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ImageStore.store', () => {
  it('copies an image into the folder of its entity', async () => {
    const store = await loadStore();
    const path = await store.store('monsters/16907-goblin', 'portrait', GOBLIN_V1);

    expect(path).toBe('beyond/monsters/16907-goblin/portrait.png');
    expect(files.get(path)).toBe(`bytes of ${GOBLIN_V1}`);
  });

  it('does not download or store an image twice, even in a later session', async () => {
    let store = await loadStore();
    const first = await store.store('monsters/16907-goblin', 'portrait', GOBLIN_V1);
    await store.store('monsters/16907-goblin', 'portrait', GOBLIN_V1);
    await vi.runAllTimersAsync(); // index is written

    store = await loadStore();
    const again = await store.store('monsters/16907-goblin', 'portrait', GOBLIN_V1);

    expect(again).toBe(first);
    expect(downloads).toEqual([GOBLIN_V1]);
    expect([...files.keys()].sort()).toEqual(['beyond/index.json', first]);
  });

  it('replaces the copy in place when D&D Beyond changed the image of the entity', async () => {
    let store = await loadStore();
    const first = await store.store('monsters/16907-goblin', 'portrait', GOBLIN_V1);
    await vi.runAllTimersAsync();

    store = await loadStore();
    const updated = await store.store('monsters/16907-goblin', 'portrait', GOBLIN_V2);

    expect(updated).toBe(first);
    expect(files.get(first)).toBe(`bytes of ${GOBLIN_V2}`);
    expect([...files.keys()].filter((f) => f.includes('goblin'))).toHaveLength(1);
  });

  it('keeps the remote link when the proxy is unavailable', async () => {
    proxyOk = false;
    const store = await loadStore();

    expect(await store.store('monsters/16907-goblin', 'portrait', GOBLIN_V1)).toBe(GOBLIN_V1);
    expect(await store.store('monsters/1-orc', 'portrait', GOBLIN_V2)).toBe(GOBLIN_V2);
    expect((globalThis as any).ui.notifications.warn).toHaveBeenCalledTimes(1);
  });

  it('leaves images that are already local untouched', async () => {
    const store = await loadStore();
    expect(await store.store('monsters/x', 'portrait', 'beyond/monsters/x/portrait.png')).toBe(
      'beyond/monsters/x/portrait.png',
    );
    expect(downloads).toEqual([]);
  });
});
