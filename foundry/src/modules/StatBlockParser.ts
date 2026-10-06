import { ParsedStatBlock } from '../types.js';

const CORE_STAT_LABELS = new Set(['Armor Class', 'Hit Points', 'Speed']);

export class StatBlockParser {
  static extractAll(doc: Document): ParsedStatBlock[] {
    const results: ParsedStatBlock[] = [];

    // Format 1: inline stat blocks
    for (const el of Array.from(doc.querySelectorAll('.stat-block-background'))) {
      const sb = StatBlockParser.parse(el as HTMLElement);
      if (sb) results.push(sb);
    }

    // Format 2a: .more-info popup blocks containing .mon-stat-block
    for (const el of Array.from(doc.querySelectorAll('.more-info'))) {
      if ((el as HTMLElement).querySelector('.mon-stat-block')) {
        const sb = StatBlockParser.parseMon(el as HTMLElement);
        if (sb) results.push(sb);
      }
    }

    // Format 2b: standalone .mon-stat-block not nested inside .more-info
    for (const el of Array.from(doc.querySelectorAll('.mon-stat-block'))) {
      if (el.closest('.more-info')) continue;
      const container = el.closest('.detail-content, .page-content') ?? el.parentElement ?? el;
      const sb = StatBlockParser.parseMon(container as HTMLElement);
      if (sb) results.push(sb);
    }

    // Format 3: 2024 individual monster pages (.mon-stat-block-2024)
    for (const el of Array.from(doc.querySelectorAll('.mon-stat-block-2024'))) {
      const container = el.closest('.detail-content, .page-content') ?? el.parentElement ?? el;
      const sb = StatBlockParser.parseMon2024(container as HTMLElement);
      if (sb) results.push(sb);
    }

    return results;
  }

  static parse(el: HTMLElement): ParsedStatBlock | null {
    const name = el.querySelector('[class*="Stat-Block-Title"]')?.textContent?.trim() ?? '';
    if (!name) return null;

    const meta = el.querySelector('[class*="Stat-Block-Metadata"]')?.textContent?.trim() ?? '';

    // DDB monster href for actor link rewriting (e.g. "/monsters/17281-meenlock")
    const monsterHref =
      el.querySelector('[class*="Stat-Block-Title"] a')?.getAttribute('href') ?? '';

    // Ability scores — use exact class names to avoid [class*="-score"] matching "scores"
    const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    for (const stat of Array.from(el.querySelectorAll('.stat-block-ability-scores-stat'))) {
      const key =
        stat
          .querySelector('.stat-block-ability-scores-heading')
          ?.textContent?.trim()
          .toLowerCase() ?? '';
      const score = parseInt(
        stat.querySelector('.stat-block-ability-scores-score')?.textContent?.trim() ?? '10',
        10,
      );
      if (key in abilities) (abilities as Record<string, number>)[key] = score;
    }

    const getDataText = (label: string): string => {
      for (const p of Array.from(el.querySelectorAll('[class*="Stat-Block-Data"]'))) {
        if (p.querySelector('strong')?.textContent?.trim() === label) {
          return (p.textContent ?? '').slice(label.length).trim();
        }
      }
      return '';
    };

    const acText = getDataText('Armor Class');
    const ac = parseInt(acText, 10) || 0;
    const acNote = acText
      .replace(/^\d+\s*/, '')
      .replace(/^\(|\)$/g, '')
      .trim();

    const hpText = getDataText('Hit Points');
    const hpMatch = hpText.match(/^(\d+)\s*\(([^)]+)\)/);
    const hp = hpMatch ? parseInt(hpMatch[1], 10) : parseInt(hpText, 10) || 0;
    const hpFormula = hpMatch ? hpMatch[2] : '';

    const speed = getDataText('Speed');

    const crLine = el.querySelector('[class*="Stat-Block-Data-Last"]')?.textContent?.trim() ?? '';
    const crMatch = crLine.match(/Challenge(?:\s+Rating)?\s+([^\s(]+)/i);
    const cr = crMatch ? crMatch[1] : '';
    const xpMatch = crLine.match(/\((\d[\d,]*)\s*XP\)/i);
    const xp = xpMatch ? parseInt(xpMatch[1].replace(/,/g, ''), 10) : 0;
    const profMatch = crLine.match(/Proficiency Bonus\s+([+-]\d+)/i);
    const profBonus = profMatch ? profMatch[1] : '';

    const data: Array<{ label: string; value: string }> = [];
    for (const p of Array.from(
      el.querySelectorAll('[class*="Stat-Block-Data"]:not([class*="Data-Last"])'),
    )) {
      const label = p.querySelector('strong')?.textContent?.trim() ?? '';
      if (!label || CORE_STAT_LABELS.has(label)) continue;
      const value = (p.textContent ?? '').slice(label.length).trim();
      data.push({ label, value });
    }

    const sections: Array<{ heading: string; entries: string[] }> = [{ heading: '', entries: [] }];
    let current = sections[0];
    for (const node of Array.from(el.children)) {
      const cls = (node as HTMLElement).className ?? '';
      if (cls.includes('Stat-Block-Heading')) {
        current = { heading: node.textContent?.trim() ?? '', entries: [] };
        sections.push(current);
      } else if (cls.includes('Stat-Block-Body')) {
        current.entries.push((node as HTMLElement).innerHTML);
      }
    }

    const lightbox = el.querySelector('a.ddb-lightbox-outer');
    const imgEl = el.querySelector('img.ddb-lightbox-inner, img[src*="avatars"]');
    const imageUrl = lightbox?.getAttribute('href') ?? imgEl?.getAttribute('src') ?? '';

    const sbData = {
      name,
      meta,
      monsterHref,
      ac,
      acNote,
      hp,
      hpFormula,
      speed,
      abilities,
      cr,
      xp,
      profBonus,
      data,
      sections,
      imageUrl,
    };
    return { ...sbData, cleanHtml: buildStatBlockHtml(sbData) };
  }

  // Handles the .mon-stat-block format found inside .more-info containers or standalone on
  // monster pages. Pass the outer container so the portrait image can be found alongside it.
  static parseMon(container: HTMLElement): ParsedStatBlock | null {
    const el = container.querySelector<HTMLElement>('.mon-stat-block');
    if (!el) return null;

    const name =
      el.querySelector('.mon-stat-block__name-link, .mon-stat-block__name')?.textContent?.trim() ??
      '';
    if (!name) return null;

    const monsterHref =
      el.querySelector<HTMLAnchorElement>('.mon-stat-block__name-link')?.getAttribute('href') ?? '';

    const meta = el.querySelector('.mon-stat-block__meta')?.textContent?.trim() ?? '';

    const getAttribute = (label: string): string => {
      for (const attr of Array.from(el.querySelectorAll('.mon-stat-block__attribute'))) {
        if (attr.querySelector('.mon-stat-block__attribute-label')?.textContent?.trim() === label) {
          const val =
            attr.querySelector('.mon-stat-block__attribute-data-value')?.textContent?.trim() ?? '';
          const extra =
            attr.querySelector('.mon-stat-block__attribute-data-extra')?.textContent?.trim() ?? '';
          return extra ? `${val} ${extra}` : val;
        }
      }
      return '';
    };

    const acText = getAttribute('Armor Class');
    const ac = parseInt(acText, 10) || 0;
    const acNote = acText
      .replace(/^\d+\s*/, '')
      .replace(/^\(|\)$/g, '')
      .trim();

    const hpText = getAttribute('Hit Points');
    const hpMatch = hpText.match(/^(\d+)\s*(?:\(([^)]+)\))?/);
    const hp = hpMatch ? parseInt(hpMatch[1], 10) : 0;
    const hpFormula = hpMatch?.[2]?.trim() ?? '';

    const speed = getAttribute('Speed');

    const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    for (const stat of Array.from(el.querySelectorAll('.ability-block__stat'))) {
      const key =
        stat.querySelector('.ability-block__heading')?.textContent?.trim().toLowerCase() ?? '';
      const score = parseInt(
        stat.querySelector('.ability-block__score')?.textContent?.trim() ?? '10',
        10,
      );
      if (key in abilities) (abilities as Record<string, number>)[key] = score;
    }

    const data: Array<{ label: string; value: string }> = [];
    let cr = '';
    let xp = 0;
    let profBonus = '';
    for (const tidbit of Array.from(el.querySelectorAll('.mon-stat-block__tidbit'))) {
      const label =
        tidbit.querySelector('.mon-stat-block__tidbit-label')?.textContent?.trim() ?? '';
      const value = tidbit.querySelector('.mon-stat-block__tidbit-data')?.textContent?.trim() ?? '';
      if (!label || !value || value === '--') continue;
      if (label === 'Challenge') {
        cr = value.match(/^([^\s(]+)/)?.[1] ?? '';
        const xpM = value.match(/\((\d[\d,]*)\s*XP\)/i);
        xp = xpM ? parseInt(xpM[1].replace(/,/g, ''), 10) : 0;
      } else if (label === 'Proficiency Bonus') {
        profBonus = value;
      } else {
        data.push({ label, value });
      }
    }

    const sections: Array<{ heading: string; entries: string[] }> = [];
    for (const block of Array.from(el.querySelectorAll('.mon-stat-block__description-block'))) {
      const heading =
        block.querySelector('.mon-stat-block__description-block-heading')?.textContent?.trim() ??
        '';
      const contentEl = block.querySelector<HTMLElement>(
        '.mon-stat-block__description-block-content',
      );
      if (!contentEl) continue;
      const entries = Array.from(contentEl.querySelectorAll('p')).map((p) => p.innerHTML);
      if (entries.length) sections.push({ heading, entries });
    }

    // Image lives outside .mon-stat-block in the sibling .image div of the container
    const lightbox = container.querySelector<HTMLAnchorElement>('.image a[data-lightbox]');
    const imgEl = container.querySelector<HTMLImageElement>('img.monster-image');
    const imageUrl = lightbox?.getAttribute('href') ?? imgEl?.getAttribute('src') ?? '';

    const sbData = {
      name,
      meta,
      monsterHref,
      ac,
      acNote,
      hp,
      hpFormula,
      speed,
      abilities,
      cr,
      xp,
      profBonus,
      data,
      sections,
      imageUrl,
    };
    return { ...sbData, cleanHtml: buildStatBlockHtml(sbData) };
  }
  // Handles the .mon-stat-block-2024 format used on 2024 D&D Beyond individual monster pages.
  // Pass the outer container (.detail-content) so the portrait image can be found alongside it.
  static parseMon2024(container: HTMLElement): ParsedStatBlock | null {
    const el = container.querySelector<HTMLElement>('.mon-stat-block-2024') ?? container;

    const name =
      el
        .querySelector('.mon-stat-block-2024__name-link, .mon-stat-block-2024__name')
        ?.textContent?.trim() ?? '';
    if (!name) return null;

    const monsterHref =
      el
        .querySelector<HTMLAnchorElement>('.mon-stat-block-2024__name-link')
        ?.getAttribute('href') ?? '';

    const meta = el.querySelector('.mon-stat-block-2024__meta')?.textContent?.trim() ?? '';

    const getAttribute = (label: string): { value: string; extra: string } => {
      for (const attr of Array.from(el.querySelectorAll('.mon-stat-block-2024__attribute'))) {
        if (
          attr.querySelector('.mon-stat-block-2024__attribute-label')?.textContent?.trim() === label
        ) {
          const value =
            attr.querySelector('.mon-stat-block-2024__attribute-data-value')?.textContent?.trim() ??
            '';
          const extra =
            attr.querySelector('.mon-stat-block-2024__attribute-data-extra')?.textContent?.trim() ??
            '';
          return { value, extra };
        }
      }
      return { value: '', extra: '' };
    };

    const { value: acRaw } = getAttribute('AC');
    const ac = parseInt(acRaw, 10) || 0;
    const acNote = '';

    const { value: hpRaw, extra: hpExtra } = getAttribute('HP');
    const hp = parseInt(hpRaw, 10) || 0;
    const hpFormula = hpExtra.replace(/^\(|\)$/g, '').trim();

    const { value: speed } = getAttribute('Speed');

    // Abilities come from two .stat-table tables (physical: STR/DEX/CON, mental: INT/WIS/CHA).
    // Each row: <th>STR</th><td>21</td><td class="modifier">+5</td><td class="modifier">+5</td>
    const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    for (const row of Array.from(el.querySelectorAll('.stat-table tbody tr'))) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (cells.length < 2) continue;
      const key = cells[0].textContent?.trim().toLowerCase() ?? '';
      const score = parseInt(cells[1].textContent?.trim() ?? '10', 10);
      if (key in abilities) (abilities as Record<string, number>)[key] = score;
    }

    const data: Array<{ label: string; value: string }> = [];
    let cr = '';
    let xp = 0;
    let profBonus = '';

    for (const tidbit of Array.from(el.querySelectorAll('.mon-stat-block-2024__tidbit'))) {
      const label =
        tidbit.querySelector('.mon-stat-block-2024__tidbit-label')?.textContent?.trim() ?? '';
      const value =
        tidbit.querySelector('.mon-stat-block-2024__tidbit-data')?.textContent?.trim() ?? '';
      if (!label || !value) continue;
      if (label === 'CR') {
        cr = value.match(/^([^\s(]+)/)?.[1] ?? '';
        // "10 (XP 5,900, or 7,200 in lair; PB +4)" — take the first XP figure
        const xpM = value.match(/XP\s*([\d,]+)/i);
        xp = xpM ? parseInt(xpM[1].replace(/,/g, ''), 10) : 0;
        const pbM = value.match(/PB\s*([+-]\d+)/i);
        profBonus = pbM ? pbM[1] : '';
      } else {
        data.push({ label, value });
      }
    }

    const sections: Array<{ heading: string; entries: string[] }> = [];
    for (const block of Array.from(
      el.querySelectorAll('.mon-stat-block-2024__description-block'),
    )) {
      const heading =
        block
          .querySelector('.mon-stat-block-2024__description-block-heading')
          ?.textContent?.trim() ?? '';
      const contentEl = block.querySelector<HTMLElement>(
        '.mon-stat-block-2024__description-block-content',
      );
      if (!contentEl) continue;
      const entries = Array.from(contentEl.querySelectorAll('p')).map((p) => p.innerHTML);
      if (entries.length) sections.push({ heading, entries });
    }

    // Image lives in a sibling .image div within the container
    const lightbox = container.querySelector<HTMLAnchorElement>('.image a[data-lightbox]');
    const imgEl = container.querySelector<HTMLImageElement>('img.monster-image');
    const imageUrl = lightbox?.getAttribute('href') ?? imgEl?.getAttribute('src') ?? '';

    const sbData = {
      name,
      meta,
      monsterHref,
      ac,
      acNote,
      hp,
      hpFormula,
      speed,
      abilities,
      cr,
      xp,
      profBonus,
      data,
      sections,
      imageUrl,
    };
    return { ...sbData, cleanHtml: buildStatBlockHtml(sbData) };
  }
}

export function buildStatBlockHtml(sb: Omit<ParsedStatBlock, 'cleanHtml'>): string {
  const parts: string[] = ['<div class="bbp-stat-block">'];

  if (sb.imageUrl) {
    parts.push(`<img class="bbp-sb-portrait" src="${esc(sb.imageUrl)}" alt="${esc(sb.name)}">`);
  }

  parts.push('<div class="bbp-sb-header">');
  parts.push(`<p class="bbp-sb-name">${esc(sb.name)}</p>`);
  if (sb.meta) parts.push(`<p class="bbp-sb-meta">${esc(sb.meta)}</p>`);
  parts.push('</div>');

  parts.push('<div class="bbp-sb-divider"></div>');
  if (sb.ac) {
    parts.push(
      `<p><strong>Armor Class</strong> ${sb.ac}${sb.acNote ? ` (${esc(sb.acNote)})` : ''}</p>`,
    );
  }
  if (sb.hp) {
    parts.push(
      `<p><strong>Hit Points</strong> ${sb.hp}${sb.hpFormula ? ` (${esc(sb.hpFormula)})` : ''}</p>`,
    );
  }
  if (sb.speed) parts.push(`<p><strong>Speed</strong> ${esc(sb.speed)}</p>`);

  parts.push('<div class="bbp-sb-divider"></div>');
  parts.push('<table class="bbp-sb-abilities"><thead><tr>');
  for (const label of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
    parts.push(`<th>${label}</th>`);
  }
  parts.push('</tr></thead><tbody><tr>');
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
    const v = sb.abilities[key] ?? 10;
    const mod = Math.floor((v - 10) / 2);
    parts.push(`<td>${v}<br><span>(${mod >= 0 ? '+' : ''}${mod})</span></td>`);
  }
  parts.push('</tr></tbody></table>');

  if (sb.data.length || sb.cr) {
    parts.push('<div class="bbp-sb-divider"></div>');
    for (const d of sb.data) {
      parts.push(`<p><strong>${esc(d.label)}</strong> ${esc(d.value)}</p>`);
    }
    if (sb.cr) {
      const crParts = [
        `<strong>Challenge</strong> ${esc(sb.cr)}${sb.xp ? ` (${sb.xp.toLocaleString()} XP)` : ''}`,
      ];
      if (sb.profBonus) crParts.push(`<strong>Proficiency Bonus</strong> ${esc(sb.profBonus)}`);
      parts.push(`<p>${crParts.join(' &nbsp;|&nbsp; ')}</p>`);
    }
  }

  if (sb.sections.some((s) => s.entries.length > 0)) {
    parts.push('<div class="bbp-sb-divider"></div>');
    for (const section of sb.sections) {
      if (section.heading) {
        parts.push(`<p class="bbp-sb-section-heading">${esc(section.heading)}</p>`);
      }
      for (const entry of section.entries) {
        parts.push(`<p>${entry}</p>`);
      }
    }
  }

  parts.push('</div>');
  return parts.join('\n');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
