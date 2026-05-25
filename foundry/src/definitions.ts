export const NAMESPACE = 'beavers-beyond-parser';

export const SETTINGS = {
  PROXY_URL: 'proxyUrl',
  AI_SUPPORT_ENABLED: 'aiSupportEnabled',
} as const;

// Modules whose Item packs are searched first (order defines inter-module priority)
export const PRIMARY_PACK_MODULES = [
  'dnd-players-handbook',
  'dnd-monster-manual',
  'dnd-dungeon-masters-guide',
];

// Modules whose Item packs are searched last (fallback / legacy content)
export const LEGACY_PACK_MODULES = ['dnd5e'];
