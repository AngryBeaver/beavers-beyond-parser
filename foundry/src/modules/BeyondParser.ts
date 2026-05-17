import {
  ParsedAdventure,
  ChapterStub,
  ParsedChapter,
  ParsedPage,
  ParsedStatBlock,
} from '../types.js';
import { StatBlockParser } from './StatBlockParser.js';

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
    const statBlocks: ParsedStatBlock[] = [];
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
        // Include H1 only when its text differs from the page name (avoids redundant title)
        if ((node.textContent?.trim() ?? '') !== currentName) buf += node.outerHTML;
      } else if (tag === 'H2' && started) {
        pushPage();
        currentName = node.textContent?.trim() ?? '';
        // H2 text always equals the new page name — skip it to avoid duplication
      } else if (started) {
        const htmlNode = node as HTMLElement;
        let sb = null;
        if (htmlNode.classList?.contains('stat-block-background')) {
          sb = StatBlockParser.parse(htmlNode);
        } else if (
          htmlNode.classList?.contains('more-info') &&
          htmlNode.querySelector('.mon-stat-block')
        ) {
          sb = StatBlockParser.parseMon(htmlNode);
        }
        if (sb) {
          statBlocks.push(sb);
          buf += sb.cleanHtml;
        } else {
          buf += node.outerHTML;
        }
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
