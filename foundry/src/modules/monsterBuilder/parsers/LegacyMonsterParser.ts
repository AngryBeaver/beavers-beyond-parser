import { ParsedStatBlock } from '../../../types.js';
import { StatBlockParser } from '../../StatBlockParser.js';
import { IMonsterParser } from './IMonsterParser.js';

/** Parser for the classic 2014 D&D Beyond stat-block format (class="mon-stat-block"). */
export class LegacyMonsterParser implements IMonsterParser {
  canHandle(html: string): boolean {
    return html.includes('class="mon-stat-block"') && !html.includes('class="mon-stat-block-2024"');
  }

  extractAll(doc: Document): ParsedStatBlock[] {
    return StatBlockParser.extractAll(doc);
  }
}
