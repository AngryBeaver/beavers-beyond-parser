export const NAMESPACE = 'beavers-beyond-parser';

export const SETTINGS = {
  PROXY_URL: 'proxyUrl',
  MONSTER_PACKS: 'monsterPacks',
  SPELL_PACKS: 'spellPacks',
  AI_SUPPORT_ENABLED: 'aiSupportEnabled',
} as const;

export const COMPENDIUM_ITEM_PACK_PRIORITY = [
  // Primary — core rulebooks (highest priority)
  'dnd-players-handbook.items',
  'dnd-monster-manual.items',
  'dnd-dungeon-masters-guide.items',
  // Legacy — dnd5e built-in packs (lowest priority)
  'dnd5e.items',
  'dnd5e.spells',
  'dnd5e.classfeatures',
  'dnd5e.monsterfeatures',
  'dnd5e.backgrounds',
  'dnd5e.equipment',
  'dnd5e.tradegoods',
];
