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

  // Button shown in Module Settings for this module
  game.settings.registerMenu(NAMESPACE, 'importAdventure', {
    name: 'Import Adventure',
    label: 'Import Adventure',
    hint: 'Open the D&D Beyond adventure importer.',
    icon: 'fas fa-file-import',
    type: class {
      render() {
        ImportAdventureWindow.open();
      }
    } as any,
    restricted: true,
  });
});

Hooks.once('ready', () => {
  console.log(`${NAMESPACE} | Ready`);
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
