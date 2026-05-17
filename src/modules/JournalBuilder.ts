import { ParsedAdventure } from '../types.js';

export class JournalBuilder {
  static async build(adventure: ParsedAdventure): Promise<void> {
    const folder = (await Folder.create({
      name: adventure.title,
      type: 'JournalEntry',
      color: '#5b4a2e',
    })) as Folder;

    for (const chapter of adventure.chapters) {
      const journal = (await JournalEntry.create({
        name: chapter.title,
        folder: folder?.id ?? null,
      })) as JournalEntry;

      if (!journal || chapter.sections.length === 0) continue;

      const pages = chapter.sections.map((section, i) => ({
        name: section.title || `Page ${i + 1}`,
        type: 'text',
        sort: (i + 1) * 100,
        text: {
          content: section.content,
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
        },
      }));

      await JournalEntryPage.createDocuments(pages, { parent: journal });
    }

    ui.notifications?.info(
      `Imported "${adventure.title}" — ${adventure.chapters.length} chapter(s) created.`,
    );
  }
}
