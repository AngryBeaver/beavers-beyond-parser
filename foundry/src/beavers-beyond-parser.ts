import { NAMESPACE, SETTINGS } from './definitions.js';
import { ImportAdventureWindow } from './apps/ImportAdventureWindow.js';
import { ImportMonsterWindow } from './apps/ImportMonsterWindow.js';
import { ImportItemWindow } from './apps/ImportItemWindow.js';

Hooks.once('init', () => {
  game.settings.register(NAMESPACE, SETTINGS.PROXY_URL, {
    name: 'Parser Proxy URL',
    hint: 'URL of the running beavers-beyond-parser Docker container. Start with: docker compose -f beyond-parser-compose.yml up -d',
    scope: 'world',
    config: true,
    type: String,
    default: 'http://localhost:3001',
  });

  game.settings.register(NAMESPACE, SETTINGS.AI_SUPPORT_ENABLED, {
    name: 'Enable AI Support',
    hint: 'Uses beavers-ai-assistant to semantically match and patch compendium items. Requires the beavers-ai-assistant module to be active and configured.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });

  // Button shown in Module Settings for this module
  game.settings.registerMenu(NAMESPACE, 'importAdventure', {
    name: 'Import Adventure',
    label: 'Import Adventure',
    hint: 'Open the D&D Beyond adventure importer.',
    icon: 'fas fa-file-import',
    type: class extends (foundry.applications.api.ApplicationV2 as any) {
      render() {
        ImportAdventureWindow.open();
        return this;
      }
    } as any,
    restricted: true,
  });
});

Hooks.once('ready', () => {
  console.log(`${NAMESPACE} | Ready`);

  const aiEnabled = game.settings.get(NAMESPACE, SETTINGS.AI_SUPPORT_ENABLED) as boolean;
  if (aiEnabled) {
    if (!(game.modules as any).get('beavers-ai-assistant')?.active) {
      ui.notifications?.warn(
        'beavers-beyond-parser: AI support is enabled but the beavers-ai-assistant module is not active.',
      );
    } else if (!(game as any)['beavers-ai-assistant']?.AiService?.isConfigured()) {
      ui.notifications?.warn(
        'beavers-beyond-parser: AI support is enabled but beavers-ai-assistant has no API key configured.',
      );
    }
  }
});

// "Import Adventure" button in the Journal sidebar header
Hooks.on('renderJournalDirectory', (_app: unknown, html: unknown) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : (html as any)?.[0];
  const actionButtons = root?.querySelector?.('.header-actions.action-buttons');
  if (!actionButtons || actionButtons.querySelector('.bbp-journal-import')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add('bbp-journal-import');
  btn.innerHTML = '<i class="fa-solid fa-file-import"></i><span>Import Adventure</span>';
  btn.addEventListener('click', () => ImportAdventureWindow.open());
  actionButtons.appendChild(btn);
});

// "Import Items" button in the Items sidebar header
Hooks.on('renderItemDirectory', (_app: unknown, html: unknown) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : (html as any)?.[0];
  const actionButtons = root?.querySelector?.('.header-actions.action-buttons');
  if (!actionButtons || actionButtons.querySelector('.bbp-item-import')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add('bbp-item-import');
  btn.innerHTML = '<i class="fa-solid fa-hat-wizard"></i><span>Import Items</span>';
  btn.addEventListener('click', () => ImportItemWindow.open());
  actionButtons.appendChild(btn);
});

// "Import Monster" button in the Actors sidebar header
Hooks.on('renderActorDirectory', (_app: unknown, html: unknown) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : (html as any)?.[0];
  const actionButtons = root?.querySelector?.('.header-actions.action-buttons');
  if (!actionButtons || actionButtons.querySelector('.bbp-actor-import')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add('bbp-actor-import');
  btn.innerHTML = '<i class="fa-solid fa-dragon"></i><span>Import Monster</span>';
  btn.addEventListener('click', () => ImportMonsterWindow.open());
  actionButtons.appendChild(btn);
});
