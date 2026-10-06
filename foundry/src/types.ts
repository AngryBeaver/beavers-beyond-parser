/**
 * Progress callback of an import step. `fraction` (0–1) says how far that step is;
 * it is omitted for messages that do not move the progress.
 */
export type ProgressFn = (msg: string, fraction?: number) => void;

export interface ParsedAdventure {
  title: string;
  url: string;
  description: string;
  chapterStubs: ChapterStub[];
}

export interface ChapterStub {
  title: string;
  url: string;
}

export interface MonsterRef {
  name: string;
  monsterHref: string;
}

export interface ParsedChapter {
  title: string;
  slug: string;
  pages: ParsedPage[];
  statBlocks: MonsterRef[];
}

export interface ParsedPage {
  name: string;
  content: string;
}

export interface ParsedStatBlock {
  name: string;
  meta: string;
  monsterHref: string;
  ac: number;
  acNote: string;
  hp: number;
  hpFormula: string;
  speed: string;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  cr: string;
  xp: number;
  profBonus: string;
  data: Array<{ label: string; value: string }>;
  sections: Array<{ heading: string; entries: string[] }>;
  imageUrl: string;
  cleanHtml: string;
}

export interface ParsedSpell {
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string[];
  materialDesc: string;
  concentration: boolean;
  ritual: boolean;
  duration: string;
  description: string;
  imageUrl: string;
  attackSave: string;
  damageEffect: string;
}
