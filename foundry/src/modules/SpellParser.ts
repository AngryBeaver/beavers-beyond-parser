import { ParsedSpell } from '../types.js';

export const SCHOOL_MAP: Record<string, string> = {
  abjuration: 'abj',
  conjuration: 'con',
  divination: 'div',
  enchantment: 'enc',
  evocation: 'evo',
  illusion: 'ill',
  necromancy: 'nec',
  transmutation: 'trs',
};

export class SpellParser {
  /**
   * Extract spell metadata from D&D Beyond `.more-info.details-more-info` blocks
   * (the expandable spell panels present on adventure/monster pages).
   * Returns a map keyed by lowercased spell name for fast lookup.
   */
  static extractAll(doc: Document): Map<string, ParsedSpell> {
    const result = new Map<string, ParsedSpell>();

    for (const container of Array.from(
      doc.querySelectorAll<HTMLElement>('.more-info.details-more-info'),
    )) {
      const spellEl = container.querySelector<HTMLElement>('.ddb-statblock-spell');
      if (!spellEl) continue;

      const imgEl = container.querySelector<HTMLImageElement>('img.spell-image');
      const name = imgEl?.getAttribute('alt')?.trim() ??
        container.querySelector('.more-info-title')?.textContent?.trim() ?? '';
      if (!name) continue;

      const imageUrl = imgEl?.getAttribute('src')?.trim() ?? '';

      const getVal = (cls: string) =>
        spellEl
          .querySelector<HTMLElement>(`.ddb-statblock-item-${cls} .ddb-statblock-item-value`)
          ?.textContent?.trim() ?? '';

      const levelText = getVal('level');
      const level = /cantrip/i.test(levelText) ? 0 : parseInt(levelText) || 0;
      const school = SCHOOL_MAP[getVal('school').toLowerCase()] ?? 'evo';

      const compText = getVal('components');
      const components: string[] = [];
      if (/\bV\b/.test(compText)) components.push('vocal');
      if (/\bS\b/.test(compText)) components.push('somatic');
      if (/\bM\b/.test(compText)) components.push('material');
      const ritual = /\bR\b/.test(compText) || /ritual/i.test(compText);
      const materialDescM = compText.match(/M\s*\(([^)]+)\)/i);
      const materialDesc = materialDescM ? materialDescM[1].trim() : '';

      const durationText = getVal('duration');
      const concentration = /concentration/i.test(durationText);

      const description = Array.from(
        container.querySelectorAll<HTMLElement>('.more-info-content p'),
      )
        .map((p) => `<p>${p.innerHTML}</p>`)
        .join('\n');

      result.set(name.toLowerCase(), {
        name,
        level,
        school,
        castingTime: getVal('casting-time'),
        range: getVal('range-area'),
        components,
        materialDesc,
        concentration,
        ritual,
        duration: durationText,
        description,
        imageUrl,
        attackSave: getVal('attack-save'),
        damageEffect: getVal('damage-effect'),
      });
    }

    return result;
  }

  /**
   * Best-effort parse of a standalone DDB spell detail page
   * (https://www.dndbeyond.com/spells/SLUG).
   * Used as a fallback when the spell is not in any compendium.
   */
  static parseSpellPage(doc: Document, fallbackName: string): ParsedSpell {
    const name =
      doc.querySelector('h1.page-title, h1.spell-name, h1')?.textContent?.trim() ?? fallbackName;

    const imgEl = doc.querySelector<HTMLImageElement>('img.spell-image, img.spell-header-image');
    const imageUrl = imgEl?.getAttribute('src')?.trim() ?? '';

    const getDetail = (label: string) =>
      Array.from(doc.querySelectorAll('.ddb-statblock-item'))
        .find((el) => el.querySelector('.ddb-statblock-item-label')?.textContent?.trim() === label)
        ?.querySelector('.ddb-statblock-item-value')
        ?.textContent?.trim() ?? '';

    const levelText = getDetail('Level') || getDetail('Spell Level');
    const level = /cantrip/i.test(levelText) ? 0 : parseInt(levelText) || 0;
    const school = SCHOOL_MAP[getDetail('School').toLowerCase()] ?? 'evo';

    const compText = getDetail('Components');
    const components: string[] = [];
    if (/\bV\b/.test(compText)) components.push('vocal');
    if (/\bS\b/.test(compText)) components.push('somatic');
    if (/\bM\b/.test(compText)) components.push('material');
    const ritual = /\bR\b/.test(compText) || /ritual/i.test(compText);
    const materialDescM = compText.match(/M\s*\(([^)]+)\)/i);
    const materialDesc = materialDescM ? materialDescM[1].trim() : '';

    const durationText = getDetail('Duration');
    const concentration = /concentration/i.test(durationText);

    const contentEl = doc.querySelector(
      '.spell-description, .more-info-content, .spell-body-content, .p-article-content',
    );
    const description = contentEl
      ? Array.from(contentEl.querySelectorAll('p'))
          .map((p) => `<p>${p.innerHTML}</p>`)
          .join('\n')
      : '';

    return {
      name,
      level,
      school,
      castingTime: getDetail('Casting Time'),
      range: getDetail('Range') || getDetail('Range/Area'),
      components,
      materialDesc,
      concentration,
      ritual,
      duration: durationText,
      description,
      imageUrl,
      attackSave: getDetail('Attack/Save'),
      damageEffect: getDetail('Damage/Effect'),
    };
  }
}