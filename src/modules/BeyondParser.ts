import { ParsedAdventure, ParsedChapter, ParsedSection } from '../types.js';

export class BeyondParser {
  static parse(html: string, url: string): ParsedAdventure {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const title =
      doc.querySelector('.source-introduction h1, h1.page-title, h1')?.textContent?.trim() ??
      'Unknown Adventure';

    const description =
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';

    // DDB wraps adventure content in one of these containers
    const contentRoot =
      doc.querySelector('.p-article-content') ??
      doc.querySelector('[class*="content-container"]') ??
      doc.querySelector('main article') ??
      doc.body;

    return {
      title,
      url,
      description,
      chapters: this.parseChapters(contentRoot),
    };
  }

  private static parseChapters(root: Element): ParsedChapter[] {
    const chapters: ParsedChapter[] = [];
    let chapter: ParsedChapter | null = null;
    let section: ParsedSection | null = null;
    let buf = '';

    const pushSection = () => {
      if (section && chapter) {
        section.content = buf;
        chapter.sections.push(section);
        section = null;
        buf = '';
      }
    };

    const pushChapter = () => {
      pushSection();
      if (chapter) chapters.push(chapter);
      chapter = null;
    };

    for (const node of Array.from(root.children)) {
      const tag = node.tagName;

      if (tag === 'H1') {
        pushChapter();
        const chapterTitle = node.textContent?.trim() ?? '';
        chapter = { title: chapterTitle, slug: slugify(chapterTitle), sections: [] };
      } else if (tag === 'H2') {
        pushSection();
        if (!chapter) {
          // content before the first H1 — create an implicit intro chapter
          chapter = { title: title(root), slug: 'introduction', sections: [] };
        }
        const sectionTitle = node.textContent?.trim() ?? '';
        section = { title: sectionTitle, content: '' };
      } else {
        if (!chapter) {
          chapter = { title: title(root), slug: 'introduction', sections: [] };
        }
        if (!section) {
          section = { title: '', content: '' };
        }
        buf += node.outerHTML;
      }
    }

    pushChapter();
    return chapters;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function title(root: Element): string {
  return root.closest('article')?.querySelector('h1')?.textContent?.trim() ?? 'Introduction';
}
