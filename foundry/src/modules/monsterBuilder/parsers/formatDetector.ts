export type MonsterFormat = 'legacy' | '2024' | 'unknown';

/**
 * Detect the D&D Beyond monster page format from raw HTML.
 *
 * Legacy (2014): uses CSS class "mon-stat-block"
 * 2024:          uses CSS class "mon-stat-block-2024"
 */
export function detectFormat(html: string): MonsterFormat {
  if (html.includes('class="mon-stat-block-2024"')) return '2024';
  if (html.includes('class="mon-stat-block"')) return 'legacy';
  return 'unknown';
}
