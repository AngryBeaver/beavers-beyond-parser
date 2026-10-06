type FolderType = 'Actor' | 'Item' | 'JournalEntry';

/** Top-level folder per document type that everything imported from D&D Beyond is filed under. */
const ROOT: Record<FolderType, string> = {
  Actor: 'dndbeyond',
  Item: 'dndBeyond',
  JournalEntry: 'dndbeyond',
};

let importLabel = '';

/**
 * File the following imports under their own sub-folder of the D&D Beyond folders
 * (`dndbeyond/<label>/…`). Documents of a labelled import are never shared with other imports,
 * so the same content can be imported several times side by side, e.g. to compare settings.
 */
export function setImportLabel(label: string): void {
  importLabel = label.trim();
}

function findFolder(type: FolderType, name: string, parentId: string | null): any {
  return (game.folders as any)?.find(
    (f: any) => f.type === type && f.name === name && (f.folder?.id ?? null) === parentId,
  );
}

/**
 * Id of the folder `<root>/[<label>/]<path…>` for a document type; missing levels are created.
 * Returns null when a folder cannot be created (documents then land at the top level).
 */
export async function importFolder(type: FolderType, ...path: string[]): Promise<string | null> {
  try {
    let parentId: string | null = null;
    for (const name of [ROOT[type], ...(importLabel ? [importLabel] : []), ...path]) {
      const folder: any =
        findFolder(type, name, parentId) ??
        (await (Folder as any).create({ name, type, folder: parentId }));
      parentId = folder?.id ?? null;
      if (!parentId) return null;
    }
    return parentId;
  } catch {
    return null;
  }
}
