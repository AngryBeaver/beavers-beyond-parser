import { ParsedAdventure, ChapterStub, ParsedChapter, ParsedPage, MonsterRef } from '../types.js';

export class BeyondParser {
  static parseToc(html: string, url: string): ParsedAdventure {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const title =
      doc.querySelector('.source-introduction h1, h1.page-title, h1')?.textContent?.trim() ??
      'Unknown Adventure';
    const description =
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';

    let base = 'https://www.dndbeyond.com';
    try {
      base = new URL(url).origin;
    } catch {}

    const stubs: ChapterStub[] = [];
    for (const a of Array.from(doc.querySelectorAll('.compendium-toc-full-text h3 a'))) {
      const href = a.getAttribute('href');
      if (!href) continue;
      stubs.push({
        title: a.textContent?.trim() ?? '',
        url: new URL(href, base).href,
      });
    }

    return { title, url, description, chapterStubs: stubs };
  }

  static parseChapter(html: string): ParsedChapter {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const contentRoot =
      doc.querySelector('.p-article-content') ??
      doc.querySelector('[class*="content-container"]') ??
      doc.querySelector('main article') ??
      doc.body;

    const pages: ParsedPage[] = [];
    const statBlocks: MonsterRef[] = [];
    let currentName = 'Overview';
    let buf = '';
    let started = false;

    const pushPage = () => {
      if (buf.trim()) pages.push({ name: currentName, content: buf });
      buf = '';
    };

    for (const node of Array.from(contentRoot.children)) {
      const tag = node.tagName;
      if (tag === 'H1') {
        started = true;
        currentName = 'Overview';
        if ((node.textContent?.trim() ?? '') !== currentName) buf += node.outerHTML;
      } else if (tag === 'H2' && started) {
        pushPage();
        currentName = node.textContent?.trim() ?? '';
      } else if (started) {
        const htmlNode = node as HTMLElement;
        // Extract monster ref (name + href) from inline stat blocks — never parse them
        // for actor creation; the canonical /monsters/ page is used instead.
        if (htmlNode.classList?.contains('stat-block-background')) {
          const name =
            htmlNode.querySelector('[class*="Stat-Block-Title"]')?.textContent?.trim() ?? '';
          const monsterHref =
            htmlNode.querySelector('[class*="Stat-Block-Title"] a')?.getAttribute('href') ?? '';
          if (name && monsterHref) statBlocks.push({ name, monsterHref });
        } else if (
          htmlNode.classList?.contains('more-info') &&
          htmlNode.querySelector('.mon-stat-block')
        ) {
          const name =
            htmlNode
              .querySelector('.mon-stat-block__name-link, .mon-stat-block__name')
              ?.textContent?.trim() ?? '';
          const monsterHref =
            htmlNode
              .querySelector<HTMLAnchorElement>('.mon-stat-block__name-link')
              ?.getAttribute('href') ?? '';
          if (name && monsterHref) statBlocks.push({ name, monsterHref });
        }
        buf += node.outerHTML;
      }
    }
    pushPage();

    const chapterTitle = doc.querySelector('h1')?.textContent?.trim() ?? '';

    // Prefer the canonical URL's last segment — DDB drops apostrophes differently than slugify
    // e.g. "Zikran's" → URL slug "zikrans", but slugify gives "zikran-s"
    const canonical =
      doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
      doc.querySelector('meta[property="og:url"]')?.getAttribute('content');
    const slug = canonical
      ? (canonical.split('/').filter(Boolean).pop() ?? slugify(chapterTitle))
      : slugify(chapterTitle);

    return { title: chapterTitle, slug, pages, statBlocks };
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
