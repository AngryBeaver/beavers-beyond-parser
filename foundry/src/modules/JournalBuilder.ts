import { ParsedChapter } from '../types.js';

interface JournalData {
  journalId: string;
  anchorToPageId: Map<string, string>;
}

export class JournalBuilder {
  static async build(
    adventureTitle: string,
    chapters: ParsedChapter[],
    monsterPathToActorId: Map<string, string>,
  ): Promise<void> {
    const folder = (await Folder.create({
      name: adventureTitle,
      type: 'JournalEntry',
      color: '#5b4a2e',
    })) as Folder;

    // Pass 1: create JournalEntries with 2-digit prefix, pre-generate page IDs
    const created: Array<{
      journal: JournalEntry;
      chapter: ParsedChapter;
      pageIds: string[];
    }> = [];

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      const journal = (await JournalEntry.create({
        name: `${String(i + 1).padStart(2, '0')} - ${chapter.title}`,
        folder: folder?.id ?? null,
        sort: (i + 1) * 100,
      })) as JournalEntry;
      if (!journal) continue;
      const pageIds = chapter.pages.map(() => foundry.utils.randomID());
      created.push({ journal, chapter, pageIds });
    }

    // Build slug → { journalId, anchor→pageId } for link rewriting
    const slugToData = new Map<string, JournalData>();
    for (const { journal, chapter, pageIds } of created) {
      const anchorToPageId = new Map<string, string>();
      chapter.pages.forEach((page, i) => {
        const norm = normalizeAnchor(page.name);
        if (norm) anchorToPageId.set(norm, pageIds[i]);
      });
      slugToData.set(chapter.slug, { journalId: journal.id, anchorToPageId });
    }

    // Pass 2: create pages with pre-assigned IDs and rewritten links
    for (const { journal, chapter, pageIds } of created) {
      if (chapter.pages.length === 0) continue;
      const pages = chapter.pages.map((page, i) => ({
        _id: pageIds[i],
        name: page.name || `Page ${i + 1}`,
        type: 'text',
        sort: (i + 1) * 100,
        text: {
          content: rewriteLinks(page.content, slugToData, monsterPathToActorId),
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
        },
      }));
      await JournalEntryPage.createDocuments(pages, { parent: journal });
    }

    ui.notifications?.info(`Imported "${adventureTitle}" — ${chapters.length} chapter(s) created.`);
  }
}

function normalizeAnchor(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function rewriteLinks(
  html: string,
  slugToData: Map<string, JournalData>,
  monsterPathToActorId: Map<string, string>,
): string {
  if (slugToData.size === 0 && monsterPathToActorId.size === 0) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;

  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    let pathname: string;
    let hash: string;
    try {
      if (href.startsWith('http')) {
        const u = new URL(href);
        pathname = u.pathname;
        hash = u.hash.slice(1);
      } else {
        const hashIdx = href.indexOf('#');
        if (hashIdx >= 0) {
          pathname = href.slice(0, hashIdx);
          hash = href.slice(hashIdx + 1);
        } else {
          pathname = href;
          hash = '';
        }
      }
    } catch {
      continue;
    }

    const text = a.textContent?.trim() ?? '';

    // Monster links: /monsters/...
    if (pathname.startsWith('/monsters/')) {
      const actorId = monsterPathToActorId.get(pathname);
      if (actorId) {
        a.replaceWith(doc.createTextNode(`@UUID[Actor.${actorId}]{${text}}`));
        changed = true;
      }
      continue;
    }

    // Chapter/page links: match by last URL segment
    const slug = pathname.split('/').filter(Boolean).pop() ?? '';
    if (!slug) continue;
    const data = slugToData.get(slug);
    if (!data) continue;

    if (hash) {
      const pageId = data.anchorToPageId.get(normalizeAnchor(hash));
      if (pageId) {
        a.replaceWith(
          doc.createTextNode(
            `@UUID[JournalEntry.${data.journalId}.JournalEntryPage.${pageId}]{${text}}`,
          ),
        );
      } else {
        a.replaceWith(doc.createTextNode(`@UUID[JournalEntry.${data.journalId}]{${text}}`));
      }
    } else {
      a.replaceWith(doc.createTextNode(`@UUID[JournalEntry.${data.journalId}]{${text}}`));
    }
    changed = true;
  }

  return changed ? doc.body.innerHTML : html;
}
