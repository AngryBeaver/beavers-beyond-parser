export interface ParsedAdventure {
  title: string;
  url: string;
  description: string;
  chapters: ParsedChapter[];
}

export interface ParsedChapter {
  title: string;
  slug: string;
  sections: ParsedSection[];
}

export interface ParsedSection {
  title: string;
  content: string; // HTML
}
