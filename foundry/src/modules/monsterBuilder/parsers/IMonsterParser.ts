import { ParsedStatBlock } from '../../../types.js';

export interface IMonsterParser {
  /** Returns true if this parser handles the given raw HTML page. */
  canHandle(html: string): boolean;
  /** Extract all stat blocks from a parsed document. */
  extractAll(doc: Document): ParsedStatBlock[];
}
