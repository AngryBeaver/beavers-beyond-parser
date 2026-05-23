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
    spellNameToItemId: Map<string, string> = new Map(),
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

    // Build slug → { journalId, anchor→pageId } for link rewriting.
    // anchorToPageId covers:
    //   • H2 headings (become page-name anchors via normalizeAnchor(page.name))
    //   • Every [id] attribute found anywhere in the page content HTML
    //     (covers H3/H4/… anchors that DDB embeds in the adventure text)
    const slugToData = new Map<string, JournalData>();
    for (const { journal, chapter, pageIds } of created) {
      const anchorToPageId = new Map<string, string>();
      chapter.pages.forEach((page, i) => {
        // H2-level: map the page name itself
        const norm = normalizeAnchor(page.name);
        if (norm) anchorToPageId.set(norm, pageIds[i]);

        // Sub-H2: scan all id attributes in the page's HTML content
        const pageDoc = new DOMParser().parseFromString(page.content, 'text/html');
        for (const el of Array.from(pageDoc.querySelectorAll('[id]'))) {
          const id = el.getAttribute('id');
          if (id) anchorToPageId.set(normalizeAnchor(id), pageIds[i]);
        }
      });
      slugToData.set(chapter.slug, { journalId: journal.id, anchorToPageId });
    }

    // Pass 2: create pages with pre-assigned IDs and rewritten links
    for (const { journal, chapter, pageIds } of created) {
      if (chapter.pages.length === 0) continue;
      const chapterData = slugToData.get(chapter.slug);
      const pages = chapter.pages.map((page, i) => ({
        _id: pageIds[i],
        name: page.name || `Page ${i + 1}`,
        type: 'text',
        sort: (i + 1) * 100,
        text: {
          content: rewriteLinks(
            page.content,
            slugToData,
            monsterPathToActorId,
            spellNameToItemId,
            chapterData,
          ),
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
        },
      }));
      await JournalEntryPage.createDocuments(pages, { parent: journal });
    }

    ui.notifications?.info(`Imported "${adventureTitle}" — ${chapters.length} chapter(s) created.`);
  }
}

/**
 * Convert a DDB .stat-block-background element into clean, readable HTML
 * suitable for a Foundry journal page.  Used when the corresponding actor
 * was not imported (so @Embed is not available).
 */
function renderStatBlock(el: Element): string {
  const parts: string[] = ['<section class="stat-block">'];
  let sectionDividerAdded = false;

  for (const child of Array.from(el.children)) {
    const cls = child.className ?? '';

    if (cls.includes('Stat-Block-Title')) {
      parts.push(`<h4>${child.textContent?.trim() ?? ''}</h4>`);
    } else if (cls.includes('Stat-Block-Metadata')) {
      parts.push(`<p><em>${child.textContent?.trim() ?? ''}</em></p><hr>`);
    } else if ((child as HTMLElement).classList?.contains('stat-block-ability-scores')) {
      const stats = Array.from(child.querySelectorAll('.stat-block-ability-scores-stat'));
      if (stats.length > 0) {
        const ths = stats
          .map(
            (s) =>
              `<th>${s.querySelector('.stat-block-ability-scores-heading')?.textContent?.trim() ?? ''}</th>`,
          )
          .join('');
        const tds = stats
          .map((s) => {
            const score =
              s.querySelector('.stat-block-ability-scores-score')?.textContent?.trim() ?? '';
            const mod =
              s.querySelector('.stat-block-ability-scores-modifier')?.textContent?.trim() ?? '';
            return `<td>${score} ${mod}</td>`;
          })
          .join('');
        parts.push(
          `<table><thead><tr>${ths}</tr></thead><tbody><tr>${tds}</tr></tbody></table><hr>`,
        );
      }
    } else if (cls.includes('Stat-Block-Heading')) {
      if (!sectionDividerAdded) {
        parts.push('<hr>');
        sectionDividerAdded = true;
      }
      parts.push(`<p><strong>${child.textContent?.trim() ?? ''}</strong></p>`);
    } else if (cls.includes('Stat-Block-Data')) {
      // innerHTML preserved — spell/monster links inside are rewritten by Pass 2
      parts.push(`<p>${child.innerHTML}</p>`);
    } else if (cls.includes('Stat-Block-Body') || cls.includes('Stat-Block-Hanging')) {
      parts.push(`<p>${child.innerHTML}</p>`);
    }
  }

  parts.push('</section>');
  return parts.join('\n');
}

function normalizeAnchor(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Look up a link anchor in the page-id map.
 * Exact match first; then prefix match where the next char is a letter —
 * this handles DDB's pattern of short anchors (#M1) that are prefixes of the
 * full heading id (M1FoyerandHallway) without false-matching #M1 → M10Kitchen.
 */
function lookupAnchor(anchorToPageId: Map<string, string>, anchor: string): string | undefined {
  const norm = normalizeAnchor(anchor);
  const exact = anchorToPageId.get(norm);
  if (exact) return exact;
  for (const [key, pageId] of anchorToPageId) {
    if (key.startsWith(norm) && key.length > norm.length && /^[a-z]/.test(key[norm.length])) {
      return pageId;
    }
  }
  return undefined;
}

function rewriteLinks(
  html: string,
  slugToData: Map<string, JournalData>,
  monsterPathToActorId: Map<string, string>,
  spellNameToItemId: Map<string, string>,
  currentChapterData?: JournalData,
): string {
  if (slugToData.size === 0 && monsterPathToActorId.size === 0 && spellNameToItemId.size === 0)
    return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;

  // Pass 1: inline stat blocks — must run before anchor rewriting so the title
  // link hasn't been replaced yet, and so any links inside the rendered HTML
  // are picked up by the anchor pass below.
  for (const div of Array.from(
    doc.querySelectorAll<HTMLElement>('.stat-block-background, .more-info'),
  )) {
    const isStatBlock = div.classList.contains('stat-block-background');
    const isMonsterMoreInfo =
      !isStatBlock && div.classList.contains('more-info') && !!div.querySelector('.mon-stat-block');
    if (!isStatBlock && !isMonsterMoreInfo) continue;

    const titleLink =
      div.querySelector<HTMLAnchorElement>('[class*="Stat-Block-Title"] a') ??
      div.querySelector<HTMLAnchorElement>('.mon-stat-block__name-link');

    if (titleLink) {
      const href = titleLink.getAttribute('href') ?? '';
      let pathname = '';
      try {
        pathname = href.startsWith('http') ? new URL(href).pathname : href.split('#')[0];
      } catch { /* ignore */ }

      const actorUuid = pathname ? monsterPathToActorId.get(pathname) : undefined;
      if (actorUuid) {
        const name = titleLink.textContent?.trim() ?? '';
        div.replaceWith(doc.createTextNode(`@Embed[${actorUuid}]{${name}}`));
        changed = true;
        continue;
      }
    }

    // Fallback for the newer stat-block-background format: render as clean HTML
    // so the journal page is still readable even if the actor wasn't imported.
    if (isStatBlock) {
      const temp = doc.createElement('div');
      temp.innerHTML = renderStatBlock(div);
      div.replaceWith(...Array.from(temp.childNodes));
      changed = true;
    }
  }

  // Pass 2: anchor links
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    if (a.getAttribute('aria-hidden') === 'true') continue;
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

    // Pure in-page hash links (#SomeAnchor with no pathname) — resolve within
    // the current chapter using the expanded anchorToPageId map.
    if (!pathname && hash && currentChapterData) {
      const pageId = lookupAnchor(currentChapterData.anchorToPageId, hash);
      if (pageId) {
        a.replaceWith(
          doc.createTextNode(
            `@UUID[JournalEntry.${currentChapterData.journalId}.JournalEntryPage.${pageId}]{${text}}`,
          ),
        );
        changed = true;
      }
      continue;
    }

    // Monster links: /monsters/...
    if (pathname.startsWith('/monsters/')) {
      const actorUuid = monsterPathToActorId.get(pathname);
      if (actorUuid) {
        a.replaceWith(doc.createTextNode(`@UUID[${actorUuid}]{${text}}`));
        changed = true;
      }
      continue;
    }

    // Spell links: /spells/123-fire-bolt or /spells/fire-bolt
    if (pathname.includes('/spells/')) {
      const slug = pathname.split('/').filter(Boolean).pop() ?? '';
      const nameFromSlug = slug.replace(/^\d+-/, '').replace(/-/g, ' ');
      const spellUuid =
        spellNameToItemId.get(nameFromSlug.toLowerCase()) ??
        spellNameToItemId.get(text.toLowerCase());
      if (spellUuid) {
        a.replaceWith(doc.createTextNode(`@UUID[${spellUuid}]{${text}}`));
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
      const pageId = lookupAnchor(data.anchorToPageId, hash);
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
