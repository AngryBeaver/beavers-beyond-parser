export interface ParsedItem {
  name: string;
  /** The line under the title, e.g. "Wondrous Item, rare (requires attunement)"; empty for mundane equipment. */
  meta: string;
  description: string;
  imageUrl: string;
}

const DDB_ORIGIN = 'https://www.dndbeyond.com';

const RARITY: Array<[RegExp, string]> = [
  [/very rare/i, 'veryRare'],
  [/uncommon/i, 'uncommon'],
  [/common/i, 'common'],
  [/rare/i, 'rare'],
  [/legendary/i, 'legendary'],
  [/artifact/i, 'artifact'],
];

/**
 * Parse a D&D Beyond item detail page (/magic-items/… or /equipment/…).
 * Returns null when the page holds no item description (e.g. content the account does not own).
 */
export function parseItemPage(doc: Document, fallbackName: string): ParsedItem | null {
  const content =
    doc.querySelector('.item-details .more-info-content') ??
    doc.querySelector('.details-container-content-description-text') ??
    doc.querySelector('.details-container-content-description');
  if (!content) return null;

  // Links inside the description would otherwise be relative to the Foundry server.
  for (const a of Array.from(content.querySelectorAll('a[href]'))) {
    try {
      a.setAttribute('href', new URL(a.getAttribute('href') ?? '', DDB_ORIGIN).href);
    } catch {
      // leave unparseable links alone
    }
  }

  const image = doc.querySelector<HTMLImageElement>(
    'img.magic-item-image, .details-aside .image img',
  );
  return {
    name: doc.querySelector('h1.page-title')?.textContent?.trim() || fallbackName,
    meta: doc.querySelector('.item-info .details')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    description: content.innerHTML.trim(),
    imageUrl: image?.closest('a')?.getAttribute('href') ?? image?.getAttribute('src') ?? '',
  };
}

/**
 * dnd5e item data for a parsed page. Only what the page states reliably is filled in — name,
 * kind, rarity, attunement and the full description; mechanics stay in the description text.
 */
export function buildItemData(parsed: ParsedItem): Record<string, unknown> {
  const meta = parsed.meta.toLowerCase();
  const kind = meta.split(/[,(]/)[0].trim();

  let type = 'loot';
  let subtype: string | undefined;
  if (kind.startsWith('weapon')) type = 'weapon';
  else if (kind.startsWith('armor')) type = 'equipment';
  else if (/^(potion|scroll|wand|rod)/.test(kind)) {
    type = 'consumable';
    subtype = kind.match(/^(potion|scroll|wand|rod)/)![1];
  } else if (kind.startsWith('ring')) ((type = 'equipment'), (subtype = 'ring'));
  else if (kind.startsWith('wondrous')) ((type = 'equipment'), (subtype = 'wondrous'));
  else if (kind.startsWith('staff')) ((type = 'equipment'), (subtype = 'trinket'));

  const magical = !!parsed.meta;
  return {
    name: parsed.name,
    type,
    system: {
      description: { value: parsed.description },
      quantity: 1,
      ...(subtype ? { type: { value: subtype } } : {}),
      ...(magical
        ? {
            rarity: RARITY.find(([re]) => re.test(meta))?.[1] ?? '',
            attunement: /requires attunement/.test(meta) ? 'required' : '',
            properties: ['mgc'],
          }
        : {}),
    },
  };
}
