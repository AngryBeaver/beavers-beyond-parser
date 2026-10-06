import { ParsedChapter, ProgressFn } from '../types.js';
import { ImageStore } from './ImageStore.js';
import { importFolder } from './ImportFolders.js';

interface JournalData {
  journalId: string;
  anchorToPageId: Map<string, string>;
}

/** Everything link rewriting can resolve a D&D Beyond link to. */
export interface LinkContext {
  /** chapter slug → journal + anchors */
  slugToData: Map<string, JournalData>;
  /** "/monsters/17281-meenlock" → actor UUID */
  monsterPathToActorId: Pick<Map<string, string>, 'get'>;
  /** lowercased spell name → item UUID */
  spellNameToItemId: Pick<Map<string, string>, 'get'>;
  /** "/magic-items/4710-potion-of-invisibility", "/equipment/4-longsword" → item UUID */
  itemPathToUuid?: Pick<Map<string, string>, 'get'>;
  /** Resolve a rules term ("Stealth", "RestrainedCondition") to a dnd5e `&Reference` target. */
  findRule?: (candidates: string[]) => string | null;
  currentChapterData?: JournalData;
}

export interface JournalBuildOptions {
  itemPathToUuid?: Map<string, string>;
  /** Folder below `beyond/` the journal images are copied to; images stay remote when omitted. */
  imageEntity?: string;
  onProgress?: ProgressFn;
}

const DDB_ORIGIN = 'https://www.dndbeyond.com';

export class JournalBuilder {
  static async build(
    adventureTitle: string,
    chapters: ParsedChapter[],
    monsterPathToActorId: Map<string, string>,
    spellNameToItemId: Map<string, string> = new Map(),
    { itemPathToUuid, imageEntity, onProgress }: JournalBuildOptions = {},
  ): Promise<{ journals: number; pages: number }> {
    const folder = (await Folder.create({
      name: adventureTitle,
      type: 'JournalEntry',
      folder: await importFolder('JournalEntry'),
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

    // Pass 2: create pages with pre-assigned IDs and rewritten links.
    // Images are copied to local storage before the pages referencing them are created; this
    // runs after link rewriting so stat blocks replaced by an @Embed are not downloaded again.
    const imageClaims = new Map<string, string>();
    for (const { journal, chapter, pageIds } of created) {
      if (chapter.pages.length === 0) continue;
      const chapterData = slugToData.get(chapter.slug);
      const pages = [];
      for (let i = 0; i < chapter.pages.length; i++) {
        const page = chapter.pages[i];
        let content = rewriteLinks(page.content, {
          slugToData,
          monsterPathToActorId,
          spellNameToItemId,
          itemPathToUuid,
          findRule: findDnd5eRule,
          currentChapterData: chapterData,
        });
        if (imageEntity) {
          onProgress?.(
            `Copying images: ${chapter.title} — ${page.name}…`,
            (created.findIndex((c) => c.chapter === chapter) + i / chapter.pages.length) /
              created.length,
          );
          content = await ImageStore.localizeHtml(content, imageEntity, imageClaims);
        }
        pages.push({
          _id: pageIds[i],
          name: page.name || `Page ${i + 1}`,
          type: 'text',
          sort: (i + 1) * 100,
          text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
        });
      }
      // keepId: the links written above point at the pre-generated page ids
      await JournalEntryPage.createDocuments(pages, { parent: journal, keepId: true });
    }

    const totalPages = created.reduce((sum, { chapter }) => sum + chapter.pages.length, 0);
    return { journals: created.length, pages: totalPages };
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

export function normalizeAnchor(text: string): string {
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

/**
 * dnd5e ships its rules as journal pages and links to them with `&Reference[type=key]`.
 * Returns that target for the first candidate naming a known condition, skill, rule, ….
 */
let _ruleIndex: Map<string, string> | null = null;
function findDnd5eRule(candidates: string[]): string | null {
  if (!_ruleIndex) {
    _ruleIndex = new Map();
    const config = (globalThis as any).CONFIG?.DND5E ?? {};
    for (const [type, def] of Object.entries<any>(config.ruleTypes ?? {})) {
      const table = (foundry.utils as any).getProperty(config, def.references) ?? {};
      for (const [key, entry] of Object.entries<any>(table)) {
        if (!(typeof entry === 'object' ? entry?.reference : entry)) continue;
        const target = `${type}=${key}`;
        if (!_ruleIndex.has(normalizeAnchor(key))) _ruleIndex.set(normalizeAnchor(key), target);
        const label =
          typeof entry === 'object' && entry.label ? (game as any).i18n.localize(entry.label) : '';
        if (label && !_ruleIndex.has(normalizeAnchor(label))) {
          _ruleIndex.set(normalizeAnchor(label), target);
        }
      }
    }
  }
  for (const candidate of candidates) {
    const target = _ruleIndex.get(normalizeAnchor(candidate));
    if (target) return target;
  }
  return null;
}

/** Names a rules link may refer to: its text and its anchor, also without inflection. */
function ruleCandidates(text: string, hash: string): string[] {
  const names = [text, hash, hash.replace(/Condition$/, '')].filter(Boolean);
  // "surprised" → "surprise", "potions" → "potion"
  for (const name of [...names]) {
    const lower = name.toLowerCase();
    if (/(ed|s)$/.test(lower))
      names.push(lower.replace(/(d|s)$/, ''), lower.replace(/(ed|s)$/, ''));
  }
  return names;
}

export function rewriteLinks(html: string, ctx: LinkContext): string {
  const { slugToData, monsterPathToActorId, spellNameToItemId, currentChapterData } = ctx;
  const doc = new DOMParser().parseFromString(html, 'text/html');

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
      } catch {
        /* ignore */
      }

      const actorUuid = pathname ? monsterPathToActorId.get(pathname) : undefined;
      if (actorUuid) {
        const name = titleLink.textContent?.trim() ?? '';
        div.replaceWith(doc.createTextNode(`@Embed[${actorUuid}]{${name}}`));
        continue;
      }
    }

    // Fallback for the newer stat-block-background format: render as clean HTML
    // so the journal page is still readable even if the actor wasn't imported.
    if (isStatBlock) {
      const temp = doc.createElement('div');
      temp.innerHTML = renderStatBlock(div);
      div.replaceWith(...Array.from(temp.childNodes));
    }
  }

  const pageLink = (data: JournalData, pageId: string | undefined, text: string): Text =>
    doc.createTextNode(
      pageId
        ? `@UUID[JournalEntry.${data.journalId}.JournalEntryPage.${pageId}]{${text}}`
        : `@UUID[JournalEntry.${data.journalId}]{${text}}`,
    );

  /** Find an anchor in the current chapter first, then anywhere in the adventure. */
  const findAnchor = (hash: string): [JournalData, string] | undefined => {
    for (const data of [currentChapterData, ...slugToData.values()]) {
      const pageId = data && lookupAnchor(data.anchorToPageId, hash);
      if (data && pageId) return [data, pageId];
    }
    return undefined;
  };

  // Pass 2: anchor links
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    let href = (a.getAttribute('href') ?? '').trim();
    // D&D Beyond occasionally drops the "#" of an in-page link ("WizardsQuartersTreasure")
    if (/^[A-Za-z][\w-]*$/.test(href)) href = `#${href}`;

    let pathname: string;
    let hash: string;
    let external = false;
    try {
      const u = new URL(href, DDB_ORIGIN);
      external = !/^https?:$/.test(u.protocol) || !/(^|\.)dndbeyond\.com$/.test(u.hostname);
      pathname = href.startsWith('#') ? '' : u.pathname;
      hash = decodeURIComponent(u.hash.slice(1));
    } catch {
      continue;
    }
    if (external) continue; // other sites, mailto: … stay as they are

    const text = a.textContent?.trim() ?? '';

    // In-page links (#SomeAnchor)
    if (!pathname) {
      // Headings carry an empty self-link (the permalink icon) — it has no use in a journal.
      if (!text && !a.querySelector('img')) {
        a.remove();
        continue;
      }
      const found = hash ? findAnchor(hash) : undefined;
      if (found) a.replaceWith(pageLink(found[0], found[1], text));
      else a.replaceWith(...Array.from(a.childNodes)); // dead anchor: keep the text only
      continue;
    }

    const segments = pathname.split('/').filter(Boolean);
    const slug = segments[segments.length - 1] ?? '';
    const nameFromSlug = slug.replace(/^\d+-/, '').replace(/-/g, ' ');
    let target: string | undefined;

    if (segments[0] === 'monsters') {
      target = monsterPathToActorId.get(pathname);
    } else if (segments.includes('spells')) {
      // /spells/123-fire-bolt or /spells/fire-bolt
      target =
        spellNameToItemId.get(nameFromSlug.toLowerCase()) ??
        spellNameToItemId.get(text.toLowerCase());
    } else if (segments[0] === 'magic-items' || segments[0] === 'equipment') {
      target = ctx.itemPathToUuid?.get(pathname);
    } else {
      // Chapter/page links: match by last URL segment
      const data = slugToData.get(slug);
      if (data) {
        a.replaceWith(
          pageLink(data, hash ? lookupAnchor(data.anchorToPageId, hash) : undefined, text),
        );
        continue;
      }
      // Links into the rule books → the rules shipped with the dnd5e system
      if (segments[0] === 'sources' || segments[0] === 'compendium') {
        const rule = text ? ctx.findRule?.(ruleCandidates(text, hash)) : null;
        if (rule) {
          a.replaceWith(doc.createTextNode(`&Reference[${rule}]{${text}}`));
          continue;
        }
      }
    }

    if (target) {
      a.replaceWith(doc.createTextNode(`@UUID[${target}]{${text}}`));
    } else {
      // Nothing local to link to: at least make the link work from inside Foundry.
      a.setAttribute('href', new URL(href, DDB_ORIGIN).href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  }

  return doc.body.innerHTML;
}
