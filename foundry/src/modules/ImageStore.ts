import { NAMESPACE, SETTINGS } from '../definitions.js';

/** Folder inside the Foundry user data directory that holds every local image copy. */
export const IMAGE_ROOT = 'beyond';

const INDEX_FILE = 'index.json';
const DDB_ORIGIN = 'https://www.dndbeyond.com';
const IMAGE_URL_RE = /\.(?:jpe?g|png|webp|gif|svg|avif)$/i;
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};
// After the proxy itself failed, skip further downloads for a while instead of failing once per image.
const PROXY_RETRY_MS = 60_000;
const PARALLEL_DOWNLOADS = 4;

// ── Pure helpers (no Foundry globals — unit tested) ───────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Absolute URL of a remote image, or null when the reference is already local (or inline). */
export function remoteUrl(url: string): string | null {
  const u = url.trim();
  if (u.startsWith('//')) return `https:${u}`;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return DDB_ORIGIN + u;
  return null;
}

function pathSegments(url: string): string[] {
  let pathname = url.split(/[?#]/)[0];
  try {
    if (/^https?:\/\//i.test(url)) pathname = new URL(url).pathname;
  } catch {
    // keep the raw string
  }
  return pathname.split('/').filter(Boolean);
}

/** True when a link target is an image file (lightbox links to full-size maps and handouts). */
export function isImageUrl(url: string): boolean {
  return IMAGE_URL_RE.test(pathSegments(url).pop() ?? '');
}

/** File name of an image URL without directories and extension, e.g. "map-1-1-cragmaw-hideout". */
export function imageBaseName(url: string): string {
  const file = pathSegments(url).pop() ?? '';
  return slugify(decodeURIComponent(file).replace(/\.[a-z0-9]+$/i, '')) || 'image';
}

/**
 * Storage folder of a monster. D&D Beyond gives every version of a creature its own id
 * ("/monsters/16907-goblin" vs "/monsters/5195047-goblin-warrior"), so the id + slug is the
 * entity — unlike the image file name, which changes whenever the art is replaced.
 */
export function monsterEntity(hrefOrUrl: string, name: string): string {
  const segments = pathSegments(hrefOrUrl);
  const idx = segments.indexOf('monsters');
  const slug = idx >= 0 ? slugify(segments[idx + 1] ?? '') : '';
  return `monsters/${slug || slugify(name) || 'unknown'}`;
}

/**
 * Storage folder of a sourcebook / adventure. D&D Beyond serves the same book under
 * ".../sources/dnd/lmop" and ".../sources/lmop", so only the book's own slug is used.
 */
export function sourceEntity(url: string, title: string): string {
  const segments = pathSegments(url);
  const idx = segments.indexOf('sources');
  const slug = idx >= 0 && segments.length > idx + 1 ? slugify(segments[segments.length - 1]) : '';
  return `sources/${slug || slugify(title) || 'unknown'}`;
}

/**
 * Storage location of a spell image. Most spells only show their school icon, which is shared
 * by every spell of that school and therefore stored once instead of once per spell.
 */
export function spellImageTarget(spellName: string, url: string): { entity: string; name: string } {
  if (/\/spell-schools\//i.test(url)) return { entity: 'spells/schools', name: imageBaseName(url) };
  return { entity: `spells/${slugify(spellName) || 'unknown'}`, name: 'icon' };
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface IndexEntry {
  /** Remote URL the stored file was downloaded from. */
  src: string;
  /** Path of the local copy, relative to the user data directory. */
  path: string;
}

class ProxyError extends Error {}

function filePicker(): any {
  return (
    (foundry as any).applications?.apps?.FilePicker?.implementation ??
    (globalThis as any).FilePicker
  );
}

/**
 * Copies D&D Beyond images into the Foundry user data directory (`beyond/…`) so imported
 * content works offline and on the canvas (remote DDB images carry no CORS headers and cannot
 * be used as token textures).
 *
 * Every image is stored under the entity it belongs to, never under its remote file name, and
 * `beyond/index.json` remembers which remote URL each copy came from:
 *   • same entity + same URL  → the existing copy is reused, nothing is downloaded
 *   • same entity + new URL   → DDB replaced the art; the copy is overwritten in place
 */
export class ImageStore {
  private static index: Promise<Record<string, IndexEntry>> | null = null;
  private static pending = new Map<string, Promise<string>>();
  private static listings = new Map<string, Promise<Set<string>>>();
  private static saveTimer: ReturnType<typeof setTimeout> | null = null;
  private static proxyDownUntil = 0;

  /**
   * Return the local path for `url`, downloading it first if needed.
   * Falls back to the remote URL when the copy cannot be made, so imports never fail on images.
   */
  static async store(entity: string, name: string, url: string): Promise<string> {
    const src = remoteUrl(url);
    if (!src) return url;

    const key = `${entity}/${name}`;
    const running = ImageStore.pending.get(key);
    if (running) return running;

    const task = ImageStore.storeUncached(key, entity, name, src)
      .catch((err: Error) => {
        if (err instanceof ProxyError) {
          if (Date.now() >= ImageStore.proxyDownUntil) {
            ui.notifications?.warn(
              `${NAMESPACE}: images are not copied locally — ${err.message}. Keeping D&D Beyond links.`,
            );
          }
          ImageStore.proxyDownUntil = Date.now() + PROXY_RETRY_MS;
        } else {
          console.warn(`${NAMESPACE} | could not copy image ${src}:`, err.message);
        }
        return src;
      })
      .finally(() => ImageStore.pending.delete(key));
    ImageStore.pending.set(key, task);
    return task;
  }

  /**
   * Copy every remote image referenced by an HTML fragment (`<img>` sources and links to image
   * files) and return the HTML pointing at the local copies.
   *
   * `claims` maps "name → remote URL" for one import run, so two different images that happen to
   * share a file name do not overwrite each other.
   */
  static async localizeHtml(
    html: string,
    entity: string,
    claims: Map<string, string> = new Map(),
  ): Promise<string> {
    if (!/<img|<a/i.test(html)) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const targets: Array<{ el: Element; attr: string; src: string }> = [];
    for (const img of Array.from(doc.querySelectorAll('img[src]'))) {
      const src = remoteUrl(img.getAttribute('src') ?? '');
      if (src) targets.push({ el: img, attr: 'src', src });
    }
    for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? '';
      const src = isImageUrl(href) ? remoteUrl(href) : null;
      if (src) targets.push({ el: a, attr: 'href', src });
    }
    if (targets.length === 0) return html;

    const nameBySrc = new Map<string, string>();
    for (const { src } of targets) {
      if (nameBySrc.has(src)) continue;
      const base = imageBaseName(src);
      let name = base;
      for (let n = 2; claims.has(name) && claims.get(name) !== src; n++) name = `${base}-${n}`;
      claims.set(name, src);
      nameBySrc.set(src, name);
    }

    const localBySrc = new Map<string, string>();
    const queue = Array.from(nameBySrc);
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        localBySrc.set(next[0], await ImageStore.store(entity, next[1], next[0]));
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));

    for (const { el, attr, src } of targets) {
      el.setAttribute(attr, localBySrc.get(src) ?? src);
      // responsive variants would still point at D&D Beyond
      if (attr === 'src') el.removeAttribute('srcset');
    }
    return doc.body.innerHTML;
  }

  private static async storeUncached(
    key: string,
    entity: string,
    name: string,
    src: string,
  ): Promise<string> {
    const index = await ImageStore.loadIndex();
    const known = index[key];
    if (known?.src === src) return known.path;

    if (Date.now() < ImageStore.proxyDownUntil) return src;
    // One retry: a single image occasionally fails while many are fetched in parallel.
    const blob = await ImageStore.download(src).catch((err) => {
      if (err instanceof ProxyError) throw err;
      return ImageStore.download(src);
    });
    const ext = EXT_BY_MIME[blob.type.split(';')[0].trim()] ?? 'png';

    const dir = `${IMAGE_ROOT}/${entity}`;
    const path = await ImageStore.upload(
      dir,
      new File([blob], `${name}.${ext}`, { type: blob.type }),
    );
    index[key] = { src, path };
    ImageStore.scheduleIndexSave();
    return path;
  }

  private static async download(src: string): Promise<Blob> {
    const proxyUrl = ((game.settings.get(NAMESPACE, SETTINGS.PROXY_URL) ?? '') as string).replace(
      /\/$/,
      '',
    );
    if (!proxyUrl) throw new ProxyError('proxy URL not set');

    let response: Response;
    try {
      response = await fetch(`${proxyUrl}/image?url=${encodeURIComponent(src)}`);
    } catch {
      throw new ProxyError('proxy not reachable');
    }
    if (!response.ok) {
      let msg = `proxy returned ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) msg = body.error;
      } catch {}
      // The router's own 404: a proxy container built before the /image endpoint existed.
      if (response.status === 404 && msg === 'Not found') {
        throw new ProxyError('the proxy container is outdated (no /image endpoint), update it');
      }
      throw new Error(msg);
    }
    return response.blob();
  }

  // ── Foundry file access ─────────────────────────────────────────────────────

  private static async upload(dir: string, file: File): Promise<string> {
    await ImageStore.ensureDir(dir);
    const result = await filePicker().upload('data', dir, file, {}, { notify: false });
    if (!result?.path) throw new Error(`upload to ${dir}/${file.name} failed`);
    return result.path as string;
  }

  /** Directory names inside `dir`; empty when `dir` does not exist. */
  private static listDirs(dir: string): Promise<Set<string>> {
    let listing = ImageStore.listings.get(dir);
    if (!listing) {
      listing = filePicker()
        .browse('data', dir)
        .then((r: { dirs?: string[] }) => new Set((r.dirs ?? []).map((d) => decodeURIComponent(d))))
        .catch(() => new Set<string>());
      ImageStore.listings.set(dir, listing!);
    }
    return listing!;
  }

  private static async ensureDir(dir: string): Promise<void> {
    let parent = '';
    for (const segment of dir.split('/')) {
      const path = parent ? `${parent}/${segment}` : segment;
      const siblings = await ImageStore.listDirs(parent);
      if (!siblings.has(path)) {
        siblings.add(path);
        try {
          await filePicker().createDirectory('data', path);
        } catch (err: any) {
          // created concurrently (or by another GM) — anything else surfaces on upload
          if (!/EEXIST|exist/i.test(err?.message ?? '')) throw err;
        }
      }
      parent = path;
    }
  }

  // ── Index ───────────────────────────────────────────────────────────────────

  private static loadIndex(): Promise<Record<string, IndexEntry>> {
    ImageStore.index ??= (async () => {
      try {
        const listing = await filePicker().browse('data', IMAGE_ROOT);
        const file = ((listing.files ?? []) as string[]).find((f) => f.endsWith(`/${INDEX_FILE}`));
        if (!file) return {};
        const response = await fetch(foundry.utils.getRoute(file), { cache: 'no-store' });
        return response.ok ? ((await response.json()) as Record<string, IndexEntry>) : {};
      } catch {
        return {}; // no "beyond" folder yet
      }
    })();
    return ImageStore.index;
  }

  private static scheduleIndexSave(): void {
    if (ImageStore.saveTimer) clearTimeout(ImageStore.saveTimer);
    ImageStore.saveTimer = setTimeout(() => {
      ImageStore.saveTimer = null;
      void ImageStore.saveIndex();
    }, 1000);
  }

  private static async saveIndex(): Promise<void> {
    try {
      const json = JSON.stringify(await ImageStore.loadIndex(), null, 1);
      await ImageStore.upload(
        IMAGE_ROOT,
        new File([json], INDEX_FILE, { type: 'application/json' }),
      );
    } catch (err: any) {
      console.warn(`${NAMESPACE} | could not save ${IMAGE_ROOT}/${INDEX_FILE}:`, err?.message);
    }
  }
}
